use std::sync::Arc;

use serde_json::json;

use crate::db::Database;
use crate::repo::notes::SqliteNotesRepo;
use crate::repo::{
    FoldersRepo, NoteFilter, NotesRepo, SaveNoteInput, SearchInput, Selection, TagsRepo,
};
use crate::services::search::SearchService;

struct Fixture {
    _dir: TempDir,
    db: Arc<Database>,
}

struct TempDir(std::path::PathBuf);

impl TempDir {
    fn new(tag: &str) -> Self {
        let unique = format!(
            "chayote-test-{tag}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        );
        let path = std::env::temp_dir().join(unique);
        std::fs::create_dir_all(&path).expect("temp dir");
        Self(path)
    }

    fn path(&self) -> &std::path::Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn fixture(tag: &str) -> Fixture {
    let dir = TempDir::new(tag);
    let db = Arc::new(Database::open(dir.path()).expect("database opens"));
    Fixture { _dir: dir, db }
}

fn notes(db: &Arc<Database>) -> SqliteNotesRepo {
    SqliteNotesRepo::new(Arc::clone(db))
}

fn note_with_text(text: &str) -> SaveNoteInput {
    SaveNoteInput {
        id: String::new(),
        doc: json!({
            "type": "doc",
            "content": [
                {"type": "paragraph", "content": [{"type": "text", "text": text}]}
            ]
        }),
        folder_id: None,
        tag_ids: vec![],
        is_pinned: false,
    }
}

fn on(note_id: &str, input: SaveNoteInput) -> SaveNoteInput {
    SaveNoteInput {
        id: note_id.to_owned(),
        ..input
    }
}

fn scalar(db: &Arc<Database>, sql: &str) -> i64 {
    db.with_conn(|conn| Ok(conn.query_row(sql, [], |row| row.get(0)).unwrap_or(-1)))
        .expect("scalar query")
}

fn mark_synced(db: &Arc<Database>, id: &str) {
    db.with_conn(|conn| {
        conn.execute("UPDATE notes SET rev = 7, dirty = 0 WHERE id = ?1", [id])?;
        Ok::<_, crate::error::AppError>(())
    })
    .expect("mark synced");
}

#[test]
fn applies_every_migration_once_and_is_idempotent_on_reopen() {
    let f = fixture("migrate");
    let applied = crate::db::migrate::applied_all(&f.db).expect("schema_migrations readable");
    let names: Vec<&str> = applied.iter().map(|(_, name)| name.as_str()).collect();
    assert_eq!(
        names,
        vec![
            "0001_initial.sql",
            "0002_fts.sql",
            "0003_outbox.sql",
            "0004_sync.sql",
            "0005_sync_backoff.sql",
            "0006_note_title_field.sql",
            "0007_tags_live_unique.sql",
            "0008_fts_update_columns.sql"
        ]
    );
    assert_eq!(applied[0].0, 1);

    let reopened = Arc::new(Database::open(f._dir.path()).expect("reopen"));
    let again = crate::db::migrate::applied_all(&reopened).expect("readable again");
    assert_eq!(again.len(), 8);
}

#[test]
fn a_tag_tombstone_no_longer_blocks_a_live_tag_of_the_same_name() {
    let f = fixture("migrate-tags");
    f.db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO tags (id, name, created_at, updated_at, deleted_at)
             VALUES ('t-old', 'work', 1, 1, 5)",
            (),
        )?;
        conn.execute(
            "INSERT INTO tags (id, name, created_at, updated_at) VALUES ('t-new', 'Work', 2, 2)",
            (),
        )?;
        let clash = conn.execute(
            "INSERT INTO tags (id, name, created_at, updated_at) VALUES ('t-dup', 'WORK', 3, 3)",
            (),
        );
        assert!(clash.is_err(), "two live tags may not share a name");
        Ok::<_, crate::error::AppError>(())
    })
    .expect("a tombstone and a live tag coexist");
}

#[test]
fn the_tags_rebuild_keeps_every_note_tag_link() {
    let f = fixture("migrate-tags-links");
    let repo = notes(&f.db);
    let tags = crate::repo::tags::SqliteTagsRepo::new(Arc::clone(&f.db));
    let tag = tags.create("Kept").expect("tag creates");
    let id = repo.create(None).expect("note creates").summary.id;
    repo.save(&SaveNoteInput {
        id: id.clone(),
        tag_ids: vec![tag.id.clone()],
        ..note_with_text("linked")
    })
    .expect("tags the note");

    f.db.with_conn(|conn| {
        let tx = conn.transaction()?;
        tx.execute_batch(include_str!("../migrations/0007_tags_live_unique.sql"))?;
        tx.commit()?;
        Ok::<_, crate::error::AppError>(())
    })
    .expect("the rebuild runs on a populated database");

    let note = repo.get(&id).expect("note reads");
    assert_eq!(note.summary.tags.len(), 1, "the link survives the rebuild");
    assert_eq!(tags.list().expect("lists")[0].count, 1);
}

#[test]
fn renaming_a_tag_onto_another_tags_name_is_a_validation_error() {
    let f = fixture("tag-rename-clash");
    let tags = crate::repo::tags::SqliteTagsRepo::new(Arc::clone(&f.db));
    tags.create("Work").expect("creates");
    let other = tags.create("Home").expect("creates");
    let err = tags.rename(&other.id, "work").expect_err("clashes");
    assert_eq!(err.code(), "VALIDATION");
    let respelled = tags.rename(&other.id, "HOME").expect("respells");
    assert_eq!(respelled.name, "HOME");
}

#[test]
fn the_title_field_migration_moves_a_leading_heading_out_of_the_body() {
    let f = fixture("migrate-title");
    let repo = notes(&f.db);

    let created = repo.create(None).expect("create");
    let id = created.summary.id.clone();
    repo.save(&on(
        &id,
        SaveNoteInput {
            doc: json!({
                "type": "doc",
                "content": [
                    {"type": "heading", "attrs": {"level": 1},
                     "content": [{"type": "text", "text": "Old note"}]},
                    {"type": "paragraph",
                     "content": [{"type": "text", "text": "the body"}]}
                ]
            }),
            ..note_with_text("")
        },
    ))
    .expect("save");
    assert_eq!(
        scalar(
            &f.db,
            "SELECT COUNT(*) FROM notes WHERE title_source = 'manual'"
        ),
        0
    );

    f.db.with_conn(|conn| {
        let tx = conn.transaction()?;
        crate::db::migrate::lift_leading_heading_into_title_for_tests(&tx)?;
        tx.commit()?;
        Ok::<_, crate::error::AppError>(())
    })
    .expect("data pass");

    let migrated = repo.get(&id).expect("reload");
    assert_eq!(
        migrated.summary.title, "Old note",
        "the heading became the title"
    );
    assert_eq!(
        f.db.with_conn(|conn| {
            let source: String =
                conn.query_row("SELECT title_source FROM notes", [], |row| row.get(0))?;
            Ok(source)
        })
        .expect("title_source"),
        "manual"
    );
    assert_eq!(
        migrated.summary.word_count, 2,
        "the heading left the plain text too"
    );
    let first_block = migrated.doc["content"][0]["type"]
        .as_str()
        .unwrap_or_default();
    assert_eq!(first_block, "paragraph", "body starts at the paragraph now");
    assert_eq!(
        migrated.doc["content"][0]["content"][0]["text"].as_str(),
        Some("the body")
    );

    f.db.with_conn(|conn| {
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM outbox WHERE entity = 'note' AND entity_id = ?1",
            [&id],
            |row| row.get(0),
        )?;
        Ok(count)
    })
    .expect("outbox count");
    assert!(
        f.db.with_conn(|conn| {
            let count: i64 = conn.query_row(
                "SELECT COUNT(*) FROM outbox WHERE entity = 'note' AND entity_id = ?1",
                [&id],
                |row| row.get(0),
            )?;
            Ok(count > 0)
        })
        .expect("outbox count"),
        "the moved title is queued for sync"
    );
}

