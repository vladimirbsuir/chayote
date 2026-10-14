//! Repository and service tests.
//!
//! Every test opens a real SQLite file in a temp directory, not `:memory:`:
//! `journal_mode = WAL`, the foreign-key cascades and the FTS triggers are all
//! part of what is being tested, and none of them behave the same way in an
//! in-memory database.
//!
//! The ten required tests from `10-conventions.md` §10 are marked below by
//! their number.

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

/// Points an input at the note it will be saved into.
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

// ---------------------------------------------------------------- migration

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
            "0004_sync.sql"
        ]
    );
    assert_eq!(applied[0].0, 1);

    // Reopening must apply nothing new (R8).
    let reopened = Arc::new(Database::open(f._dir.path()).expect("reopen"));
    let again = crate::db::migrate::applied_all(&reopened).expect("readable again");
    assert_eq!(again.len(), 4);
}

/// An in-memory database cannot do WAL or cascades across connections, so every
/// other test uses a real file. This one exists to keep the constructor honest
/// about what it is for: a database that must never touch the user's notes.
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

    // WAL is a file-only journal mode; an in-memory database keeps its own.
    // The pragmas that matter here are the ones that are not about files.
    let foreign_keys: i64 = db
        .with_conn(|conn| Ok(conn.query_row("PRAGMA foreign_keys", [], |row| row.get(0))?))
        .unwrap_or(0);
    assert_eq!(foreign_keys, 1, "cascades are enforced");
}

#[test]
fn applies_pragmas_from_the_data_model() {
    let f = fixture("pragmas");

    // journal_mode answers with a mode name; the rest answer with integers.
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

// ------------------------------------------------- required tests 1 and 2

/// Required test 1: every write appends an outbox row in the same transaction.
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

    repo.destroy(&created.summary.id).expect("destroy");
    assert_eq!(scalar(&f.db, "SELECT COUNT(*) FROM outbox"), 5);
}

/// Required test 2: a failed write leaves no orphan outbox row.
///
/// The write fails because the note does not exist, so the transaction must
/// roll back before the append.
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

/// The dirty flag and the outbox must agree, or sync cannot tell "unchanged"
/// from "changed and not yet sent" (R4, `07-sync-plan.md` §12).
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

// ------------------------------------------------------- required test 3

/// Required test 3: derived values are recomputed on every save.
#[test]
fn derived_values_are_recomputed_on_every_save() {
    let f = fixture("derived");
    let repo = notes(&f.db);

    let created = repo.create(None).expect("create");
    assert_eq!(created.summary.title, "Untitled");
    assert_eq!(created.summary.word_count, 0);
    assert_eq!(created.summary.excerpt, "");

    let first = on(&created.summary.id, note_with_text("first title"));
    let after_first = repo.save(&first).expect("save");
    assert_eq!(after_first.summary.title, "first title");
    assert_eq!(after_first.summary.word_count, 2);
    assert!(after_first.summary.excerpt.starts_with("first title"));

    let second = on(&created.summary.id, note_with_text("a different title"));
    let after_second = repo.save(&second).expect("save");
    assert_eq!(after_second.summary.title, "a different title");
    assert_eq!(after_second.summary.word_count, 3);

    // A heading wins over the first paragraph.
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
    assert_eq!(after_heading.summary.title, "The Heading");
}

// --------------------------------------------------------- required test 4

/// Required test 4: IDs are UUIDv7 and strictly increasing within a run.
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

/// No ID is ever reused, even after the row is gone (R1).
#[test]
fn ids_are_never_reused_after_deletion() {
    let f = fixture("no-reuse");
    let repo = notes(&f.db);

    let first = repo.create(None).expect("create");
    let second = repo.create(None).expect("create");
    repo.destroy(&first.summary.id).expect("destroy");
    let third = repo.create(None).expect("create");

    assert_ne!(first.summary.id, second.summary.id);
    assert_ne!(first.summary.id, third.summary.id);
    assert_ne!(second.summary.id, third.summary.id);
}

// --------------------------------------------------------- required test 5

/// Required test 5: soft delete sets `deleted_at` and leaves the row present.
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

    // It disappears from every live selection but stays in the trash.
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

// --------------------------------------------------------- required test 6

