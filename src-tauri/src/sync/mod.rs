//! Single-Postgres sync engine (`07-sync-plan.md`, MVP slice).
//!
//! One general implementation over the Postgres wire protocol: any server
//! works (hosted Postgres or a local container) because nothing here is
//! provider-specific — the connection string selects the server, exactly
//! like it selects the database for every other Postgres tool.
//!
//! A cycle is push-then-pull (`§8` loop, minus the background timer, which
//! the frontend owns with a 60 s interval in this slice):
//!
//! 1. **Push** — drain the outbox (written from day one, R5) in dependency
//!    order tags → folders → notes, 50 distinct rows per batch. Server `rev`
//!    comes from the global `sync_rev_seq` and is echoed back to the row
//!    (R4); the row goes clean with `synced_at` set.
//! 2. **Pull** — per-table `rev > watermark` fetch, applied with the §5
//!    conflict policy. Watermarks live in `sync_state`.
//!
//! Conflict policy (never silently lose data, principle 4):
//!
//! - folders / tags — LWW per row on `updated_at`; delete beats a
//!   concurrent rename (the row is tombstoned, §5.2/§5.4).
//! - notes — disjoint field changes merge; a both-sides-changed `doc_json`
//!   is never auto-resolved: the local document stays live and the remote
//!   one is parked in `conflicts` behind a non-modal badge (§5.1).
//! - `note_tags` — set union on concurrent change (§5.3).
//!
//! Locking: one cycle at a time, guarded by an in-process lock (§8). A
//! second caller gets `already_running` rather than queueing.
//!
//! The rusqlite `Mutex` is never held across an `.await`: every phase loads
//! what it needs, releases the connection, talks to the server, then
//! writes back.

use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio_postgres::Client;

use crate::db::Database;
use crate::error::AppError;

const BATCH_ROWS: usize = 50;
const PULL_LIMIT: i64 = 200;
const PULL_PAGES_PER_CYCLE: usize = 10;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// Every server round trip carries a deadline. Without one, a stalled
/// pooled session hangs the cycle forever: the in-process lock never
/// releases and every later cycle reports `already_running` while nothing
/// moves — observed against a hosted pooler, where a blackholed query is
/// a fact of life, not a theory.
const QUERY_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_BATCHES_PER_CYCLE: usize = 20;
/// Per-row retry backoff (§8, Phase E). A failing row records `attempts` and
/// the earliest epoch-ms it is due again (`outbox.next_retry_at`); the drain
/// skips rows that are not due yet, so one dead row neither spins the queue
/// at full speed nor blocks the rows behind it. Growth is ×4 from a 30 s
/// base — 30 s, 2 min, 8 min — capped at 30 min so a long outage cannot
/// stall the tab past the next launch.
const RETRY_BASE_MS: i64 = 30_000;
const RETRY_CAP_MS: i64 = 30 * 60_000;

/// Exponential backoff for a row that has just failed `attempts` times
/// (1-based: the first failure waits out the base delay).
fn retry_delay_ms(attempts: i64) -> i64 {
    let mut delay = RETRY_BASE_MS;
    for _ in 1..attempts.max(1) {
        delay = delay.saturating_mul(4).min(RETRY_CAP_MS);
    }
    delay.min(RETRY_CAP_MS)
}

const KEY_CONNECTION: &str = "connection_string";
const KEY_ENDPOINT: &str = "endpoint_id";
const KEY_ENABLED: &str = "enabled";
const KEY_FOLDERS_REV: &str = "folders_rev";
const KEY_TAGS_REV: &str = "tags_rev";
const KEY_NOTES_REV: &str = "notes_rev";
const KEY_LAST_SYNCED: &str = "last_synced_at";
const KEY_LAST_ATTEMPT: &str = "last_attempt_at";
const KEY_LAST_ERROR: &str = "last_error";

/// What `sync_get_status` reports. All timestamps are epoch ms (R2).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub configured: bool,
    pub enabled: bool,
    pub pending_count: i64,
    pub conflict_count: i64,
    pub last_synced_at: Option<i64>,
    pub last_attempt_at: Option<i64>,
    pub last_error: Option<String>,
}

/// What one `sync_now` cycle did. `deferred` counts remote rows that were
/// deliberately not applied this cycle: the open note's, while it is being
/// edited (Phase-E open-editor guard). They are re-fetched next cycle.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncSummary {
    pub pushed: i64,
    pub pulled: i64,
    pub conflicts: i64,
    pub deferred: i64,
    pub already_running: bool,
}

impl SyncSummary {
    fn busy() -> Self {
        Self {
            pushed: 0,
            pulled: 0,
            conflicts: 0,
            deferred: 0,
            already_running: true,
        }
    }
}

/// One parked remote document, for the conflict badge and resolver.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncConflict {
    pub id: String,
    pub note_id: String,
    pub note_title: String,
    pub local_rev: i64,
    pub remote_rev: i64,
    pub remote_title: String,
    pub created_at: i64,
}

pub struct SyncService {
    db: Arc<Database>,
    /// One cycle at a time (§8). A tokio mutex whose guard is `Send`, so it
    /// can be held across the network awaits below — a std guard cannot.
    lock: tokio::sync::Mutex<()>,
}

impl SyncService {
    pub fn new(db: Arc<Database>) -> Self {
        Self {
            db,
            lock: tokio::sync::Mutex::new(()),
        }
    }

    pub fn status(&self) -> Result<SyncStatus, AppError> {
        status_of(&self.db)
    }

    /// An empty string keeps the stored secret and only flips the switch,
    /// so the frontend can save "enable" without ever reading the secret
    /// back. A non-empty string must look like Postgres.
    ///
    /// Changing the server re-bootstraps (§6): revisions and watermarks are
    /// meaningless against a database that has never seen this device, so
    /// every local row is re-queued and the watermarks restart at zero.
    /// Without this, rows marked clean against server A stay silent on
    /// server B forever — observed exactly that way when a config was
    /// swapped by hand underneath the engine. A missing stored endpoint
    /// counts as changed, so upgrades and hand-edited databases converge
    /// instead of diverging silently.
    pub fn set_config(&self, connection_string: &str, enabled: bool) -> Result<(), AppError> {
        let clean = connection_string.trim();
        self.db.with_conn(|conn| {
            let tx = conn.transaction()?;
            if !clean.is_empty() {
                if !clean.starts_with("postgresql://") && !clean.starts_with("postgres://") {
                    return Err(AppError::Validation(
                        "That does not look like a Postgres connection string — it should start with postgresql://.".into(),
                    ));
                }
                put_state(&tx, KEY_CONNECTION, clean)?;
            } else if get_state(&tx, KEY_CONNECTION)?.unwrap_or_default().trim().is_empty() {
                return Err(AppError::Validation(
                    "Paste a connection string first — there is nothing saved yet.".into(),
                ));
            }
            let endpoint = endpoint_id(
                get_state(&tx, KEY_CONNECTION)?.unwrap_or_default().as_str(),
            );
            let previous = get_state(&tx, KEY_ENDPOINT)?;
            if previous.as_deref() != Some(endpoint.as_str()) {
                rebootstrap_tx(&tx)?;
                put_state(&tx, KEY_ENDPOINT, &endpoint)?;
            }
            put_state(
                &tx,
                KEY_ENABLED,
                if enabled { "1" } else { "0" },
            )?;
            put_state(&tx, KEY_LAST_ERROR, "")?;
            tx.commit()?;
            Ok(())
        })
    }

    /// Re-queues every surviving row and restarts the pull watermarks (§6
    /// recovery). Without this, a wiped server against clean rows and stale
    /// watermarks is permanent divergence with no way out: a sync would push
    /// nothing (empty outbox) and pull nothing (watermarks past every rev),
    /// and re-saving the same connection string is deliberately a no-op.
    /// Exposed as "Re-upload everything" in Settings → Sync; the next cycle
    /// pushes the whole library and pulls since zero. Returns the queued
    /// row count so the UI can name what happened.
    pub fn reupload_all(&self) -> Result<i64, AppError> {
        self.db.with_conn(|conn| {
            let tx = conn.transaction()?;
            rebootstrap_tx(&tx)?;
            let queued: i64 = tx.query_row(
                "SELECT COUNT(*) FROM outbox WHERE sent_at IS NULL",
                (),
                |row| row.get(0),
            )?;
            tx.commit()?;
            Ok(queued)
        })
    }

