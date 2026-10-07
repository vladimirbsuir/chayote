use std::sync::Arc;

use rusqlite::OptionalExtension;
use uuid::Uuid as UuidV7;

use crate::db::Database;
use crate::error::AppError;
use crate::repo::{append_outbox, base_rev_of, FolderNode, FoldersRepo};

/// `03-data-model.md` §3.2. Folders keep `position` because a tree needs
/// explicit order, and the drag gesture already exists for re-parenting.
pub struct SqliteFoldersRepo {
    db: Arc<Database>,
}

struct Row {
    id: String,
    name: String,
    parent_id: Option<String>,
    position: i64,
}

impl SqliteFoldersRepo {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    fn node(&self, id: &str) -> Result<FolderNode, AppError> {
        self.db.with_conn(|conn| {
            let row = conn
                .query_row(
                    "SELECT id, name, parent_id, position FROM folders WHERE id = ?1",
                    [id],
                    |row| {
                        Ok(Row {
                            id: row.get(0)?,
                            name: row.get(1)?,
                            parent_id: row.get(2)?,
                            position: row.get(3)?,
                        })
                    },
                )
                .optional()?
                .ok_or(AppError::NotFound)?;
            Ok(FolderNode {
                id: row.id,
                name: row.name,
                parent_id: row.parent_id,
                position: row.position,
                children: Vec::new(),
            })
        })
    }
}

impl FoldersRepo for SqliteFoldersRepo {
    /// The tree is assembled in Rust from a flat ordered read. A recursive CTE
    /// buys nothing at the expected size and produces a shape that is awkward
    /// to map back to the UI (`03-data-model.md` §5).
    fn list(&self) -> Result<Vec<FolderNode>, AppError> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, name, parent_id, position
                   FROM folders
                  WHERE deleted_at IS NULL
               ORDER BY parent_id, position, name COLLATE NOCASE",
            )?;
            let rows: Vec<Row> = stmt
                .query_map((), |row| {
                    Ok(Row {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        parent_id: row.get(2)?,
                        position: row.get(3)?,
                    })
                })?
                .collect::<Result<_, _>>()?;

            Ok(assemble(rows))
        })
    }

    fn create(&self, name: &str, parent_id: Option<&str>) -> Result<FolderNode, AppError> {
        let clean = name.trim().to_owned();
        if clean.is_empty() {
            return Err(AppError::Validation("Give the folder a name.".into()));
        }
        let id = UuidV7::now_v7().to_string();
        let parent = parent_id.map(str::to_owned);
        let payload =
            serde_json::json!({ "id": id, "name": clean, "parentId": parent }).to_string();
        let insert_id = id.clone();

        self.db.with_conn(move |conn| {
            let position = match parent.as_deref() {
                Some(pid) => {
                    if !folder_is_live(conn, pid)? {
                        return Err(AppError::NotFound);
                    }
                    next_position(conn, Some(pid))?
                }
                None => next_position(conn, None)?,
            };

            let tx = conn.transaction()?;
            tx.execute(
                "INSERT INTO folders (id, name, parent_id, position, rev, dirty,
                                      created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, 0, 1, ?5, ?5)",
                rusqlite::params![insert_id, clean, parent, position, crate::clock::now_ms()],
            )?;
            append_outbox(&tx, "folder", &insert_id, "upsert", Some(&payload), 0)?;
            tx.commit()?;
            Ok(())
        })?;

        self.node(&id)
    }

    fn rename(&self, id: &str, name: &str) -> Result<FolderNode, AppError> {
        let clean = name.trim().to_owned();
        if clean.is_empty() {
            return Err(AppError::Validation("Give the folder a name.".into()));
        }
        let folder_id = id.to_owned();
        let payload = serde_json::json!({ "id": folder_id, "name": clean }).to_string();

        self.db.with_conn(move |conn| {
            let base_rev = base_rev_of(conn, "folders", &folder_id)?.ok_or(AppError::NotFound)?;
            let tx = conn.transaction()?;
            tx.execute(
                "UPDATE folders SET name = ?2, dirty = 1, updated_at = ?3 WHERE id = ?1",
                rusqlite::params![folder_id, clean, crate::clock::now_ms()],
            )?;
            append_outbox(
                &tx,
                "folder",
                &folder_id,
                "upsert",
                Some(&payload),
                base_rev,
            )?;
            tx.commit()?;
            Ok(())
        })?;

        self.node(id)
    }

    /// `position` is sibling-local and densified in one transaction: moves are
    /// user-initiated and infrequent, so renumbering is cheap and avoids the
    /// drift that gap-based ordering accumulates.
    fn move_to(
        &self,
        id: &str,
        new_parent_id: Option<&str>,
        position: i64,
    ) -> Result<FolderNode, AppError> {
        let folder_id = id.to_owned();
        let parent = new_parent_id.map(str::to_owned);
        let payload = serde_json::json!({ "id": folder_id, "parentId": parent }).to_string();

        self.db.with_conn(move |conn| {
            let base_rev = base_rev_of(conn, "folders", &folder_id)?.ok_or(AppError::NotFound)?;

            if let Some(pid) = parent.as_deref() {
                if !folder_is_live(conn, pid)? {
                    return Err(AppError::NotFound);
                }
                // A folder cannot be moved inside itself or its own descendant.
                if subtree_ids(conn, &folder_id)?.iter().any(|id| id == pid) {
                    return Err(AppError::CycleDetected);
                }
            }

            let target = position.clamp(0, sibling_count(conn, parent.as_deref())? as i64) as usize;

            let tx = conn.transaction()?;
            densify(&tx, parent.as_deref(), &folder_id, target)?;
            tx.execute(
                "UPDATE folders SET parent_id = ?2, position = ?3, dirty = 1, updated_at = ?4
                  WHERE id = ?1",
                rusqlite::params![folder_id, parent, target as i64, crate::clock::now_ms()],
            )?;
            append_outbox(
                &tx,
                "folder",
                &folder_id,
                "upsert",
                Some(&payload),
                base_rev,
            )?;
            tx.commit()?;
            Ok(())
        })?;

        self.node(id)
    }

    /// Permanent in v1. `ON DELETE CASCADE` on `folders.parent_id` takes the
    /// subtree; `notes.folder_id` is `ON DELETE SET NULL`, so the notes survive
    /// as unfiled.
    fn delete(&self, id: &str) -> Result<(), AppError> {
        let folder_id = id.to_owned();
        self.db.with_conn(move |conn| {
            base_rev_of(conn, "folders", &folder_id)?.ok_or(AppError::NotFound)?;
            let ids = subtree_ids(conn, &folder_id)?;

            let tx = conn.transaction()?;
            for victim in &ids {
                append_outbox(&tx, "folder", victim, "delete", None, 0)?;
                tx.execute("DELETE FROM folders WHERE id = ?1", [victim])?;
            }
            tx.commit()?;
            Ok(())
        })
    }
}

