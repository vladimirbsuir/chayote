use std::collections::HashMap;

use rusqlite::Row;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Types crossing the repository boundary. Rust structs carry
/// `#[serde(rename_all = "camelCase")]`, matching `src/types/`.
/// UUIDv7 string (R1). Generated on the device, never reassigned or reused.
pub type Uuid = String;

/// R2: UTC epoch milliseconds, never local time.
pub type Timestamp = i64;

pub mod folders;
pub mod notes;
pub mod tags;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Selection {
    All,
    Pinned,
    Folder { id: Uuid },
    Tag { id: Uuid },
    Trash,
}

/// The single selection model: exactly one of all, pinned, folder, tag or
/// trash is active at a time (`05-ui-ux.md` §5).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteFilter {
    #[serde(flatten)]
    pub selection: Selection,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

impl NoteFilter {
    /// The paging fields are optional on the wire, so this builds a filter
    /// without spelling them out. Commands deserialise their own instance.
    #[cfg(test)]
    pub fn new(selection: Selection) -> Self {
        Self {
            selection,
            limit: None,
            offset: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TagRef {
    pub id: Uuid,
    pub name: String,
}

/// Never carries the document body: `excerpt` and `word_count` exist so the
/// note list does not have to load one (`10-conventions.md` §8).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NoteSummary {
    pub id: Uuid,
    pub title: String,
    pub excerpt: String,
    pub folder_id: Option<Uuid>,
    pub folder_name: Option<String>,
    pub is_pinned: bool,
    pub word_count: i64,
    pub updated_at: Timestamp,
    pub tags: Vec<TagRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    #[serde(flatten)]
    pub summary: NoteSummary,
    pub doc: Value,
    pub created_at: Timestamp,
    pub deleted_at: Option<Timestamp>,
}

/// `02-architecture.md` §7: one named argument, so adding a field is not a
/// breaking change.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveNoteInput {
    pub id: Uuid,
    pub doc: Value,
    pub folder_id: Option<Uuid>,
    pub tag_ids: Vec<Uuid>,
    pub is_pinned: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FolderNode {
    pub id: Uuid,
    pub name: String,
    pub parent_id: Option<Uuid>,
    pub position: i64,
    pub children: Vec<FolderNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TagWithCount {
    pub id: Uuid,
    pub name: String,
    pub count: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchInput {
    pub query: String,
    pub filter: NoteFilter,
    pub limit: i64,
    pub offset: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    #[serde(flatten)]
    pub summary: NoteSummary,
    /// `bm25` weight. FTS5 returns more negative values for better matches,
    /// so `ORDER BY rank` ascending is correct.
    pub rank: f64,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SearchPage {
    pub hits: Vec<SearchHit>,
    pub total: i64,
    pub next_offset: Option<i64>,
}

/// The seam where remote storage arrives (ADR-003, ADR-005).
///
/// `v1` has exactly one implementation, `SqliteNotesRepo`. The post-v1
/// `SupabaseNotesRepo` implements the same trait, which is what makes sync
/// additive rather than architectural.
///
/// Every method owns its transaction, and the row write and the outbox append
/// commit together or not at all (R5).
pub trait NotesRepo: Send + Sync {
    /// Notes in a selection, pinned first then by recency.
    fn list(&self, filter: &NoteFilter) -> Result<Vec<NoteSummary>, crate::error::AppError>;
    fn get(&self, id: &str) -> Result<Note, crate::error::AppError>;
    fn create(&self, folder_id: Option<&str>) -> Result<Note, crate::error::AppError>;
    fn save(&self, input: &SaveNoteInput) -> Result<Note, crate::error::AppError>;
    fn move_to(&self, id: &str, folder_id: Option<&str>) -> Result<Note, crate::error::AppError>;
    /// Sets `deleted_at`; the row stays, so the deletion can propagate (R3).
    fn soft_delete(&self, id: &str) -> Result<(), crate::error::AppError>;
    fn restore(&self, id: &str) -> Result<(), crate::error::AppError>;
    /// Removes the row outright. `07-sync-plan.md` §5.4 adds the tombstone
    /// guard here when sync lands; in v1 it would refuse every delete, since
    /// `synced_at` is always NULL before the first push.
    fn destroy(&self, id: &str) -> Result<(), crate::error::AppError>;
    fn empty_trash(&self) -> Result<i64, crate::error::AppError>;
}

pub trait FoldersRepo: Send + Sync {
    /// The whole live tree, assembled in Rust from a flat ordered read.
    fn list(&self) -> Result<Vec<FolderNode>, crate::error::AppError>;
    fn create(
        &self,
        name: &str,
        parent_id: Option<&str>,
    ) -> Result<FolderNode, crate::error::AppError>;
    fn rename(&self, id: &str, name: &str) -> Result<FolderNode, crate::error::AppError>;
    fn move_to(
        &self,
        id: &str,
        new_parent_id: Option<&str>,
        position: i64,
    ) -> Result<FolderNode, crate::error::AppError>;
    /// Permanent in v1: the subtree goes, its notes become unfiled. See
    /// `07-sync-plan.md` §5.2 for what sync changes about this.
    fn delete(&self, id: &str) -> Result<(), crate::error::AppError>;
}

pub trait TagsRepo: Send + Sync {
    /// Counts exclude notes in the trash: an empty filter in the sidebar is
    /// noise (`03-data-model.md` §5).
    fn list(&self) -> Result<Vec<TagWithCount>, crate::error::AppError>;
    /// Case-insensitive: `Work`, `work` and `WORK` are one tag, normalised to
    /// the first-created spelling.
    fn create(&self, name: &str) -> Result<TagWithCount, crate::error::AppError>;
    fn rename(&self, id: &str, name: &str) -> Result<TagWithCount, crate::error::AppError>;
    fn delete(&self, id: &str) -> Result<(), crate::error::AppError>;
}

/// Every service write appends here in the same transaction as the row write
/// (R5). If the process dies between the two, neither happened.
pub(crate) fn append_outbox(
    tx: &rusqlite::Transaction<'_>,
    entity: &str,
    entity_id: &str,
    op: &str,
    payload: Option<&str>,
    base_rev: i64,
) -> Result<(), rusqlite::Error> {
    tx.execute(
        "INSERT INTO outbox (entity, entity_id, op, payload, base_rev, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            entity,
            entity_id,
            op,
            payload,
            base_rev,
            crate::clock::now_ms()
        ],
    )?;
    Ok(())
}

pub(crate) fn base_rev_of(
    conn: &rusqlite::Connection,
    table: &str,
    id: &str,
) -> Result<Option<i64>, rusqlite::Error> {
    use rusqlite::OptionalExtension;
    conn.query_row(
        &format!("SELECT rev FROM {table} WHERE id = ?1"),
        [id],
        |row| row.get(0),
    )
    .optional()
}

/// The columns every note read shares, in a fixed order.
pub(crate) const SUMMARY_COLUMNS: &str =
    "n.id, n.title, n.excerpt, n.folder_id, n.is_pinned, n.word_count, n.updated_at";

/// Owned copy of the summary columns. Rows are collected into this before the
/// connection is reused, so no `Row` borrow is ever held across another query.
#[derive(Clone)]
pub(crate) struct SummaryRow {
    pub id: String,
    pub title: String,
    pub excerpt: String,
    pub folder_id: Option<String>,
    pub is_pinned: bool,
    pub word_count: i64,
    pub updated_at: i64,
}

impl SummaryRow {
    pub fn read(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get(0)?,
            title: row.get(1)?,
            excerpt: row.get(2)?,
            folder_id: row.get(3)?,
            is_pinned: row.get::<_, i64>(4)? != 0,
            word_count: row.get(5)?,
            updated_at: row.get(6)?,
        })
    }
}

/// Folder names for `NoteSummary.folder_name`, in one query.
pub(crate) fn folder_names(
    conn: &rusqlite::Connection,
) -> Result<HashMap<String, String>, rusqlite::Error> {
    let mut stmt = conn.prepare("SELECT id, name FROM folders WHERE deleted_at IS NULL")?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut map = HashMap::new();
    for row in rows {
        let (id, name) = row?;
        map.insert(id, name);
    }
    Ok(map)
}

/// Tag references for a set of notes, in one query.
pub(crate) fn tags_for(
    conn: &rusqlite::Connection,
    note_ids: &[Uuid],
) -> Result<HashMap<String, Vec<TagRef>>, rusqlite::Error> {
    let mut map: HashMap<String, Vec<TagRef>> = HashMap::new();
    if note_ids.is_empty() {
        return Ok(map);
    }

    let placeholders = vec!["?"; note_ids.len()].join(",");
    let sql = format!(
        "SELECT nt.note_id, t.id, t.name
           FROM note_tags nt
           JOIN tags t ON t.id = nt.tag_id
          WHERE nt.note_id IN ({placeholders})
            AND t.deleted_at IS NULL
          ORDER BY t.name COLLATE NOCASE"
    );
    let mut stmt = conn.prepare(&sql)?;
    let refs: Vec<&dyn rusqlite::ToSql> = note_ids
        .iter()
        .map(|id| id as &dyn rusqlite::ToSql)
        .collect();
    let rows = stmt.query_map(refs.as_slice(), |row| {
        Ok((
            row.get::<_, String>(0)?,
            TagRef {
                id: row.get(1)?,
                name: row.get(2)?,
            },
        ))
    })?;
    for row in rows {
        let (note_id, tag) = row?;
        map.entry(note_id).or_default().push(tag);
    }
    Ok(map)
}

/// Resolves folder names and tag references for a page of rows, in two queries
/// rather than one per row.
pub(crate) fn attach(
    conn: &rusqlite::Connection,
    rows: &[SummaryRow],
) -> Result<Vec<NoteSummary>, rusqlite::Error> {
    let names = folder_names(conn)?;
    let ids: Vec<String> = rows.iter().map(|row| row.id.clone()).collect();
    let tags = tags_for(conn, &ids)?;

    Ok(rows
        .iter()
        .map(|row| NoteSummary {
            folder_name: row.folder_id.as_ref().and_then(|id| names.get(id)).cloned(),
            tags: tags.get(&row.id).cloned().unwrap_or_default(),
            id: row.id.clone(),
            title: row.title.clone(),
            excerpt: row.excerpt.clone(),
            folder_id: row.folder_id.clone(),
            is_pinned: row.is_pinned,
            word_count: row.word_count,
            updated_at: row.updated_at,
        })
        .collect())
}

/// `params![]` is not `Params`, and neither is an empty array: an owned empty
/// `Vec` is the empty binding set.
pub(crate) fn no_params() {}

/// Reads a page of summary rows for an optional scope parameter.
pub(crate) fn read_rows(
    conn: &rusqlite::Connection,
    sql: &str,
    scope: Option<&str>,
) -> Result<Vec<SummaryRow>, rusqlite::Error> {
    let mut stmt = conn.prepare(sql)?;
    let collected = match scope {
        Some(id) => stmt.query_map([id], SummaryRow::read)?,
        None => stmt.query_map(no_params(), SummaryRow::read)?,
    };
    collected.collect()
}