    pub fn list_conflicts(&self) -> Result<Vec<SyncConflict>, AppError> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT c.id, c.note_id, COALESCE(n.title, ''),
                        c.local_rev, c.remote_rev, c.remote_title, c.created_at
                   FROM conflicts c
              LEFT JOIN notes n ON n.id = c.note_id
               ORDER BY c.created_at DESC",
            )?;
            let rows = stmt
                .query_map((), |row| {
                    Ok(SyncConflict {
                        id: row.get(0)?,
                        note_id: row.get(1)?,
                        note_title: row.get(2)?,
                        local_rev: row.get(3)?,
                        remote_rev: row.get(4)?,
                        remote_title: row.get(5)?,
                        created_at: row.get(6)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        })
    }

    /// Keep-local drops the parked copy (the live document already won on
    /// the next push). Use-remote applies the *parked* remote document from
    /// the conflicts table — never the live server row. The push that parked
    /// the conflict already overwrote the server with the local document
    /// (§5.1: keep-local converges in one round), so the live row *is* the
    /// local version and fetching it would behave exactly like keep-local.
    /// The parked copy is what the UI showed as "Other version", and applying
    /// it needs no network: filing, pin and tags stay as they are (tags were
    /// already unioned at park time, §5.3), only the text is restored (R9),
    /// then the row is re-queued so the next push converges the server.
    pub async fn resolve_conflict(&self, id: &str, keep_local: bool) -> Result<(), AppError> {
        let (note_id, remote_doc, remote_title) = self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT note_id, remote_doc, remote_title FROM conflicts WHERE id = ?1",
                [id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .map_err(|err| match err {
                rusqlite::Error::QueryReturnedNoRows => AppError::NotFound,
                other => AppError::from(other),
            })
        })?;

        if keep_local {
            return self.db.with_conn(|conn| {
                let tx = conn.transaction()?;
                tx.execute("DELETE FROM conflicts WHERE id = ?1", [id])?;
                ensure_outbox(&tx, "note", &note_id)?;
                tx.commit()?;
                Ok(())
            });
        }

        self.db.with_conn(|conn| {
            let tx = conn.transaction()?;
            let doc: serde_json::Value =
                serde_json::from_str(&remote_doc)
                    .map_err(|err| AppError::internal(format!("remote document is not valid JSON: {err}")))?;
            crate::doc::validate::validate(&doc)?;
            let title_source: String = tx
                .query_row(
                    "SELECT title_source FROM notes WHERE id = ?1",
                    [&note_id],
                    |row| row.get(0),
                )
                .map_err(|_| AppError::NotFound)?;
            let derived = crate::services::derive::derive(&doc, &title_source);
            // `manual` titles derive to "": fall back to the parked remote
            // title the other device stored, rather than blanking the row.
            let title = if derived.title.is_empty() && !remote_title.is_empty() {
                remote_title.clone()
            } else {
                derived.title
            };
            let now = crate::clock::now_ms();
            tx.execute(
                "UPDATE notes
                    SET title = ?2, doc_json = ?3, plain_text = ?4, excerpt = ?5,
                        word_count = ?6,
                        dirty = 1, updated_at = ?7, deleted_at = NULL
                  WHERE id = ?1",
                rusqlite::params![
                    note_id,
                    title,
                    remote_doc,
                    derived.plain_text,
                    derived.excerpt,
                    derived.word_count,
                    now,
                ],
            )?;
            let base: i64 =
                tx.query_row("SELECT rev FROM notes WHERE id = ?1", [&note_id], |row| row.get(0))?;
            tx.execute(
                "UPDATE outbox SET sent_at = ?2 WHERE sent_at IS NULL AND entity = 'note' AND entity_id = ?1",
                rusqlite::params![note_id, now],
            )?;
            crate::repo::append_outbox(&tx, "note", &note_id, "upsert", None, base)?;
            tx.execute("DELETE FROM conflicts WHERE note_id = ?1", [&note_id])?;
            tx.commit()?;
            Ok(())
        })
    }

    fn configured_connection(&self) -> Result<String, AppError> {
        self.db.with_conn(|conn| {
            let s = get_state(conn, KEY_CONNECTION)?.unwrap_or_default();
            let e = get_state(conn, KEY_ENABLED)?.as_deref() == Some("1");
            if !e || s.trim().is_empty() {
                return Err(AppError::Validation(
                    "Sync is not configured yet — paste a connection string under Settings → Sync."
                        .into(),
                ));
            }
            Ok(s)
        })
    }

    /// One push-then-pull cycle. Bootstrap (§6) needs no special case: the
    /// outbox has recorded every local write since day one, so draining it
    /// in dependency order *is* the upload, and pull only starts after.
    ///
    /// `open_note_id` is the note on screen, if any (Phase-E open-editor
    /// guard). The frontend flushes the autosave before calling, so SQLite
    /// holds what the user typed; a remote change for that same note is then
    /// deferred rather than applied under the cursor, and re-fetched next
    /// cycle. Nothing is ever clobbered while it is being typed.
    pub async fn run_cycle(&self, open_note_id: Option<&str>) -> Result<SyncSummary, AppError> {
        let _guard = match self.lock.try_lock() {
            Ok(guard) => guard,
            Err(_) => return Ok(SyncSummary::busy()),
        };

        // Heartbeat first: if the cycle below stalls, the next status read
        // still shows a fresh attempt rather than a dead silence that looks
        // identical to "never tried".
        let attempt_at = crate::clock::now_ms();
        self.db.with_conn(|conn| {
            put_state(conn, KEY_LAST_ATTEMPT, &attempt_at.to_string())?;
            Ok::<_, AppError>(())
        })?;

        let conn_str = self.configured_connection()?;
        let client = connect(&conn_str).await.inspect_err(|err| {
            let _ = self
                .db
                .with_conn(|conn| put_state(conn, KEY_LAST_ERROR, &err.log_line()));
        })?;

        let mut pushed = 0i64;
        let mut pulled = 0i64;

        for _ in 0..MAX_BATCHES_PER_CYCLE {
            let batch = self
                .db
                .with_conn(|conn| pending_batch(conn, crate::clock::now_ms()))?;
            if batch.is_empty() {
                break;
            }
            let mut progressed = false;
            for row in batch {
                match self.push_one(&client, &row).await {
                    Ok(PushOutcome::Pushed) => {
                        self.supersede(&row.entity_id, row.outbox_id)?;
                        pushed += 1;
                        progressed = true;
                    }
                    Ok(PushOutcome::Rebased) => {
                        self.supersede(&row.entity_id, row.outbox_id)?;
                        pulled += 1;
                        progressed = true;
                    }
                    Ok(PushOutcome::ConflictParked) => {
                        self.supersede(&row.entity_id, row.outbox_id)?;
                        pushed += 1;
                        progressed = true;
                    }
                    Ok(PushOutcome::Skipped) => {
                        progressed = true;
                    }
                    Err(err) => {
                        self.record_row_error(row.outbox_id, &err.log_line())?;
                        // A dead row must not pin the queue: keep draining.
                    }
                }
            }
            if !progressed {
                break;
            }
        }

        let (pulled_pull, deferred) = self.pull_all(&client, open_note_id).await?;
        pulled += pulled_pull;
        let conflicts = self.db.with_conn(|conn| {
            conn.query_row("SELECT COUNT(*) FROM conflicts", (), |row| row.get(0))
                .map_err(AppError::from)
        })?;

        let now = crate::clock::now_ms();
        self.db.with_conn(|conn| {
            put_state(conn, KEY_LAST_SYNCED, &now.to_string())?;
            put_state(conn, KEY_LAST_ERROR, "")?;
            Ok(())
        })?;

        Ok(SyncSummary {
            pushed,
            pulled,
            conflicts,
            deferred,
            already_running: false,
        })
    }

    fn record_row_error(&self, outbox_id: i64, detail: &str) -> Result<(), AppError> {
        self.db.with_conn(|conn| {
            let attempts: i64 = conn
                .query_row(
                    "SELECT attempts FROM outbox WHERE id = ?1",
                    [outbox_id],
                    |row| row.get(0),
                )
                .unwrap_or(0);
            let next = attempts + 1;
            let retry_at = crate::clock::now_ms().saturating_add(retry_delay_ms(next));
            conn.execute(
                "UPDATE outbox SET attempts = ?2, last_error = ?3, next_retry_at = ?4 WHERE id = ?1",
                rusqlite::params![outbox_id, next, detail, retry_at],
            )?;
            put_state(conn, KEY_LAST_ERROR, detail)?;
            Ok(())
        })
    }

    async fn push_one(&self, client: &Client, row: &OutboxRow) -> Result<PushOutcome, AppError> {
        match (row.entity.as_str(), row.op.as_str()) {
            ("tag", _) => self.push_tag(client, row).await,
            ("folder", _) => self.push_folder(client, row).await,
            ("note", _) => self.push_note(client, row).await,
            // `note_tags` collapses into its note's row (replace_tags); a
            // stray row is acknowledged, never retried forever.
            _ => {
                self.db.with_conn(|conn| {
                    conn.execute(
                        "UPDATE outbox SET sent_at = ?2 WHERE id = ?1",
                        [row.outbox_id, crate::clock::now_ms()],
                    )?;
                    Ok::<_, AppError>(())
                })?;
                Ok(PushOutcome::Skipped)
            }
        }
    }

    // -- tags -----------------------------------------------------------

    async fn push_tag(&self, client: &Client, row: &OutboxRow) -> Result<PushOutcome, AppError> {
        let local = self
            .db
            .with_conn(|conn| load_local_tag(conn, &row.entity_id))?;
        let id = uid(&row.entity_id)?;

        if row.op == "delete" || local.is_none() {
            // v1 hard-deletes locally; the server keeps a tombstone (§5.4)
            // so a second device can observe the deletion on pull.
            let now = crate::clock::now_ms();
            client_execute(
                client,
                "INSERT INTO tags (id, name, rev, created_at, updated_at, deleted_at)
                 VALUES ($1::uuid, '', nextval('sync_rev_seq'), $2, $2, $2)
                 ON CONFLICT (id) DO UPDATE
                 SET deleted_at = EXCLUDED.deleted_at, updated_at = EXCLUDED.updated_at,
                     rev = nextval('sync_rev_seq')",
                &[&id as _, &now as _],
            )
            .await?;
            self.mark_sent(row.outbox_id)?;
            return Ok(PushOutcome::Pushed);
        }
        let local = local.expect("checked above");

        match query_remote_tag(client, &row.entity_id).await? {
            None => {
                let rev = query_rev(
                    client,
                    "INSERT INTO tags (id, name, rev, created_at, updated_at, deleted_at)
                     VALUES ($1::uuid, $2, nextval('sync_rev_seq'), $3, $4, NULL)
                     RETURNING rev",
                    &[
                        &id as _,
                        &local.name as _,
                        &local.created_at as _,
                        &local.updated_at as _,
                    ],
                )
                .await?;
                self.accept_push("tags", &row.entity_id, rev, row.outbox_id)?;
                Ok(PushOutcome::Pushed)
            }
            Some(remote) if remote.deleted_at.is_some() => {
                // Delete wins over a concurrent rename (§5.2).
                self.db.with_conn(|conn| {
                    let tx = conn.transaction()?;
                    tx.execute("DELETE FROM tags WHERE id = ?1", [&row.entity_id])?;
                    tx.execute("DELETE FROM note_tags WHERE tag_id = ?1", [&row.entity_id])?;
                    mark_sent_tx(&tx, row.outbox_id)?;
                    tx.commit()?;
                    Ok::<_, AppError>(())
                })?;
                Ok(PushOutcome::Rebased)
            }
            Some(remote) if remote.rev > row.base_rev && remote.name != local.name => {
                // Both sides renamed: LWW on updated_at, loser rebases.
                if local.updated_at >= remote.updated_at {
                    let rev = query_rev(
                        client,
                        "UPDATE tags SET name = $2, updated_at = $3, deleted_at = NULL,
                                          rev = nextval('sync_rev_seq')
                         WHERE id = $1::uuid RETURNING rev",
                        &[&id as _, &local.name as _, &local.updated_at as _],
                    )
                    .await?;
                    self.accept_push("tags", &row.entity_id, rev, row.outbox_id)?;
                    Ok(PushOutcome::Pushed)
                } else {
                    self.db.with_conn(|conn| {
                        let tx = conn.transaction()?;
                        tx.execute(
                            "UPDATE tags SET name = ?2, rev = ?3, dirty = 0, updated_at = ?4,
                                             deleted_at = NULL WHERE id = ?1",
                            rusqlite::params![
                                row.entity_id,
                                remote.name,
                                remote.rev,
                                remote.updated_at
                            ],
                        )?;
                        mark_sent_tx(&tx, row.outbox_id)?;
                        tx.commit()?;
                        Ok::<_, AppError>(())
                    })?;
                    Ok(PushOutcome::Rebased)
                }
            }
            Some(_) => {
                let rev = query_rev(
                    client,
                    "UPDATE tags SET name = $2, updated_at = $3, deleted_at = NULL,
                                      rev = nextval('sync_rev_seq')
                     WHERE id = $1::uuid RETURNING rev",
                    &[&id as _, &local.name as _, &local.updated_at as _],
                )
                .await?;
                self.accept_push("tags", &row.entity_id, rev, row.outbox_id)?;
                Ok(PushOutcome::Pushed)
            }
        }
    }

    // -- folders --------------------------------------------------------

    async fn push_folder(&self, client: &Client, row: &OutboxRow) -> Result<PushOutcome, AppError> {
        let local = self
            .db
            .with_conn(|conn| load_local_folder(conn, &row.entity_id))?;
        let id = uid(&row.entity_id)?;

        if row.op == "delete" || local.is_none() {
            // v1 hard-deletes the subtree locally; each tombstoned id keeps
            // a server tombstone so pulls can propagate the deletion. The
            // name is a placeholder that never surfaces: pulls skip
            // tombstones for unknown ids, and the live-name CHECK below
            // rejects an empty string.
            let now = crate::clock::now_ms();
            client_execute(
                client,
                "INSERT INTO folders (id, name, rev, created_at, updated_at, deleted_at)
                 VALUES ($1::uuid, '(deleted)', nextval('sync_rev_seq'), $2, $2, $2)
                 ON CONFLICT (id) DO UPDATE
                 SET deleted_at = EXCLUDED.deleted_at, updated_at = EXCLUDED.updated_at,
                     rev = nextval('sync_rev_seq')",
                &[&id as _, &now as _],
            )
            .await?;
            self.mark_sent(row.outbox_id)?;
            return Ok(PushOutcome::Pushed);
        }
        let local = local.expect("checked above");
        let parent = uid_opt(local.parent_id.as_deref())?;

        match query_remote_folder(client, &row.entity_id).await? {
            None => {
                let rev = query_rev(
                    client,
                    "INSERT INTO folders (id, name, parent_id, position, rev, created_at, updated_at, deleted_at)
                     VALUES ($1::uuid, $2, $3::uuid, $4, nextval('sync_rev_seq'), $5, $6, NULL)
                     RETURNING rev",
                    &[
                        &id as _,
                        &local.name as _,
                        &parent as _,
                        &local.position as _,
                        &local.created_at as _,
                        &local.updated_at as _,
                    ],
                )
                .await?;
                self.accept_push("folders", &row.entity_id, rev, row.outbox_id)?;
                Ok(PushOutcome::Pushed)
            }
            Some(remote) if remote.deleted_at.is_some() => {
                // Delete wins over concurrent rename/move (§5.2).
                self.db.with_conn(|conn| {
                    let tx = conn.transaction()?;
                    tx.execute("DELETE FROM folders WHERE id = ?1", [&row.entity_id])?;
                    tx.execute(
                        "UPDATE notes SET folder_id = NULL WHERE folder_id = ?1",
                        [&row.entity_id],
                    )?;
                    mark_sent_tx(&tx, row.outbox_id)?;
                    tx.commit()?;
                    Ok::<_, AppError>(())
                })?;
                Ok(PushOutcome::Rebased)
            }
            Some(remote)
                if remote.rev > row.base_rev
                    && (remote.name != local.name
                        || remote.parent_id != local.parent_id
                        || remote.position != local.position) =>
            {
                if local.updated_at >= remote.updated_at {
                    let rev = query_rev(
                        client,
                        "UPDATE folders SET name = $2, parent_id = $3::uuid, position = $4,
                                              updated_at = $5, deleted_at = NULL,
                                              rev = nextval('sync_rev_seq')
                         WHERE id = $1::uuid RETURNING rev",
                        &[
                            &id as _,
                            &local.name as _,
                            &parent as _,
                            &local.position as _,
                            &local.updated_at as _,
                        ],
                    )
                    .await?;
                    self.accept_push("folders", &row.entity_id, rev, row.outbox_id)?;
                    Ok(PushOutcome::Pushed)
                } else {
                    self.db.with_conn(|conn| {
                        let tx = conn.transaction()?;
                        tx.execute(
                            "UPDATE folders
                                SET name = ?2, parent_id = ?3, position = ?4,
                                    rev = ?5, dirty = 0, updated_at = ?6, deleted_at = NULL
                              WHERE id = ?1",
                            rusqlite::params![
                                row.entity_id,
                                remote.name,
                                remote.parent_id,
                                remote.position,
                                remote.rev,
                                remote.updated_at
                            ],
                        )?;
                        mark_sent_tx(&tx, row.outbox_id)?;
                        tx.commit()?;
                        Ok::<_, AppError>(())
                    })?;
                    Ok(PushOutcome::Rebased)
                }
            }
            Some(_) => {
                let rev = query_rev(
                    client,
                    "UPDATE folders SET name = $2, parent_id = $3::uuid, position = $4,
                                          updated_at = $5, deleted_at = NULL,
                                          rev = nextval('sync_rev_seq')
                     WHERE id = $1::uuid RETURNING rev",
                    &[
                        &id as _,
                        &local.name as _,
                        &parent as _,
                        &local.position as _,
                        &local.updated_at as _,
                    ],
                )
                .await?;
                self.accept_push("folders", &row.entity_id, rev, row.outbox_id)?;
                Ok(PushOutcome::Pushed)
            }
        }
    }

    // -- notes ----------------------------------------------------------

    async fn push_note(&self, client: &Client, row: &OutboxRow) -> Result<PushOutcome, AppError> {
        let local = self
            .db
            .with_conn(|conn| load_local_note(conn, &row.entity_id))?;
        let id = uid(&row.entity_id)?;

        if row.op == "delete" || local.is_none() {
            // Soft or hard local delete → server tombstone (§5.4). The id
            // stays server-side so a second device observes the deletion
            // instead of resurrecting the note.
            let now = crate::clock::now_ms();
            let tombstone_at = local
                .as_ref()
                .and_then(|note| note.deleted_at)
                .unwrap_or(now);
            let rev = query_rev(
                client,
                "INSERT INTO notes (id, doc_json, rev, created_at, updated_at, deleted_at)
                 VALUES ($1::uuid, '{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\"}]}', nextval('sync_rev_seq'), $2, $2, $3)
                 ON CONFLICT (id) DO UPDATE
                 SET deleted_at = EXCLUDED.deleted_at, updated_at = EXCLUDED.updated_at,
                     rev = nextval('sync_rev_seq')
                 RETURNING rev",
                &[&id as _, &now as _, &tombstone_at as _],
            )
            .await?;
            if local.is_some() {
                self.db.with_conn(|conn| {
                    conn.execute(
                        "UPDATE notes SET rev = ?2, dirty = 0 WHERE id = ?1",
                        rusqlite::params![row.entity_id, rev],
                    )?;
                    Ok::<_, AppError>(())
                })?;
            }
            self.mark_sent(row.outbox_id)?;
            return Ok(PushOutcome::Pushed);
        }
        let local = local.expect("checked above");

        match query_remote_note(client, &row.entity_id).await? {
            None => {
                let rev = insert_remote_note(client, &row.entity_id, &local).await?;
                let remote_tags: Vec<String> = Vec::new();
                self.push_note_tags(client, &row.entity_id, &local.tag_ids, &remote_tags)
                    .await?;
                self.accept_push("notes", &row.entity_id, rev, row.outbox_id)?;
                Ok(PushOutcome::Pushed)
            }
            Some(remote) if remote.deleted_at.is_some() => {
                if local.deleted_at.is_some() {
                    // Both deleted: converge on the tombstone.
                    self.db.with_conn(|conn| {
                        conn.execute(
                            "UPDATE notes SET rev = ?2, dirty = 0 WHERE id = ?1",
                            rusqlite::params![row.entity_id, remote.rev],
                        )?;
                        Ok::<_, AppError>(())
                    })?;
                    self.mark_sent(row.outbox_id)?;
                    Ok(PushOutcome::Pushed)
                } else {
                    // Delete wins over concurrent edit (§5.2): apply the
                    // tombstone locally. The parked-conflict path does not
                    // apply — there is no remote content worth keeping.
                    self.db.with_conn(|conn| {
                        let tx = conn.transaction()?;
                        tx.execute(
                            "UPDATE notes SET deleted_at = ?2, rev = ?3, dirty = 0, updated_at = ?2 WHERE id = ?1",
                            rusqlite::params![row.entity_id, remote.deleted_at, remote.rev],
                        )?;
                        mark_sent_tx(&tx, row.outbox_id)?;
                        tx.commit()?;
                        Ok::<_, AppError>(())
                    })?;
                    Ok(PushOutcome::Rebased)
                }
            }
            Some(remote) if remote.rev > row.base_rev => {
                self.push_note_conflicted(client, row, &local, &remote)
                    .await
            }
            Some(_) => {
                let rev = update_remote_note(client, &row.entity_id, &local).await?;
                let remote_tags: Vec<String> = Vec::new();
                self.push_note_tags(client, &row.entity_id, &local.tag_ids, &remote_tags)
                    .await?;
                self.accept_push("notes", &row.entity_id, rev, row.outbox_id)?;
                Ok(PushOutcome::Pushed)
            }
        }
    }

    /// Both sides changed since `base_rev`. Disjoint fields merge; a
    /// changed `doc_json` parks the remote copy and keeps local live (§5.1).
    async fn push_note_conflicted(
        &self,
        client: &Client,
        row: &OutboxRow,
        local: &LocalNote,
        remote: &RemoteNote,
    ) -> Result<PushOutcome, AppError> {
        let remote_tags = query_remote_note_tags(client, &row.entity_id).await?;

        if !docs_equal(&local.doc_json, &remote.doc_json) {
            park_conflict(
                &self.db,
                &row.entity_id,
                local.rev,
                remote.rev,
                &remote.doc_json,
                &remote.title,
            )?;
            // Tag sets still union — the text conflict must not eat a tag
            // the other device added (§5.3).
            let union = union_sets(&local.tag_ids, &remote_tags);
            self.db.with_conn(|conn| {
                replace_local_tags(conn, &row.entity_id, &union)?;
                Ok::<_, AppError>(())
            })?;
            let rev = update_remote_note(client, &row.entity_id, local).await?;
            self.push_note_tags(client, &row.entity_id, &union, &remote_tags)
                .await?;
            self.accept_push("notes", &row.entity_id, rev, row.outbox_id)?;
            return Ok(PushOutcome::ConflictParked);
        }

        // Disjoint metadata change: merge field-wise, LWW per field.
        let folder_id =
            if remote.folder_id != local.folder_id && local.updated_at < remote.updated_at {
                remote.folder_id.clone()
            } else {
                local.folder_id.clone()
            };
        let is_pinned =
            if remote.is_pinned != local.is_pinned && local.updated_at < remote.updated_at {
                remote.is_pinned
            } else {
                local.is_pinned
            };
        let union = union_sets(&local.tag_ids, &remote_tags);
        let merged = LocalNote {
            folder_id,
            is_pinned,
            tag_ids: union.clone(),
            ..local.clone()
        };
        let rev = update_remote_note(client, &row.entity_id, &merged).await?;
        self.push_note_tags(client, &row.entity_id, &union, &remote_tags)
            .await?;
        self.db.with_conn(|conn| {
            let tx = conn.transaction()?;
            tx.execute(
                "UPDATE notes SET folder_id = ?2, is_pinned = ?3, rev = ?4, dirty = 0, updated_at = ?5 WHERE id = ?1",
                rusqlite::params![
                    row.entity_id,
                    merged.folder_id,
                    i64::from(merged.is_pinned),
                    rev,
                    local.updated_at
                ],
            )?;
            replace_local_tags(&tx, &row.entity_id, &union)?;
            mark_sent_tx(&tx, row.outbox_id)?;
            tx.commit()?;
            Ok::<_, AppError>(())
        })?;
        Ok(PushOutcome::Pushed)
    }

    async fn push_note_tags(
        &self,
        client: &Client,
        note_id: &str,
        want: &[String],
        have: &[String],
    ) -> Result<(), AppError> {
        if want == have {
            return Ok(());
        }
        let note = uid(note_id)?;
        let want_ids: Vec<uuid::Uuid> =
            want.iter().map(|tag| uid(tag)).collect::<Result<_, _>>()?;
        let now = crate::clock::now_ms();
        client_execute(
            client,
            "DELETE FROM note_tags WHERE note_id = $1::uuid",
            &[&note as _],
        )
        .await?;
        for tag_id in &want_ids {
            client_execute(
                client,
                "INSERT INTO note_tags (note_id, tag_id, created_at)
                 VALUES ($1::uuid, $2::uuid, $3) ON CONFLICT DO NOTHING",
                &[&note as _, tag_id as _, &now as _],
            )
            .await?;
        }
        Ok(())
    }
    fn mark_sent(&self, outbox_id: i64) -> Result<(), AppError> {
        let now = crate::clock::now_ms();
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE outbox SET sent_at = ?2 WHERE id = ?1",
                rusqlite::params![outbox_id, now],
            )?;
            Ok(())
        })
    }

    /// Older queued rows for the same entity are superseded by the state
    /// just arbitrated: without this, a stale upsert queued before a delete
    /// (or before a rebase) would re-push deleted content over the server
    /// on a later cycle. The delete arms bypass `accept_push`, so this runs
    /// centrally for every successful outcome instead.
    fn supersede(&self, entity_id: &str, outbox_id: i64) -> Result<(), AppError> {
        let now = crate::clock::now_ms();
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE outbox SET sent_at = ?3 WHERE sent_at IS NULL AND entity_id = ?1 AND id <> ?2",
                rusqlite::params![entity_id, outbox_id, now],
            )?;
            Ok(())
        })
    }

    fn accept_push(&self, table: &str, id: &str, rev: i64, outbox_id: i64) -> Result<(), AppError> {
        let now = crate::clock::now_ms();
        self.db.with_conn(|conn| {
            let tx = conn.transaction()?;
            tx.execute(
                &format!("UPDATE {table} SET rev = ?2, dirty = 0 WHERE id = ?1"),
                rusqlite::params![id, rev],
            )?;
            if table == "notes" {
                tx.execute(
                    "UPDATE notes SET synced_at = ?2 WHERE id = ?1",
                    rusqlite::params![id, now],
                )?;
            }
            mark_sent_tx(&tx, outbox_id)?;
            // An older queued row for the same entity is superseded by the
            // state just pushed: acknowledge it so it never re-pushes stale
            // content over the server.
            tx.execute(
                "UPDATE outbox SET sent_at = ?3 WHERE sent_at IS NULL AND entity_id = ?1 AND id <> ?2",
                rusqlite::params![id, outbox_id, now],
            )?;
            tx.commit()?;
            Ok(())
        })
    }

    // -- pull -----------------------------------------------------------

    async fn pull_all(
        &self,
        client: &Client,
        open_note_id: Option<&str>,
    ) -> Result<(i64, i64), AppError> {
        let mut pulled = 0;
        pulled += self.pull_folders(client).await?;
        pulled += self.pull_tags(client).await?;
        let (notes_pulled, deferred) = self.pull_notes(client, open_note_id).await?;
        pulled += notes_pulled;
        Ok((pulled, deferred))
    }

    async fn pull_folders(&self, client: &Client) -> Result<i64, AppError> {
        let mut pulled = 0;
        for _ in 0..PULL_PAGES_PER_CYCLE {
            let watermark = watermark(&self.db, KEY_FOLDERS_REV)?;
            let rows: Vec<RemoteFolder> = client_query(
                client,
                "SELECT id::text AS id, name, parent_id::text AS parent_id, position, rev,
                        created_at, updated_at, deleted_at
                 FROM folders WHERE rev > $1 ORDER BY rev LIMIT $2",
                &[&watermark as _, &PULL_LIMIT as _],
            )
            .await?;
            if rows.is_empty() {
                break;
            }
            let mut max_rev = watermark;
            for remote in &rows {
                max_rev = max_rev.max(remote.rev);
                if self
                    .db
                    .with_conn(|conn| apply_remote_folder(conn, remote))?
                {
                    pulled += 1;
                }
            }
            set_watermark(&self.db, KEY_FOLDERS_REV, max_rev)?;
            if rows.len() < PULL_LIMIT as usize {
                break;
            }
        }
        Ok(pulled)
    }

    async fn pull_tags(&self, client: &Client) -> Result<i64, AppError> {
        let mut pulled = 0;
        for _ in 0..PULL_PAGES_PER_CYCLE {
            let watermark = watermark(&self.db, KEY_TAGS_REV)?;
            let rows: Vec<RemoteTag> = client_query(
                client,
                "SELECT id::text AS id, name, rev, created_at, updated_at, deleted_at
                 FROM tags WHERE rev > $1 ORDER BY rev LIMIT $2",
                &[&watermark as _, &PULL_LIMIT as _],
            )
            .await?;
            if rows.is_empty() {
                break;
            }
            let mut max_rev = watermark;
            for remote in &rows {
                max_rev = max_rev.max(remote.rev);
                if self.db.with_conn(|conn| apply_remote_tag(conn, remote))? {
                    pulled += 1;
                }
            }
            set_watermark(&self.db, KEY_TAGS_REV, max_rev)?;
            if rows.len() < PULL_LIMIT as usize {
                break;
            }
        }
        Ok(pulled)
    }

    /// Pulls notes, deferring the open note's row while it is being edited
    /// (Phase-E open-editor guard). A deferred row is left untouched and the
    /// watermark is held below it, so the row is re-fetched next cycle rather
    /// than skipped forever; re-applying the rows around it is idempotent
    /// (`remote.rev <= local.rev` is a no-op). Returns `(applied, deferred)`.
    async fn pull_notes(
        &self,
        client: &Client,
        open_note_id: Option<&str>,
    ) -> Result<(i64, i64), AppError> {
        let mut pulled = 0;
        let mut deferred = 0;
        for _ in 0..PULL_PAGES_PER_CYCLE {
            let watermark = watermark(&self.db, KEY_NOTES_REV)?;
            let rows: Vec<RemoteNote> = client_query(
                client,
                "SELECT id::text AS id, title, title_source, doc_json::text AS doc_json,
                        plain_text, excerpt, word_count, folder_id::text AS folder_id,
                        is_pinned, rev, created_at, updated_at, deleted_at
                 FROM notes WHERE rev > $1 ORDER BY rev LIMIT $2",
                &[&watermark as _, &PULL_LIMIT as _],
            )
            .await?;
            if rows.is_empty() {
                break;
            }
            let mut max_seen = watermark;
            let mut max_applied = watermark;
            let mut min_skipped: Option<i64> = None;
            for remote in &rows {
                max_seen = max_seen.max(remote.rev);
                if note_pull_skipped(open_note_id, remote, &self.db)? {
                    min_skipped = Some(min_skipped.map_or(remote.rev, |prev| prev.min(remote.rev)));
                    deferred += 1;
                    continue;
                }
                let remote_tags = query_remote_note_tags(client, &remote.id).await?;
                if self
                    .db
                    .with_conn(|conn| apply_remote_note(conn, remote, &remote_tags))?
                    == ApplyOutcome::Applied
                {
                    pulled += 1;
                }
                max_applied = max_applied.max(remote.rev);
            }
            // A skipped row must be re-fetched: hold the watermark below the
            // lowest skip. Rows applied past it are re-fetched too, harmlessly —
            // applying an already-seen rev is a no-op.
            let next = match min_skipped {
                Some(skipped) => max_applied.min(skipped - 1).max(watermark),
                None => max_seen,
            };
            set_watermark(&self.db, KEY_NOTES_REV, next)?;
            if rows.len() < PULL_LIMIT as usize {
                break;
            }
        }
        Ok((pulled, deferred))
    }
}

