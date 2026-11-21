use std::collections::HashMap;

use rusqlite::Row;
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub type Uuid = String;

pub type Timestamp = i64;

pub mod folders;
pub mod notes;
pub mod tags;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Selection {
    All,
    Pinned,
    Folder { id: Uuid },
    Tag { id: Uuid },
    Trash,
}

impl Selection {
    #[cfg(test)]
    pub fn kind(&self) -> &'static str {
        match self {
            Self::All => "all",
            Self::Pinned => "pinned",
            Self::Folder { .. } => "folder",
            Self::Tag { .. } => "tag",
            Self::Trash => "trash",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteFilter {
    #[serde(flatten)]
    pub selection: Selection,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

impl NoteFilter {
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveNoteInput {
    pub id: Uuid,
    pub doc: Value,
    pub folder_id: Option<Uuid>,
    pub tag_ids: Vec<Uuid>,
    #[serde(default)]
    #[allow(dead_code)]
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

pub trait NotesRepo: Send + Sync {
    fn list(&self, filter: &NoteFilter) -> Result<Vec<NoteSummary>, crate::error::AppError>;
    fn get(&self, id: &str) -> Result<Note, crate::error::AppError>;
    fn create(&self, folder_id: Option<&str>) -> Result<Note, crate::error::AppError>;
    fn save(&self, input: &SaveNoteInput) -> Result<Note, crate::error::AppError>;
    fn move_to(&self, id: &str, folder_id: Option<&str>) -> Result<Note, crate::error::AppError>;
    fn set_pinned(&self, id: &str, is_pinned: bool) -> Result<Note, crate::error::AppError>;
    fn set_title(&self, id: &str, title: &str) -> Result<Note, crate::error::AppError>;
    fn soft_delete(&self, id: &str) -> Result<(), crate::error::AppError>;
    fn restore(&self, id: &str) -> Result<(), crate::error::AppError>;
    fn destroy(&self, id: &str) -> Result<(), crate::error::AppError>;
    fn empty_trash(&self) -> Result<i64, crate::error::AppError>;
}

pub trait FoldersRepo: Send + Sync {
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
    fn delete(&self, id: &str) -> Result<(), crate::error::AppError>;
}

pub trait TagsRepo: Send + Sync {
    fn list(&self) -> Result<Vec<TagWithCount>, crate::error::AppError>;
    fn create(&self, name: &str) -> Result<TagWithCount, crate::error::AppError>;
    fn rename(&self, id: &str, name: &str) -> Result<TagWithCount, crate::error::AppError>;
    fn delete(&self, id: &str) -> Result<(), crate::error::AppError>;
}

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

pub(crate) const SUMMARY_COLUMNS: &str =
    "n.id, n.title, n.excerpt, n.folder_id, n.is_pinned, n.word_count, n.updated_at";

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

const TAG_LOOKUP_CHUNK: usize = 500;

pub(crate) fn tags_for(
    conn: &rusqlite::Connection,
    note_ids: &[Uuid],
) -> Result<HashMap<String, Vec<TagRef>>, rusqlite::Error> {
    let mut map: HashMap<String, Vec<TagRef>> = HashMap::new();
    if note_ids.is_empty() {
        return Ok(map);
    }

    for chunk in note_ids.chunks(TAG_LOOKUP_CHUNK) {
        let placeholders = vec!["?"; chunk.len()].join(",");
        let sql = format!(
            "SELECT nt.note_id, t.id, t.name
               FROM note_tags nt
               JOIN tags t ON t.id = nt.tag_id
              WHERE nt.note_id IN ({placeholders})
                AND t.deleted_at IS NULL
              ORDER BY t.name COLLATE NOCASE"
        );
        let mut stmt = conn.prepare_cached(&sql)?;
        let rows = stmt.query_map(rusqlite::params_from_iter(chunk), |row| {
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
    }
    Ok(map)
}

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

pub(crate) fn no_params() {}

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