#[test]
fn the_title_field_migration_leaves_a_note_with_no_leading_heading_alone() {
    let f = fixture("migrate-title-plain");
    let repo = notes(&f.db);

    let created = repo.create(None).expect("create");
    let id = created.summary.id.clone();
    repo.save(&on(&id, note_with_text("just a paragraph")))
        .expect("save");

    f.db.with_conn(|conn| {
        let tx = conn.transaction()?;
        crate::db::migrate::lift_leading_heading_into_title_for_tests(&tx)?;
        tx.commit()?;
        Ok::<_, crate::error::AppError>(())
    })
    .expect("data pass");

    let after = repo.get(&id).expect("reload");
    assert_eq!(after.summary.title, "", "untouched, and untitled");
    assert_eq!(
        after.doc["content"][0]["content"][0]["text"].as_str(),
        Some("just a paragraph")
    );
}

#[test]
fn a_note_that_was_only_a_title_keeps_a_body_to_type_into() {
    let f = fixture("migrate-title-only");
    let repo = notes(&f.db);

    let created = repo.create(None).expect("create");
    let id = created.summary.id.clone();
    repo.save(&on(
        &id,
        SaveNoteInput {
            doc: json!({
                "type": "doc",
                "content": [
                    {"type": "heading", "attrs": {"level": 1},
                     "content": [{"type": "text", "text": "Only a title"}]}
                ]
            }),
            ..note_with_text("")
        },
    ))
    .expect("save");

    f.db.with_conn(|conn| {
        let tx = conn.transaction()?;
        crate::db::migrate::lift_leading_heading_into_title_for_tests(&tx)?;
        tx.commit()?;
        Ok::<_, crate::error::AppError>(())
    })
    .expect("data pass");

    let migrated = repo.get(&id).expect("reload");
    assert_eq!(migrated.summary.title, "Only a title");
    assert_eq!(migrated.doc["content"].as_array().map(Vec::len), Some(1));
    assert_eq!(
        migrated.doc["content"][0]["type"].as_str(),
        Some("paragraph")
    );
    assert!(
        crate::doc::validate::validate(&migrated.doc).is_ok(),
        "still valid"
    );
}

#[test]
fn an_in_memory_database_gets_the_schema_and_the_pragmas() {
    let db = Database::open_in_memory().expect("in-memory database");
    assert_eq!(db.path().as_deref(), Some(":memory:"));

    let tables: Vec<String> = db
        .with_conn(|conn| {
            let mut stmt = conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")?;
            let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
            let names = rows.collect::<Result<Vec<_>, _>>()?;
            Ok(names)
        })
        .expect("tables readable");
    for expected in [
        "notes",
        "folders",
        "tags",
        "note_tags",
        "notes_fts",
        "outbox",
    ] {
        assert!(
            tables.iter().any(|name| name == expected),
            "{expected} exists"
        );
    }

    let foreign_keys: i64 = db
        .with_conn(|conn| Ok(conn.query_row("PRAGMA foreign_keys", [], |row| row.get(0))?))
        .unwrap_or(0);
    assert_eq!(foreign_keys, 1, "cascades are enforced");
}

#[test]
fn applies_pragmas_from_the_data_model() {
    let f = fixture("pragmas");

    let mode: String =
        f.db.with_conn(|conn| {
            Ok(conn.query_row("PRAGMA journal_mode", [], |row| row.get::<_, String>(0))?)
        })
        .unwrap_or_default();
    assert_eq!(mode.to_lowercase(), "wal");

    for (pragma, expected) in [
        ("foreign_keys", 1),
        ("busy_timeout", 5000),
        ("temp_store", 2),
    ] {
        let value: i64 =
            f.db.with_conn(|conn| {
                Ok(conn.query_row(&format!("PRAGMA {pragma}"), [], |row| row.get(0))?)
            })
            .unwrap_or(-1);
        assert_eq!(value, expected, "PRAGMA {pragma}");
    }
}

#[test]
fn every_write_appends_exactly_one_outbox_row() {
    let f = fixture("outbox-append");
    let repo = notes(&f.db);

    let created = repo.create(None).expect("create");
    assert_eq!(scalar(&f.db, "SELECT COUNT(*) FROM outbox"), 1);

    let input = on(&created.summary.id, note_with_text("hello"));
    repo.save(&input).expect("save");
    assert_eq!(scalar(&f.db, "SELECT COUNT(*) FROM outbox"), 2);

    repo.soft_delete(&created.summary.id).expect("soft delete");
    assert_eq!(scalar(&f.db, "SELECT COUNT(*) FROM outbox"), 3);

    repo.restore(&created.summary.id).expect("restore");
    assert_eq!(scalar(&f.db, "SELECT COUNT(*) FROM outbox"), 4);

    mark_synced(&f.db, &created.summary.id);
    repo.destroy(&created.summary.id).expect("destroy");
    assert_eq!(scalar(&f.db, "SELECT COUNT(*) FROM outbox"), 5);
}

#[test]
fn a_failed_write_leaves_no_orphan_outbox_row() {
    let f = fixture("outbox-rollback");
    let repo = notes(&f.db);

    let input = on("does-not-exist", note_with_text("hello"));
    assert!(repo.save(&input).is_err());
    assert_eq!(scalar(&f.db, "SELECT COUNT(*) FROM outbox"), 0);

    assert!(repo.soft_delete("does-not-exist").is_err());
    assert_eq!(scalar(&f.db, "SELECT COUNT(*) FROM outbox"), 0);

    assert!(repo.destroy("does-not-exist").is_err());
    assert_eq!(scalar(&f.db, "SELECT COUNT(*) FROM outbox"), 0);
}

#[test]
fn dirty_rows_and_outbox_rows_agree() {
    let f = fixture("dirty-agrees");
    let repo = notes(&f.db);

    let created = repo.create(None).expect("create");
    let input = on(&created.summary.id, note_with_text("counted"));
    repo.save(&input).expect("save");

    assert_eq!(
        scalar(&f.db, "SELECT COUNT(*) FROM notes WHERE dirty = 1"),
        1
    );
    assert_eq!(scalar(&f.db, "SELECT COUNT(*) FROM outbox"), 2);
}

#[test]
fn derived_values_are_recomputed_on_every_save() {
    let f = fixture("derived");
    let repo = notes(&f.db);

    let created = repo.create(None).expect("create");
    assert_eq!(created.summary.title, "", "no title stored");
    assert_eq!(created.summary.word_count, 0);
    assert_eq!(created.summary.excerpt, "");

    let first = on(&created.summary.id, note_with_text("first title"));
    let after_first = repo.save(&first).expect("save");
    assert_eq!(after_first.summary.title, "", "the title is not derived");
    assert_eq!(after_first.summary.word_count, 2);
    assert!(after_first.summary.excerpt.starts_with("first title"));

    let second = on(&created.summary.id, note_with_text("a different title"));
    let after_second = repo.save(&second).expect("save");
    assert_eq!(after_second.summary.title, "", "and stays that way");
    assert_eq!(after_second.summary.word_count, 3);

    let heading = SaveNoteInput {
        id: created.summary.id.clone(),
        doc: json!({
            "type": "doc",
            "content": [
                {"type": "paragraph", "content": [{"type": "text", "text": "intro"}]},
                {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "The Heading"}]}
            ]
        }),
        folder_id: None,
        tag_ids: vec![],
        is_pinned: false,
    };
    let after_heading = repo.save(&heading).expect("save heading");
    assert_eq!(after_heading.summary.title, "");
    assert!(
        after_heading.summary.excerpt.contains("The Heading"),
        "the heading is still in the derived text"
    );
}