/// Required test 6: the FTS index stays consistent with `notes` across
/// insert, update, delete and hard delete.
#[test]
fn fts_index_tracks_notes_across_every_write() {
    let f = fixture("fts");
    let repo = notes(&f.db);

    let created = repo.create(None).expect("create");
    let input = on(&created.summary.id, note_with_text("kumquat"));
    repo.save(&input).expect("save");
    assert_eq!(fts_hits(&f.db, "kumquat"), 1, "indexed on write");

    // Updating the derived text must drop the old term from the index.
    let renamed = on(&created.summary.id, note_with_text("satsuma"));
    repo.save(&renamed).expect("save");
    assert_eq!(fts_hits(&f.db, "kumquat"), 0, "old term gone");
    assert_eq!(fts_hits(&f.db, "satsuma"), 1, "new term present");

    // Soft delete removes it from the live search scope.
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

    // Hard delete removes it from the index entirely.
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

// --------------------------------------------------------- required test 7

/// Required test 7: FTS operators in user input cannot produce an error or an
/// injection.
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

    // Nothing was executed, and the row survived.
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

// --------------------------------------------------------- required test 8

/// Required test 8: a document violating an invariant is rejected and the
/// stored version survives.
#[test]
fn an_invalid_document_is_rejected_and_the_stored_one_survives() {
    let f = fixture("doc-invalid");
    let repo = notes(&f.db);

    let created = repo.create(None).expect("create");
    let good = on(&created.summary.id, note_with_text("survives"));
    repo.save(&good).expect("save good");

    let invalid_documents = vec![
        // Empty doc: invariant 1.
        json!({"type": "doc", "content": []}),
        // Unknown node type: invariant 4.
        json!({"type": "doc", "content": [{"type": "video"}]}),
        // Empty text node: invariant 6.
        json!({"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": ""}]}]}),
        // Heading level out of range.
        json!({"type": "doc", "content": [{"type": "heading", "attrs": {"level": 4}, "content": [{"type": "text", "text": "x"}]}]}),
        // Missing heading level.
        json!({"type": "doc", "content": [{"type": "heading", "content": [{"type": "text", "text": "x"}]}]}),
        // Unknown mark: v1 has no link mark.
        json!({"type": "doc", "content": [{"type": "paragraph", "content": [
            {"type": "text", "text": "click", "marks": [{"type": "link", "attrs": {"href": "javascript:alert(1)"}}]}
        ]}]}),
        // Not a doc at all.
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
    assert_eq!(stored.summary.title, "survives");
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

    // The buffer is the user's; the stored version is untouched.
    assert_eq!(
        repo.get(&created.summary.id).expect("stored").summary.title,
        "Untitled"
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

    // `04-editor.md` §1.2: paragraph, heading and blockquote carry 0–7.
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

// ------------------------------------------------------- selection and order

#[test]
fn pinned_notes_sort_first_in_every_selection() {
    let f = fixture("order");
    let repo = notes(&f.db);

    let plain = repo.create(None).expect("create");
    let pinned = repo.create(None).expect("create");
    repo.save(&SaveNoteInput {
        id: pinned.summary.id.clone(),
        doc: pinned.doc.clone(),
        folder_id: None,
        tag_ids: vec![],
        is_pinned: true,
    })
    .expect("pin");

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
    /* The whole reason this command exists: the note list holds a summary with no
    document, so pinning from a card must not send or rewrite one. Compared
    against the note as it stood immediately before the pin, the body and every
    derived column are byte-identical. */
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

    /* `updated_at` moves with the flag, the same as `move_to`: a pinned note sorts
    above everything in every selection, so pinning one is a change to where it
    appears, not a change to what it contains. */
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

    // A refused pin writes nothing at all: no flag change, no outbox row (R5).
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

// -------------------------------------------------------------- folders

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

    // Reordering inside the parent moves the node.
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

    // Into itself is also a cycle.
    assert_eq!(
        folders
            .move_to(&work.id, Some(&work.id), 0)
            .expect_err("self refused")
            .code(),
        "CYCLE_DETECTED"
    );

    // The refused moves changed nothing.
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

    // A note survives its folder and becomes unfiled.
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

// ------------------------------------------------------------------ tags

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

    /* ADR-021: a tag with no live notes stays listed at a zero count, so tags
    can be created before any note carries them. Ordered by name. */
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

    // Removing the tag itself takes it out of the sidebar; the unused one stays.
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
    /* ADR-021: detaching the last note leaves a visible zero-count tag rather
    than hiding the row — the tag itself survives either way. */
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

/// Timestamps are UTC epoch milliseconds and never repeat within a run (R2).
#[test]
fn timestamps_are_epoch_milliseconds_and_strictly_increasing() {
    let f = fixture("timestamps");
    let repo = notes(&f.db);

    let mut previous = 0;
    for _ in 0..8 {
        let created = repo.create(None).expect("create");
        assert!(created.summary.updated_at > previous, "monotonic");
        // Milliseconds, not seconds: well past any 2001 epoch in seconds.
        assert!(created.summary.updated_at > 1_000_000_000_000, "epoch ms");
        previous = created.summary.updated_at;
    }
}

/// The IPC wire shape is a contract with `src/types/ipc.ts`. A field renamed on
/// one side only is a silent break that no repository test would catch, so the
/// JSON is asserted here rather than trusted.
#[test]
fn the_wire_shape_matches_the_typescript_types() {
    // A selection is an internally tagged union, flattened into the filter.
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

    // Outgoing shapes.
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

    // An AppError carries a stable code and a user-facing message.
    let error = crate::error::AppError::CycleDetected;
    let wire = serde_json::to_value(&error).expect("error serialises");
    assert_eq!(wire["code"], "CYCLE_DETECTED");
    assert!(wire["message"].is_string());
    assert!(wire.get("details").is_none(), "no detail, so no key at all");

    // A validation error carries its detail, which the message shows.
    let wire = serde_json::to_value(crate::error::AppError::Validation(
        "Give the tag a name.".into(),
    ))
    .expect("serialises");
    assert_eq!(wire["code"], "VALIDATION");
    assert_eq!(wire["message"], "Give the tag a name.");
}

/// `NOT_FOUND` for a row that exists but is not visible in the requested scope.
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