// -- connection ----------------------------------------------------------

fn network(detail: impl std::fmt::Display) -> AppError {
    AppError::Network(format!("Could not reach the sync server: {detail}"))
}

/// tokio-postgres `Display` says "db error" for every server rejection and
/// drops the code and message — which live in the source chain. A sync log
/// without them is undebuggable (this exact gap once hid a CHECK violation
/// behind a bare "db error" for an hour), so server errors always travel
/// with their chain.
fn pg_error(err: tokio_postgres::Error) -> AppError {
    let mut detail = err.to_string();
    let mut cause = std::error::Error::source(&err);
    while let Some(next) = cause {
        detail.push_str(": ");
        detail.push_str(&next.to_string());
        cause = next.source();
    }
    network(detail)
}

async fn connect(conn_str: &str) -> Result<Client, AppError> {
    let mode = ssl_mode(conn_str);
    // tokio-postgres only accepts disable/prefer/require as `sslmode` — the
    // verifying modes are ours, enforced by the connector below, so the
    // parameter is rewritten to something it parses. Verification and the
    // must-use-TLS decision are independent axes; conflating them is what
    // made `verify-full` a config error instead of a policy.
    let effective = with_sslmode_param(
        conn_str,
        match mode {
            SslMode::Disable => "disable",
            SslMode::Require | SslMode::VerifyFull => "require",
        },
    );
    let owned = effective;
    let dial = async move {
        if mode == SslMode::Disable {
            let (client, connection) =
                tokio_postgres::connect(owned.as_str(), tokio_postgres::NoTls)
                    .await
                    .map_err(network)?;
            tokio::spawn(async move {
                let _ = connection.await;
            });
            Ok(client)
        } else {
            // Bundled Mozilla roots, no OS store: identical behaviour on
            // Windows, Linux and Android, where the system store is not
            // reliably reachable from Rust.
            let mut roots = rustls::RootCertStore::empty();
            roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
            let mut config = rustls::ClientConfig::builder()
                .with_root_certificates(roots)
                .with_no_client_auth();
            if mode == SslMode::Require {
                // `require` encrypts without authenticating the server — the
                // libpq meaning, and the only mode hosted poolers with
                // privately-rooted chains (see below) can speak.
                config
                    .dangerous()
                    .set_certificate_verifier(std::sync::Arc::new(NoVerify));
            }
            let tls = tokio_postgres_rustls::MakeRustlsConnect::new(config);
            let (client, connection) = tokio_postgres::connect(owned.as_str(), tls)
                .await
                .map_err(pg_error)?;
            tokio::spawn(async move {
                let _ = connection.await;
            });
            Ok::<_, AppError>(client)
        }
    };
    tokio::time::timeout(CONNECT_TIMEOUT, dial)
        .await
        .map_err(|_| network("connection timed out after 15 s"))?
}

/// libpq-style `sslmode`, read off the connection string.
///
/// - `disable` — plaintext. Only sensible on loopback; the password itself
///   is still SCRAM-protected, but everything else travels openly.
/// - `require` (the default) — TLS, server not authenticated. This is what
///   `psql` does out of the box, and the only thing that works against a
///   pooler serving a privately-rooted chain: the observed Supabase pooler
///   chain terminates at a "Supabase Intermediate 2021 CA" no public bundle
///   contains, so verification is impossible there by construction, not by
///   neglect. Encryption still defeats passive capture; active MITM is not
///   defended — see `postgres/README.md`.
/// - `verify-full` (and `verify-ca`, which behaves identically — rustls
///   always checks the hostname, and no weaker option is offered) — TLS
///   against the bundled Mozilla roots. Use it for servers with public
///   certificates: direct `db.*` hosts, self-hosted with Let's Encrypt.
/// - `prefer` / `allow` behave as `require`: unlike libpq there is no
///   silent plaintext fallback — a sync that thinks it is encrypted must
///   not quietly run open.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SslMode {
    Disable,
    Require,
    VerifyFull,
}

fn ssl_mode(conn_str: &str) -> SslMode {
    let query = conn_str.rsplit('?').next().unwrap_or("");
    let mut mode = SslMode::Require;
    for pair in query.split('&') {
        let mut parts = pair.splitn(2, '=');
        if parts.next() == Some("sslmode") {
            mode = match parts.next().unwrap_or("").to_lowercase().as_str() {
                "disable" => SslMode::Disable,
                "verify-full" | "verify-ca" => SslMode::VerifyFull,
                _ => SslMode::Require,
            };
        }
    }
    mode
}