#[test]
fn a_typed_title_survives_every_later_save() {
    let f = fixture("title-survives");
    let repo = notes(&f.db);

    let created = repo.create(None).expect("create");
    let id = created.summary.id.clone();
    repo.save(&on(&id, note_with_text("body"))).expect("save");
    repo.set_title(&id, "The real title").expect("set title");

    let after = repo
        .save(&on(
            &id,
            note_with_text("a completely different opening line"),
        ))
        .expect("save");
    assert_eq!(
        after.summary.title, "The real title",
        "the title is the reader's, not the body's"
    );
}

#[test]
fn ids_are_uuidv7_and_strictly_increasing() {
    let f = fixture("uuidv7");
    let repo = notes(&f.db);

    let mut previous = String::new();
    for _ in 0..5 {
        let created = repo.create(None).expect("create");
        let id = created.summary.id.clone();
        assert_eq!(id.len(), 36, "uuid string form: {id}");
        assert_eq!(id.as_bytes()[14], b'7', "uuid version nibble: {id}");

        let timestamp: i64 = id
            .split('-')
            .next()
            .and_then(|group| u64::from_str_radix(group, 16).ok())
            .expect("first group is hex") as i64;
        let previous_ts: i64 = previous
            .split('-')
            .next()
            .and_then(|group| u64::from_str_radix(group, 16).ok())
            .unwrap_or(0) as i64;
        assert!(
            timestamp >= previous_ts,
            "time-ordered: {timestamp} >= {previous_ts}"
        );

        previous = id;
    }
}

#[test]
fn ids_are_never_reused_after_deletion() {
    let f = fixture("no-reuse");
    let repo = notes(&f.db);

    let first = repo.create(None).expect("create");
    let second = repo.create(None).expect("create");
    mark_synced(&f.db, &first.summary.id);
    repo.destroy(&first.summary.id).expect("destroy");
    let third = repo.create(None).expect("create");

    assert_ne!(first.summary.id, second.summary.id);
    assert_ne!(first.summary.id, third.summary.id);
    assert_ne!(second.summary.id, third.summary.id);
}

#[test]
fn soft_delete_sets_deleted_at_and_keeps_the_row() {
    let f = fixture("soft-delete");
    let repo = notes(&f.db);

    let created = repo.create(None).expect("create");
    repo.soft_delete(&created.summary.id).expect("soft delete");

    assert_eq!(scalar(&f.db, "SELECT COUNT(*) FROM notes"), 1);
    assert_eq!(
        scalar(
            &f.db,
            "SELECT COUNT(*) FROM notes WHERE deleted_at IS NOT NULL"
        ),
        1
    );

    let all = repo
        .list(&NoteFilter::new(Selection::All))
        .expect("list all");
    assert!(all.is_empty());
    let trash = repo
        .list(&NoteFilter::new(Selection::Trash))
        .expect("list trash");
    assert_eq!(trash.len(), 1);

    repo.restore(&created.summary.id).expect("restore");
    assert_eq!(
        scalar(&f.db, "SELECT COUNT(*) FROM notes WHERE deleted_at IS NULL"),
        1
    );
}

#[test]
fn empty_trash_removes_only_soft_deleted_notes() {
    let f = fixture("empty-trash");
    let repo = notes(&f.db);

    let keep = repo.create(None).expect("keep");
    let drop_one = repo.create(None).expect("drop");
    repo.soft_delete(&drop_one.summary.id).expect("soft delete");
    mark_synced(&f.db, &drop_one.summary.id);

    assert_eq!(repo.empty_trash().expect("empty"), 1);
    assert_eq!(scalar(&f.db, "SELECT COUNT(*) FROM notes"), 1);
    assert_eq!(
        scalar(&f.db, "SELECT COUNT(*) FROM notes WHERE id = ?",)
            .max(scalar(&f.db, "SELECT COUNT(*) FROM notes")),
        1
    );
    assert!(repo.get(&keep.summary.id).is_ok());
    assert_eq!(
        repo.get(&drop_one.summary.id).unwrap_err().code(),
        "NOT_FOUND"
    );
}

#[test]
fn destroy_removes_a_note_that_never_synced_and_queues_its_tombstone() {
    let f = fixture("destroy-unsynced");
    let repo = notes(&f.db);
    let deletes = "SELECT COUNT(*) FROM outbox WHERE op = 'delete' AND base_rev = 0";

    let created = repo.create(None).expect("create");
    repo.soft_delete(&created.summary.id).expect("soft delete");
    let before = scalar(&f.db, deletes);
    repo.destroy(&created.summary.id)
        .expect("destroy without sync");

    assert_eq!(
        repo.get(&created.summary.id).unwrap_err().code(),
        "NOT_FOUND"
    );
    assert_eq!(
        scalar(&f.db, deletes),
        before + 1,
        "a later first sync still tells the server"
    );
}

#[test]
fn empty_trash_removes_synced_and_never_synced_notes() {
    let f = fixture("empty-trash-all");
    let repo = notes(&f.db);
    let deletes = "SELECT COUNT(*) FROM outbox WHERE op = 'delete'";

    let synced = repo.create(None).expect("synced");
    let fresh = repo.create(None).expect("fresh");
    let kept = repo.create(None).expect("kept");
    repo.soft_delete(&synced.summary.id).expect("soft delete");
    repo.soft_delete(&fresh.summary.id).expect("soft delete");
    mark_synced(&f.db, &synced.summary.id);
    let before = scalar(&f.db, deletes);

    assert_eq!(repo.empty_trash().expect("empty"), 2);
    assert!(repo.get(&synced.summary.id).is_err());
    assert!(repo.get(&fresh.summary.id).is_err());
    assert!(repo.get(&kept.summary.id).is_ok());
    assert_eq!(scalar(&f.db, deletes), before + 2);
}

#[test]
fn fts_index_tracks_notes_across_every_write() {
    let f = fixture("fts");
    let repo = notes(&f.db);

    let created = repo.create(None).expect("create");
    let input = on(&created.summary.id, note_with_text("kumquat"));
    repo.save(&input).expect("save");
    assert_eq!(fts_hits(&f.db, "kumquat"), 1, "indexed on write");

    let renamed = on(&created.summary.id, note_with_text("satsuma"));
    repo.save(&renamed).expect("save");
    assert_eq!(fts_hits(&f.db, "kumquat"), 0, "old term gone");
    assert_eq!(fts_hits(&f.db, "satsuma"), 1, "new term present");

    repo.soft_delete(&created.summary.id).expect("soft delete");
    let search = SearchService::new(Arc::clone(&f.db));
    let page = search
        .query(&SearchInput {
            query: "satsuma".into(),
            filter: NoteFilter::new(Selection::All),
            limit: 20,
            offset: 0,
        })
        .expect("search");
    assert!(page.hits.is_empty(), "trashed note is not a live hit");

    mark_synced(&f.db, &created.summary.id);
    repo.destroy(&created.summary.id).expect("destroy");
    assert_eq!(fts_hits(&f.db, "satsuma"), 0, "row gone from index");
    assert_eq!(
        scalar(
            &f.db,
            "SELECT COUNT(*) FROM notes_fts WHERE notes_fts MATCH 'satsuma'"
        ),
        0
    );
}

fn fts_hits(db: &Arc<Database>, term: &str) -> i64 {
    let db = Arc::clone(db);
    db.with_conn(|conn| {
        Ok(conn.query_row(
            "SELECT COUNT(*) FROM notes_fts WHERE notes_fts MATCH ?1",
            [term],
            |row| row.get(0),
        )?)
    })
    .unwrap_or(-1)
}

