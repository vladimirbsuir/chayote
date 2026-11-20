//! Case-insensitive tag clashes across devices (`07-sync-plan.md` §5.2,
//! `03-data-model.md` §3.4).
//!
//! Tag names are unique among live tags, ignoring case, on the device and on
//! the server alike. Each device enforces that against its own tags only, so
//! two devices can each create "work" and "Work" under different ids. Before
//! this, the second one could never sync: its push hit the server's unique
//! index and retried for ever, and a pull of the other device's tag hit the
//! local one and failed every cycle before a single note was pulled.
//!
//! The policy: **the tag already on the server wins.** It was there first
//! (the server took it first), every device sees the same row, and so every
//! device merges the same way. The local tag is folded into it: its note
//! links move to the server's tag, those notes are queued so the server
//! learns the new links, and the local tag is dropped — with a tombstone
//! queued for it if the server ever held it.

use super::merge::TAGS_ONLY_KEY;
use super::RemoteTag;
use crate::error::AppError;

/// Folds the local tag `loser_id` into the server's `winner`, inside `tx`.
/// `known_to_server` is whether the loser's id exists on the server, in
/// which case its deletion must propagate as a tombstone.
pub(super) fn merge_tag_into(
    tx: &rusqlite::Transaction<'_>,
    loser_id: &str,
    winner: &RemoteTag,
    known_to_server: bool,
) -> Result<(), AppError> {
    use rusqlite::OptionalExtension as _;
    let now = crate::clock::now_ms();
    let notes: Vec<String> = {
        let mut stmt = tx.prepare("SELECT note_id FROM note_tags WHERE tag_id = ?1")?;
        let rows = stmt
            .query_map([loser_id], |row| row.get(0))?
            .collect::<Result<Vec<String>, _>>()?;
        rows
    };
    let loser_rev: i64 = tx
        .query_row("SELECT rev FROM tags WHERE id = ?1", [loser_id], |row| {
            row.get(0)
        })
        .optional()?
        .unwrap_or(0);

    // The links cascade with the row; they are re-made below on the winner.
    tx.execute("DELETE FROM tags WHERE id = ?1", [loser_id])?;
    tx.execute(
        "UPDATE outbox SET sent_at = ?2 WHERE sent_at IS NULL AND entity = 'tag' AND entity_id = ?1",
        rusqlite::params![loser_id, now],
    )?;
    if known_to_server || loser_rev > 0 {
        crate::repo::append_outbox(tx, "tag", loser_id, "delete", None, 0)?;
    }

    tx.execute(
        "INSERT INTO tags (id, name, rev, dirty, created_at, updated_at)
         VALUES (?1, ?2, ?3, 0, ?4, ?5)
         ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name, rev = EXCLUDED.rev, updated_at = EXCLUDED.updated_at,
             deleted_at = NULL
         WHERE tags.dirty = 0 AND tags.rev < EXCLUDED.rev",
        rusqlite::params![
            winner.id,
            winner.name,
            winner.rev,
            winner.created_at,
            winner.updated_at
        ],
    )?;

    for note_id in &notes {
        tx.execute(
            "INSERT OR IGNORE INTO note_tags (note_id, tag_id, created_at) VALUES (?1, ?2, ?3)",
            rusqlite::params![note_id, winner.id, now],
        )?;
        /* The note's tag set changed under it, and only the tag set: the
        payload says so, so the push cannot mistake this for a document edit
        and park a conflict against a text change made elsewhere. */
        let rev: i64 = tx.query_row("SELECT rev FROM notes WHERE id = ?1", [note_id], |row| {
            row.get(0)
        })?;
        let payload = serde_json::json!({ "id": note_id, TAGS_ONLY_KEY: true }).to_string();
        tx.execute("UPDATE notes SET dirty = 1 WHERE id = ?1", [note_id])?;
        crate::repo::append_outbox(tx, "note", note_id, "upsert", Some(&payload), rev)?;
    }
    Ok(())
}

