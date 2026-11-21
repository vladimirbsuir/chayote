use super::{docs_equal, union_sets, LocalNote, RemoteNote};
use crate::error::AppError;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(super) struct Touched {
    pub doc: bool,
    pub folder: bool,
    pub pinned: bool,
    pub title: bool,
    pub tags: bool,
}

impl Touched {
    const ALL: Self = Self {
        doc: true,
        folder: true,
        pinned: true,
        title: true,
        tags: true,
    };

    fn union(self, other: Self) -> Self {
        Self {
            doc: self.doc || other.doc,
            folder: self.folder || other.folder,
            pinned: self.pinned || other.pinned,
            title: self.title || other.title,
            tags: self.tags || other.tags,
        }
    }

    fn intersects(self, other: Self) -> bool {
        (self.doc && other.doc)
            || (self.folder && other.folder)
            || (self.pinned && other.pinned)
            || (self.title && other.title)
            || (self.tags && other.tags)
    }

    fn of_payload(op: &str, payload: Option<&str>) -> Self {
        if op != "upsert" {
            return Self::ALL;
        }
        let Some(value) =
            payload.and_then(|text| serde_json::from_str::<serde_json::Value>(text).ok())
        else {
            return Self::ALL;
        };
        let Some(object) = value.as_object() else {
            return Self::ALL;
        };
        let mut touched = Self::default();
        let mut known = false;
        if object.contains_key("tagIds") {
            touched.doc = true;
            touched.folder = true;
            touched.tags = true;
            known = true;
        }
        if object.contains_key(TAGS_ONLY_KEY) {
            touched.tags = true;
            known = true;
        }
        if object.contains_key("folderId") {
            touched.folder = true;
            known = true;
        }
        if object.contains_key("isPinned") {
            touched.pinned = true;
            known = true;
        }
        if object.contains_key("title") {
            touched.title = true;
            known = true;
        }
        if known {
            touched
        } else {
            Self::ALL
        }
    }
}

pub(super) const TAGS_ONLY_KEY: &str = "tagSetMerged";

pub(super) fn local_touches(
    conn: &rusqlite::Connection,
    note_id: &str,
    after: Option<i64>,
) -> Result<Touched, AppError> {
    let mut stmt = conn.prepare(
        "SELECT op, payload FROM outbox
          WHERE sent_at IS NULL AND entity = 'note' AND entity_id = ?1 AND id > ?2",
    )?;
    let rows = stmt
        .query_map(rusqlite::params![note_id, after.unwrap_or(0)], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows.iter().fold(Touched::default(), |acc, (op, payload)| {
        acc.union(Touched::of_payload(op, payload.as_deref()))
    }))
}

#[derive(Debug, Clone)]
pub(super) struct Merged {
    pub note: LocalNote,
    pub park: bool,
    pub adopted: Touched,
}

pub(super) fn merge_note(
    local: &LocalNote,
    remote: &RemoteNote,
    remote_tags: &[String],
    touched: Touched,
) -> Merged {
    let mut adopted = Touched::default();
    let mut note = local.clone();

    let park = touched.doc && !docs_equal(&local.doc_json, &remote.doc_json);
    if !touched.doc {
        note.doc_json = remote.doc_json.clone();
        note.plain_text = remote.plain_text.clone();
        note.excerpt = remote.excerpt.clone();
        note.word_count = remote.word_count;
        adopted.doc = true;
    }
    if !touched.folder {
        note.folder_id = remote.folder_id.clone();
        adopted.folder = true;
    }
    if !touched.pinned {
        note.is_pinned = remote.is_pinned;
        adopted.pinned = true;
    }
    if !touched.title {
        note.title = remote.title.clone();
        note.title_source = remote.title_source.clone();
        adopted.title = true;
    }
    if touched.tags {
        note.tag_ids = union_sets(&local.tag_ids, remote_tags);
    } else {
        note.tag_ids = remote_tags.to_vec();
        adopted.tags = true;
    }
    note.updated_at = local.updated_at.max(remote.updated_at);

    Merged {
        note,
        park,
        adopted,
    }
}

