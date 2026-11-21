use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio_postgres::Client;

use crate::db::Database;
use crate::error::AppError;

mod merge;
mod tag_merge;
mod tree;

const BATCH_ROWS: usize = 50;
const PULL_LIMIT: i64 = 200;
const PULL_PAGES_PER_CYCLE: usize = 10;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const QUERY_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_BATCHES_PER_CYCLE: usize = 20;
const RETRY_BASE_MS: i64 = 30_000;
const RETRY_CAP_MS: i64 = 30 * 60_000;

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
            let title = remote_title.clone();
            let derived = crate::services::derive::derive(&doc);
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

    pub async fn run_cycle(&self, open_note_id: Option<&str>) -> Result<SyncSummary, AppError> {
        let _guard = match self.lock.try_lock() {
            Ok(guard) => guard,
            Err(_) => return Ok(SyncSummary::busy()),
        };

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
                    }
                }
            }
            if !progressed {
                break;
            }
        }

        let (pulled_pull, deferred) =
            self.pull_all(&client, open_note_id)
                .await
                .inspect_err(|err| {
                    let _ = self
                        .db
                        .with_conn(|conn| put_state(conn, KEY_LAST_ERROR, &err.log_line()));
                })?;
        pulled += pulled_pull;
        let conflicts = self.db.with_conn(|conn| {
            conn.query_row("SELECT COUNT(*) FROM conflicts", (), |row| row.get(0))
                .map_err(AppError::from)
        })?;

        let now = crate::clock::now_ms();
        self.db.with_conn(|conn| {
            use rusqlite::OptionalExtension as _;
            let failing: Option<String> = conn
                .query_row(
                    "SELECT last_error FROM outbox
                      WHERE sent_at IS NULL AND last_error IS NOT NULL AND last_error <> ''
                   ORDER BY id DESC LIMIT 1",
                    (),
                    |row| row.get(0),
                )
                .optional()?;
            put_state(conn, KEY_LAST_SYNCED, &now.to_string())?;
            put_state(conn, KEY_LAST_ERROR, failing.as_deref().unwrap_or(""))?;
            Ok::<_, AppError>(())
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

    async fn push_tag(&self, client: &Client, row: &OutboxRow) -> Result<PushOutcome, AppError> {
        let local = self
            .db
            .with_conn(|conn| load_local_tag(conn, &row.entity_id))?;
        let id = uid(&row.entity_id)?;

        if row.op == "delete" || local.is_none() {
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

        let remote = query_remote_tag(client, &row.entity_id).await?;
        if remote.as_ref().is_none_or(|r| r.deleted_at.is_none()) {
            if let Some(winner) = query_live_tag_named(client, &local.name, id).await? {
                let known = remote.is_some();
                self.db.with_conn(|conn| {
                    let tx = conn.transaction()?;
                    mark_sent_tx(&tx, row.outbox_id)?;
                    tag_merge::merge_tag_into(&tx, &row.entity_id, &winner, known)?;
                    tx.commit()?;
                    Ok::<_, AppError>(())
                })?;
                return Ok(PushOutcome::Rebased);
            }
        }

        match remote {
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

    async fn push_folder(&self, client: &Client, row: &OutboxRow) -> Result<PushOutcome, AppError> {
        let local = self
            .db
            .with_conn(|conn| load_local_folder(conn, &row.entity_id))?;
        let id = uid(&row.entity_id)?;

        if row.op == "delete" || local.is_none() {
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
                if local.parent_id.is_some()
                    && local.parent_id != remote.parent_id
                    && server_would_cycle(client, id, parent).await? =>
            {
                self.rebase_folder(&remote, row.outbox_id)?;
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
                    self.rebase_folder(&remote, row.outbox_id)?;
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

    fn rebase_folder(&self, remote: &RemoteFolder, outbox_id: i64) -> Result<(), AppError> {
        self.db.with_conn(|conn| {
            let tx = conn.transaction()?;
            mark_sent_tx(&tx, outbox_id)?;
            tree::upsert_remote_folder(&tx, remote, false)?;
            tx.commit()?;
            Ok(())
        })
    }

    async fn push_note(&self, client: &Client, row: &OutboxRow) -> Result<PushOutcome, AppError> {
        let local = self
            .db
            .with_conn(|conn| load_local_note(conn, &row.entity_id))?;
        let id = uid(&row.entity_id)?;

        if row.op == "delete" || local.is_none() {
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
            Some(remote)
                if remote.deleted_at.is_some()
                    && (local.deleted_at.is_some() || remote.rev > row.base_rev) =>
            {
                if local.deleted_at.is_some() {
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
                let remote_tags = query_remote_note_tags(client, &row.entity_id).await?;
                let rev = update_remote_note(client, &row.entity_id, &local).await?;
                self.push_note_tags(client, &row.entity_id, &local.tag_ids, &remote_tags)
                    .await?;
                self.accept_push("notes", &row.entity_id, rev, row.outbox_id)?;
                Ok(PushOutcome::Pushed)
            }
        }
    }

    async fn push_note_conflicted(
        &self,
        client: &Client,
        row: &OutboxRow,
        local: &LocalNote,
        remote: &RemoteNote,
    ) -> Result<PushOutcome, AppError> {
        let remote_tags = query_remote_note_tags(client, &row.entity_id).await?;
        let touched = self
            .db
            .with_conn(|conn| merge::local_touches(conn, &row.entity_id, None))?;
        let merged = merge::merge_note(local, remote, &remote_tags, touched);

        let rev = update_remote_note(client, &row.entity_id, &merged.note).await?;
        self.push_note_tags(client, &row.entity_id, &merged.note.tag_ids, &remote_tags)
            .await?;

        self.db.with_conn(|conn| {
            let newer = merge::local_touches(conn, &row.entity_id, Some(row.outbox_id))?;
            let tx = conn.transaction()?;
            if merged.park {
                park_conflict_in(
                    &tx,
                    &row.entity_id,
                    local.rev,
                    remote.rev,
                    &remote.doc_json,
                    &remote.title,
                )?;
            }
            merge::write_merged(&tx, &row.entity_id, &merged, newer)?;
            accept_push_tx(
                &tx,
                "notes",
                &row.entity_id,
                rev,
                row.outbox_id,
                merge::may_rebase(&merged, newer),
            )?;
            tx.commit()?;
            Ok::<_, AppError>(())
        })?;
        Ok(if merged.park {
            PushOutcome::ConflictParked
        } else {
            PushOutcome::Pushed
        })
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

    fn supersede(&self, entity_id: &str, outbox_id: i64) -> Result<(), AppError> {
        let now = crate::clock::now_ms();
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE outbox SET sent_at = ?3 WHERE sent_at IS NULL AND entity_id = ?1 AND id < ?2",
                rusqlite::params![entity_id, outbox_id, now],
            )?;
            Ok(())
        })
    }

    fn accept_push(&self, table: &str, id: &str, rev: i64, outbox_id: i64) -> Result<(), AppError> {
        self.db.with_conn(|conn| {
            let tx = conn.transaction()?;
            accept_push_tx(&tx, table, id, rev, outbox_id, true)?;
            tx.commit()?;
            Ok(())
        })
    }

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
        let watermark = watermark(&self.db, KEY_FOLDERS_REV)?;
        let mut cursor = watermark;
        let mut rows: Vec<RemoteFolder> = Vec::new();
        loop {
            let page: Vec<RemoteFolder> = client_query(
                client,
                "SELECT id::text AS id, name, parent_id::text AS parent_id, position, rev,
                        created_at, updated_at, deleted_at
                 FROM folders WHERE rev > $1 ORDER BY rev LIMIT $2",
                &[&cursor as _, &PULL_LIMIT as _],
            )
            .await?;
            let full = page.len() == PULL_LIMIT as usize;
            cursor = page.iter().map(|row| row.rev).fold(cursor, i64::max);
            rows.extend(page);
            if !full {
                break;
            }
        }
        if rows.is_empty() {
            return Ok(0);
        }
        let pulled = self
            .db
            .with_conn(|conn| tree::apply_remote_folders(conn, &rows))?;
        set_watermark(&self.db, KEY_FOLDERS_REV, cursor)?;
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

    async fn pull_notes(
        &self,
        client: &Client,
        open_note_id: Option<&str>,
    ) -> Result<(i64, i64), AppError> {
        let mut pulled = 0;
        let mut deferred = 0;
        let mut cursor = PullCursor::new(watermark(&self.db, KEY_NOTES_REV)?);
        for _ in 0..PULL_PAGES_PER_CYCLE {
            let rows: Vec<RemoteNote> = client_query(
                client,
                "SELECT id::text AS id, title, title_source, doc_json::text AS doc_json,
                        plain_text, excerpt, word_count, folder_id::text AS folder_id,
                        is_pinned, rev, created_at, updated_at, deleted_at
                 FROM notes WHERE rev > $1 ORDER BY rev LIMIT $2",
                &[&cursor.next_page_after() as _, &PULL_LIMIT as _],
            )
            .await?;
            if rows.is_empty() {
                break;
            }
            let mut tag_sets = query_remote_tag_sets(client, &rows).await?;
            for remote in &rows {
                if note_pull_skipped(open_note_id, remote, &self.db)? {
                    cursor.defer(remote.rev);
                    deferred += 1;
                    continue;
                }
                let remote_tags = tag_sets.remove(&remote.id).unwrap_or_default();
                if self
                    .db
                    .with_conn(|conn| apply_remote_note(conn, remote, &remote_tags))?
                    == ApplyOutcome::Applied
                {
                    pulled += 1;
                }
                cursor.seen(remote.rev);
            }
            set_watermark(&self.db, KEY_NOTES_REV, cursor.watermark())?;
            if rows.len() < PULL_LIMIT as usize {
                break;
            }
        }
        Ok((pulled, deferred))
    }
}

#[derive(Debug, Clone, Copy)]
struct PullCursor {
    start: i64,
    max_seen: i64,
    min_deferred: Option<i64>,
}

impl PullCursor {
    fn new(watermark: i64) -> Self {
        Self {
            start: watermark,
            max_seen: watermark,
            min_deferred: None,
        }
    }

    fn seen(&mut self, rev: i64) {
        self.max_seen = self.max_seen.max(rev);
    }

    fn defer(&mut self, rev: i64) {
        self.seen(rev);
        self.min_deferred = Some(self.min_deferred.map_or(rev, |prev| prev.min(rev)));
    }

    fn next_page_after(&self) -> i64 {
        self.max_seen
    }

    fn watermark(&self) -> i64 {
        match self.min_deferred {
            Some(deferred) => (deferred - 1).max(self.start),
            None => self.max_seen,
        }
    }
}

fn network(detail: impl std::fmt::Display) -> AppError {
    AppError::Network(format!("Could not reach the sync server: {detail}"))
}

fn pg_error(err: tokio_postgres::Error) -> AppError {
    let mut detail = err.to_string();
    let mut cause = std::error::Error::source(&err);
    while let Some(next) = cause {
        detail.push_str(": ");
        detail.push_str(&next.to_string());
        cause = next.source();
    }
    let Some(db) = err.as_db_error() else {
        return network(detail);
    };
    classify_sqlstate(db.code().code(), detail)
}

fn classify_sqlstate(sqlstate: &str, detail: String) -> AppError {
    let class = sqlstate.get(..2).unwrap_or("");
    if class == "28" || class == "3D" || sqlstate == "42P01" || sqlstate == "42703" {
        AppError::Validation(format!(
            "The sync server refused the connection string or has no Chayote schema — check it under Settings → Sync ({detail})."
        ))
    } else if class == "08" || class == "53" || class == "57" {
        network(detail)
    } else {
        AppError::internal(format!("The sync server rejected a write: {detail}"))
    }
}

async fn connect(conn_str: &str) -> Result<Client, AppError> {
    let mode = ssl_mode(conn_str);
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
                    .map_err(pg_error)?;
            tokio::spawn(async move {
                let _ = connection.await;
            });
            Ok(client)
        } else {
            let mut roots = rustls::RootCertStore::empty();
            roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
            let mut config = rustls::ClientConfig::builder()
                .with_root_certificates(roots)
                .with_no_client_auth();
            if mode == SslMode::Require {
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

fn uid(id: &str) -> Result<uuid::Uuid, AppError> {
    uuid::Uuid::parse_str(id)
        .map_err(|err| AppError::internal(format!("stored id is not a UUID: {err}")))
}

fn uid_opt(id: Option<&str>) -> Result<Option<uuid::Uuid>, AppError> {
    id.map(uid).transpose()
}

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

fn accept_push_tx(
    tx: &rusqlite::Transaction<'_>,
    table: &str,
    id: &str,
    rev: i64,
    outbox_id: i64,
    rebase: bool,
) -> Result<(), AppError> {
    let now = crate::clock::now_ms();
    let newer: i64 = tx.query_row(
        "SELECT COUNT(*) FROM outbox WHERE sent_at IS NULL AND entity_id = ?1 AND id > ?2",
        rusqlite::params![id, outbox_id],
        |row| row.get(0),
    )?;
    tx.execute(
        &format!("UPDATE {table} SET rev = ?2, dirty = ?3 WHERE id = ?1"),
        rusqlite::params![id, rev, i64::from(newer > 0)],
    )?;
    if rebase {
        tx.execute(
            "UPDATE outbox SET base_rev = ?3
              WHERE sent_at IS NULL AND entity_id = ?1 AND id > ?2 AND base_rev < ?3",
            rusqlite::params![id, outbox_id, rev],
        )?;
    }
    if table == "notes" {
        tx.execute(
            "UPDATE notes SET synced_at = ?2 WHERE id = ?1",
            rusqlite::params![id, now],
        )?;
    }
    mark_sent_tx(tx, outbox_id)?;
    tx.execute(
        "UPDATE outbox SET sent_at = ?3 WHERE sent_at IS NULL AND entity_id = ?1 AND id < ?2",
        rusqlite::params![id, outbox_id, now],
    )?;
    Ok(())
}

fn mark_sent_tx(tx: &rusqlite::Transaction<'_>, outbox_id: i64) -> Result<(), rusqlite::Error> {
    tx.execute(
        "UPDATE outbox SET sent_at = ?2 WHERE id = ?1",
        rusqlite::params![outbox_id, crate::clock::now_ms()],
    )?;
    Ok(())
}

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

async fn query_live_tag_named(
    client: &Client,
    name: &str,
    id: uuid::Uuid,
) -> Result<Option<RemoteTag>, AppError> {
    let rows: Vec<RemoteTag> = client_query(
        client,
        "SELECT id::text AS id, name, rev, created_at, updated_at, deleted_at
         FROM tags
         WHERE lower(name) = lower($1) AND deleted_at IS NULL AND id <> $2::uuid
         LIMIT 1",
        &[&name as _, &id as _],
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

async fn server_would_cycle(
    client: &Client,
    id: uuid::Uuid,
    parent: Option<uuid::Uuid>,
) -> Result<bool, AppError> {
    let Some(parent) = parent else {
        return Ok(false);
    };
    let row = tokio::time::timeout(
        QUERY_TIMEOUT,
        client.query_one(
            "WITH RECURSIVE up(id, parent_id) AS (
                 SELECT id, parent_id FROM folders WHERE id = $2::uuid
               UNION
                 SELECT f.id, f.parent_id FROM folders f JOIN up ON f.id = up.parent_id
             )
             SELECT EXISTS (SELECT 1 FROM up WHERE id = $1::uuid)",
            &[&id as _, &parent as _],
        ),
    )
    .await
    .map_err(|_| network(query_timeout()))?
    .map_err(pg_error)?;
    row.try_get(0).map_err(network)
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

async fn query_remote_tag_sets(
    client: &Client,
    notes: &[RemoteNote],
) -> Result<std::collections::HashMap<String, Vec<String>>, AppError> {
    let ids: Vec<uuid::Uuid> = notes
        .iter()
        .map(|note| uid(&note.id))
        .collect::<Result<_, _>>()?;
    let rows = tokio::time::timeout(
        QUERY_TIMEOUT,
        client.query(
            "SELECT note_id::text, tag_id::text FROM note_tags
              WHERE note_id = ANY($1::uuid[]) ORDER BY note_id, tag_id",
            &[&ids as _],
        ),
    )
    .await
    .map_err(|_| network(query_timeout()))?
    .map_err(pg_error)?;
    let mut sets: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
    for row in &rows {
        let note: String = row.try_get(0).map_err(network)?;
        let tag: String = row.try_get(1).map_err(network)?;
        sets.entry(note).or_default().push(tag);
    }
    Ok(sets)
}

async fn insert_remote_note(client: &Client, id: &str, local: &LocalNote) -> Result<i64, AppError> {
    let id = uid(id)?;
    let folder = uid_opt(local.folder_id.as_deref())?;
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

fn apply_remote_tag(conn: &mut rusqlite::Connection, remote: &RemoteTag) -> Result<bool, AppError> {
    let tx = conn.transaction()?;
    let local: Option<(i64, i64)> = tx
        .query_row(
            "SELECT rev, dirty FROM tags WHERE id = ?1",
            [&remote.id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .ok();
    let skip = match local {
        None => remote.deleted_at.is_some(),
        Some((local_rev, dirty)) => remote.rev <= local_rev || dirty != 0,
    };
    if !skip && remote.deleted_at.is_none() {
        if let Some(loser) = tag_merge::local_clash(&tx, &remote.id, &remote.name)? {
            tag_merge::merge_tag_into(&tx, &loser, remote, false)?;
            tx.commit()?;
            return Ok(true);
        }
    }
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
                if remote.deleted_at.is_some() {
                    return Ok(ApplyOutcome::Unchanged);
                }
                let touched = merge::local_touches(conn, &remote.id, None)?;
                let merged = merge::merge_note(&local, remote, remote_tags, touched);
                let tx = conn.transaction()?;
                if merged.park {
                    park_conflict_in(
                        &tx,
                        &remote.id,
                        local.rev,
                        remote.rev,
                        &remote.doc_json,
                        &remote.title,
                    )?;
                }
                merge::write_merged(&tx, &remote.id, &merged, merge::Touched::default())?;
                tx.commit()?;
                return Ok(if merged.park {
                    ApplyOutcome::Conflicted
                } else {
                    ApplyOutcome::Applied
                });
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

#[cfg(test)]
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

        let batch = db
            .with_conn(|conn| pending_batch(conn, now + 600_001))
            .expect("batch reads");
        assert_eq!(batch.len(), 1);
        assert_eq!(batch[0].entity_id, tag.id);
    }

    #[test]
    fn pending_batch_never_promotes_stale_state_past_a_waiting_latest() {
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
        assert!(note_pull_skipped(Some(&id), &newer, &db).expect("reads"));
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
        let tag = tags.create("Ephemeral").expect("tag creates");
        tags.delete(&tag.id).expect("tag deletes");
        let status = sync.status().expect("status");
        assert_eq!(status.pending_count, 1);
    }

    #[test]
    fn postgres_errors_are_classified_by_sqlstate() {
        let code = |state: &str| classify_sqlstate(state, "detail".into()).code();
        assert_eq!(code("28P01"), "VALIDATION", "bad password");
        assert_eq!(code("3D000"), "VALIDATION", "no such database");
        assert_eq!(code("42P01"), "VALIDATION", "schema.sql never applied");
        assert_eq!(code("23505"), "INTERNAL", "unique violation");
        assert_eq!(code("23503"), "INTERNAL", "foreign key violation");
        assert_eq!(code("57P01"), "NETWORK", "server shutting down");
        assert_eq!(code("08006"), "NETWORK", "connection failure");
        assert_eq!(code("53300"), "NETWORK", "too many connections");
    }

    #[test]
    fn a_deferred_row_holds_the_watermark_but_not_the_page() {
        let mut cursor = PullCursor::new(100);
        cursor.seen(101);
        cursor.defer(102);
        cursor.seen(300);
        assert_eq!(
            cursor.next_page_after(),
            300,
            "the next page starts past it"
        );
        assert_eq!(cursor.watermark(), 101, "the next cycle re-fetches it");
        cursor.seen(500);
        cursor.defer(450);
        assert_eq!(cursor.watermark(), 101, "the lowest deferral holds");

        let mut quiet = PullCursor::new(7);
        assert_eq!(quiet.watermark(), 7);
        quiet.seen(42);
        assert_eq!(quiet.watermark(), 42);

        let mut first = PullCursor::new(7);
        first.defer(8);
        assert_eq!(first.watermark(), 7, "never below where it started");
    }

    #[test]
    fn accepting_a_push_keeps_edits_queued_during_it() {
        let db = Database::open_in_memory().expect("memory db");
        let sync = SyncService::new(Arc::new(db));
        let db = sync.db.clone();
        let tags = crate::repo::tags::SqliteTagsRepo::new(Arc::clone(&db));
        let tag = tags.create("Before").expect("tag creates");
        let rows = |db: &Database| {
            db.with_conn(|conn| {
                let mut stmt = conn.prepare(
                    "SELECT id, sent_at IS NOT NULL, base_rev FROM outbox WHERE entity_id = ?1 ORDER BY id",
                )?;
                let out = stmt
                    .query_map([&tag.id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
                    .collect::<Result<Vec<(i64, bool, i64)>, _>>()?;
                Ok::<_, AppError>(out)
            })
            .expect("outbox reads")
        };
        let pushed = rows(&db)[0].0;

        tags.rename(&tag.id, "During").expect("tag renames");
        sync.accept_push("tags", &tag.id, 42, pushed)
            .expect("push accepted");

        let after = rows(&db);
        assert_eq!(after.len(), 2);
        assert!(after[0].1, "the pushed row is sent");
        assert!(!after[1].1, "the newer row is still pending");
        assert_eq!(after[1].2, 42, "and rebased onto the pushed rev");
        let dirty: i64 = db
            .with_conn(|conn| {
                conn.query_row("SELECT dirty FROM tags WHERE id = ?1", [&tag.id], |row| {
                    row.get(0)
                })
                .map_err(AppError::from)
            })
            .expect("tag reads");
        assert_eq!(dirty, 1);
    }

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

        let folder_uuid = uuid::Uuid::parse_str(&folder.id).expect("folder uuid");
        let note_uuid = uuid::Uuid::parse_str(&created.summary.id).expect("note uuid");

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

        let second = sync.run_cycle(None).await.expect("second cycle");
        assert_eq!((second.pushed, second.pulled), (0, 0));

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

        sync.resolve_conflict(&conflicts[0].id, true)
            .await
            .expect("keep-local resolves");
        assert_eq!(sync.list_conflicts().expect("lists").len(), 0);

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

    static LIVE_2DEV: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

    #[tokio::test]
    async fn live_two_devices_share_tag_union_and_lww() {
        let _turn = LIVE_2DEV.lock().await;
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

        let first_b = sync_b.run_cycle(None).await.expect("B pulls");
        assert!(first_b.pulled >= 3, "B downloads everything: {first_b:?}");
        let b_live = notes_b.get(&created.summary.id).expect("B reads note");
        assert!(
            b_live.summary.excerpt.contains("hello A"),
            "B sees A's document: {:?}",
            b_live.summary.title
        );

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
        let a_pull = sync_a.run_cycle(None).await.expect("A pulls");
        assert_eq!(a_pull.pulled, 1, "A applies B's push: {a_pull:?}");
        let a_live = notes_a.get(&created.summary.id).expect("A reads");
        assert!(
            a_live.summary.excerpt.contains("B edit"),
            "A converges onto B: {:?}",
            a_live.summary.title
        );

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

        folders_a.rename(&folder.id, "AName").expect("A renames");
        sync_a.run_cycle(None).await.expect("A pushes rename");
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let folders_b = crate::repo::folders::SqliteFoldersRepo::new(Arc::clone(&db_b));
        folders_b.rename(&folder.id, "BName").expect("B renames");
        let b_rename = sync_b.run_cycle(None).await.expect("B pushes rename");
        assert!(b_rename.pushed >= 1, "B uploads its rename: {b_rename:?}");
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

    #[tokio::test]
    async fn live_two_devices_merge_disjoint_changes_tags_and_trees() {
        let _turn = LIVE_2DEV.lock().await;
        let url = match std::env::var("CHAYOTE_SYNC_2DEV_URL") {
            Ok(url) => url,
            Err(_) => {
                eprintln!("skipping two-device merge test: CHAYOTE_SYNC_2DEV_URL unset");
                return;
            }
        };
        let device = |tag: &str| {
            let dir = std::env::temp_dir().join(format!(
                "chayote-sync-merge-{tag}-{}-{:?}",
                std::process::id(),
                std::thread::current().id()
            ));
            std::fs::remove_dir_all(&dir).ok();
            std::fs::create_dir_all(&dir).expect("temp dir");
            let db = Arc::new(Database::open(&dir).expect("database opens"));
            let sync = SyncService::new(Arc::clone(&db));
            (dir, db, sync)
        };
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

        let folders_a = crate::repo::folders::SqliteFoldersRepo::new(Arc::clone(&db_a));
        let folders_b = crate::repo::folders::SqliteFoldersRepo::new(Arc::clone(&db_b));
        let tags_a = crate::repo::tags::SqliteTagsRepo::new(Arc::clone(&db_a));
        let tags_b = crate::repo::tags::SqliteTagsRepo::new(Arc::clone(&db_b));
        let notes_a = crate::repo::notes::SqliteNotesRepo::new(Arc::clone(&db_a));
        let notes_b = crate::repo::notes::SqliteNotesRepo::new(Arc::clone(&db_b));
        let text = |words: &str| {
            serde_json::json!({
                "type": "doc",
                "content": [{"type": "paragraph", "content": [{"type": "text", "text": words}]}]
            })
        };

        let parent = folders_a.create("Parent", None).expect("creates");
        let child = folders_a
            .create("Child", Some(&parent.id))
            .expect("creates");
        let other = folders_a.create("Other", None).expect("creates");
        sync_a.run_cycle(None).await.expect("A pushes the tree");
        folders_a
            .rename(&parent.id, "Parent renamed")
            .expect("renames");
        sync_a.run_cycle(None).await.expect("A pushes the rename");
        let first_b = sync_b
            .run_cycle(None)
            .await
            .expect("B pulls the tree in one cycle");
        assert!(first_b.pulled >= 3, "B lands every folder: {first_b:?}");
        let tree_b = folders_b.list().expect("lists");
        let parent_b = tree_b
            .iter()
            .find(|node| node.id == parent.id)
            .expect("the parent is a root");
        assert_eq!(
            parent_b.children.len(),
            1,
            "the child is under it: {tree_b:?}"
        );
        assert_eq!(parent_b.children[0].id, child.id);

        let work_a = tags_a.create("work").expect("creates");
        sync_a.run_cycle(None).await.expect("A pushes its tag");
        let work_b = tags_b.create("Work").expect("creates");
        let tagged = notes_b.create(None).expect("creates").summary.id;
        notes_b
            .save(&crate::repo::SaveNoteInput {
                id: tagged.clone(),
                doc: text("tagged on B"),
                folder_id: None,
                tag_ids: vec![work_b.id.clone()],
                is_pinned: false,
            })
            .expect("tags the note");
        sync_b
            .run_cycle(None)
            .await
            .expect("B's push meets the clash");
        sync_b.run_cycle(None).await.expect("B settles");
        let listed = tags_b.list().expect("lists");
        assert_eq!(listed.len(), 1, "one tag left on B: {listed:?}");
        assert_eq!(listed[0].id, work_a.id, "the server's tag stands");
        assert_eq!(listed[0].count, 1, "B's note carries it");
        let status_b = sync_b.status().expect("status");
        assert_eq!(status_b.pending_count, 0, "B drains: {status_b:?}");
        assert!(status_b.last_error.is_none(), "{status_b:?}");
        sync_a.run_cycle(None).await.expect("A pulls B's note");
        let on_a = notes_a.get(&tagged).expect("A has the note");
        assert_eq!(on_a.summary.tags.len(), 1);
        assert_eq!(on_a.summary.tags[0].id, work_a.id);

        sync_b.run_cycle(None).await.expect("B is current");
        notes_a.set_pinned(&tagged, true).expect("A pins");
        notes_b
            .save(&crate::repo::SaveNoteInput {
                id: tagged.clone(),
                doc: text("edited on B"),
                folder_id: None,
                tag_ids: vec![work_a.id.clone()],
                is_pinned: false,
            })
            .expect("B edits");
        sync_b
            .run_cycle(None)
            .await
            .expect("B pushes the text first");
        let a_round = sync_a.run_cycle(None).await.expect("A pushes the pin");
        assert_eq!(
            a_round.conflicts, 0,
            "a pin is not a text conflict: {a_round:?}"
        );
        let on_a = notes_a.get(&tagged).expect("reads");
        assert!(
            on_a.summary.excerpt.contains("edited on B"),
            "A takes B's text: {:?}",
            on_a.summary.excerpt
        );
        assert!(on_a.summary.is_pinned, "A keeps its pin");
        let b_round = sync_b.run_cycle(None).await.expect("B pulls the pin");
        assert_eq!(b_round.conflicts, 0);
        let on_b = notes_b.get(&tagged).expect("reads");
        assert!(on_b.summary.is_pinned && on_b.summary.excerpt.contains("edited on B"));

        folders_a
            .move_to(&other.id, Some(&parent.id), 0)
            .expect("A moves Other under Parent");
        folders_b
            .move_to(&parent.id, Some(&other.id), 0)
            .expect("B moves Parent under Other");
        sync_a.run_cycle(None).await.expect("A pushes its move");
        sync_b.run_cycle(None).await.expect("B's move loses");
        sync_a.run_cycle(None).await.expect("A settles");
        let parent_uuid = uuid::Uuid::parse_str(&parent.id).expect("uuid");
        let server_parent: Option<String> = client
            .query_one(
                "SELECT parent_id::text FROM folders WHERE id = $1::uuid",
                &[&parent_uuid],
            )
            .await
            .expect("reads")
            .get(0);
        assert_eq!(server_parent, None, "the server holds no cycle");
        for (who, repo) in [("A", &folders_a), ("B", &folders_b)] {
            let tree = repo.list().expect("lists");
            let root = tree
                .iter()
                .find(|node| node.id == parent.id)
                .unwrap_or_else(|| panic!("{who}: Parent is a root: {tree:?}"));
            assert!(
                root.children.iter().any(|node| node.id == other.id),
                "{who}: Other is under Parent: {tree:?}"
            );
            assert!(repo.move_to(&child.id, Some(&parent.id), 0).is_ok());
        }

        std::fs::remove_dir_all(&dir_a).ok();
        std::fs::remove_dir_all(&dir_b).ok();
    }
}