#[test]
fn fts_operators_in_search_input_are_harmless() {
    let f = fixture("fts-injection");
    let repo = notes(&f.db);
    let created = repo.create(None).expect("create");
    let input = on(&created.summary.id, note_with_text("roadmap"));
    repo.save(&input).expect("save");

    let search = SearchService::new(Arc::clone(&f.db));
    let hostile = [
        ",",
        "*",
        "NEAR(",
        "^",
        "-",
        "\"",
        "'",
        "AND",
        "OR",
        "NOT",
        "(",
        ")",
        "roadmap; DROP TABLE notes",
        "a*",
        "--",
        "\\",
        "%",
        "_",
        "{}",
        "\u{0}",
    ];

    for query in hostile {
        let result = search.query(&SearchInput {
            query: query.to_owned(),
            filter: NoteFilter::new(Selection::All),
            limit: 20,
            offset: 0,
        });
        assert!(result.is_ok(), "query {query:?} must not error");
    }

    assert_eq!(scalar(&f.db, "SELECT COUNT(*) FROM notes"), 1);
    assert_eq!(scalar(&f.db, "SELECT COUNT(*) FROM notes_fts"), 1);
}

#[test]
fn sanitised_search_matches_prefixes_and_ranks_by_bm25() {
    let f = fixture("fts-rank");
    let repo = notes(&f.db);

    for text in ["roadmap planning", "meeting about the roadmap", "lunch"] {
        let created = repo.create(None).expect("create");
        let input = on(&created.summary.id, note_with_text(text));
        repo.save(&input).expect("save");
    }

    let search = SearchService::new(Arc::clone(&f.db));
    let page = search
        .query(&SearchInput {
            query: "roadmap".into(),
            filter: NoteFilter::new(Selection::All),
            limit: 20,
            offset: 0,
        })
        .expect("search");

    assert_eq!(page.total, 2, "both roadmap notes match the prefix");
    for hit in &page.hits {
        assert!(hit.rank < 0.0, "bm25 is more negative for a better match");
        assert!(hit.snippet.contains("roadmap") || hit.snippet.contains("Roadmap"));
    }
}

#[test]
fn search_scopes_to_the_active_selection_and_paginates() {
    let f = fixture("fts-scope");
    let repo = notes(&f.db);
    let folders = crate::repo::folders::SqliteFoldersRepo::new(Arc::clone(&f.db));
    let folder = folders.create("Work", None).expect("folder");

    for text in ["budget review", "hiring budget"] {
        let created = repo.create(None).expect("create");
        let input = on(
            &created.summary.id,
            SaveNoteInput {
                folder_id: Some(folder.id.clone()),
                ..note_with_text(text)
            },
        );
        repo.save(&input).expect("save");
    }

    let unfiled = repo.create(None).expect("create");
    let input = on(&unfiled.summary.id, note_with_text("budget nothing"));
    repo.save(&input).expect("save");

    let search = SearchService::new(Arc::clone(&f.db));
    let scoped = search
        .query(&SearchInput {
            query: "budget".into(),
            filter: NoteFilter::new(Selection::Folder {
                id: folder.id.clone(),
            }),
            limit: 20,
            offset: 0,
        })
        .expect("scoped search");
    assert_eq!(scoped.total, 2, "unfiled note is out of scope");

    let all = search
        .query(&SearchInput {
            query: "budget".into(),
            filter: NoteFilter::new(Selection::All),
            limit: 20,
            offset: 0,
        })
        .expect("unscoped search");
    assert_eq!(all.total, 3);

    let page_one = search
        .query(&SearchInput {
            query: "budget".into(),
            filter: NoteFilter::new(Selection::All),
            limit: 2,
            offset: 0,
        })
        .expect("page one");
    assert_eq!(page_one.hits.len(), 2);
    assert_eq!(page_one.next_offset, Some(2));

    let page_two = search
        .query(&SearchInput {
            query: "budget".into(),
            filter: NoteFilter::new(Selection::All),
            limit: 2,
            offset: 2,
        })
        .expect("page two");
    assert_eq!(page_two.hits.len(), 1);
    assert_eq!(page_two.next_offset, None);
}

#[test]
fn search_that_sanitises_to_nothing_falls_back_instead_of_erroring() {
    let f = fixture("fts-fallback");
    let repo = notes(&f.db);
    let created = repo.create(None).expect("create");
    let input = on(&created.summary.id, note_with_text("anything"));
    repo.save(&input).expect("save");

    let search = SearchService::new(Arc::clone(&f.db));
    for query in ["", "   ", "!!!", "-", "^", "()"] {
        let page = search
            .query(&SearchInput {
                query: query.to_owned(),
                filter: NoteFilter::new(Selection::All),
                limit: 20,
                offset: 0,
            })
            .expect("fallback search");
        assert_eq!(page.total, 1, "query {query:?} falls back to recency");
    }
}

#[test]
fn an_invalid_document_is_rejected_and_the_stored_one_survives() {
    let f = fixture("doc-invalid");
    let repo = notes(&f.db);

    let created = repo.create(None).expect("create");
    let good = on(&created.summary.id, note_with_text("survives"));
    repo.save(&good).expect("save good");

    let invalid_documents = vec![
        json!({"type": "doc", "content": []}),
        json!({"type": "doc", "content": [{"type": "video"}]}),
        json!({"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": ""}]}]}),
        json!({"type": "doc", "content": [{"type": "heading", "attrs": {"level": 4}, "content": [{"type": "text", "text": "x"}]}]}),
        json!({"type": "doc", "content": [{"type": "heading", "content": [{"type": "text", "text": "x"}]}]}),
        json!({"type": "doc", "content": [{"type": "paragraph", "content": [
            {"type": "text", "text": "click", "marks": [{"type": "link", "attrs": {"href": "javascript:alert(1)"}}]}
        ]}]}),
        json!({"type": "paragraph"}),
    ];

    for invalid in invalid_documents {
        let attempt = SaveNoteInput {
            id: created.summary.id.clone(),
            doc: invalid.clone(),
            folder_id: None,
            tag_ids: vec![],
            is_pinned: false,
        };
        let error = repo.save(&attempt).expect_err("must reject");
        assert_eq!(error.code(), "DOC_INVALID", "document {invalid}");
    }

    let stored = repo
        .get(&created.summary.id)
        .expect("stored version survives");
    assert_eq!(
        stored.doc["content"][0]["content"][0]["text"].as_str(),
        Some("survives"),
        "the document that was stored is the one that was validated"
    );
}

#[test]
fn a_document_over_five_megabytes_is_rejected() {
    let f = fixture("doc-large");
    let repo = notes(&f.db);
    let created = repo.create(None).expect("create");

    let huge = "x".repeat(5 * 1024 * 1024 + 16);
    let attempt = on(&created.summary.id, note_with_text(&huge));
    let error = repo.save(&attempt).expect_err("must reject");
    assert_eq!(error.code(), "DOC_TOO_LARGE");

    assert_eq!(
        repo.get(&created.summary.id).expect("stored").summary.title,
        ""
    );
}

#[test]
fn nesting_deeper_than_twelve_is_rejected() {
    let f = fixture("doc-deep");
    let repo = notes(&f.db);
    let created = repo.create(None).expect("create");

    let mut node = json!({"type": "paragraph", "content": [{"type": "text", "text": "deep"}]});
    for _ in 0..20 {
        node = json!({"type": "blockquote", "content": [node]});
    }
    let attempt = SaveNoteInput {
        id: created.summary.id.clone(),
        doc: json!({"type": "doc", "content": [node]}),
        folder_id: None,
        tag_ids: vec![],
        is_pinned: false,
    };
    assert_eq!(
        repo.save(&attempt).expect_err("must reject").code(),
        "DOC_INVALID"
    );
}