/// Accepts any server certificate: the `require` half of libpq semantics.
/// The name is deliberately loud at every use site.
#[derive(Debug)]
struct NoVerify;

impl rustls::client::danger::ServerCertVerifier for NoVerify {
    fn verify_server_cert(
        &self,
        _end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &rustls::pki_types::ServerName<'_>,
        _ocsp_response: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        // Everything is accepted anyway; this only needs to cover what a
        // server may offer so the handshake is never cut short for listing
        // too little.
        vec![
            rustls::SignatureScheme::ECDSA_NISTP256_SHA256,
            rustls::SignatureScheme::ECDSA_NISTP384_SHA384,
            rustls::SignatureScheme::ECDSA_NISTP521_SHA512,
            rustls::SignatureScheme::ED25519,
            rustls::SignatureScheme::RSA_PSS_SHA256,
            rustls::SignatureScheme::RSA_PSS_SHA384,
            rustls::SignatureScheme::RSA_PSS_SHA512,
            rustls::SignatureScheme::RSA_PKCS1_SHA256,
            rustls::SignatureScheme::RSA_PKCS1_SHA384,
            rustls::SignatureScheme::RSA_PKCS1_SHA512,
        ]
    }
}

fn query_timeout() -> String {
    format!(
        "a server round trip timed out after {} s",
        QUERY_TIMEOUT.as_secs()
    )
}

async fn client_execute(
    client: &Client,
    sql: &str,
    params: &[&(dyn tokio_postgres::types::ToSql + Sync)],
) -> Result<u64, AppError> {
    // A Postgres rejection here is a logic error (bad FK, bad JSON), not a
    // network fault — but it travels in `details`, where the status UI and
    // the row's `last_error` show it verbatim.
    tokio::time::timeout(QUERY_TIMEOUT, client.execute(sql, params))
        .await
        .map_err(|_| network(query_timeout()))?
        .map_err(pg_error)
}

async fn query_rev(
    client: &Client,
    sql: &str,
    params: &[&(dyn tokio_postgres::types::ToSql + Sync)],
) -> Result<i64, AppError> {
    let row = tokio::time::timeout(QUERY_TIMEOUT, client.query_one(sql, params))
        .await
        .map_err(|_| network(query_timeout()))?
        .map_err(pg_error)?;
    row.try_get(0).map_err(network)
}

async fn client_query<T>(
    client: &Client,
    sql: &str,
    params: &[&(dyn tokio_postgres::types::ToSql + Sync)],
) -> Result<Vec<T>, AppError>
where
    T: FromRow,
{
    let rows = tokio::time::timeout(QUERY_TIMEOUT, client.query(sql, params))
        .await
        .map_err(|_| network(query_timeout()))?
        .map_err(pg_error)?;
    rows.iter().map(T::from_row).collect()
}

trait FromRow: Sized {
    fn from_row(row: &tokio_postgres::Row) -> Result<Self, AppError>;
}

/// Device ids are UUIDv7 strings (R1); the server columns are `uuid`.
/// Parsing once per call keeps every parameter binary-typed: sending a
/// `String` for a `uuid` column fails on both sides of the wire (no
/// `uuid = text` operator server-side, no `String → uuid` serialisation
/// client-side), so there is no stringly-typed shortcut here.
fn uid(id: &str) -> Result<uuid::Uuid, AppError> {
    uuid::Uuid::parse_str(id)
        .map_err(|err| AppError::internal(format!("stored id is not a UUID: {err}")))
}

fn uid_opt(id: Option<&str>) -> Result<Option<uuid::Uuid>, AppError> {
    id.map(uid).transpose()
}

// -- local state helpers ---------------------------------------------------

fn get_state(conn: &rusqlite::Connection, key: &str) -> Result<Option<String>, AppError> {
    use rusqlite::OptionalExtension;
    conn.query_row(
        "SELECT value FROM sync_state WHERE key = ?1",
        [key],
        |row| row.get(0),
    )
    .optional()
    .map_err(AppError::from)
}

fn put_state(conn: &rusqlite::Connection, key: &str, value: &str) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO sync_state (key, value) VALUES (?1, ?2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        [key, value],
    )?;
    Ok(())
}

fn watermark(db: &Database, key: &str) -> Result<i64, AppError> {
    db.with_conn(|conn| {
        Ok(get_state(conn, key)?
            .and_then(|v| v.parse().ok())
            .unwrap_or(0))
    })
}

fn set_watermark(db: &Database, key: &str, rev: i64) -> Result<(), AppError> {
    db.with_conn(|conn| put_state(conn, key, &rev.to_string()))
}

fn status_of(db: &Database) -> Result<SyncStatus, AppError> {
    db.with_conn(|conn| {
        let conn_str = get_state(conn, KEY_CONNECTION)?.unwrap_or_default();
        let enabled = get_state(conn, KEY_ENABLED)?.as_deref() == Some("1");
        // Distinct changed rows, not outbox rows: every write appends an
        // event, so create-then-delete is two rows but one pending change
        // (the drain collapses to the latest row per entity anyway).
        let pending: i64 = conn.query_row(
            "SELECT COUNT(*) FROM (SELECT DISTINCT entity, entity_id FROM outbox WHERE sent_at IS NULL)",
            (),
            |row| row.get(0),
        )?;
        let conflicts: i64 =
            conn.query_row("SELECT COUNT(*) FROM conflicts", (), |row| row.get(0))?;
        let last_synced = get_state(conn, KEY_LAST_SYNCED)?.and_then(|v| v.parse().ok());
        let last_attempt = get_state(conn, KEY_LAST_ATTEMPT)?.and_then(|v| v.parse().ok());
        let last_error = get_state(conn, KEY_LAST_ERROR)?.filter(|v| !v.is_empty());
        Ok(SyncStatus {
            configured: !conn_str.trim().is_empty(),
            enabled,
            pending_count: pending,
            conflict_count: conflicts,
            last_synced_at: last_synced,
            last_attempt_at: last_attempt,
            last_error,
        })
    })
}

/// Rewrites the `sslmode` query parameter to `value`, keeping every other
/// parameter untouched. `tokio_postgres` parses only disable/prefer/require.
fn with_sslmode_param(conn_str: &str, value: &str) -> String {
    let (base, query) = match conn_str.split_once('?') {
        Some((base, query)) => (base, query),
        None => return format!("{conn_str}?sslmode={value}"),
    };
    let kept: Vec<&str> = query
        .split('&')
        .filter(|pair| pair.split_once('=').map(|(key, _)| key) != Some("sslmode"))
        .collect();
    if kept.is_empty() {
        format!("{base}?sslmode={value}")
    } else {
        format!("{base}?{}&sslmode={value}", kept.join("&"))
    }
}

/// Identifies the server, not the credential: user, host, port and database.
/// A password rotation must not re-upload the world, but a new server must.
/// Compared as an opaque string; parsing is deliberately narrow (what the
/// Settings tab accepts), not a general URL parser.
fn endpoint_id(conn_str: &str) -> String {
    let after_scheme = conn_str
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(conn_str);
    let authority = after_scheme.split('/').next().unwrap_or("");
    let (userinfo, hostport) = match authority.rsplit_once('@') {
        Some((user, host)) => (user, host),
        None => ("", authority),
    };
    let user = userinfo.split(':').next().unwrap_or("");
    let (host, port) = if let Some(rest) = hostport.strip_prefix('[') {
        match rest.split_once("]:") {
            Some((host, port)) => (format!("[{host}]"), port),
            None => (hostport.to_owned(), "5432"),
        }
    } else {
        match hostport.rsplit_once(':') {
            Some((host, port)) if port.chars().all(|c| c.is_ascii_digit()) => {
                (host.to_owned(), port)
            }
            _ => (hostport.to_owned(), "5432"),
        }
    };
    let dbname = after_scheme
        .split('/')
        .nth(1)
        .unwrap_or("")
        .split(['?', ';'])
        .next()
        .unwrap_or("");
    let dbname = if dbname.is_empty() { user } else { dbname };
    format!("{}@{}:{}/{}", user, host.to_lowercase(), port, dbname)
}

/// Re-queues every surviving row and restarts the watermarks: the first
/// sync against a new server uploads everything (§6 bootstrap). Soft-deleted
/// notes queue deletes so their tombstones propagate; hard-deleted folders
/// and tags are already gone locally, so deletions predating the switch do
/// not propagate — documented in `postgres/README.md`.
fn rebootstrap_tx(tx: &rusqlite::Transaction<'_>) -> Result<(), AppError> {
    for (table, entity) in [("tags", "tag"), ("folders", "folder"), ("notes", "note")] {
        tx.execute(&format!("UPDATE {table} SET dirty = 1"), ())?;
        let mut stmt = tx.prepare(&format!("SELECT id, rev, deleted_at FROM {table}"))?;
        let rows: Vec<(String, i64, Option<i64>)> = stmt
            .query_map((), |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
            .collect::<Result<_, _>>()?;
        drop(stmt);
        for (id, rev, deleted_at) in &rows {
            let op = if deleted_at.is_some() {
                "delete"
            } else {
                "upsert"
            };
            crate::repo::append_outbox(tx, entity, id, op, None, *rev)?;
        }
    }
    for key in [KEY_FOLDERS_REV, KEY_TAGS_REV, KEY_NOTES_REV] {
        put_state(tx, key, "0")?;
    }
    tx.execute("DELETE FROM sync_state WHERE key = ?1", [KEY_LAST_SYNCED])?;
    Ok(())
}

/// A queued resolution re-uses the normal path: mark dirty and append.
fn ensure_outbox(
    tx: &rusqlite::Transaction<'_>,
    entity: &str,
    entity_id: &str,
) -> Result<(), AppError> {
    let table = match entity {
        "note" => "notes",
        "folder" => "folders",
        _ => "tags",
    };
    let pending: i64 = tx.query_row(
        "SELECT COUNT(*) FROM outbox WHERE sent_at IS NULL AND entity = ?1 AND entity_id = ?2",
        [entity, entity_id],
        |row| row.get(0),
    )?;
    if pending == 0 {
        let base: i64 = tx
            .query_row(
                &format!("SELECT rev FROM {table} WHERE id = ?1"),
                [entity_id],
                |row| row.get(0),
            )
            .unwrap_or(0);
        crate::repo::append_outbox(tx, entity, entity_id, "upsert", None, base)?;
        tx.execute(
            &format!("UPDATE {table} SET dirty = 1 WHERE id = ?1"),
            [entity_id],
        )?;
    }
    Ok(())
}

fn mark_sent_tx(tx: &rusqlite::Transaction<'_>, outbox_id: i64) -> Result<(), rusqlite::Error> {
    tx.execute(
        "UPDATE outbox SET sent_at = ?2 WHERE id = ?1",
        rusqlite::params![outbox_id, crate::clock::now_ms()],
    )?;
    Ok(())
}

// -- outbox batch ------------------------------------------------------------

#[derive(Debug)]
struct OutboxRow {
    outbox_id: i64,
    entity: String,
    entity_id: String,
    op: String,
    base_rev: i64,
}

fn entity_rank(entity: &str) -> i64 {
    match entity {
        "tag" => 0,
        "folder" => 1,
        "note" => 2,
        _ => 3,
    }
}

/// Latest row per (entity, entity_id), in dependency order. Older rows for
/// the same key are superseded: the push sends full current state, so they
/// can never contribute anything the latest row does not already carry.
///
/// Backoff aware: the "latest" is computed over *all* pending rows first,
/// and only then filtered by due time. Filtering before collapsing would
/// promote an older due row past a newer not-due one, and a successful push
/// of that stale state would supersede the newer row without ever sending
/// it. A not-due latest row skips the whole entity this cycle.
/// Collapsed outbox state per (entity, entity_id): latest row id, op,
/// base_rev and backoff timestamp.
type CollapsedOutbox = std::collections::HashMap<(String, String), (i64, String, i64, Option<i64>)>;

fn pending_batch(conn: &mut rusqlite::Connection, now_ms: i64) -> Result<Vec<OutboxRow>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, entity, entity_id, op, base_rev, next_retry_at
           FROM outbox WHERE sent_at IS NULL
        ORDER BY created_at",
    )?;
    let all: Vec<(i64, String, String, String, i64, Option<i64>)> = stmt
        .query_map((), |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
            ))
        })?
        .collect::<Result<_, _>>()?;
    drop(stmt);

    use std::collections::HashMap;
    let mut latest: CollapsedOutbox = HashMap::new();
    for (id, entity, entity_id, op, base_rev, retry_at) in all {
        latest.insert((entity, entity_id), (id, op, base_rev, retry_at));
    }
    let mut batch: Vec<OutboxRow> = latest
        .into_iter()
        .filter(|(_, (_, _, _, retry_at))| retry_at.is_none_or(|at| at <= now_ms))
        .map(|((entity, entity_id), (id, op, base_rev, _))| OutboxRow {
            outbox_id: id,
            entity,
            entity_id,
            op,
            base_rev,
        })
        .collect();
    batch.sort_by_key(|row| (entity_rank(&row.entity), row.outbox_id));
    batch.truncate(BATCH_ROWS);
    Ok(batch)
}

enum PushOutcome {
    Pushed,
    Rebased,
    ConflictParked,
    Skipped,
}

#[derive(Debug, PartialEq, Eq)]
enum ApplyOutcome {
    Applied,
    Conflicted,
    Unchanged,
}

// -- row shapes ----------------------------------------------------------------

#[derive(Debug, Clone)]
struct LocalTag {
    name: String,
    created_at: i64,
    updated_at: i64,
}

fn load_local_tag(conn: &rusqlite::Connection, id: &str) -> Result<Option<LocalTag>, AppError> {
    let mut stmt = conn.prepare("SELECT name, created_at, updated_at FROM tags WHERE id = ?1")?;
    match stmt.query_row([id], |row| {
        Ok(LocalTag {
            name: row.get(0)?,
            created_at: row.get(1)?,
            updated_at: row.get(2)?,
        })
    }) {
        Ok(tag) => Ok(Some(tag)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(err) => Err(AppError::from(err)),
    }
}

#[derive(Debug, Clone)]
struct RemoteTag {
    id: String,
    name: String,
    rev: i64,
    created_at: i64,
    updated_at: i64,
    deleted_at: Option<i64>,
}

impl FromRow for RemoteTag {
    fn from_row(row: &tokio_postgres::Row) -> Result<Self, AppError> {
        Ok(Self {
            id: row.try_get("id").map_err(network)?,
            name: row.try_get("name").map_err(network)?,
            rev: row.try_get("rev").map_err(network)?,
            created_at: row.try_get("created_at").map_err(network)?,
            updated_at: row.try_get("updated_at").map_err(network)?,
            deleted_at: row.try_get("deleted_at").map_err(network)?,
        })
    }
}

async fn query_remote_tag(client: &Client, id: &str) -> Result<Option<RemoteTag>, AppError> {
    let id = uid(id)?;
    let rows: Vec<RemoteTag> = client_query(
        client,
        "SELECT id::text AS id, name, rev, created_at, updated_at, deleted_at
         FROM tags WHERE id = $1::uuid",
        &[&id as _],
    )
    .await?;
    Ok(rows.into_iter().next())
}

#[derive(Debug, Clone)]
struct LocalFolder {
    name: String,
    parent_id: Option<String>,
    position: i64,
    created_at: i64,
    updated_at: i64,
}

fn load_local_folder(
    conn: &rusqlite::Connection,
    id: &str,
) -> Result<Option<LocalFolder>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT name, parent_id, position, created_at, updated_at FROM folders WHERE id = ?1",
    )?;
    match stmt.query_row([id], |row| {
        Ok(LocalFolder {
            name: row.get(0)?,
            parent_id: row.get(1)?,
            position: row.get(2)?,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
        })
    }) {
        Ok(folder) => Ok(Some(folder)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(err) => Err(AppError::from(err)),
    }
}

