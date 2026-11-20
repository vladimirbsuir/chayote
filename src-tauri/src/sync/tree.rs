//! Folder tree integrity across devices (`07-sync-plan.md` §5.2).
//!
//! Two properties a pull must not break, and the server enforces neither:
//!
//! - **A parent before its child.** Pulls fetch by `rev`, and a parent that
//!   was renamed or moved after its child was created has the higher rev, so
//!   on a fresh device the child arrives first and fails the foreign key. That
//!   failure aborted the whole cycle, every cycle, before notes were pulled.
//! - **No cycles.** Two devices moving X under Y and Y under X each pass the
//!   local check, and the server takes both. A local cycle hangs every walk of
//!   the subtree and hides both folders from the tree.
//!
//! The push refuses a move that would close a cycle on the server (the first
//! push wins, the second rebases onto it); this module is the pull's half.

use std::collections::HashSet;

use super::RemoteFolder;
use crate::error::AppError;

/// Whether filing `id` under `new_parent` would make `id` its own ancestor.
/// The walk is bounded by a visited set, so a cycle already on disk (written
/// by an older build) terminates instead of spinning.
pub(super) fn would_cycle(
    conn: &rusqlite::Connection,
    id: &str,
    new_parent: &str,
) -> Result<bool, AppError> {
    use rusqlite::OptionalExtension as _;
    let mut seen = HashSet::new();
    let mut current = Some(new_parent.to_owned());
    while let Some(folder) = current {
        if folder == id {
            return Ok(true);
        }
        if !seen.insert(folder.clone()) {
            return Ok(false);
        }
        current = conn
            .query_row(
                "SELECT parent_id FROM folders WHERE id = ?1",
                [&folder],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten();
    }
    Ok(false)
}

fn exists(conn: &rusqlite::Connection, id: &str) -> Result<bool, AppError> {
    use rusqlite::OptionalExtension as _;
    Ok(conn
        .query_row("SELECT 1 FROM folders WHERE id = ?1", [id], |_| Ok(()))
        .optional()?
        .is_some())
}

/// Writes a remote folder row into the local tree, inside `tx`.
///
/// The parent is checked first. One this device does not hold (deleted here,
/// or a tombstone on the server) files the folder at the root — the same
/// rule a pulled note gets for a missing folder, and what the tree already
/// does for an orphan. A parent that would close a cycle, or `force_root`,
/// also files it at the root, and then the row is queued back to the server
/// so the server's cycle is broken too and every device converges on it.
pub(super) fn upsert_remote_folder(
    tx: &rusqlite::Transaction<'_>,
    remote: &RemoteFolder,
    force_root: bool,
) -> Result<(), AppError> {
    let (parent, heal) = match remote.parent_id.as_deref() {
        _ if force_root => (None, true),
        None => (None, false),
        Some(parent) if !exists(tx, parent)? => (None, false),
        Some(parent) if would_cycle(tx, &remote.id, parent)? => (None, true),
        Some(parent) => (Some(parent.to_owned()), false),
    };
    tx.execute(
        "INSERT INTO folders (id, name, parent_id, position, rev, dirty, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7)
         ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name, parent_id = EXCLUDED.parent_id,
             position = EXCLUDED.position, rev = EXCLUDED.rev, dirty = 0,
             updated_at = EXCLUDED.updated_at, deleted_at = NULL",
        rusqlite::params![
            remote.id,
            remote.name,
            parent,
            remote.position,
            remote.rev,
            remote.created_at,
            remote.updated_at
        ],
    )?;
    if heal {
        let payload = serde_json::json!({ "id": remote.id, "parentId": null }).to_string();
        tx.execute("UPDATE folders SET dirty = 1 WHERE id = ?1", [&remote.id])?;
        crate::repo::append_outbox(
            tx,
            "folder",
            &remote.id,
            "upsert",
            Some(&payload),
            remote.rev,
        )?;
    }
    Ok(())
}

/// Applies one pulled folder. True when the local store visibly changed. A
/// dirty local row is never touched here: the push phase already arbitrated
/// it, and marking it clean would drop the queued write.
fn apply_one(
    conn: &mut rusqlite::Connection,
    remote: &RemoteFolder,
    force_root: bool,
) -> Result<bool, AppError> {
    use rusqlite::OptionalExtension as _;
    let tx = conn.transaction()?;
    let local: Option<(i64, i64)> = tx
        .query_row(
            "SELECT rev, dirty FROM folders WHERE id = ?1",
            [&remote.id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    match local {
        None if remote.deleted_at.is_some() => return Ok(false),
        Some((local_rev, dirty)) if remote.rev <= local_rev || dirty != 0 => return Ok(false),
        _ => {}
    }
    if remote.deleted_at.is_some() {
        tx.execute("DELETE FROM folders WHERE id = ?1", [&remote.id])?;
        tx.execute(
            "UPDATE notes SET folder_id = NULL WHERE folder_id = ?1",
            [&remote.id],
        )?;
    } else {
        upsert_remote_folder(&tx, remote, force_root)?;
    }
    tx.commit()?;
    Ok(true)
}

/// Applies a pulled set of folder rows parent-first. Returns how many changed
/// the local store.
///
/// Rows go in `rev` order wherever they can — a tombstone and a move must not
/// swap places — but a row whose parent is still waiting in this set waits
/// for it. A row whose parent is neither here nor waiting is applied at once
/// (`upsert_remote_folder` files it at the root). When every waiting row is
/// waiting on another, the set holds a cycle: the lowest-rev row is filed at
/// the root and sent back, and the rest then apply under it.
pub(super) fn apply_remote_folders(
    conn: &mut rusqlite::Connection,
    rows: &[RemoteFolder],
) -> Result<i64, AppError> {
    let mut waiting: Vec<&RemoteFolder> = rows.iter().collect();
    waiting.sort_by_key(|row| row.rev);
    let mut applied = 0;
    while !waiting.is_empty() {
        let pending: HashSet<&str> = waiting.iter().map(|row| row.id.as_str()).collect();
        let ready = waiting.iter().position(|row| {
            row.deleted_at.is_some()
                || row
                    .parent_id
                    .as_deref()
                    .is_none_or(|parent| parent == row.id || !pending.contains(parent))
        });
        let (index, force_root) = match ready {
            Some(index) => (index, false),
            None => (0, true),
        };
        let row = waiting.remove(index);
        if apply_one(conn, row, force_root)? {
            applied += 1;
        }
    }
    Ok(applied)
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::db::Database;
    use crate::repo::FoldersRepo as _;

    fn remote(id: &str, parent: Option<&str>, rev: i64) -> RemoteFolder {
        RemoteFolder {
            id: id.to_owned(),
            name: format!("F{rev}"),
            parent_id: parent.map(str::to_owned),
            position: 0,
            rev,
            created_at: 1,
            updated_at: 1,
            deleted_at: None,
        }
    }

    fn parent_of(db: &Database, id: &str) -> Option<String> {
        db.with_conn(|conn| {
            conn.query_row("SELECT parent_id FROM folders WHERE id = ?1", [id], |row| {
                row.get(0)
            })
            .map_err(AppError::from)
        })
        .expect("folder reads")
    }

    fn dirty_of(db: &Database, id: &str) -> i64 {
        db.with_conn(|conn| {
            conn.query_row("SELECT dirty FROM folders WHERE id = ?1", [id], |row| {
                row.get(0)
            })
            .map_err(AppError::from)
        })
        .expect("folder reads")
    }

    /// The child's rev is lower than its parent's (the parent was renamed
    /// later): a fresh device still lands both, parent first.
    #[test]
    fn a_child_pulled_before_its_parent_lands_under_it() {
        let db = Database::open_in_memory().expect("memory db");
        let rows = vec![
            remote("child", Some("parent"), 5),
            remote("parent", None, 9),
        ];
        let applied = db
            .with_conn(|conn| apply_remote_folders(conn, &rows))
            .expect("applies without an FK failure");
        assert_eq!(applied, 2);
        assert_eq!(parent_of(&db, "child").as_deref(), Some("parent"));
    }

    /// A parent this device does not hold files the child at the root
    /// instead of failing the cycle.
    #[test]
    fn a_missing_parent_files_the_folder_at_the_root() {
        let db = Database::open_in_memory().expect("memory db");
        let rows = vec![remote("orphan", Some("gone"), 5)];
        db.with_conn(|conn| apply_remote_folders(conn, &rows))
            .expect("applies");
        assert_eq!(parent_of(&db, "orphan"), None);
        assert_eq!(dirty_of(&db, "orphan"), 0, "nothing to heal");
    }

    /// X under Y here, the server says Y under X: the pull breaks the cycle
    /// by filing Y at the root and queueing it back.
    #[test]
    fn a_pull_that_would_close_a_cycle_files_the_folder_at_the_root() {
        let db = Arc::new(Database::open_in_memory().expect("memory db"));
        let folders = crate::repo::folders::SqliteFoldersRepo::new(Arc::clone(&db));
        let y = folders.create("Y", None).expect("creates");
        let x = folders.create("X", Some(&y.id)).expect("creates");
        db.with_conn(|conn| {
            conn.execute("UPDATE folders SET dirty = 0, rev = 2", ())?;
            conn.execute("UPDATE outbox SET sent_at = 1", ())?;
            Ok::<_, AppError>(())
        })
        .expect("marks synced");

        let rows = vec![remote(&y.id, Some(&x.id), 7)];
        db.with_conn(|conn| apply_remote_folders(conn, &rows))
            .expect("applies");
        assert_eq!(parent_of(&db, &y.id), None, "Y goes to the root");
        assert_eq!(parent_of(&db, &x.id).as_deref(), Some(y.id.as_str()));
        assert_eq!(
            dirty_of(&db, &y.id),
            1,
            "and is sent back to heal the server"
        );
        // And the tree walks terminate.
        assert_eq!(folders.list().expect("lists").len(), 1);
        folders.delete(&y.id).expect("deletes the whole subtree");
    }

    /// A cycle entirely inside the pulled set (a fresh device pulling a
    /// server that already holds one) still lands every row.
    #[test]
    fn a_cycle_inside_the_pulled_rows_is_broken_once() {
        let db = Database::open_in_memory().expect("memory db");
        let rows = vec![remote("a", Some("b"), 3), remote("b", Some("a"), 4)];
        let applied = db
            .with_conn(|conn| apply_remote_folders(conn, &rows))
            .expect("applies");
        assert_eq!(applied, 2);
        assert_eq!(parent_of(&db, "a"), None);
        assert_eq!(parent_of(&db, "b").as_deref(), Some("a"));
        assert_eq!(dirty_of(&db, "a"), 1);
    }

    #[test]
    fn would_cycle_terminates_on_a_cycle_already_on_disk() {
        let db = Database::open_in_memory().expect("memory db");
        db.with_conn(|conn| {
            conn.execute_batch(
                "INSERT INTO folders (id, name, created_at, updated_at) VALUES ('p', 'P', 1, 1), ('q', 'Q', 1, 1);
                 UPDATE folders SET parent_id = 'q' WHERE id = 'p';
                 UPDATE folders SET parent_id = 'p' WHERE id = 'q';",
            )?;
            assert!(!would_cycle(conn, "z", "p")?);
            assert!(would_cycle(conn, "p", "q")?);
            Ok::<_, AppError>(())
        })
        .expect("walks terminate");
    }
}