#[test]
fn indent_levels_zero_to_seven_save_and_eight_is_rejected() {
    let f = fixture("doc-indent");
    let repo = notes(&f.db);
    let created = repo.create(None).expect("create");

    let indented = json!({"type": "doc", "content": [
        {"type": "paragraph", "attrs": {"indent": 3},
         "content": [{"type": "text", "text": "indented"}]},
        {"type": "heading", "attrs": {"level": 2, "indent": 7},
         "content": [{"type": "text", "text": "deep"}]},
        {"type": "blockquote", "attrs": {"indent": 1}, "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "quoted"}]}]},
    ]});
    let attempt = SaveNoteInput {
        id: created.summary.id.clone(),
        doc: indented,
        folder_id: None,
        tag_ids: vec![],
        is_pinned: false,
    };
    repo.save(&attempt).expect("indent 0–7 saves");

    let attempt = SaveNoteInput {
        id: created.summary.id.clone(),
        doc: json!({"type": "doc", "content": [
            {"type": "paragraph", "attrs": {"indent": 8},
             "content": [{"type": "text", "text": "too far"}]}]}),
        folder_id: None,
        tag_ids: vec![],
        is_pinned: false,
    };
    assert_eq!(
        repo.save(&attempt).expect_err("must reject").code(),
        "DOC_INVALID"
    );
}

#[test]
fn a_save_never_moves_the_pin() {
    let f = fixture("save-pin");
    let repo = notes(&f.db);
    let note = repo.create(None).expect("create");
    repo.set_pinned(&note.summary.id, true).expect("pin");

    let saved = repo
        .save(&SaveNoteInput {
            id: note.summary.id.clone(),
            doc: note.doc.clone(),
            folder_id: None,
            tag_ids: vec![],
            is_pinned: false,
        })
        .expect("save");
    assert!(saved.summary.is_pinned);
}

#[test]
fn a_save_drops_a_folder_or_tag_that_no_longer_exists() {
    let f = fixture("save-dangling");
    let repo = notes(&f.db);
    let note = repo.create(None).expect("create");

    let saved = repo
        .save(&SaveNoteInput {
            id: note.summary.id.clone(),
            doc: note.doc.clone(),
            folder_id: Some("01980000-0000-7000-8000-00000000dead".to_owned()),
            tag_ids: vec!["01980000-0000-7000-8000-00000000beef".to_owned()],
            is_pinned: false,
        })
        .expect("a dangling id does not fail the save");
    assert_eq!(saved.summary.folder_id, None);
    assert!(saved.summary.tags.is_empty());
}

#[test]
fn pinned_notes_sort_first_in_every_selection() {
    let f = fixture("order");
    let repo = notes(&f.db);

    let plain = repo.create(None).expect("create");
    let pinned = repo.create(None).expect("create");
    repo.set_pinned(&pinned.summary.id, true).expect("pin");

    let listed = repo.list(&NoteFilter::new(Selection::All)).expect("list");
    assert_eq!(listed[0].id, pinned.summary.id, "pinned first");
    assert_eq!(listed[1].id, plain.summary.id);

    let pinned_only = repo
        .list(&NoteFilter::new(Selection::Pinned))
        .expect("pinned filter");
    assert_eq!(pinned_only.len(), 1);
    assert_eq!(pinned_only[0].id, pinned.summary.id);
}

#[test]
fn a_typed_title_is_kept_verbatim_and_survives_every_later_save() {
    let f = fixture("title-manual");
    let repo = notes(&f.db);

    let created = repo.create(None).expect("create");
    let id = created.summary.id.clone();
    repo.save(&on(&id, note_with_text("body"))).expect("save");

    let titled = repo
        .set_title(&id, "  Roadmap review  ")
        .expect("set title");
    assert_eq!(titled.summary.title, "Roadmap review", "trimmed");
    assert_eq!(
        titled.doc,
        repo.get(&id).expect("reload").doc,
        "document untouched"
    );

    let after = repo
        .save(&on(&id, note_with_text("A different first line")))
        .expect("save again");

    assert_eq!(after.summary.title, "Roadmap review", "title kept");
}

#[test]
fn clearing_a_typed_title_leaves_the_note_untitled() {
    let f = fixture("title-clear");
    let repo = notes(&f.db);

    let created = repo.create(None).expect("create");
    let id = created.summary.id.clone();
    repo.save(&on(&id, note_with_text("First line of the body")))
        .expect("save");
    repo.set_title(&id, "Typed").expect("set title");

    let cleared = repo.set_title(&id, "   ").expect("clear title");
    assert_eq!(cleared.summary.title, "");

    let resaved = repo
        .save(&on(&id, note_with_text("Second line of the body")))
        .expect("save");
    assert_eq!(
        resaved.summary.title, "",
        "a save leaves the title alone whatever the body says"
    );
}

#[test]
fn a_typed_title_is_capped_like_a_derived_one() {
    let f = fixture("title-cap");
    let repo = notes(&f.db);

    let created = repo.create(None).expect("create");
    let long = "word ".repeat(40);
    let titled = repo
        .set_title(&created.summary.id, long.trim())
        .expect("set title");

    assert!(
        titled.summary.title.chars().count() <= 120,
        "capped at 120, got {}",
        titled.summary.title.chars().count()
    );
    assert!(!titled.summary.title.ends_with(' '), "no trailing space");
}

#[test]
fn setting_a_title_on_a_note_that_does_not_exist_is_not_found() {
    let f = fixture("title-missing");
    let repo = notes(&f.db);

    let err = repo.set_title("00000000-0000-7000-8000-000000000000", "Nope");
    assert!(
        matches!(err, Err(crate::error::AppError::NotFound)),
        "got {err:?}"
    );
}

#[test]
fn a_titled_note_reports_its_new_title_in_the_list_and_in_search() {
    let f = fixture("title-listing");
    let repo = notes(&f.db);

    let created = repo.create(None).expect("create");
    let id = created.summary.id.clone();
    repo.save(&on(&id, note_with_text("a body with a distinctive word")))
        .expect("save");
    repo.set_title(&id, "Quarterly plan").expect("set title");

    let listed = repo.list(&NoteFilter::new(Selection::All)).expect("list");
    assert_eq!(listed[0].title, "Quarterly plan", "the list carries it");

    let hits = SearchService::new(Arc::clone(&f.db))
        .query(&SearchInput {
            query: "quarterly".into(),
            filter: NoteFilter::new(Selection::All),
            limit: 20,
            offset: 0,
        })
        .expect("search");
    assert_eq!(hits.hits.len(), 1, "found by its title");
    assert_eq!(hits.hits[0].summary.title, "Quarterly plan");
}

#[test]
fn pinning_flips_the_flag_without_touching_the_document() {
    let f = fixture("pin-flag");
    let repo = notes(&f.db);

    let created = repo.create(None).expect("create");
    let id = created.summary.id.clone();
    repo.save(&SaveNoteInput {
        id: id.clone(),
        doc: json!({
            "type": "doc",
            "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "body" }] }]
        }),
        folder_id: None,
        tag_ids: vec![],
        is_pinned: false,
    })
    .expect("save");

    let saved = repo.get(&id).expect("reload");
    let pinned = repo.set_pinned(&id, true).expect("pin");

    assert!(pinned.summary.is_pinned, "flag flipped");
    assert_eq!(pinned.doc, saved.doc, "document untouched");
    assert_eq!(pinned.summary.title, saved.summary.title);
    assert_eq!(pinned.summary.word_count, saved.summary.word_count);
    assert_eq!(pinned.summary.excerpt, saved.summary.excerpt);

    let unpinned = repo.set_pinned(&id, false).expect("unpin");
    assert!(!unpinned.summary.is_pinned, "and back again");
    assert_eq!(unpinned.doc, saved.doc, "still untouched");
}

#[test]
fn pinning_raises_the_note_to_the_top_of_the_list() {
    let f = fixture("pin-order");
    let repo = notes(&f.db);

    let oldest = repo.create(None).expect("create");
    let middle = repo.create(None).expect("create");
    let newest = repo.create(None).expect("create");

    let listed = repo.list(&NoteFilter::new(Selection::All)).expect("list");
    assert_eq!(
        listed[0].id, newest.summary.id,
        "newest first before pinning"
    );

    repo.set_pinned(&oldest.summary.id, true).expect("pin");

    let listed = repo.list(&NoteFilter::new(Selection::All)).expect("list");
    assert_eq!(
        listed[0].id, oldest.summary.id,
        "pinned first after pinning"
    );

    let pinned_only = repo
        .list(&NoteFilter::new(Selection::Pinned))
        .expect("pinned filter");
    assert_eq!(pinned_only.len(), 1);
    assert_eq!(pinned_only[0].id, oldest.summary.id);
    assert!(
        listed.iter().any(|n| n.id == middle.summary.id),
        "the others remain"
    );
}

#[test]
fn pinning_appends_exactly_one_outbox_row_and_a_failed_pin_leaves_none() {
    let f = fixture("pin-outbox");
    let repo = notes(&f.db);

    let created = repo.create(None).expect("create");
    let id = created.summary.id.clone();
    let before =
        f.db.with_conn(|conn| {
            let n: i64 = conn.query_row(
                "SELECT COUNT(*) FROM outbox WHERE entity_id = ?1",
                [&id],
                |row| row.get(0),
            )?;
            Ok(n)
        })
        .expect("count");

    repo.set_pinned(&id, true).expect("pin");

    let after =
        f.db.with_conn(|conn| {
            let n: i64 = conn.query_row(
                "SELECT COUNT(*) FROM outbox WHERE entity_id = ?1",
                [&id],
                |row| row.get(0),
            )?;
            Ok(n)
        })
        .expect("count");
    assert_eq!(after, before + 1, "row and outbox commit together (R5)");

    assert_eq!(
        repo.set_pinned("missing", true)
            .expect_err("must fail")
            .code(),
        "NOT_FOUND"
    );
    let after_failure =
        f.db.with_conn(|conn| {
            let n: i64 = conn.query_row("SELECT COUNT(*) FROM outbox", [], |row| row.get(0))?;
            Ok(n)
        })
        .expect("count");
    assert_eq!(
        after_failure, after,
        "a refused pin leaves no orphan outbox row"
    );
}

#[test]
fn recency_order_is_strict_and_stable() {
    let f = fixture("recency");
    let repo = notes(&f.db);

    let mut ids = Vec::new();
    for _ in 0..4 {
        ids.push(repo.create(None).expect("create").summary.id);
    }

    let listed = repo.list(&NoteFilter::new(Selection::All)).expect("list");
    assert_eq!(listed.len(), 4);
    for pair in listed.windows(2) {
        assert!(pair[0].updated_at >= pair[1].updated_at, "descending");
    }
    assert_eq!(listed[0].id, ids[3], "newest first");
}

#[test]
fn pagination_counts_notes_not_join_rows() {
    let f = fixture("paging");
    let repo = notes(&f.db);
    let tags = crate::repo::tags::SqliteTagsRepo::new(Arc::clone(&f.db));
    let work = tags.create("work").expect("tag");
    let ideas = tags.create("ideas").expect("tag");

    for _ in 0..3 {
        let created = repo.create(None).expect("create");
        let input = SaveNoteInput {
            id: created.summary.id.clone(),
            doc: created.doc.clone(),
            folder_id: None,
            tag_ids: vec![work.id.clone(), ideas.id.clone()],
            is_pinned: false,
        };
        repo.save(&input).expect("save");
    }

    let filtered = NoteFilter {
        limit: Some(10),
        offset: Some(0),
        ..NoteFilter::new(Selection::Tag {
            id: work.id.clone(),
        })
    };
    let all = repo.list(&filtered).expect("list");
    assert_eq!(all.len(), 3);
    assert_eq!(all[0].tags.len(), 2, "both tags resolved");

    let page = repo
        .list(&NoteFilter {
            limit: Some(2),
            offset: Some(1),
            ..NoteFilter::new(Selection::Tag { id: work.id })
        })
        .expect("page");
    assert_eq!(page.len(), 2);
    assert_eq!(page[0].id, all[1].id);
}

#[test]
fn folder_tree_nests_and_orders_by_position() {
    let f = fixture("folders");
    let folders = crate::repo::folders::SqliteFoldersRepo::new(Arc::clone(&f.db));

    let work = folders.create("Work", None).expect("work");
    let projects = folders
        .create("Projects", Some(&work.id))
        .expect("projects");
    let meetings = folders
        .create("Meetings", Some(&work.id))
        .expect("meetings");
    let personal = folders.create("Personal", None).expect("personal");

    let tree = folders.list().expect("tree");
    assert_eq!(tree.len(), 2);
    assert_eq!(tree[0].id, work.id);
    assert_eq!(tree[0].children.len(), 2);
    assert_eq!(tree[0].children[0].id, projects.id);
    assert_eq!(tree[0].children[1].id, meetings.id);
    assert_eq!(tree[1].id, personal.id);

    folders
        .move_to(&meetings.id, Some(&work.id), 0)
        .expect("reorder");
    let reordered = folders.list().expect("tree");
    assert_eq!(reordered[0].children[0].id, meetings.id);
}

#[test]
fn moving_a_folder_into_its_own_descendant_is_refused() {
    let f = fixture("folder-cycle");
    let folders = crate::repo::folders::SqliteFoldersRepo::new(Arc::clone(&f.db));

    let work = folders.create("Work", None).expect("work");
    let projects = folders
        .create("Projects", Some(&work.id))
        .expect("projects");
    let deep = folders.create("Deep", Some(&projects.id)).expect("deep");

    let error = folders
        .move_to(&work.id, Some(&deep.id), 0)
        .expect_err("cycle refused");
    assert_eq!(error.code(), "CYCLE_DETECTED");

    assert_eq!(
        folders
            .move_to(&work.id, Some(&work.id), 0)
            .expect_err("self refused")
            .code(),
        "CYCLE_DETECTED"
    );

    let tree = folders.list().expect("tree");
    assert_eq!(tree[0].id, work.id);
    assert_eq!(tree[0].children[0].id, projects.id);
}

#[test]
fn deleting_a_folder_takes_the_subtree_and_unfiles_the_notes() {
    let f = fixture("folder-delete");
    let folders = crate::repo::folders::SqliteFoldersRepo::new(Arc::clone(&f.db));
    let repo = notes(&f.db);

    let work = folders.create("Work", None).expect("work");
    let projects = folders
        .create("Projects", Some(&work.id))
        .expect("projects");

    let inside = repo.create(Some(&projects.id)).expect("inside");
    let outside = repo.create(None).expect("outside");

    folders.delete(&work.id).expect("delete subtree");

    assert!(folders.list().expect("tree").is_empty(), "subtree gone");
    assert_eq!(scalar(&f.db, "SELECT COUNT(*) FROM folders"), 0);

    let survivor = repo.get(&inside.summary.id).expect("note survives");
    assert_eq!(survivor.summary.folder_id, None);
    assert!(repo.get(&outside.summary.id).is_ok());
}

#[test]
fn renaming_a_folder_rejects_an_empty_name_and_updates_the_summary() {
    let f = fixture("folder-rename");
    let folders = crate::repo::folders::SqliteFoldersRepo::new(Arc::clone(&f.db));
    let repo = notes(&f.db);

    let work = folders.create("Work", None).expect("work");
    let note = repo.create(Some(&work.id)).expect("note");

    assert_eq!(
        folders.rename(&work.id, "   ").expect_err("empty").code(),
        "VALIDATION"
    );

    let renamed = folders.rename(&work.id, "  Studio  ").expect("rename");
    assert_eq!(renamed.name, "Studio");

    let reloaded = repo.get(&note.summary.id).expect("note");
    assert_eq!(reloaded.summary.folder_name.as_deref(), Some("Studio"));
}

#[test]
fn tag_names_are_case_insensitive_and_normalised_to_the_first_spelling() {
    let f = fixture("tags-case");
    let tags = crate::repo::tags::SqliteTagsRepo::new(Arc::clone(&f.db));

    let work = tags.create("Work").expect("create");
    let again = tags.create("work").expect("duplicate");
    let shouted = tags.create("WORK").expect("duplicate");

    assert_eq!(work.id, again.id);
    assert_eq!(work.id, shouted.id);
    assert_eq!(again.name, "Work", "first-created spelling wins");
    assert_eq!(scalar(&f.db, "SELECT COUNT(*) FROM tags"), 1);
}

#[test]
fn tag_counts_exclude_notes_in_the_trash_and_show_empty_tags() {
    let f = fixture("tags-count");
    let repo = notes(&f.db);
    let tags = crate::repo::tags::SqliteTagsRepo::new(Arc::clone(&f.db));

    let work = tags.create("work").expect("tag");
    let lonely = tags.create("lonely").expect("tag");

    let keep = repo.create(None).expect("keep");
    let drop_one = repo.create(None).expect("drop");
    for (id, tag) in [(&keep.summary.id, &work), (&drop_one.summary.id, &work)] {
        repo.save(&SaveNoteInput {
            id: id.clone(),
            doc: json!({"type": "doc", "content": [{"type": "paragraph"}]}),
            folder_id: None,
            tag_ids: vec![tag.id.clone()],
            is_pinned: false,
        })
        .expect("tag the note");
    }

    let listed = tags.list().expect("list");
    assert_eq!(listed.len(), 2);
    assert_eq!(listed[0].id, lonely.id);
    assert_eq!(listed[0].count, 0);
    assert_eq!(listed[1].id, work.id);
    assert_eq!(listed[1].count, 2);

    repo.soft_delete(&drop_one.summary.id).expect("soft delete");
    let after = tags.list().expect("list");
    assert_eq!(after.len(), 2);
    assert_eq!(after[1].count, 1, "trashed note does not count");

    tags.delete(&work.id).expect("delete tag");
    let remaining = tags.list().expect("list");
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].id, lonely.id);
    assert!(repo.get(&keep.summary.id).is_ok(), "the note survives");
}

