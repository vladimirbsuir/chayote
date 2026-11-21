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

fn new_id() -> String {
    UuidV7::now_v7().to_string()
}

fn base_rev(conn: &rusqlite::Connection, id: &str) -> Result<i64, AppError> {
    base_rev_of(conn, "notes", id)?.ok_or(AppError::NotFound)
}

const DEFAULT_ORDER: &str = "n.is_pinned DESC, n.updated_at DESC";

impl NotesRepo for SqliteNotesRepo {
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
        let derived = derive::derive(&doc_value);
        let serialised = serde_json::to_string(&doc_value).map_err(AppError::internal)?;
        let payload = serde_json::json!({ "id": id, "folderId": folder_id }).to_string();
        let folder = folder_id.map(str::to_owned);

        self.db.with_conn(move |conn| {
            if let Some(folder_id) = folder.as_deref() {
                if !folder_is_live(conn, folder_id)? {
                    return Err(AppError::NotFound);
                }
            }
            let tx = conn.transaction()?;
            tx.execute(
                "INSERT INTO notes (id, title, title_source, doc_json, plain_text, excerpt,
                                    word_count, folder_id, is_pinned, rev, dirty,
                                    created_at, updated_at)
                 VALUES (?1, ?2, 'auto', ?3, ?4, ?5, ?6, ?7, 0, 0, 1, ?8, ?8)",
                rusqlite::params![
                    id,
                    "",
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

    fn save(&self, input: &SaveNoteInput) -> Result<Note, AppError> {
        doc::validate::validate(&input.doc)?;

        let now = crate::clock::now_ms();
        let note_id = input.id.clone();
        let doc_json = serde_json::to_string(&input.doc).map_err(AppError::internal)?;
        let folder = input.folder_id.clone();
        let tag_ids = input.tag_ids.clone();

        self.db.with_conn(move |conn| {
            let base_rev = base_rev(conn, &note_id)?;
            let derived = derive::derive(&input.doc);

            let folder = match folder {
                Some(id) if folder_is_live(conn, &id)? => Some(id),
                _ => None,
            };

            let payload = serde_json::json!({
                "id": note_id,
                "folderId": folder,
                "tagIds": tag_ids,
            })
            .to_string();

            let tx = conn.transaction()?;
            tx.execute(
                "UPDATE notes
                    SET doc_json = ?2, plain_text = ?3, excerpt = ?4,
                        word_count = ?5, folder_id = ?6,
                        dirty = 1, updated_at = ?7
                  WHERE id = ?1",
                rusqlite::params![
                    note_id,
                    doc_json,
                    derived.plain_text,
                    derived.excerpt,
                    derived.word_count,
                    folder,
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

    fn set_pinned(&self, id: &str, is_pinned: bool) -> Result<Note, AppError> {
        let note_id = id.to_owned();
        let now = crate::clock::now_ms();

        self.db.with_conn(move |conn| {
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

    fn set_title(&self, id: &str, title: &str) -> Result<Note, AppError> {
        let note_id = id.to_owned();
        let trimmed = title.trim().to_owned();
        let now = crate::clock::now_ms();

        self.db.with_conn(move |conn| {
            let exists: bool = {
                let mut stmt = conn.prepare("SELECT 1 FROM notes WHERE id = ?1")?;
                stmt.exists([&note_id]).map_err(AppError::from)?
            };
            if !exists {
                return Err(AppError::NotFound);
            }

            let capped = derive::truncate_title(&trimmed);
            let (title, title_source) = if capped.is_empty() {
                (String::new(), "auto".to_owned())
            } else {
                (capped, "manual".to_owned())
            };

            let base_rev = base_rev(conn, &note_id)?;
            let payload = serde_json::json!({ "id": note_id, "title": title }).to_string();

            let tx = conn.transaction()?;
            tx.execute(
                "UPDATE notes
                    SET title = ?2, title_source = ?3, dirty = 1, updated_at = ?4
                  WHERE id = ?1",
                rusqlite::params![note_id, title, title_source, now],
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
            let base_rev = base_rev(conn, &note_id)?;
            let tx = conn.transaction()?;
            tx.execute("DELETE FROM notes WHERE id = ?1", [&note_id])?;
            append_outbox(&tx, "note", &note_id, "delete", None, base_rev)?;
            tx.commit()?;
            Ok(())
        })
    }

    fn empty_trash(&self) -> Result<i64, AppError> {
        self.db.with_conn(|conn| {
            let trashed: Vec<(String, i64)> = {
                let mut stmt =
                    conn.prepare("SELECT id, rev FROM notes WHERE deleted_at IS NOT NULL")?;
                let rows = stmt.query_map((), |row| Ok((row.get(0)?, row.get(1)?)))?;
                rows.collect::<Result<Vec<_>, _>>()?
            };

            let tx = conn.transaction()?;
            for (id, base_rev) in &trashed {
                append_outbox(&tx, "note", id, "delete", None, *base_rev)?;
            }
            let removed = tx.execute("DELETE FROM notes WHERE deleted_at IS NOT NULL", ())?;
            tx.commit()?;
            Ok(removed as i64)
        })
    }
}

fn folder_is_live(conn: &rusqlite::Connection, id: &str) -> Result<bool, AppError> {
    use rusqlite::OptionalExtension as _;
    Ok(conn
        .query_row("SELECT 1 FROM folders WHERE id = ?1", [id], |_| Ok(()))
        .optional()?
        .is_some())
}

fn replace_tags(
    tx: &rusqlite::Transaction<'_>,
    note_id: &str,
    tag_ids: &[String],
) -> Result<(), rusqlite::Error> {
    tx.execute("DELETE FROM note_tags WHERE note_id = ?1", [note_id])?;
    for tag_id in tag_ids {
        tx.execute(
            "INSERT OR IGNORE INTO note_tags (note_id, tag_id, created_at)
             SELECT ?1, id, ?3 FROM tags WHERE id = ?2 AND deleted_at IS NULL",
            rusqlite::params![note_id, tag_id, crate::clock::now_ms()],
        )?;
    }
    Ok(())
}
