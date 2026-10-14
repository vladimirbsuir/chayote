use std::sync::Arc;

use uuid::Uuid as UuidV7;

use crate::db::Database;
use crate::doc;
use crate::error::AppError;
use crate::repo::{
    append_outbox, attach, base_rev_of, read_rows, Note, NoteFilter, NoteSummary, NotesRepo,
    SaveNoteInput, Selection, SummaryRow, SUMMARY_COLUMNS,
};
use crate::services::derive;

/// The only implementation. Sync replicates its rows to Postgres without
/// touching anything above this trait (ADR-003).
pub struct SqliteNotesRepo {
    db: Arc<Database>,
}

impl SqliteNotesRepo {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    fn load(&self, conn: &rusqlite::Connection, id: &str) -> Result<Note, AppError> {
        let sql = format!(
            "SELECT {SUMMARY_COLUMNS}, n.doc_json, n.created_at, n.deleted_at
               FROM notes n
              WHERE n.id = ?1"
        );
        let mut stmt = conn.prepare(&sql)?;
        let found = stmt.query_row([id], |row| {
            Ok((
                SummaryRow::read(row)?,
                row.get::<_, String>(7)?,
                row.get::<_, i64>(8)?,
                row.get::<_, Option<i64>>(9)?,
            ))
        });
        let (summary_row, doc_json, created_at, deleted_at) = found.map_err(|err| match err {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound,
            other => AppError::from(other),
        })?;
        drop(stmt);

        let summary = attach(conn, std::slice::from_ref(&summary_row))?
            .into_iter()
            .next()
            .ok_or(AppError::NotFound)?;

        let doc = serde_json::from_str(&doc_json).map_err(|err| {
            AppError::internal(format!("stored document is not valid JSON: {err}"))
        })?;

        Ok(Note {
            summary,
            doc,
            created_at,
            deleted_at,
        })
    }
}

/// A fresh UUIDv7 (R1). Generated on the device at creation time, never
/// reassigned, never reused after a delete.
fn new_id() -> String {
    UuidV7::now_v7().to_string()
}

/// Reads `rev` outside the write transaction's borrow, then writes.
fn base_rev(conn: &rusqlite::Connection, id: &str) -> Result<i64, AppError> {
    base_rev_of(conn, "notes", id)?.ok_or(AppError::NotFound)
}

const DEFAULT_ORDER: &str = "n.is_pinned DESC, n.updated_at DESC";