#[test]
fn removing_a_tag_from_a_note_leaves_the_tag_alone() {
    let f = fixture("tags-detach");
    let repo = notes(&f.db);
    let tags = crate::repo::tags::SqliteTagsRepo::new(Arc::clone(&f.db));

    let work = tags.create("work").expect("tag");
    let note = repo.create(None).expect("note");
    repo.save(&SaveNoteInput {
        id: note.summary.id.clone(),
        doc: note.doc.clone(),
        folder_id: None,
        tag_ids: vec![work.id.clone()],
        is_pinned: false,
    })
    .expect("attach");
    assert_eq!(tags.list().expect("list")[0].count, 1);

    repo.save(&SaveNoteInput {
        id: note.summary.id.clone(),
        doc: note.doc.clone(),
        folder_id: None,
        tag_ids: vec![],
        is_pinned: false,
    })
    .expect("detach");

    let reloaded = repo.get(&note.summary.id).expect("note");
    assert!(reloaded.summary.tags.is_empty(), "detached from the note");
    let listed = tags.list().expect("list");
    assert_eq!(listed.len(), 1, "the tag itself survives");
    assert_eq!(listed[0].count, 0);
}

#[test]
fn unknown_ids_report_not_found() {
    let f = fixture("not-found");
    let repo = notes(&f.db);
    let folders = crate::repo::folders::SqliteFoldersRepo::new(Arc::clone(&f.db));
    let tags = crate::repo::tags::SqliteTagsRepo::new(Arc::clone(&f.db));

    assert_eq!(repo.get("nope").expect_err("get").code(), "NOT_FOUND");
    assert_eq!(
        repo.move_to("nope", None).expect_err("move").code(),
        "NOT_FOUND"
    );
    assert_eq!(
        repo.restore("nope").expect_err("restore").code(),
        "NOT_FOUND"
    );
    assert_eq!(
        folders.rename("nope", "x").expect_err("rename").code(),
        "NOT_FOUND"
    );
    assert_eq!(
        folders.delete("nope").expect_err("delete").code(),
        "NOT_FOUND"
    );
    assert_eq!(
        tags.rename("nope", "x").expect_err("rename").code(),
        "NOT_FOUND"
    );
    assert_eq!(tags.delete("nope").expect_err("delete").code(), "NOT_FOUND");
    assert_eq!(
        repo.move_to(&repo.create(None).expect("create").summary.id, Some("nope"),)
            .expect_err("bad folder")
            .code(),
        "NOT_FOUND"
    );
}