#[derive(Debug, Clone)]
struct RemoteFolder {
    id: String,
    name: String,
    parent_id: Option<String>,
    position: i64,
    rev: i64,
    created_at: i64,
    updated_at: i64,
    deleted_at: Option<i64>,
}

impl FromRow for RemoteFolder {
    fn from_row(row: &tokio_postgres::Row) -> Result<Self, AppError> {
        Ok(Self {
            id: row.try_get("id").map_err(network)?,
            name: row.try_get("name").map_err(network)?,
            parent_id: row.try_get("parent_id").map_err(network)?,
            position: row.try_get("position").map_err(network)?,
            rev: row.try_get("rev").map_err(network)?,
            created_at: row.try_get("created_at").map_err(network)?,
            updated_at: row.try_get("updated_at").map_err(network)?,
            deleted_at: row.try_get("deleted_at").map_err(network)?,
        })
    }
}

async fn query_remote_folder(client: &Client, id: &str) -> Result<Option<RemoteFolder>, AppError> {
    let id = uid(id)?;
    let rows: Vec<RemoteFolder> = client_query(
        client,
        "SELECT id::text AS id, name, parent_id::text AS parent_id, position, rev,
                created_at, updated_at, deleted_at
         FROM folders WHERE id = $1::uuid",
        &[&id as _],
    )
    .await?;
    Ok(rows.into_iter().next())
}

#[derive(Debug, Clone)]
struct LocalNote {
    title: String,
    title_source: String,
    doc_json: String,
    plain_text: String,
    excerpt: String,
    word_count: i64,
    folder_id: Option<String>,
    is_pinned: bool,
    rev: i64,
    created_at: i64,
    updated_at: i64,
    deleted_at: Option<i64>,
    tag_ids: Vec<String>,
}

fn load_local_note(conn: &rusqlite::Connection, id: &str) -> Result<Option<LocalNote>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT title, title_source, doc_json, plain_text, excerpt, word_count,
                folder_id, is_pinned, rev, created_at, updated_at, deleted_at
           FROM notes WHERE id = ?1",
    )?;
    let mut note = match stmt.query_row([id], |row| {
        Ok(LocalNote {
            title: row.get(0)?,
            title_source: row.get(1)?,
            doc_json: row.get(2)?,
            plain_text: row.get(3)?,
            excerpt: row.get(4)?,
            word_count: row.get(5)?,
            folder_id: row.get(6)?,
            is_pinned: row.get::<_, i64>(7)? != 0,
            rev: row.get(8)?,
            created_at: row.get(9)?,
            updated_at: row.get(10)?,
            deleted_at: row.get(11)?,
            tag_ids: Vec::new(),
        })
    }) {
        Ok(note) => note,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
        Err(err) => return Err(AppError::from(err)),
    };
    drop(stmt);
    let mut tags =
        conn.prepare("SELECT tag_id FROM note_tags WHERE note_id = ?1 ORDER BY tag_id")?;
    note.tag_ids = tags
        .query_map([id], |row| row.get(0))?
        .collect::<Result<_, _>>()?;
    Ok(Some(note))
}

#[derive(Debug, Clone)]
struct RemoteNote {
    id: String,
    title: String,
    title_source: String,
    doc_json: String,
    plain_text: String,
    excerpt: String,
    word_count: i64,
    folder_id: Option<String>,
    is_pinned: bool,
    rev: i64,
    created_at: i64,
    updated_at: i64,
    deleted_at: Option<i64>,
}

impl FromRow for RemoteNote {
    fn from_row(row: &tokio_postgres::Row) -> Result<Self, AppError> {
        Ok(Self {
            id: row.try_get("id").map_err(network)?,
            title: row.try_get("title").map_err(network)?,
            title_source: row.try_get("title_source").map_err(network)?,
            doc_json: row.try_get("doc_json").map_err(network)?,
            plain_text: row.try_get("plain_text").map_err(network)?,
            excerpt: row.try_get("excerpt").map_err(network)?,
            word_count: row.try_get("word_count").map_err(network)?,
            folder_id: row.try_get("folder_id").map_err(network)?,
            is_pinned: row.try_get("is_pinned").map_err(network)?,
            rev: row.try_get("rev").map_err(network)?,
            created_at: row.try_get("created_at").map_err(network)?,
            updated_at: row.try_get("updated_at").map_err(network)?,
            deleted_at: row.try_get("deleted_at").map_err(network)?,
        })
    }
}

async fn query_remote_note(client: &Client, id: &str) -> Result<Option<RemoteNote>, AppError> {
    let id = uid(id)?;
    let rows: Vec<RemoteNote> = client_query(
        client,
        "SELECT id::text AS id, title, title_source, doc_json::text AS doc_json,
                plain_text, excerpt, word_count, folder_id::text AS folder_id,
                is_pinned, rev, created_at, updated_at, deleted_at
         FROM notes WHERE id = $1::uuid",
        &[&id as _],
    )
    .await?;
    Ok(rows.into_iter().next())
}

async fn query_remote_note_tags(client: &Client, note_id: &str) -> Result<Vec<String>, AppError> {
    let note_id = uid(note_id)?;
    let rows = tokio::time::timeout(
        QUERY_TIMEOUT,
        client.query(
            "SELECT tag_id::text FROM note_tags WHERE note_id = $1::uuid ORDER BY tag_id",
            &[&note_id as _],
        ),
    )
    .await
    .map_err(|_| network(query_timeout()))?
    .map_err(pg_error)?;
    rows.iter()
        .map(|row| row.try_get(0).map_err(network))
        .collect()
}

async fn insert_remote_note(client: &Client, id: &str, local: &LocalNote) -> Result<i64, AppError> {
    let id = uid(id)?;
    let folder = uid_opt(local.folder_id.as_deref())?;
    // Typed JSONB, not text: the column is `jsonb` and a `String` cannot
    // serialise into it, exactly like ids cannot stay strings (§7 mapping).
    let doc: serde_json::Value = serde_json::from_str(&local.doc_json)
        .map_err(|err| AppError::internal(format!("local document is not valid JSON: {err}")))?;
    query_rev(
        client,
        "INSERT INTO notes (id, title, title_source, doc_json, plain_text, excerpt,
                            word_count, folder_id, is_pinned, rev,
                            created_at, updated_at, deleted_at, synced_at)
         VALUES ($1::uuid, $2, $3, $4::jsonb, $5, $6, $7, $8::uuid, $9, nextval('sync_rev_seq'),
                 $10, $11, $12, $13)
         RETURNING rev",
        &[
            &id as _,
            &local.title as _,
            &local.title_source as _,
            &doc as _,
            &local.plain_text as _,
            &local.excerpt as _,
            &local.word_count as _,
            &folder as _,
            &local.is_pinned as _,
            &local.created_at as _,
            &local.updated_at as _,
            &local.deleted_at as _,
            &local.updated_at as _,
        ],
    )
    .await
}

async fn update_remote_note(client: &Client, id: &str, local: &LocalNote) -> Result<i64, AppError> {
    let id = uid(id)?;
    let folder = uid_opt(local.folder_id.as_deref())?;
    let doc: serde_json::Value = serde_json::from_str(&local.doc_json)
        .map_err(|err| AppError::internal(format!("local document is not valid JSON: {err}")))?;
    query_rev(
        client,
        "UPDATE notes
            SET title = $2, title_source = $3, doc_json = $4::jsonb, plain_text = $5,
                excerpt = $6, word_count = $7, folder_id = $8::uuid, is_pinned = $9,
                updated_at = $10, deleted_at = $11, synced_at = $10,
                rev = nextval('sync_rev_seq')
          WHERE id = $1::uuid RETURNING rev",
        &[
            &id as _,
            &local.title as _,
            &local.title_source as _,
            &doc as _,
            &local.plain_text as _,
            &local.excerpt as _,
            &local.word_count as _,
            &folder as _,
            &local.is_pinned as _,
            &local.updated_at as _,
            &local.deleted_at as _,
        ],
    )
    .await
}

// -- pull apply ---------------------------------------------------------------