/// The live local tag whose name clashes with `name` (any case), other than
/// `id` itself.
pub(super) fn local_clash(
    conn: &rusqlite::Connection,
    id: &str,
    name: &str,
) -> Result<Option<String>, AppError> {
    use rusqlite::OptionalExtension as _;
    Ok(conn
        .query_row(
            "SELECT id FROM tags
              WHERE name = ?1 COLLATE NOCASE AND id <> ?2 AND deleted_at IS NULL",
            [name, id],
            |row| row.get(0),
        )
        .optional()?)
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::db::Database;
    use crate::repo::{NotesRepo as _, TagsRepo as _};

    fn winner(name: &str) -> RemoteTag {
        RemoteTag {
            id: uuid::Uuid::now_v7().to_string(),
            name: name.to_owned(),
            rev: 40,
            created_at: 1,
            updated_at: 1,
            deleted_at: None,
        }
    }

    /// "work" here, "Work" pulled from the server under another id: the pull
    /// lands instead of failing every cycle, the note keeps its tag (now the
    /// server's), and the note is queued with a tags-only change.
    #[test]
    fn a_pulled_tag_that_clashes_by_case_absorbs_the_local_one() {
        let db = Arc::new(Database::open_in_memory().expect("memory db"));
        let tags = crate::repo::tags::SqliteTagsRepo::new(Arc::clone(&db));
        let notes = crate::repo::notes::SqliteNotesRepo::new(Arc::clone(&db));
        let local = tags.create("work").expect("creates");
        let note = notes.create(None).expect("creates").summary.id;
        notes
            .save(&crate::repo::SaveNoteInput {
                id: note.clone(),
                doc: serde_json::json!({"type": "doc", "content": [{"type": "paragraph"}]}),
                folder_id: None,
                tag_ids: vec![local.id.clone()],
                is_pinned: false,
            })
            .expect("tags the note");
        db.with_conn(|conn| {
            conn.execute("UPDATE outbox SET sent_at = 1", ())?;
            conn.execute("UPDATE tags SET rev = 7, dirty = 0", ())?;
            conn.execute("UPDATE notes SET rev = 9, dirty = 0", ())?;
            Ok::<_, AppError>(())
        })
        .expect("marks synced");

        let remote = winner("Work");
        let applied = db
            .with_conn(|conn| super::super::apply_remote_tag(conn, &remote))
            .expect("the clash no longer fails the pull");
        assert!(applied);

        let listed = tags.list().expect("lists");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, remote.id, "the server's tag stands");
        assert_eq!(listed[0].name, "Work");
        assert_eq!(listed[0].count, 1, "the note moved onto it");

        let (tombstone, note_payload): (i64, String) = db
            .with_conn(|conn| {
                let tombstone = conn.query_row(
                    "SELECT COUNT(*) FROM outbox
                      WHERE sent_at IS NULL AND entity = 'tag' AND entity_id = ?1 AND op = 'delete'",
                    [&local.id],
                    |row| row.get(0),
                )?;
                let payload = conn.query_row(
                    "SELECT payload FROM outbox WHERE sent_at IS NULL AND entity = 'note'",
                    (),
                    |row| row.get(0),
                )?;
                Ok::<_, AppError>((tombstone, payload))
            })
            .expect("reads");
        assert_eq!(tombstone, 1, "the server held the local tag: tombstone it");
        let touched = db
            .with_conn(|conn| super::super::merge::local_touches(conn, &note, None))
            .expect("reads");
        assert!(touched.tags && !touched.doc, "tags only: {note_payload}");
    }

    /// A tag this device never pushed needs no tombstone.
    #[test]
    fn an_unpushed_loser_leaves_no_tombstone() {
        let db = Arc::new(Database::open_in_memory().expect("memory db"));
        let tags = crate::repo::tags::SqliteTagsRepo::new(Arc::clone(&db));
        let local = tags.create("Home").expect("creates");
        let remote = winner("HOME");
        db.with_conn(|conn| {
            let tx = conn.transaction()?;
            assert_eq!(
                local_clash(&tx, &remote.id, &remote.name)?.as_deref(),
                Some(local.id.as_str())
            );
            merge_tag_into(&tx, &local.id, &remote, false)?;
            tx.commit()?;
            let pending: i64 = conn.query_row(
                "SELECT COUNT(*) FROM outbox WHERE sent_at IS NULL AND entity_id = ?1",
                [&local.id],
                |row| row.get(0),
            )?;
            assert_eq!(
                pending, 0,
                "its create is acknowledged, nothing replaces it"
            );
            Ok::<_, AppError>(())
        })
        .expect("merges");
        assert_eq!(tags.list().expect("lists")[0].name, "HOME");
    }
}