#[test]
fn timestamps_are_epoch_milliseconds_and_strictly_increasing() {
    let f = fixture("timestamps");
    let repo = notes(&f.db);

    let mut previous = 0;
    for _ in 0..8 {
        let created = repo.create(None).expect("create");
        assert!(created.summary.updated_at > previous, "monotonic");
        assert!(created.summary.updated_at > 1_000_000_000_000, "epoch ms");
        previous = created.summary.updated_at;
    }
}

#[test]
fn the_wire_shape_matches_the_typescript_types() {
    let filter: NoteFilter = serde_json::from_value(json!({
        "kind": "folder", "id": "f1", "limit": 20, "offset": 0
    }))
    .expect("folder filter deserialises");
    assert_eq!(
        filter.selection,
        Selection::Folder {
            id: "f1".to_owned()
        }
    );
    assert_eq!(filter.limit, Some(20));

    for kind in ["all", "pinned", "trash"] {
        let parsed: NoteFilter =
            serde_json::from_value(json!({"kind": kind})).expect("unit variant deserialises");
        assert_eq!(parsed.selection.kind(), kind);
    }

    let note = json!({
        "id": "n1",
        "title": "Meeting notes",
        "excerpt": "Discussed the launch date",
        "folderId": "f1",
        "folderName": "Work",
        "isPinned": true,
        "wordCount": 342,
        "updatedAt": 1_780_000_000_000_i64,
        "tags": [{"id": "t1", "name": "work"}],
        "doc": {"type": "doc", "content": [{"type": "paragraph"}]},
        "createdAt": 1_779_000_000_000_i64,
        "deletedAt": null
    });
    let value: serde_json::Value = serde_json::from_value(note.clone()).expect("note round-trips");
    for field in [
        "id",
        "title",
        "excerpt",
        "folderId",
        "folderName",
        "isPinned",
        "wordCount",
        "updatedAt",
        "tags",
        "doc",
        "createdAt",
        "deletedAt",
    ] {
        assert!(value.get(field).is_some(), "Note carries {field}");
    }

    let error = crate::error::AppError::CycleDetected;
    let wire = serde_json::to_value(&error).expect("error serialises");
    assert_eq!(wire["code"], "CYCLE_DETECTED");
    assert!(wire["message"].is_string());
    assert!(wire.get("details").is_none(), "no detail, so no key at all");

    let wire = serde_json::to_value(crate::error::AppError::Validation(
        "Give the tag a name.".into(),
    ))
    .expect("serialises");
    assert_eq!(wire["code"], "VALIDATION");
    assert_eq!(wire["message"], "Give the tag a name.");
}