pub(super) fn write_merged(
    tx: &rusqlite::Transaction<'_>,
    note_id: &str,
    merged: &Merged,
    newer: Touched,
) -> Result<(), AppError> {
    let note = &merged.note;
    if !newer.doc {
        tx.execute(
            "UPDATE notes SET doc_json = ?2, plain_text = ?3, excerpt = ?4, word_count = ?5
              WHERE id = ?1",
            rusqlite::params![
                note_id,
                note.doc_json,
                note.plain_text,
                note.excerpt,
                note.word_count
            ],
        )?;
    }
    if !newer.folder {
        let folder_id = super::live_folder_id(tx, &note.folder_id)?;
        tx.execute(
            "UPDATE notes SET folder_id = ?2 WHERE id = ?1",
            rusqlite::params![note_id, folder_id],
        )?;
    }
    if !newer.pinned {
        tx.execute(
            "UPDATE notes SET is_pinned = ?2 WHERE id = ?1",
            rusqlite::params![note_id, i64::from(note.is_pinned)],
        )?;
    }
    if !newer.title {
        tx.execute(
            "UPDATE notes SET title = ?2, title_source = ?3 WHERE id = ?1",
            rusqlite::params![note_id, note.title, note.title_source],
        )?;
    }
    if !newer.tags {
        super::replace_local_tags(tx, note_id, &note.tag_ids)?;
    }
    tx.execute(
        "UPDATE notes SET updated_at = MAX(updated_at, ?2) WHERE id = ?1",
        rusqlite::params![note_id, note.updated_at],
    )?;
    Ok(())
}