/// Documents compare by parsed value, never by string. The server column is
/// `jsonb`, and `jsonb::text` re-spaces (and reorders) keys on every read —
/// so a round-tripped document is never string-equal to the compact text the
/// device stored, even with zero content change. Comparing strings would park
/// a conflict on every concurrent edit, however identical. Unparseable input
/// compares unequal (park is the safe direction).
fn docs_equal(local: &str, remote: &str) -> bool {
    if local == remote {
        return true;
    }
    match (
        serde_json::from_str::<serde_json::Value>(local),
        serde_json::from_str::<serde_json::Value>(remote),
    ) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

/// Whether the open-editor guard defers this remote row. True only when the
/// row *would* change the note on screen: the ids match and the remote rev is
/// newer than the local one. Anything else — a different note, an already-seen
/// rev, a note that no longer exists locally — flows through the normal path.
fn note_pull_skipped(
    open_note_id: Option<&str>,
    remote: &RemoteNote,
    db: &Database,
) -> Result<bool, AppError> {
    if open_note_id != Some(remote.id.as_str()) {
        return Ok(false);
    }
    let local_rev: Option<i64> = db.with_conn(|conn| {
        conn.query_row("SELECT rev FROM notes WHERE id = ?1", [&remote.id], |row| {
            row.get(0)
        })
        .map(Some)
        .or_else(|err| match err {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(AppError::from(other)),
        })
    })?;
    match local_rev {
        None => Ok(false),
        Some(rev) => Ok(remote.rev > rev),
    }
}

fn apply_remote_folder(
    conn: &mut rusqlite::Connection,
    remote: &RemoteFolder,
) -> Result<bool, AppError> {
    // True when the local store visibly changed. A dirty local row is never
    // touched here: the push phase already arbitrated it, and marking it
    // clean would drop the queued write.
    let tx = conn.transaction()?;
    let local: Option<(i64, i64)> = tx
        .query_row(
            "SELECT rev, dirty FROM folders WHERE id = ?1",
            [&remote.id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .ok();
    match local {
        None => {
            if remote.deleted_at.is_some() {
                return Ok(false);
            }
            tx.execute(
                "INSERT INTO folders (id, name, parent_id, position, rev, dirty, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7)",
                rusqlite::params![
                    remote.id,
                    remote.name,
                    remote.parent_id,
                    remote.position,
                    remote.rev,
                    remote.created_at,
                    remote.updated_at
                ],
            )?;
            tx.commit()?;
            Ok(true)
        }
        Some((local_rev, dirty)) => {
            if remote.rev <= local_rev || dirty != 0 {
                return Ok(false);
            }
            if remote.deleted_at.is_some() {
                tx.execute("DELETE FROM folders WHERE id = ?1", [&remote.id])?;
                tx.execute(
                    "UPDATE notes SET folder_id = NULL WHERE folder_id = ?1",
                    [&remote.id],
                )?;
            } else {
                tx.execute(
                    "UPDATE folders SET name = ?2, parent_id = ?3, position = ?4, rev = ?5,
                                        dirty = 0, updated_at = ?6, deleted_at = NULL
                     WHERE id = ?1",
                    rusqlite::params![
                        remote.id,
                        remote.name,
                        remote.parent_id,
                        remote.position,
                        remote.rev,
                        remote.updated_at
                    ],
                )?;
            }
            tx.commit()?;
            Ok(true)
        }
    }
}

fn apply_remote_tag(conn: &mut rusqlite::Connection, remote: &RemoteTag) -> Result<bool, AppError> {
    let tx = conn.transaction()?;
    let local: Option<(i64, i64)> = tx
        .query_row(
            "SELECT rev, dirty FROM tags WHERE id = ?1",
            [&remote.id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .ok();
    match local {
        None => {
            if remote.deleted_at.is_some() {
                return Ok(false);
            }
            tx.execute(
                "INSERT INTO tags (id, name, rev, dirty, created_at, updated_at)
                 VALUES (?1, ?2, ?3, 0, ?4, ?5)",
                rusqlite::params![
                    remote.id,
                    remote.name,
                    remote.rev,
                    remote.created_at,
                    remote.updated_at
                ],
            )?;
            tx.commit()?;
            Ok(true)
        }
        Some((local_rev, dirty)) => {
            if remote.rev <= local_rev || dirty != 0 {
                return Ok(false);
            }
            if remote.deleted_at.is_some() {
                tx.execute("DELETE FROM tags WHERE id = ?1", [&remote.id])?;
                tx.execute("DELETE FROM note_tags WHERE tag_id = ?1", [&remote.id])?;
            } else {
                tx.execute(
                    "UPDATE tags SET name = ?2, rev = ?3, dirty = 0, updated_at = ?4,
                                     deleted_at = NULL WHERE id = ?1",
                    rusqlite::params![remote.id, remote.name, remote.rev, remote.updated_at],
                )?;
            }
            tx.commit()?;
            Ok(true)
        }
    }
}

/// A pull that files a note into a folder this device does not hold
/// (deleted here, never arrived) unfiles the note instead of violating the
/// FK — the same `ON DELETE SET NULL` semantics a local folder delete gets.
/// Crashing the cycle over a filing hint would block every row behind it;
/// the next local edit re-sends the (null) filing and heals the server row.
fn live_folder_id(
    conn: &rusqlite::Connection,
    folder_id: &Option<String>,
) -> Result<Option<String>, AppError> {
    let Some(id) = folder_id else {
        return Ok(None);
    };
    let exists = conn
        .query_row("SELECT 1 FROM folders WHERE id = ?1", [id], |_| Ok(()))
        .is_ok();
    Ok(exists.then(|| id.clone()))
}

fn apply_remote_note(
    conn: &mut rusqlite::Connection,
    remote: &RemoteNote,
    remote_tags: &[String],
) -> Result<ApplyOutcome, AppError> {
    let local = load_local_note(conn, &remote.id)?;
    match local {
        None => {
            if remote.deleted_at.is_some() {
                return Ok(ApplyOutcome::Unchanged);
            }
            let folder_id = live_folder_id(conn, &remote.folder_id)?;
            let tx = conn.transaction()?;
            tx.execute(
                "INSERT INTO notes (id, title, title_source, doc_json, plain_text, excerpt,
                                    word_count, folder_id, is_pinned, rev, dirty,
                                    created_at, updated_at, deleted_at, synced_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0, ?11, ?12, NULL, ?12)",
                rusqlite::params![
                    remote.id,
                    remote.title,
                    remote.title_source,
                    remote.doc_json,
                    remote.plain_text,
                    remote.excerpt,
                    remote.word_count,
                    folder_id,
                    i64::from(remote.is_pinned),
                    remote.rev,
                    remote.created_at,
                    remote.updated_at
                ],
            )?;
            replace_local_tags(&tx, &remote.id, remote_tags)?;
            tx.commit()?;
            Ok(ApplyOutcome::Applied)
        }
        Some(local) => {
            if remote.rev <= local.rev {
                return Ok(ApplyOutcome::Unchanged);
            }
            let dirty: i64 = conn.query_row(
                "SELECT dirty FROM notes WHERE id = ?1",
                [&remote.id],
                |row| row.get(0),
            )?;
            if dirty != 0 {
                // Both sides changed: park the remote document, keep local
                // live. The next push converges the server onto local; the
                // user restores remote explicitly if that was wrong (§5.1).
                if !docs_equal(&local.doc_json, &remote.doc_json) && remote.deleted_at.is_none() {
                    park_conflict_in(
                        conn,
                        &remote.id,
                        local.rev,
                        remote.rev,
                        &remote.doc_json,
                        &remote.title,
                    )?;
                    let union = union_sets(&local.tag_ids, remote_tags);
                    replace_local_tags(conn, &remote.id, &union)?;
                    return Ok(ApplyOutcome::Conflicted);
                }
                return Ok(ApplyOutcome::Unchanged);
            }
            let tx = conn.transaction()?;
            if remote.deleted_at.is_some() {
                tx.execute(
                    "UPDATE notes SET deleted_at = ?2, rev = ?3, dirty = 0, updated_at = ?2 WHERE id = ?1",
                    rusqlite::params![remote.id, remote.deleted_at, remote.rev],
                )?;
            } else {
                let folder_id = live_folder_id(&tx, &remote.folder_id)?;
                tx.execute(
                    "UPDATE notes
                        SET title = ?2, title_source = ?3, doc_json = ?4, plain_text = ?5,
                            excerpt = ?6, word_count = ?7, folder_id = ?8, is_pinned = ?9,
                            rev = ?10, dirty = 0, updated_at = ?11, deleted_at = NULL,
                            synced_at = ?11
                      WHERE id = ?1",
                    rusqlite::params![
                        remote.id,
                        remote.title,
                        remote.title_source,
                        remote.doc_json,
                        remote.plain_text,
                        remote.excerpt,
                        remote.word_count,
                        folder_id,
                        i64::from(remote.is_pinned),
                        remote.rev,
                        remote.updated_at
                    ],
                )?;
                replace_local_tags(&tx, &remote.id, remote_tags)?;
            }
            tx.commit()?;
            Ok(ApplyOutcome::Applied)
        }
    }
}

fn park_conflict(
    db: &Database,
    note_id: &str,
    local_rev: i64,
    remote_rev: i64,
    remote_doc: &str,
    remote_title: &str,
) -> Result<(), AppError> {
    db.with_conn(|conn| {
        park_conflict_in(
            conn,
            note_id,
            local_rev,
            remote_rev,
            remote_doc,
            remote_title,
        )
    })
}

fn park_conflict_in(
    conn: &rusqlite::Connection,
    note_id: &str,
    local_rev: i64,
    remote_rev: i64,
    remote_doc: &str,
    remote_title: &str,
) -> Result<(), AppError> {
    // One parked copy per note; a newer remote supersedes the parked one.
    let id = uuid::Uuid::now_v7().to_string();
    conn.execute(
        "INSERT INTO conflicts (id, note_id, local_rev, remote_rev, remote_doc, remote_title, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT (note_id) DO UPDATE
         SET remote_doc = EXCLUDED.remote_doc, remote_title = EXCLUDED.remote_title,
             local_rev = EXCLUDED.local_rev, remote_rev = EXCLUDED.remote_rev,
             created_at = EXCLUDED.created_at",
        rusqlite::params![
            id,
            note_id,
            local_rev,
            remote_rev,
            remote_doc,
            remote_title,
            crate::clock::now_ms()
        ],
    )?;
    Ok(())
}

/// Links are whole-set replaced to match the union (or the pulled set).
/// SQLite does not apply `OR IGNORE` to foreign keys, so linking a tag whose
/// row has not arrived yet aborts the write instead of skipping it. That is
/// ordering, not corruption: the push runs before the pull in every cycle,
/// so a cross-device union can reference a tag pulled moments later. The row
/// waits out backoff and completes on retry — never filtered, because
/// dropping the link locally would clobber the server union on the next
/// push. See the heal leg in `live_two_devices_share_tag_union_and_lww`.
fn replace_local_tags(
    conn: &rusqlite::Connection,
    note_id: &str,
    tag_ids: &[String],
) -> Result<(), AppError> {
    conn.execute("DELETE FROM note_tags WHERE note_id = ?1", [note_id])?;
    for tag_id in tag_ids {
        conn.execute(
            "INSERT OR IGNORE INTO note_tags (note_id, tag_id, created_at) VALUES (?1, ?2, ?3)",
            rusqlite::params![note_id, tag_id, crate::clock::now_ms()],
        )?;
    }
    Ok(())
}

/// Set union, sorted: removing a tag on one device while adding another
/// elsewhere keeps both (§5.3).
fn union_sets(local: &[String], remote: &[String]) -> Vec<String> {
    use std::collections::BTreeSet;
    local
        .iter()
        .chain(remote.iter())
        .cloned()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo::{FoldersRepo, NotesRepo, TagsRepo};

    #[test]
    fn entity_order_is_tags_folders_notes() {
        assert!(entity_rank("tag") < entity_rank("folder"));
        assert!(entity_rank("folder") < entity_rank("note"));
        assert!(entity_rank("note") < entity_rank("note_tags"));
    }

    #[test]
    fn ssl_mode_parsing_follows_libpq_names() {
        assert_eq!(ssl_mode("postgresql://h/db"), SslMode::Require);
        assert_eq!(
            ssl_mode("postgresql://h/db?sslmode=require"),
            SslMode::Require
        );
        assert_eq!(
            ssl_mode("postgresql://h/db?sslmode=disable"),
            SslMode::Disable
        );
        assert_eq!(
            ssl_mode("postgresql://h/db?sslmode=verify-full"),
            SslMode::VerifyFull
        );
        assert_eq!(
            ssl_mode("postgresql://h/db?sslmode=verify-ca"),
            SslMode::VerifyFull
        );
        // No silent plaintext fallback: prefer behaves as require.
        assert_eq!(
            ssl_mode("postgresql://h/db?sslmode=prefer"),
            SslMode::Require
        );
        assert_eq!(
            ssl_mode("postgresql://h/db?connect_timeout=10&sslmode=disable"),
            SslMode::Disable
        );
    }

    #[test]
    fn endpoint_id_ignores_password_but_sees_server() {
        let a = endpoint_id("postgresql://u:p@host:5432/db");
        assert_eq!(endpoint_id("postgresql://u:other@host:5432/db"), a);
        assert_eq!(endpoint_id("postgres://u:p@HOST:5432/db"), a);
        assert_ne!(endpoint_id("postgresql://u:p@host:5433/db"), a);
        assert_ne!(endpoint_id("postgresql://u:p@host:5432/other"), a);
        assert_ne!(endpoint_id("postgresql://v:p@host:5432/db"), a);
        assert_eq!(
            endpoint_id("postgresql://u:p@host/db?sslmode=require"),
            "u@host:5432/db"
        );
    }

    #[test]
    fn sslmode_param_is_rewritten_to_what_tokio_parses() {
        // tokio-postgres accepts only disable/prefer/require; our verifying
        // modes travel in the connector, so the parameter is normalised and
        // every other parameter survives untouched.
        assert_eq!(
            with_sslmode_param("postgresql://h/db?sslmode=verify-full", "require"),
            "postgresql://h/db?sslmode=require"
        );
        assert_eq!(
            with_sslmode_param(
                "postgresql://h/db?connect_timeout=10&sslmode=disable",
                "require"
            ),
            "postgresql://h/db?connect_timeout=10&sslmode=require"
        );
        assert_eq!(
            with_sslmode_param("postgresql://h/db", "disable"),
            "postgresql://h/db?sslmode=disable"
        );
    }

    #[test]
    fn changing_server_requeues_everything_and_restarts_watermarks() {
        use rusqlite::OptionalExtension as _;
        let db = Database::open_in_memory().expect("memory db");
        let sync = SyncService::new(Arc::new(db));
        let db = sync.db.clone();
        let tags = crate::repo::tags::SqliteTagsRepo::new(Arc::clone(&db));
        tags.create("Requeued").expect("tag creates");

        sync.set_config("postgresql://u:p@a:5432/db?sslmode=disable", true)
            .expect("first config");
        let queued: i64 = db
            .with_conn(|conn| {
                conn.query_row(
                    "SELECT COUNT(*) FROM outbox WHERE sent_at IS NULL",
                    (),
                    |row| row.get(0),
                )
                .map_err(AppError::from)
            })
            .expect("counts");
        assert!(queued >= 2, "create plus rebootstrap queue rows");

        // Same server again: nothing new queued.
        sync.set_config("", true).expect("re-save keeps secret");
        let again: i64 = db
            .with_conn(|conn| {
                conn.query_row(
                    "SELECT COUNT(*) FROM outbox WHERE sent_at IS NULL",
                    (),
                    |row| row.get(0),
                )
                .map_err(AppError::from)
            })
            .expect("counts");
        assert_eq!(again, queued);

        // New server: everything re-queued, watermarks zeroed.
        db.with_conn(|conn| put_state(conn, KEY_NOTES_REV, "99"))
            .expect("watermark");
        sync.set_config("postgresql://u:p@b:5432/db?sslmode=disable", true)
            .expect("new server");
        let (dirty, watermark, endpoint): (i64, String, Option<String>) = db
            .with_conn(|conn| {
                let dirty: i64 =
                    conn.query_row("SELECT COUNT(*) FROM tags WHERE dirty = 1", (), |row| {
                        row.get(0)
                    })?;
                let watermark: String = conn.query_row(
                    "SELECT value FROM sync_state WHERE key = ?1",
                    [KEY_NOTES_REV],
                    |row| row.get(0),
                )?;
                let endpoint: Option<String> = conn
                    .query_row(
                        "SELECT value FROM sync_state WHERE key = ?1",
                        [KEY_ENDPOINT],
                        |row| row.get(0),
                    )
                    .optional()?;
                Ok((dirty, watermark, endpoint))
            })
            .expect("reads");
        assert_eq!(dirty, 1);
        assert_eq!(watermark, "0");
        assert_eq!(endpoint.as_deref(), Some("u@b:5432/db"));
    }

    #[test]
    fn reupload_requeues_everything_after_a_server_wipe() {
        // Clean rows, empty outbox, stale watermarks: exactly what a wiped
        // server leaves behind. Without re-queueing, the next sync would
        // push nothing and pull nothing — permanent divergence.
        let db = Database::open_in_memory().expect("memory db");
        let sync = SyncService::new(Arc::new(db));
        let db = sync.db.clone();
        let tags = crate::repo::tags::SqliteTagsRepo::new(Arc::clone(&db));
        let tag = tags.create("Survivor").expect("tag creates");
        sync.set_config("postgresql://u:p@a:5432/db?sslmode=disable", true)
            .expect("config saves");
        db.with_conn(|conn| {
            conn.execute("UPDATE outbox SET sent_at = 1 WHERE sent_at IS NULL", ())?;
            conn.execute(
                "UPDATE tags SET dirty = 0, rev = 150 WHERE id = ?1",
                [&tag.id],
            )?;
            put_state(conn, KEY_TAGS_REV, "150")?;
            Ok::<_, AppError>(())
        })
        .expect("wipe simulation");

        let queued = sync.reupload_all().expect("re-uploads");
        assert!(queued >= 1, "every surviving row queued: {queued}");
        let (dirty, watermark, pending): (i64, String, i64) = db
            .with_conn(|conn| {
                let dirty: i64 =
                    conn.query_row("SELECT COUNT(*) FROM tags WHERE dirty = 1", (), |row| {
                        row.get(0)
                    })?;
                let watermark: String = conn.query_row(
                    "SELECT value FROM sync_state WHERE key = ?1",
                    [KEY_TAGS_REV],
                    |row| row.get(0),
                )?;
                let pending: i64 = conn.query_row(
                    "SELECT COUNT(*) FROM outbox WHERE sent_at IS NULL",
                    (),
                    |row| row.get(0),
                )?;
                Ok((dirty, watermark, pending))
            })
            .expect("reads");
        assert_eq!(dirty, 1);
        assert_eq!(watermark, "0");
        assert_eq!(pending, queued);
    }

    #[test]
    fn tag_union_keeps_both_sides() {
        let union = union_sets(
            &["a".to_owned(), "b".to_owned()],
            &["b".to_owned(), "c".to_owned()],
        );
        assert_eq!(union, vec!["a".to_owned(), "b".to_owned(), "c".to_owned()]);
    }

    #[test]
    fn retry_backoff_grows_and_caps() {
        assert_eq!(retry_delay_ms(1), 30_000);
        assert_eq!(retry_delay_ms(2), 120_000);
        assert_eq!(retry_delay_ms(3), 480_000);
        assert_eq!(retry_delay_ms(4), 1_800_000);
        assert_eq!(retry_delay_ms(40), 1_800_000);
    }

    #[test]
    fn docs_compare_by_value_not_string() {
        // What `jsonb::text` hands back after a round trip: re-spaced and
        // reordered, zero content change. String comparison calls these
        // different and parks a conflict on every concurrent edit.
        let compact = r#"{"type":"doc","content":[{"type":"paragraph"}]}"#;
        let spaced = r#"{ "type": "doc", "content": [ { "type": "paragraph" } ] }"#;
        let reordered = r#"{"content":[{"type":"paragraph"}],"type":"doc"}"#;
        assert!(docs_equal(compact, compact));
        assert!(docs_equal(compact, spaced));
        assert!(docs_equal(compact, reordered));
        assert!(!docs_equal(
            compact,
            r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"changed"}]}]}"#
        ));
        // Unparseable input parks (the safe direction), never matches.
        assert!(!docs_equal(compact, "not json"));
        assert!(!docs_equal("not json", "not json either"));
    }

    #[test]
    fn pending_batch_skips_rows_that_are_not_due_yet() {
        let db = Database::open_in_memory().expect("memory db");
        let sync = SyncService::new(Arc::new(db));
        let db = sync.db.clone();
        let tags = crate::repo::tags::SqliteTagsRepo::new(Arc::clone(&db));
        let tag = tags.create("Backoff").expect("tag creates");

        let now = crate::clock::now_ms();
        // A failing row waits out its backoff; the batch is empty meanwhile.
        db.with_conn(|conn| {
            conn.execute(
                "UPDATE outbox SET attempts = 1, next_retry_at = ?1 WHERE sent_at IS NULL",
                [now + 600_000],
            )?;
            Ok::<_, AppError>(())
        })
        .expect("backoff set");
        let batch = db
            .with_conn(|conn| pending_batch(conn, now))
            .expect("batch reads");
        assert!(batch.is_empty(), "not-due rows wait: {batch:?}");

        // Due again once the timestamp passes.
        let batch = db
            .with_conn(|conn| pending_batch(conn, now + 600_001))
            .expect("batch reads");
        assert_eq!(batch.len(), 1);
        assert_eq!(batch[0].entity_id, tag.id);
    }

    #[test]
    fn pending_batch_never_promotes_stale_state_past_a_waiting_latest() {
        // Two queued rows for one entity, the latest still in backoff: the
        // entity waits as a whole. Pushing the older row would supersede the
        // newer one without ever sending it.
        let db = Database::open_in_memory().expect("memory db");
        let sync = SyncService::new(Arc::new(db));
        let db = sync.db.clone();
        let tags = crate::repo::tags::SqliteTagsRepo::new(Arc::clone(&db));
        let tag = tags.create("Stale").expect("tag creates");
        tags.rename(&tag.id, "Stale2").expect("tag renames");

        let now = crate::clock::now_ms();
        db.with_conn(|conn| {
            let latest: i64 = conn.query_row(
                "SELECT MAX(id) FROM outbox WHERE sent_at IS NULL AND entity_id = ?1",
                [&tag.id],
                |row| row.get(0),
            )?;
            conn.execute(
                "UPDATE outbox SET attempts = 1, next_retry_at = ?1 WHERE id = ?2",
                rusqlite::params![now + 600_000, latest],
            )?;
            Ok::<_, AppError>(())
        })
        .expect("backoff set");
        let batch = db
            .with_conn(|conn| pending_batch(conn, now))
            .expect("batch reads");
        assert!(
            batch.iter().all(|row| row.entity_id != tag.id),
            "no stale push past the waiting latest: {batch:?}"
        );
    }

    #[test]
    fn open_note_guard_skips_only_what_would_change_the_screen() {
        use crate::repo::NotesRepo as _;
        let db = Database::open_in_memory().expect("memory db");
        let sync = SyncService::new(Arc::new(db));
        let db = sync.db.clone();
        let notes = crate::repo::notes::SqliteNotesRepo::new(Arc::clone(&db));
        let created = notes.create(None).expect("note creates");
        let id = created.summary.id.clone();
        db.with_conn(|conn| {
            conn.execute("UPDATE notes SET rev = 3 WHERE id = ?1", [&id])?;
            Ok::<_, AppError>(())
        })
        .expect("rev set");

        let newer = RemoteNote {
            id: id.clone(),
            title: String::new(),
            title_source: "auto".into(),
            doc_json: "{}".into(),
            plain_text: String::new(),
            excerpt: String::new(),
            word_count: 0,
            folder_id: None,
            is_pinned: false,
            rev: 9,
            created_at: 0,
            updated_at: 0,
            deleted_at: None,
        };
        // The open note with a newer remote rev defers.
        assert!(note_pull_skipped(Some(&id), &newer, &db).expect("reads"));
        // Any other note, no open note, or an already-seen rev flows through.
        let other = RemoteNote {
            id: "other".into(),
            ..newer.clone()
        };
        assert!(!note_pull_skipped(Some(&id), &other, &db).expect("reads"));
        assert!(!note_pull_skipped(None, &newer, &db).expect("reads"));
        let seen = RemoteNote {
            rev: 3,
            ..newer.clone()
        };
        assert!(!note_pull_skipped(Some(&id), &seen, &db).expect("reads"));
    }

    #[test]
    fn connection_string_validation_rejects_non_postgres() {
        let db = Database::open_in_memory().expect("memory db");
        let sync = SyncService::new(Arc::new(db));
        let err = sync
            .set_config("https://example.com/db", true)
            .expect_err("must reject");
        assert!(matches!(err, AppError::Validation(_)));
        let err = sync.set_config("", true).expect_err("must reject");
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[test]
    fn config_round_trips_and_status_reports_pending() {
        let db = Database::open_in_memory().expect("memory db");
        let sync = SyncService::new(Arc::new(db));
        sync.set_config("postgresql://localhost:5432/chayote?sslmode=disable", true)
            .expect("valid");
        let status = sync.status().expect("status");
        assert!(status.configured);
        assert!(status.enabled);
        assert_eq!(status.pending_count, 0);
        assert_eq!(status.conflict_count, 0);
        assert_eq!(status.last_synced_at, None);
        assert_eq!(status.last_attempt_at, None);
    }

    #[test]
    fn pending_counts_changes_not_events() {
        let db = Database::open_in_memory().expect("memory db");
        let sync = SyncService::new(Arc::new(db));
        let db = sync.db.clone();
        let tags = crate::repo::tags::SqliteTagsRepo::new(Arc::clone(&db));
        // Create-then-delete is two outbox rows but one pending change: the
        // drain collapses to the latest row per entity.
        let tag = tags.create("Ephemeral").expect("tag creates");
        tags.delete(&tag.id).expect("tag deletes");
        let status = sync.status().expect("status");
        assert_eq!(status.pending_count, 1);
    }

    /// Use-remote applies the *parked* document, not the live server row.
    /// Regression test for "Use theirs behaves like Keep mine": the push
    /// that parks a conflict overwrites the server with the local document
    /// (§5.1), so a live fetch returns the local version. The parked copy
    /// is the only true remote — and applying it needs no network.
    #[tokio::test]
    async fn use_remote_restores_parked_document_without_network() {
        let db = Database::open_in_memory().expect("memory db");
        let sync = SyncService::new(Arc::new(db));
        let db = sync.db.clone();
        let folders = crate::repo::folders::SqliteFoldersRepo::new(Arc::clone(&db));
        let notes = crate::repo::notes::SqliteNotesRepo::new(Arc::clone(&db));
        let folder = folders.create("F", None).expect("folder creates");
        let created = notes.create(Some(&folder.id)).expect("note creates");
        let note_id = created.summary.id.clone();

        let local_doc = serde_json::json!({
            "type": "doc",
            "content": [{"type": "paragraph", "content": [{"type": "text", "text": "PHONE WINS"}]}]
        });
        notes
            .save(&crate::repo::SaveNoteInput {
                id: note_id.clone(),
                doc: local_doc,
                folder_id: Some(folder.id.clone()),
                tag_ids: vec![],
                is_pinned: false,
            })
            .expect("local edit");

        // What the push parked before overwriting the server with local:
        // the other device's document, which no longer exists server-side.
        let remote_doc = serde_json::json!({
            "type": "doc",
            "content": [{"type": "paragraph", "content": [{"type": "text", "text": "DESKTOP WINS AGAIN"}]}]
        });
        let remote_doc_str = serde_json::to_string(&remote_doc).expect("serialises");
        let local_rev: i64 = db
            .with_conn(|conn| {
                conn.query_row("SELECT rev FROM notes WHERE id = ?1", [&note_id], |row| {
                    row.get(0)
                })
                .map_err(AppError::from)
            })
            .expect("rev reads");
        park_conflict(
            &db,
            &note_id,
            local_rev,
            local_rev + 1,
            &remote_doc_str,
            "DESKTOP WINS AGAIN",
        )
        .expect("parks");
        let conflicts = sync.list_conflicts().expect("lists");
        assert_eq!(conflicts.len(), 1);

        // No connection configured on purpose: use-remote must not need one.
        sync.resolve_conflict(&conflicts[0].id, false)
            .await
            .expect("use-remote resolves");
        assert_eq!(sync.list_conflicts().expect("lists").len(), 0);
        let applied = notes.get(&note_id).expect("note reads");
        assert!(
            applied.summary.excerpt.contains("DESKTOP WINS AGAIN"),
            "parked remote goes live: {:?}",
            applied.summary.title
        );

        // And keep-local still keeps the live document untouched.
        park_conflict(
            &db,
            &note_id,
            local_rev,
            local_rev + 1,
            &remote_doc_str,
            "DESKTOP WINS AGAIN",
        )
        .expect("parks again");
        let conflicts = sync.list_conflicts().expect("lists");
        assert_eq!(conflicts.len(), 1);
        // Restore the local text first so keep-local has something to keep.
        let local_doc2 = serde_json::json!({
            "type": "doc",
            "content": [{"type": "paragraph", "content": [{"type": "text", "text": "PHONE WINS"}]}]
        });
        notes
            .save(&crate::repo::SaveNoteInput {
                id: note_id.clone(),
                doc: local_doc2,
                folder_id: Some(folder.id.clone()),
                tag_ids: vec![],
                is_pinned: false,
            })
            .expect("local edit");
        sync.resolve_conflict(&conflicts[0].id, true)
            .await
            .expect("keep-local resolves");
        let kept = notes.get(&note_id).expect("note reads");
        assert!(
            kept.summary.excerpt.contains("PHONE WINS"),
            "local stays live: {:?}",
            kept.summary.title
        );
    }

    /// End-to-end against a real Postgres. Requires
    /// `CHAYOTE_SYNC_TEST_URL` (e.g. a local container with
    /// `?sslmode=disable`); without it the test passes trivially so CI
    /// without a database stays green.
    ///
    /// The schema is applied from `postgres/schema.sql` and the server is
    /// truncated first, so the test is self-contained and repeatable.
    #[tokio::test]
    async fn live_push_pull_and_conflict_cycle() {
        let url = match std::env::var("CHAYOTE_SYNC_TEST_URL") {
            Ok(url) => url,
            Err(_) => {
                eprintln!("skipping live sync test: CHAYOTE_SYNC_TEST_URL unset");
                return;
            }
        };

        let dir = std::env::temp_dir().join(format!(
            "chayote-sync-live-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let db = Arc::new(Database::open(&dir).expect("database opens"));
        let sync = SyncService::new(Arc::clone(&db));

        let client = connect(&url).await.expect("connects to test Postgres");
        client
            .batch_execute(include_str!("../../../postgres/schema.sql"))
            .await
            .expect("server schema applies");
        client
            .execute(
                "TRUNCATE note_tags, notes, tags, folders RESTART IDENTITY",
                &[],
            )
            .await
            .expect("server starts empty");

        sync.set_config(&url, true).expect("config saves");

        // Local writes: one tag, one folder, one note carrying the tag.
        let tag = crate::repo::tags::SqliteTagsRepo::new(Arc::clone(&db));
        let tag = tag.create("LiveTag").expect("tag creates");
        let folders = crate::repo::folders::SqliteFoldersRepo::new(Arc::clone(&db));
        let folder = folders.create("LiveFolder", None).expect("folder creates");
        let notes = crate::repo::notes::SqliteNotesRepo::new(Arc::clone(&db));
        let created = notes.create(Some(&folder.id)).expect("note creates");
        let doc = serde_json::json!({
            "type": "doc",
            "content": [{"type": "paragraph", "content": [{"type": "text", "text": "hello live"}]}]
        });
        notes
            .save(&crate::repo::SaveNoteInput {
                id: created.summary.id.clone(),
                doc,
                folder_id: Some(folder.id.clone()),
                tag_ids: vec![tag.id.clone()],
                is_pinned: false,
            })
            .expect("note saves");

        // Device ids are UUIDv7 strings; the test's direct SQL binds them
        // as binary UUIDs, like the engine does — never as text.
        let folder_uuid = uuid::Uuid::parse_str(&folder.id).expect("folder uuid");
        let note_uuid = uuid::Uuid::parse_str(&created.summary.id).expect("note uuid");

        // First cycle pushes everything, then finds nothing to pull.
        let first = sync.run_cycle(None).await.expect("first cycle");
        assert!(first.pushed >= 3, "pushes tag, folder, note: {first:?}");
        assert_eq!(first.pulled, 0);
        let status = sync.status().expect("status");
        assert_eq!(status.pending_count, 0);
        assert!(status.last_synced_at.is_some());

        let server_notes: i64 = client
            .query_one("SELECT COUNT(*) FROM notes", &[])
            .await
            .expect("counts")
            .get(0);
        assert_eq!(server_notes, 1);
        let server_tags: Vec<String> = client
            .query(
                "SELECT tag_id::text FROM note_tags WHERE note_id = $1::uuid",
                &[&note_uuid],
            )
            .await
            .expect("tag set")
            .iter()
            .map(|row| row.get(0))
            .collect();
        assert_eq!(server_tags, vec![tag.id.clone()]);

        // A quiet second cycle is a no-op in both directions.
        let second = sync.run_cycle(None).await.expect("second cycle");
        assert_eq!((second.pushed, second.pulled), (0, 0));

        // Remote-only rename pulls cleanly.
        client
            .execute(
                "UPDATE folders SET name = $2, rev = nextval('sync_rev_seq') WHERE id = $1::uuid",
                &[&folder_uuid, &"RenamedElsewhere".to_owned()],
            )
            .await
            .expect("remote rename");
        let third = sync.run_cycle(None).await.expect("third cycle");
        assert_eq!(third.pulled, 1);
        let tree = folders.list().expect("tree lists");
        assert_eq!(tree[0].name, "RenamedElsewhere");

        // Both-sides-changed document parks the remote copy, keeps local.
        let local_doc = serde_json::json!({
            "type": "doc",
            "content": [{"type": "paragraph", "content": [{"type": "text", "text": "local wins"}]}]
        });
        notes
            .save(&crate::repo::SaveNoteInput {
                id: created.summary.id.clone(),
                doc: local_doc,
                folder_id: Some(folder.id.clone()),
                tag_ids: vec![tag.id.clone()],
                is_pinned: false,
            })
            .expect("local edit");
        let remote_doc: serde_json::Value = serde_json::json!({
            "type": "doc",
            "content": [{"type": "paragraph", "content": [{"type": "text", "text": "remote parked"}]}]
        });
        client
            .execute(
                "UPDATE notes SET doc_json = $2::jsonb, plain_text = 'remote parked',
                                  rev = nextval('sync_rev_seq') WHERE id = $1::uuid",
                &[&note_uuid, &remote_doc],
            )
            .await
            .expect("remote edit");
        let fourth = sync.run_cycle(None).await.expect("fourth cycle");
        assert_eq!(
            fourth.conflicts, 1,
            "parks exactly one conflict: {fourth:?}"
        );
        let live = notes.get(&created.summary.id).expect("note reads");
        assert!(
            live.summary.excerpt.contains("local wins") || live.summary.title.contains("local"),
            "local stays live: {:?}",
            live.summary.title
        );
        let conflicts = sync.list_conflicts().expect("conflicts list");
        assert_eq!(conflicts.len(), 1);

        // Keep-local resolves without touching the document.
        sync.resolve_conflict(&conflicts[0].id, true)
            .await
            .expect("keep-local resolves");
        assert_eq!(sync.list_conflicts().expect("lists").len(), 0);

        // Use-remote resolves to the server document wholesale. For the parked
        // copy to be a TRUE remote — rather than one the push just converged
        // onto local — the local row sits out the push in backoff: then the
        // pull, not the push, parks, the server still holds the remote
        // content, and use-remote applies something visibly different from
        // keep-local. (This also covers the backoff-skip → pull-park path.)
        let local_doc2 = serde_json::json!({
            "type": "doc",
            "content": [{"type": "paragraph", "content": [{"type": "text", "text": "local v2"}]}]
        });
        notes
            .save(&crate::repo::SaveNoteInput {
                id: created.summary.id.clone(),
                doc: local_doc2,
                folder_id: Some(folder.id.clone()),
                tag_ids: vec![tag.id.clone()],
                is_pinned: false,
            })
            .expect("local edit");
        db.with_conn(|conn| {
            conn.execute(
                "UPDATE outbox SET attempts = 1, next_retry_at = ?1
                  WHERE sent_at IS NULL AND entity = 'note'",
                [crate::clock::now_ms() + 600_000],
            )?;
            Ok::<_, AppError>(())
        })
        .expect("backoff set");
        let remote_doc2: serde_json::Value = serde_json::json!({
            "type": "doc",
            "content": [{"type": "paragraph", "content": [{"type": "text", "text": "true remote use-remote"}]}]
        });
        client
            .execute(
                "UPDATE notes SET doc_json = $2::jsonb, plain_text = 'true remote use-remote',
                                  rev = nextval('sync_rev_seq') WHERE id = $1::uuid",
                &[&note_uuid, &remote_doc2],
            )
            .await
            .expect("remote edit");
        let fourth_b = sync.run_cycle(None).await.expect("conflict cycle");
        assert_eq!(fourth_b.conflicts, 1, "pull parks: {fourth_b:?}");
        assert_eq!(
            fourth_b.pushed, 0,
            "the push sat the row out in backoff: {fourth_b:?}"
        );
        let conflicts2 = sync.list_conflicts().expect("lists");
        assert_eq!(conflicts2.len(), 1);
        sync.resolve_conflict(&conflicts2[0].id, false)
            .await
            .expect("use-remote resolves");
        assert_eq!(sync.list_conflicts().expect("lists").len(), 0);
        let applied2 = notes.get(&created.summary.id).expect("note reads");
        assert!(
            applied2.summary.excerpt.contains("true remote use-remote"),
            "remote document goes live: {:?}",
            applied2.summary.title
        );
        // Release the backoff: the stale row pushes current (remote) state.
        // Docs are equal by now, so the disjoint path converges without
        // parking a second conflict.
        db.with_conn(|conn| {
            conn.execute(
                "UPDATE outbox SET next_retry_at = NULL WHERE sent_at IS NULL",
                (),
            )?;
            Ok::<_, AppError>(())
        })
        .expect("backoff released");
        let quiet = sync.run_cycle(None).await.expect("converge cycle");
        assert_eq!(
            quiet.conflicts, 0,
            "equal docs converge without parking again: {quiet:?}"
        );

        // A local hard delete becomes a server tombstone (never a silent
        // row drop), and the queued older rows for the same folder collapse
        // instead of lingering. The tombstone name satisfies the server
        // CHECK that once rejected an empty placeholder here.
        folders.delete(&folder.id).expect("folder deletes");
        let fifth = sync.run_cycle(None).await.expect("fifth cycle");
        assert!(fifth.pushed >= 1, "tombstone pushes: {fifth:?}");
        let tombstone: Option<i64> = client
            .query_opt(
                "SELECT deleted_at FROM folders WHERE id = $1::uuid",
                &[&folder_uuid],
            )
            .await
            .expect("tombstone reads")
            .map(|row| row.get(0));
        assert!(
            tombstone.is_some(),
            "server keeps a tombstone for the deleted folder"
        );
        assert_eq!(
            sync.status().expect("status").pending_count,
            0,
            "no stale rows linger after the delete"
        );

        // The Phase-E open-editor guard: a pull that would change the note on
        // screen defers it instead. The row is untouched, the watermark held,
        // and the next cycle without the guard applies it.
        let guarded_doc: serde_json::Value = serde_json::json!({
            "type": "doc",
            "content": [{"type": "paragraph", "content": [{"type": "text", "text": "guarded change"}]}]
        });
        client
            .execute(
                "UPDATE notes SET title = 'Deferred Remote', doc_json = $2::jsonb,
                                  plain_text = 'guarded change', rev = nextval('sync_rev_seq')
                  WHERE id = $1::uuid",
                &[&note_uuid, &guarded_doc],
            )
            .await
            .expect("remote edit while open");
        let sixth = sync
            .run_cycle(Some(&created.summary.id))
            .await
            .expect("guarded cycle");
        assert_eq!(sixth.deferred, 1, "open note defers: {sixth:?}");
        assert_eq!(sixth.pulled, 0);
        let held = notes.get(&created.summary.id).expect("note reads");
        assert!(
            held.summary.excerpt.contains("true remote use-remote"),
            "screen untouched while open: {:?}",
            held.summary.title
        );
        let seventh = sync.run_cycle(None).await.expect("unguarded cycle");
        assert_eq!(seventh.pulled, 1, "applies the deferred row: {seventh:?}");
        let applied = notes.get(&created.summary.id).expect("note reads");
        assert_eq!(applied.summary.title, "Deferred Remote");

        std::fs::remove_dir_all(&dir).ok();
    }

    /// Two devices against one Postgres. Requires `CHAYOTE_SYNC_2DEV_URL` —
    /// a throwaway database (the test truncates it first); without it the
    /// test passes trivially so CI stays green.
    ///
    /// Exercises what one device cannot: a clean pull onto an empty device,
    /// a both-sides-changed document (parked on the second pusher, applied
    /// on the first), a tag-set union across devices, and folder LWW.
    #[tokio::test]
    async fn live_two_devices_share_tag_union_and_lww() {
        let url = match std::env::var("CHAYOTE_SYNC_2DEV_URL") {
            Ok(url) => url,
            Err(_) => {
                eprintln!("skipping two-device sync test: CHAYOTE_SYNC_2DEV_URL unset");
                return;
            }
        };

        fn device(tag: &str) -> (std::path::PathBuf, Arc<Database>, SyncService) {
            let dir = std::env::temp_dir().join(format!(
                "chayote-sync-2dev-{tag}-{}-{:?}",
                std::process::id(),
                std::thread::current().id()
            ));
            std::fs::create_dir_all(&dir).expect("temp dir");
            let db = Arc::new(Database::open(&dir).expect("database opens"));
            let sync = SyncService::new(Arc::clone(&db));
            (dir, db, sync)
        }

        let (dir_a, db_a, sync_a) = device("a");
        let (dir_b, db_b, sync_b) = device("b");

        let client = connect(&url).await.expect("connects to test Postgres");
        client
            .batch_execute(include_str!("../../../postgres/schema.sql"))
            .await
            .expect("server schema applies");
        client
            .execute(
                "TRUNCATE note_tags, notes, tags, folders RESTART IDENTITY",
                &[],
            )
            .await
            .expect("server starts empty");

        sync_a.set_config(&url, true).expect("A config saves");
        sync_b.set_config(&url, true).expect("B config saves");

        let tags_a = crate::repo::tags::SqliteTagsRepo::new(Arc::clone(&db_a));
        let folders_a = crate::repo::folders::SqliteFoldersRepo::new(Arc::clone(&db_a));
        let notes_a = crate::repo::notes::SqliteNotesRepo::new(Arc::clone(&db_a));
        let notes_b = crate::repo::notes::SqliteNotesRepo::new(Arc::clone(&db_b));

        // Device A writes the library; device B starts empty.
        let shared = tags_a.create("Shared").expect("tag creates");
        let folder = folders_a
            .create("SharedFolder", None)
            .expect("folder creates");
        let created = notes_a.create(Some(&folder.id)).expect("note creates");
        notes_a
            .save(&crate::repo::SaveNoteInput {
                id: created.summary.id.clone(),
                doc: serde_json::json!({
                    "type": "doc",
                    "content": [{"type": "paragraph", "content": [{"type": "text", "text": "hello A"}]}]
                }),
                folder_id: Some(folder.id.clone()),
                tag_ids: vec![shared.id.clone()],
                is_pinned: false,
            })
            .expect("note saves");
        let first_a = sync_a.run_cycle(None).await.expect("A pushes");
        assert!(first_a.pushed >= 3, "A uploads everything: {first_a:?}");

        // A clean pull onto an empty device.
        let first_b = sync_b.run_cycle(None).await.expect("B pulls");
        assert!(first_b.pulled >= 3, "B downloads everything: {first_b:?}");
        let b_live = notes_b.get(&created.summary.id).expect("B reads note");
        assert!(
            b_live.summary.excerpt.contains("hello A"),
            "B sees A's document: {:?}",
            b_live.summary.title
        );

        // Both sides change the document. A pushes first and wins the live
        // copy; B parks the conflict and keeps typing.
        notes_a
            .save(&crate::repo::SaveNoteInput {
                id: created.summary.id.clone(),
                doc: serde_json::json!({
                    "type": "doc",
                    "content": [{"type": "paragraph", "content": [{"type": "text", "text": "A edit"}]}]
                }),
                folder_id: Some(folder.id.clone()),
                tag_ids: vec![shared.id.clone()],
                is_pinned: false,
            })
            .expect("A edits");
        notes_b
            .save(&crate::repo::SaveNoteInput {
                id: created.summary.id.clone(),
                doc: serde_json::json!({
                    "type": "doc",
                    "content": [{"type": "paragraph", "content": [{"type": "text", "text": "B edit"}]}]
                }),
                folder_id: Some(folder.id.clone()),
                tag_ids: vec![shared.id.clone()],
                is_pinned: false,
            })
            .expect("B edits");
        sync_a.run_cycle(None).await.expect("A pushes first");
        let b_push = sync_b.run_cycle(None).await.expect("B pushes second");
        assert_eq!(b_push.conflicts, 1, "B parks exactly one: {b_push:?}");
        assert_eq!(sync_b.list_conflicts().expect("lists").len(), 1);
        let b_live = notes_b.get(&created.summary.id).expect("B reads");
        assert!(
            b_live.summary.excerpt.contains("B edit"),
            "B keeps its live copy: {:?}",
            b_live.summary.title
        );
        // A pulls B's push and converges onto it without a conflict of its own.
        let a_pull = sync_a.run_cycle(None).await.expect("A pulls");
        assert_eq!(a_pull.pulled, 1, "A applies B's push: {a_pull:?}");
        let a_live = notes_a.get(&created.summary.id).expect("A reads");
        assert!(
            a_live.summary.excerpt.contains("B edit"),
            "A converges onto B: {:?}",
            a_live.summary.title
        );

        // Tag sets union: each side adds a different tag to the same note.
        // Documents are equal by now, so the disjoint path unions the sets.
        let tag2 = tags_a.create("ATag").expect("A tag creates");
        let tags_b = crate::repo::tags::SqliteTagsRepo::new(Arc::clone(&db_b));
        let tag3 = tags_b.create("BTag").expect("B tag creates");
        notes_a
            .save(&crate::repo::SaveNoteInput {
                id: created.summary.id.clone(),
                doc: serde_json::json!({
                    "type": "doc",
                    "content": [{"type": "paragraph", "content": [{"type": "text", "text": "B edit"}]}]
                }),
                folder_id: Some(folder.id.clone()),
                tag_ids: vec![shared.id.clone(), tag2.id.clone()],
                is_pinned: false,
            })
            .expect("A tags");
        notes_b
            .save(&crate::repo::SaveNoteInput {
                id: created.summary.id.clone(),
                doc: serde_json::json!({
                    "type": "doc",
                    "content": [{"type": "paragraph", "content": [{"type": "text", "text": "B edit"}]}]
                }),
                folder_id: Some(folder.id.clone()),
                tag_ids: vec![shared.id.clone(), tag3.id.clone()],
                is_pinned: false,
            })
            .expect("B tags");
        sync_a.run_cycle(None).await.expect("A pushes tags");
        let b_tags = sync_b.run_cycle(None).await.expect("B pushes tags");
        assert!(b_tags.pushed >= 1, "B uploads its tag set: {b_tags:?}");
        // Still exactly the one parked row from the document leg: the equal
        // docs take the union path and park nothing new (the table is one
        // row per note, so a second park could not raise the count anyway —
        // the server tag set below is what proves the union ran).
        assert_eq!(sync_b.list_conflicts().expect("lists").len(), 1);
        let note_uuid = uuid::Uuid::parse_str(&created.summary.id).expect("note uuid");
        let server_tags: Vec<String> = client
            .query(
                "SELECT tag_id::text FROM note_tags WHERE note_id = $1::uuid ORDER BY 1",
                &[&note_uuid],
            )
            .await
            .expect("tag set")
            .iter()
            .map(|row| row.get(0))
            .collect();
        assert_eq!(
            server_tags.len(),
            3,
            "union keeps all three: {server_tags:?}"
        );

        // Folder LWW: the later rename wins on both sides.
        folders_a.rename(&folder.id, "AName").expect("A renames");
        sync_a.run_cycle(None).await.expect("A pushes rename");
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let folders_b = crate::repo::folders::SqliteFoldersRepo::new(Arc::clone(&db_b));
        folders_b.rename(&folder.id, "BName").expect("B renames");
        let b_rename = sync_b.run_cycle(None).await.expect("B pushes rename");
        assert!(b_rename.pushed >= 1, "B uploads its rename: {b_rename:?}");
        // Unchanged: still exactly the one parked row from the document leg.
        // (Folders resolve by LWW and never park; the server name below is
        // what proves B's rename won.)
        assert_eq!(sync_b.list_conflicts().expect("lists").len(), 1);
        let folder_uuid = uuid::Uuid::parse_str(&folder.id).expect("folder uuid");
        let server_name: String = client
            .query_one(
                "SELECT name FROM folders WHERE id = $1::uuid",
                &[&folder_uuid],
            )
            .await
            .expect("folder reads")
            .get(0);
        assert_eq!(server_name, "BName", "later rename wins");
        sync_a.run_cycle(None).await.expect("A pulls rename");
        let tree = folders_a.list().expect("tree lists");
        assert_eq!(tree[0].name, "BName");

        assert_eq!(
            sync_a.status().expect("status").pending_count,
            0,
            "A drains clean"
        );
        // The union push above raced tag-row arrival: B linked a tag it had
        // not pulled yet, so the local link write aborted on the FK (SQLite
        // does not apply OR IGNORE to foreign keys) *after* the server side
        // had already applied the full union. Nothing is lost — the row waits
        // out backoff and completes once the tag row arrives, exactly like a
        // transient failure. Clear the wait to prove the heal deterministically.
        db_b.with_conn(|conn| {
            conn.execute(
                "UPDATE outbox SET next_retry_at = NULL WHERE sent_at IS NULL",
                (),
            )?;
            Ok::<_, AppError>(())
        })
        .expect("backoff released");
        let b_heal = sync_b.run_cycle(None).await.expect("B heals links");
        assert_eq!(
            b_heal.conflicts, 1,
            "healing parks nothing new, old row stands: {b_heal:?}"
        );
        assert_eq!(
            sync_b.status().expect("status").pending_count,
            0,
            "B drains clean (the parked conflict lives in the conflicts table, not the outbox)"
        );

        std::fs::remove_dir_all(&dir_a).ok();
        std::fs::remove_dir_all(&dir_b).ok();
    }
}