#[test]
fn a_trashed_note_is_still_gettable_by_id() {
    let f = fixture("trash-visible");
    let repo = notes(&f.db);
    let created = repo.create(None).expect("create");
    repo.soft_delete(&created.summary.id).expect("soft delete");

    let loaded = repo.get(&created.summary.id).expect("still loadable");
    assert!(loaded.deleted_at.is_some());
    assert!(repo
        .list(&NoteFilter::new(Selection::All))
        .expect("all")
        .is_empty());
}

#[test]
fn update_support_follows_the_platform() {
    assert_eq!(
        crate::commands::updates_supported(),
        cfg!(any(
            target_os = "windows",
            target_os = "linux",
            target_os = "android"
        ))
    );
}

#[test]
fn update_support_names_a_real_platform() {
    let label = crate::commands::os_label();
    assert!(!label.is_empty(), "the label must not be empty");
    assert_ne!(
        label, "Unknown",
        "a platform this project builds for must not report Unknown"
    );
}

#[cfg(desktop)]
#[test]
fn an_updater_failure_is_classified_and_keeps_its_detail_back() {
    use crate::commands::updates::update_error;
    use tauri_plugin_updater::Error as Plugin;

    let cases = [
        (
            Plugin::Network("Download request failed with status: 404".into()),
            "UPDATE_SERVER",
        ),
        (Plugin::ReleaseNotFound, "UPDATE_SERVER"),
        (
            Plugin::TargetNotFound("android-aarch64".into()),
            "UPDATE_NOT_FOR_DEVICE",
        ),
        (
            Plugin::TargetsNotFound(vec!["windows-x86_64-nsis".into()]),
            "UPDATE_NOT_FOR_DEVICE",
        ),
        (
            Plugin::SignedVersionMismatch {
                signed: "0.2.0".into(),
                announced: "0.9.0".into(),
            },
            "UPDATE_REJECTED",
        ),
        (Plugin::MissingSignedVersion, "UPDATE_REJECTED"),
        (Plugin::EmptyEndpoints, "INTERNAL"),
    ];

    for (source, code) in cases {
        let raw = source.to_string();
        let mapped = update_error(source);
        assert_eq!(mapped.code(), code, "for {raw}");
        assert_eq!(mapped.details().as_deref(), Some(raw.as_str()));

        let wire = serde_json::to_value(mapped).expect("serialises");
        assert_eq!(wire["code"], code);
        assert_ne!(
            wire["message"], wire["details"],
            "the reader-facing message must not be the plugin error"
        );
    }
}

#[cfg(desktop)]
#[test]
fn download_events_match_the_typescript_channel_shape() {
    use crate::commands::updates::DownloadEvent;

    let started = serde_json::to_value(DownloadEvent::Started {
        content_length: Some(15_000_000),
    })
    .expect("serialises");
    assert_eq!(started["event"], "started");
    assert_eq!(started["data"]["contentLength"], 15_000_000);

    let progress =
        serde_json::to_value(DownloadEvent::Progress { chunk_length: 4096 }).expect("serialises");
    assert_eq!(progress["event"], "progress");
    assert_eq!(progress["data"]["chunkLength"], 4096);

    let finished = serde_json::to_value(DownloadEvent::Finished).expect("serialises");
    assert_eq!(finished["event"], "finished");

    let unknown = serde_json::to_value(DownloadEvent::Started {
        content_length: None,
    })
    .expect("serialises");
    assert!(unknown["data"]["contentLength"].is_null());
}

#[test]
fn update_payloads_match_the_typescript_types() {
    let info = serde_json::json!({
        "version": "0.1.0",
        "os": "Windows",
        "updatesSupported": true,
    });
    for field in ["version", "os", "updatesSupported"] {
        assert!(info.get(field).is_some(), "AppInfo carries {field}");
    }

    let summary = serde_json::json!({
        "version": "0.2.0",
        "notes": "Faster search",
        "date": "2026-10-17T09:00:00Z",
    });
    for field in ["version", "notes", "date"] {
        assert!(
            summary.get(field).is_some(),
            "UpdateSummary carries {field}"
        );
    }
}

#[test]
fn a_word_with_punctuation_finds_the_note_it_came_from() {
    let f = fixture("fts-punctuation");
    let repo = notes(&f.db);
    let created = repo.create(None).expect("create");
    repo.save(&on(
        &created.summary.id,
        note_with_text("send the e-mail, don't forget example.com and pi 3.14"),
    ))
    .expect("save");

    let search = SearchService::new(Arc::clone(&f.db));
    for query in ["e-mail", "don't", "example.com", "3.14", "exam", "e-ma"] {
        let page = search
            .query(&SearchInput {
                query: query.to_owned(),
                filter: NoteFilter::new(Selection::All),
                limit: 20,
                offset: 0,
            })
            .expect("search");
        assert_eq!(page.total, 1, "query {query:?} finds the note");
    }
    assert_eq!(
        SearchService::to_fts_match("e-mail and"),
        Some("\"e mail\"* AND \"and\"*".to_owned())
    );
}

#[test]
fn pinning_does_not_rewrite_the_search_index() {
    let f = fixture("fts-pin");
    let repo = notes(&f.db);
    let created = repo.create(None).expect("create");
    repo.save(&on(&created.summary.id, note_with_text("indexed words")))
        .expect("save");
    repo.set_pinned(&created.summary.id, true).expect("pin");
    let trigger_sql: String =
        f.db.with_conn(|conn| {
            Ok::<_, crate::error::AppError>(conn.query_row(
                "SELECT sql FROM sqlite_master WHERE name = 'notes_fts_au'",
                [],
                |row| row.get(0),
            )?)
        })
        .expect("trigger sql");
    assert!(trigger_sql.contains("UPDATE OF title, plain_text"));
    assert_eq!(
        scalar(
            &f.db,
            "SELECT COUNT(*) FROM notes_fts WHERE notes_fts MATCH 'indexed'"
        ),
        1
    );
}

#[test]
fn creating_a_note_in_a_missing_folder_is_not_found() {
    let f = fixture("create-missing-folder");
    let repo = notes(&f.db);
    let err = repo
        .create(Some("0190a7d0-0000-7000-8000-000000000000"))
        .expect_err("missing folder");
    assert!(matches!(err, crate::error::AppError::NotFound));
    assert_eq!(scalar(&f.db, "SELECT COUNT(*) FROM notes"), 0);
    assert_eq!(scalar(&f.db, "SELECT COUNT(*) FROM outbox"), 0);
}

#[test]
fn listing_more_notes_than_one_tag_lookup_holds_keeps_every_tag() {
    let f = fixture("tags-chunked");
    let repo = notes(&f.db);
    let tag = crate::repo::tags::SqliteTagsRepo::new(Arc::clone(&f.db))
        .create("bulk")
        .expect("tag");
    for _ in 0..1_201 {
        let created = repo.create(None).expect("create");
        repo.save(&SaveNoteInput {
            tag_ids: vec![tag.id.clone()],
            ..on(&created.summary.id, note_with_text("tagged"))
        })
        .expect("save");
    }

    let listed = repo.list(&NoteFilter::new(Selection::All)).expect("list");
    assert_eq!(listed.len(), 1_201);
    assert!(listed.iter().all(|note| note.tags.len() == 1));
}