impl NotesRepo for SqliteNotesRepo {
    /// `03-data-model.md` §5. Pinned notes sort first across the whole
    /// selection, not just within a folder.
    fn list(&self, filter: &NoteFilter) -> Result<Vec<NoteSummary>, AppError> {
        self.db.with_conn(|conn| {
            let (liveness, order) = match filter.selection {
                Selection::Trash => ("n.deleted_at IS NOT NULL", "n.deleted_at DESC"),
                Selection::All | Selection::Pinned => ("n.deleted_at IS NULL", DEFAULT_ORDER),
                Selection::Folder { .. } | Selection::Tag { .. } => {
                    ("n.deleted_at IS NULL", DEFAULT_ORDER)
                }
            };

            let mut predicates = vec![liveness.to_owned()];
            match &filter.selection {
                Selection::Pinned => predicates.push("n.is_pinned = 1".to_owned()),
                Selection::Folder { .. } => predicates.push("n.folder_id = ?1".to_owned()),
                Selection::Tag { .. } => predicates.push(
                    "EXISTS (SELECT 1 FROM note_tags nt
                              WHERE nt.note_id = n.id AND nt.tag_id = ?1)"
                        .to_owned(),
                ),
                Selection::All | Selection::Trash => {}
            }

            let sql = format!(
                "SELECT {SUMMARY_COLUMNS} FROM notes n
                  WHERE {}
               ORDER BY {order}",
                predicates.join(" AND ")
            );

            let scope = match &filter.selection {
                Selection::Folder { id } | Selection::Tag { id } => Some(id.as_str()),
                _ => None,
            };
            let rows = read_rows(conn, &sql, scope)?;
            let mut summaries = attach(conn, &rows)?;

            // Paging is applied after the joins so the limit counts notes, not
            // join rows.
            let offset = filter.offset.unwrap_or(0).max(0) as usize;
            if offset > 0 {
                summaries = summaries.into_iter().skip(offset).collect();
            }
            if let Some(limit) = filter.limit {
                summaries.truncate(limit.max(0) as usize);
            }
            Ok(summaries)
        })
    }

    fn get(&self, id: &str) -> Result<Note, AppError> {
        self.db.with_conn(|conn| self.load(conn, id))
    }

    fn create(&self, folder_id: Option<&str>) -> Result<Note, AppError> {
        let id = new_id();
        let doc_value = doc::validate::empty_doc();
        let derived = derive::derive(&doc_value, "auto");
        let serialised = serde_json::to_string(&doc_value).map_err(AppError::internal)?;
        let payload = serde_json::json!({ "id": id, "folderId": folder_id }).to_string();
        let folder = folder_id.map(str::to_owned);

        self.db.with_conn(move |conn| {
            let tx = conn.transaction()?;
            tx.execute(
                "INSERT INTO notes (id, title, title_source, doc_json, plain_text, excerpt,
                                    word_count, folder_id, is_pinned, rev, dirty,
                                    created_at, updated_at)
                 VALUES (?1, ?2, 'auto', ?3, ?4, ?5, ?6, ?7, 0, 0, 1, ?8, ?8)",
                rusqlite::params![
                    id,
                    derived.title,
                    serialised,
                    derived.plain_text,
                    derived.excerpt,
                    derived.word_count,
                    folder,
                    crate::clock::now_ms(),
                ],
            )?;
            append_outbox(&tx, "note", &id, "upsert", Some(&payload), 0)?;
            tx.commit()?;
            self.load(conn, &id)
        })
    }

    /// Derived values, the tag set and the outbox row are written in the same
    /// transaction as the document (R5, R9).
    fn save(&self, input: &SaveNoteInput) -> Result<Note, AppError> {
        doc::validate::validate(&input.doc)?;

        let now = crate::clock::now_ms();
        let note_id = input.id.clone();
        let doc_json = serde_json::to_string(&input.doc).map_err(AppError::internal)?;
        let folder = input.folder_id.clone();
        let tag_ids = input.tag_ids.clone();
        let is_pinned = input.is_pinned;

        self.db.with_conn(move |conn| {
            let title_source: String = {
                let mut stmt = conn.prepare("SELECT title_source FROM notes WHERE id = ?1")?;
                stmt.query_row([&note_id], |row| row.get(0))
                    .map_err(|err| match err {
                        rusqlite::Error::QueryReturnedNoRows => AppError::NotFound,
                        other => AppError::from(other),
                    })?
            };
            let base_rev = base_rev(conn, &note_id)?;
            let derived = derive::derive(&input.doc, &title_source);

            let payload = serde_json::json!({
                "id": note_id,
                "folderId": folder,
                "tagIds": tag_ids,
                "isPinned": is_pinned,
            })
            .to_string();

            let tx = conn.transaction()?;
            tx.execute(
                "UPDATE notes
                    SET title = ?2, doc_json = ?3, plain_text = ?4, excerpt = ?5,
                        word_count = ?6, folder_id = ?7, is_pinned = ?8,
                        dirty = 1, updated_at = ?9
                  WHERE id = ?1",
                rusqlite::params![
                    note_id,
                    derived.title,
                    doc_json,
                    derived.plain_text,
                    derived.excerpt,
                    derived.word_count,
                    folder,
                    i64::from(is_pinned),
                    now,
                ],
            )?;
            replace_tags(&tx, &note_id, &tag_ids)?;
            append_outbox(&tx, "note", &note_id, "upsert", Some(&payload), base_rev)?;
            tx.commit()?;
            self.load(conn, &note_id)
        })
    }

    fn move_to(&self, id: &str, folder_id: Option<&str>) -> Result<Note, AppError> {
        let note_id = id.to_owned();
        let folder = folder_id.map(str::to_owned);
        let now = crate::clock::now_ms();

        self.db.with_conn(move |conn| {
            let base_rev = base_rev(conn, &note_id)?;
            if let Some(target) = folder.as_deref() {
                if !folder_is_live(conn, target)? {
                    return Err(AppError::NotFound);
                }
            }
            let payload = serde_json::json!({ "id": note_id, "folderId": folder }).to_string();

            let tx = conn.transaction()?;
            tx.execute(
                "UPDATE notes SET folder_id = ?2, dirty = 1, updated_at = ?3 WHERE id = ?1",
                rusqlite::params![note_id, folder, now],
            )?;
            append_outbox(&tx, "note", &note_id, "upsert", Some(&payload), base_rev)?;
            tx.commit()?;
            self.load(conn, &note_id)
        })
    }

    /// `updated_at` moves with the pin. A pinned note sorts above everything, so
    /// pinning one is a change to where it appears in every list — a note pinned
    /// six months ago should come to the top when the user pins it now, not resume
    /// its old position. Same reasoning as `move_to`.
    fn set_pinned(&self, id: &str, is_pinned: bool) -> Result<Note, AppError> {
        let note_id = id.to_owned();
        let now = crate::clock::now_ms();

        self.db.with_conn(move |conn| {
            /* `base_rev` rather than `base_rev_of`: the helper exists for the folder
            and tag repos, whose tables have no per-note shortcut, and it reports
            a missing row as `None` rather than `NotFound`. Pinning a note that
            does not exist has to be `NOT_FOUND` — `10-conventions.md` §6 lists it
            as "close the editor, refresh the list", and a silent success would do
            neither. */
            let base_rev = base_rev(conn, &note_id)?;
            let payload = serde_json::json!({ "id": note_id, "isPinned": is_pinned }).to_string();

            let tx = conn.transaction()?;
            tx.execute(
                "UPDATE notes SET is_pinned = ?2, dirty = 1, updated_at = ?3 WHERE id = ?1",
                rusqlite::params![note_id, i64::from(is_pinned), now],
            )?;
            append_outbox(&tx, "note", &note_id, "upsert", Some(&payload), base_rev)?;
            tx.commit()?;
            self.load(conn, &note_id)
        })
    }

    fn soft_delete(&self, id: &str) -> Result<(), AppError> {
        let note_id = id.to_owned();
        let now = crate::clock::now_ms();
        self.db.with_conn(move |conn| {
            let base_rev = base_rev(conn, &note_id)?;
            let tx = conn.transaction()?;
            tx.execute(
                "UPDATE notes SET deleted_at = ?2, dirty = 1, updated_at = ?2 WHERE id = ?1",
                rusqlite::params![note_id, now],
            )?;
            append_outbox(&tx, "note", &note_id, "delete", None, base_rev)?;
            tx.commit()?;
            Ok(())
        })
    }

    fn restore(&self, id: &str) -> Result<(), AppError> {
        let note_id = id.to_owned();
        let now = crate::clock::now_ms();
        self.db.with_conn(move |conn| {
            let base_rev = base_rev(conn, &note_id)?;
            let tx = conn.transaction()?;
            tx.execute(
                "UPDATE notes SET deleted_at = NULL, dirty = 1, updated_at = ?2 WHERE id = ?1",
                rusqlite::params![note_id, now],
            )?;
            append_outbox(&tx, "note", &note_id, "upsert", None, base_rev)?;
            tx.commit()?;
            Ok(())
        })
    }

    fn destroy(&self, id: &str) -> Result<(), AppError> {
        let note_id = id.to_owned();
        self.db.with_conn(move |conn| {
            // `07-sync-plan.md` §5.4: a never-pushed note cannot vanish without
            // ever existing elsewhere — permanent delete is refused while the
            // server has never assigned it a `rev`. Soft-delete first and sync:
            // the tombstone propagates, and *then* the row may go.
            let rev: i64 = conn
                .query_row("SELECT rev FROM notes WHERE id = ?1", [&note_id], |row| {
                    row.get(0)
                })
                .map_err(|err| match err {
                    rusqlite::Error::QueryReturnedNoRows => AppError::NotFound,
                    other => AppError::from(other),
                })?;
            if rev == 0 {
                return Err(AppError::Validation(
                    "This note has not synced yet — sync first so the deletion reaches your other devices."
                        .into(),
                ));
            }
            let base_rev = base_rev(conn, &note_id)?;
            let tx = conn.transaction()?;
            // The FTS row goes with it: AFTER DELETE trigger in 0002_fts.sql.
            tx.execute("DELETE FROM notes WHERE id = ?1", [&note_id])?;
            append_outbox(&tx, "note", &note_id, "delete", None, base_rev)?;
            tx.commit()?;
            Ok(())
        })
    }

    fn empty_trash(&self) -> Result<i64, AppError> {
        self.db.with_conn(|conn| {
            // Same §5.4 guard, per row rather than for the whole call: notes
            // that have never been pushed stay in the trash until they sync,
            // and the returned count names only what actually left.
            let trashed: Vec<(String, i64)> = {
                let mut stmt = conn.prepare(
                    "SELECT id, rev FROM notes WHERE deleted_at IS NOT NULL AND rev > 0",
                )?;
                let rows = stmt.query_map((), |row| Ok((row.get(0)?, row.get(1)?)))?;
                rows.collect::<Result<Vec<_>, _>>()?
            };

            let tx = conn.transaction()?;
            for (id, base_rev) in &trashed {
                append_outbox(&tx, "note", id, "delete", None, *base_rev)?;
            }
            let removed = tx.execute(
                "DELETE FROM notes WHERE deleted_at IS NOT NULL AND rev > 0",
                (),
            )?;
            tx.commit()?;
            Ok(removed as i64)
        })
    }
}

fn folder_is_live(conn: &rusqlite::Connection, id: &str) -> Result<bool, AppError> {
    let mut stmt = conn.prepare("SELECT 1 FROM folders WHERE id = ?1")?;
    let hit = stmt.query_row([id], |_| Ok(())).is_ok();
    Ok(hit)
}

/// A note carries exactly one folder, so a tag-set change collapses into the
/// note's own outbox row rather than one row per pair.
/// `07-sync-plan.md` §5.3 covers what that means when two devices change the
/// same tag set concurrently.
fn replace_tags(
    tx: &rusqlite::Transaction<'_>,
    note_id: &str,
    tag_ids: &[String],
) -> Result<(), rusqlite::Error> {
    tx.execute("DELETE FROM note_tags WHERE note_id = ?1", [note_id])?;
    for tag_id in tag_ids {
        tx.execute(
            "INSERT OR IGNORE INTO note_tags (note_id, tag_id, created_at) VALUES (?1, ?2, ?3)",
            rusqlite::params![note_id, tag_id, crate::clock::now_ms()],
        )?;
    }
    Ok(())
}
