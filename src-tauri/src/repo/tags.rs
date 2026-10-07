use std::sync::Arc;

use rusqlite::OptionalExtension;
use uuid::Uuid as UuidV7;

use crate::db::Database;
use crate::error::AppError;
use crate::repo::{append_outbox, base_rev_of, TagWithCount, TagsRepo};

/// `03-data-model.md` §3.4. Tag names are case-insensitive unique among live
/// tags, normalised to the first-created spelling.
pub struct SqliteTagsRepo {
    db: Arc<Database>,
}

impl SqliteTagsRepo {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    fn with_count(&self, id: &str, name: &str) -> Result<TagWithCount, AppError> {
        self.db.with_conn(|conn| {
            let count: i64 = conn.query_row(
                "SELECT COUNT(n.id)
                   FROM note_tags nt
                   JOIN notes n ON n.id = nt.note_id AND n.deleted_at IS NULL
                  WHERE nt.tag_id = ?1",
                [id],
                |row| row.get(0),
            )?;
            Ok(TagWithCount {
                id: id.to_owned(),
                name: name.to_owned(),
                count,
            })
        })
    }

    /// `COLLATE NOCASE` on the column plus the partial unique index gives
    /// case-insensitive uniqueness without application-level case folding that
    /// Postgres would disagree with. Creating `work` when `Work` exists returns
    /// the existing tag rather than a duplicate.
    fn lookup(&self, name: &str) -> Result<Option<(String, String)>, AppError> {
        self.db.with_conn(|conn| {
            let found = conn
                .query_row(
                    "SELECT id, name FROM tags
                      WHERE name = ?1 COLLATE NOCASE AND deleted_at IS NULL",
                    [name],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                )
                .optional()?;
            Ok(found)
        })
    }
}

impl TagsRepo for SqliteTagsRepo {
    /// `03-data-model.md` §5. `HAVING count > 0` hides tags whose notes are
    /// all in the trash: an empty filter in the sidebar is noise.
    fn list(&self) -> Result<Vec<TagWithCount>, AppError> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT t.id, t.name, COUNT(n.id) AS count
                   FROM tags t
                   LEFT JOIN note_tags nt ON nt.tag_id = t.id
                   LEFT JOIN notes n ON n.id = nt.note_id AND n.deleted_at IS NULL
                  WHERE t.deleted_at IS NULL
                  GROUP BY t.id, t.name
                 HAVING count > 0
               ORDER BY t.name COLLATE NOCASE",
            )?;
            let rows = stmt
                .query_map((), |row| {
                    Ok(TagWithCount {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        count: row.get(2)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        })
    }

    fn create(&self, name: &str) -> Result<TagWithCount, AppError> {
        let clean = name.trim().to_owned();
        if clean.is_empty() {
            return Err(AppError::Validation("Give the tag a name.".into()));
        }
        if let Some((id, existing_name)) = self.lookup(&clean)? {
            return self.with_count(&id, &existing_name);
        }

        let id = UuidV7::now_v7().to_string();
        let payload = serde_json::json!({ "id": id, "name": clean }).to_string();
        let insert_id = id.clone();

        self.db.with_conn(move |conn| {
            let tx = conn.transaction()?;
            tx.execute(
                "INSERT INTO tags (id, name, rev, dirty, created_at, updated_at)
                 VALUES (?1, ?2, 0, 1, ?3, ?3)",
                rusqlite::params![insert_id, clean, crate::clock::now_ms()],
            )?;
            append_outbox(&tx, "tag", &insert_id, "upsert", Some(&payload), 0)?;
            tx.commit()?;
            Ok(())
        })?;

        self.with_count(&id, name.trim())
    }

    fn rename(&self, id: &str, name: &str) -> Result<TagWithCount, AppError> {
        let clean = name.trim().to_owned();
        if clean.is_empty() {
            return Err(AppError::Validation("Give the tag a name.".into()));
        }
        let tag_id = id.to_owned();
        let payload = serde_json::json!({ "id": tag_id, "name": clean }).to_string();

        self.db.with_conn(move |conn| {
            let base_rev = base_rev_of(conn, "tags", &tag_id)?.ok_or(AppError::NotFound)?;
            let tx = conn.transaction()?;
            tx.execute(
                "UPDATE tags SET name = ?2, dirty = 1, updated_at = ?3 WHERE id = ?1",
                rusqlite::params![tag_id, clean, crate::clock::now_ms()],
            )?;
            append_outbox(&tx, "tag", &tag_id, "upsert", Some(&payload), base_rev)?;
            tx.commit()?;
            Ok(())
        })?;

        self.with_count(id, name.trim())
    }

    /// Removing a tag never removes it from a note's own history: the
    /// `note_tags` rows cascade, the tag row goes with them.
    fn delete(&self, id: &str) -> Result<(), AppError> {
        let tag_id = id.to_owned();
        self.db.with_conn(move |conn| {
            base_rev_of(conn, "tags", &tag_id)?.ok_or(AppError::NotFound)?;
            let tx = conn.transaction()?;
            append_outbox(&tx, "tag", &tag_id, "delete", None, 0)?;
            tx.execute("DELETE FROM tags WHERE id = ?1", [&tag_id])?;
            tx.commit()?;
            Ok(())
        })
    }
}