pub(super) fn may_rebase(merged: &Merged, newer: Touched) -> bool {
    !merged.adopted.intersects(newer)
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::db::Database;
    use crate::repo::NotesRepo as _;

    fn doc(text: &str) -> serde_json::Value {
        serde_json::json!({
            "type": "doc",
            "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]
        })
    }

    fn remote_of(local: &LocalNote, id: &str, text: &str) -> RemoteNote {
        RemoteNote {
            id: id.to_owned(),
            title: "Remote title".into(),
            title_source: "manual".into(),
            doc_json: doc(text).to_string(),
            plain_text: format!("{text}\n"),
            excerpt: text.to_owned(),
            word_count: 2,
            folder_id: local.folder_id.clone(),
            is_pinned: local.is_pinned,
            rev: local.rev + 5,
            created_at: local.created_at,
            updated_at: local.updated_at + 10,
            deleted_at: None,
        }
    }

    fn setup() -> (Arc<Database>, crate::repo::notes::SqliteNotesRepo, String) {
        let db = Arc::new(Database::open_in_memory().expect("memory db"));
        let notes = crate::repo::notes::SqliteNotesRepo::new(Arc::clone(&db));
        let id = notes.create(None).expect("note creates").summary.id;
        notes
            .save(&crate::repo::SaveNoteInput {
                id: id.clone(),
                doc: doc("local text"),
                folder_id: None,
                tag_ids: vec![],
                is_pinned: false,
            })
            .expect("saves");
        db.with_conn(|conn| {
            conn.execute("UPDATE outbox SET sent_at = 1", ())?;
            conn.execute("UPDATE notes SET rev = 3, dirty = 0 WHERE id = ?1", [&id])?;
            Ok::<_, AppError>(())
        })
        .expect("marks synced");
        (db, notes, id)
    }

    #[test]
    fn a_metadata_change_takes_the_remote_document_instead_of_parking() {
        let (db, notes, id) = setup();
        notes.set_pinned(&id, true).expect("pins");

        let (touched, local) = db
            .with_conn(|conn| {
                Ok::<_, AppError>((
                    local_touches(conn, &id, None)?,
                    super::super::load_local_note(conn, &id)?.expect("note exists"),
                ))
            })
            .expect("reads");
        assert_eq!(
            touched,
            Touched {
                pinned: true,
                ..Touched::default()
            }
        );

        let remote = RemoteNote {
            is_pinned: false,
            ..remote_of(&local, &id, "remote text")
        };
        let merged = merge_note(&local, &remote, &[], touched);
        assert!(!merged.park, "disjoint fields never park");
        assert!(merged.note.doc_json.contains("remote text"));
        assert_eq!(merged.note.title, "Remote title");
        assert!(merged.note.is_pinned, "the local pin is this device's");
    }

    #[test]
    fn a_save_racing_a_remote_edit_still_parks() {
        let (db, notes, id) = setup();
        notes
            .save(&crate::repo::SaveNoteInput {
                id: id.clone(),
                doc: doc("local edit"),
                folder_id: None,
                tag_ids: vec![],
                is_pinned: false,
            })
            .expect("saves");
        let (touched, local) = db
            .with_conn(|conn| {
                Ok::<_, AppError>((
                    local_touches(conn, &id, None)?,
                    super::super::load_local_note(conn, &id)?.expect("note exists"),
                ))
            })
            .expect("reads");
        assert!(touched.doc);
        assert!(!touched.title, "a save never writes the title");

        let merged = merge_note(&local, &remote_of(&local, &id, "remote edit"), &[], touched);
        assert!(merged.park);
        assert!(merged.note.doc_json.contains("local edit"));
        assert_eq!(merged.note.title, "Remote title");
    }

    #[test]
    fn an_unreadable_payload_touches_everything() {
        assert_eq!(Touched::of_payload("upsert", None), Touched::ALL);
        assert_eq!(
            Touched::of_payload("upsert", Some("{\"id\":\"x\"}")),
            Touched::ALL
        );
        assert_eq!(
            Touched::of_payload("delete", Some("{\"isPinned\":true}")),
            Touched::ALL
        );
        assert_eq!(
            Touched::of_payload("upsert", Some("{\"id\":\"x\",\"title\":\"T\"}")),
            Touched {
                title: true,
                ..Touched::default()
            }
        );
    }

    #[test]
    fn untouched_tags_take_the_remote_set() {
        let (db, notes, id) = setup();
        notes.set_pinned(&id, true).expect("pins");
        let local = db
            .with_conn(|conn| super::super::load_local_note(conn, &id))
            .expect("reads")
            .expect("note exists");
        let local = LocalNote {
            tag_ids: vec!["a".into(), "b".into()],
            ..local
        };
        let remote = remote_of(&local, &id, "local text");
        let touched = Touched {
            pinned: true,
            ..Touched::default()
        };
        let merged = merge_note(&local, &remote, &["a".to_owned()], touched);
        assert_eq!(merged.note.tag_ids, vec!["a".to_owned()]);

        let touched = Touched {
            tags: true,
            ..touched
        };
        let merged = merge_note(&local, &remote, &["c".to_owned()], touched);
        assert_eq!(merged.note.tag_ids, vec!["a", "b", "c"]);
    }

    #[test]
    fn a_newer_edit_to_an_adopted_field_is_not_rebased() {
        let (db, notes, id) = setup();
        notes.set_pinned(&id, true).expect("pins");
        let (local, pushed) = db
            .with_conn(|conn| {
                let local = super::super::load_local_note(conn, &id)?.expect("note exists");
                let pushed: i64 =
                    conn.query_row("SELECT MAX(id) FROM outbox", (), |row| row.get(0))?;
                Ok::<_, AppError>((local, pushed))
            })
            .expect("reads");
        let merged = merge_note(
            &local,
            &remote_of(&local, &id, "remote text"),
            &[],
            Touched {
                pinned: true,
                ..Touched::default()
            },
        );
        notes
            .save(&crate::repo::SaveNoteInput {
                id: id.clone(),
                doc: doc("typed during push"),
                folder_id: None,
                tag_ids: vec![],
                is_pinned: false,
            })
            .expect("saves");
        let newer = db
            .with_conn(|conn| local_touches(conn, &id, Some(pushed)))
            .expect("reads");
        assert!(newer.doc);
        assert!(!may_rebase(&merged, newer));

        db.with_conn(|conn| {
            let tx = conn.transaction()?;
            write_merged(&tx, &id, &merged, newer)?;
            tx.commit()?;
            Ok::<_, AppError>(())
        })
        .expect("writes");
        let live = notes.get(&id).expect("reads");
        assert!(
            live.summary.excerpt.contains("typed during push"),
            "the newer keystrokes are not overwritten: {:?}",
            live.summary.excerpt
        );
        assert_eq!(
            live.summary.title, "Remote title",
            "untouched fields still merge"
        );
    }
}