fn folder_is_live(conn: &rusqlite::Connection, id: &str) -> Result<bool, AppError> {
    Ok(conn
        .query_row("SELECT 1 FROM folders WHERE id = ?1", [id], |_| Ok(()))
        .optional()?
        .is_some())
}

/// `parent_id IS ?1` matches both NULL and the value, which is what lets one
/// statement handle the root case.
fn next_position(conn: &rusqlite::Connection, parent_id: Option<&str>) -> Result<i64, AppError> {
    let sql = "SELECT COALESCE(MAX(position), -1) + 1 FROM folders WHERE parent_id IS ?1";
    Ok(conn.query_row(sql, [parent_id], |row| row.get(0))?)
}

fn sibling_count(conn: &rusqlite::Connection, parent_id: Option<&str>) -> Result<i64, AppError> {
    let sql = "SELECT COUNT(*) FROM folders WHERE parent_id IS ?1";
    Ok(conn.query_row(sql, [parent_id], |row| row.get(0))?)
}

/// Renumbers the destination siblings to `0..n` with `moving_id` inserted at
/// `target`, in one transaction.
fn densify(
    tx: &rusqlite::Transaction<'_>,
    parent_id: Option<&str>,
    moving_id: &str,
    target: usize,
) -> Result<(), rusqlite::Error> {
    let mut stmt = tx.prepare(
        "SELECT id FROM folders
          WHERE parent_id IS ?1 AND id <> ?2
       ORDER BY position, name COLLATE NOCASE",
    )?;
    let siblings: Vec<String> = stmt
        .query_map(rusqlite::params![parent_id, moving_id], |row| row.get(0))?
        .collect::<Result<_, _>>()?;
    drop(stmt);

    let mut ordered = siblings;
    let index = target.min(ordered.len());
    ordered.insert(index, moving_id.to_owned());

    for (position, id) in ordered.iter().enumerate() {
        tx.execute(
            "UPDATE folders SET position = ?2 WHERE id = ?1",
            rusqlite::params![id, position as i64],
        )?;
    }
    Ok(())
}

fn subtree_ids(conn: &rusqlite::Connection, root: &str) -> Result<Vec<String>, AppError> {
    let mut found = vec![root.to_owned()];
    let mut index = 0;
    while index < found.len() {
        let current = found[index].clone();
        let mut stmt = conn.prepare("SELECT id FROM folders WHERE parent_id = ?1")?;
        let children: Vec<String> = stmt
            .query_map([&current], |row| row.get(0))?
            .collect::<Result<_, _>>()?;
        for child in children {
            found.push(child);
        }
        index += 1;
    }
    Ok(found)
}

/// Builds the tree from a flat list.
///
/// A root is a row with no parent, or whose parent is not itself in the live
/// set — which is also what keeps an orphan whose parent was hard-deleted
/// visible at the top level instead of silently vanishing.
fn assemble(rows: Vec<Row>) -> Vec<FolderNode> {
    let known: std::collections::HashSet<String> = rows.iter().map(|row| row.id.clone()).collect();

    fn build(
        parent_id: Option<&str>,
        rows: &[(String, String, Option<String>, i64)],
    ) -> Vec<FolderNode> {
        let mut children: Vec<FolderNode> = rows
            .iter()
            .filter(|(_, _, row_parent, _)| row_parent.as_deref() == parent_id)
            .map(|(id, name, _, position)| FolderNode {
                id: id.clone(),
                name: name.clone(),
                parent_id: parent_id.map(str::to_owned),
                position: *position,
                children: build(Some(id), rows),
            })
            .collect();
        children.sort_by(|a, b| a.position.cmp(&b.position).then(a.name.cmp(&b.name)));
        children
    }

    let flat: Vec<(String, String, Option<String>, i64)> = rows
        .into_iter()
        .map(|row| (row.id, row.name, row.parent_id, row.position))
        .collect();

    // A root is a row whose parent is absent from the live set, or no parent.
    let roots: Vec<FolderNode> = flat
        .iter()
        .filter(|(_, _, parent, _)| match parent {
            None => true,
            Some(pid) => !known.contains(pid),
        })
        .map(|(id, name, parent, position)| FolderNode {
            id: id.clone(),
            name: name.clone(),
            parent_id: parent.clone(),
            position: *position,
            children: build(Some(id), &flat),
        })
        .collect();

    let mut sorted = roots;
    sorted.sort_by(|a, b| a.position.cmp(&b.position).then(a.name.cmp(&b.name)));
    sorted
}
