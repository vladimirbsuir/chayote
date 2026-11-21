use std::sync::Arc;

use rusqlite::types::Value as SqlValue;

use crate::db::Database;
use crate::error::AppError;
use crate::repo::{
    attach, SearchHit, SearchInput, SearchPage, Selection, SummaryRow, SUMMARY_COLUMNS,
};

struct HitRow {
    summary: SummaryRow,
    rank: f64,
    snippet: String,
}

pub struct SearchService {
    db: Arc<Database>,
}

impl SearchService {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    pub fn to_fts_match(input: &str) -> Option<String> {
        const KEYWORDS: &[&str] = &["AND", "OR", "NOT", "NEAR", "NULL", "TRUE", "FALSE"];

        let tokens: Vec<String> = input
            .split_whitespace()
            .filter_map(|token| {
                let cleaned: String = token
                    .chars()
                    .filter(|c| c.is_alphanumeric() || *c == '_')
                    .collect();
                if cleaned.is_empty() {
                    None
                } else if KEYWORDS.contains(&cleaned.to_uppercase().as_str()) {
                    Some(format!("\"{cleaned}\"*"))
                } else {
                    Some(format!("{cleaned}*"))
                }
            })
            .collect();
        if tokens.is_empty() {
            None
        } else {
            Some(tokens.join(" AND "))
        }
    }

    pub fn query(&self, input: &SearchInput) -> Result<SearchPage, AppError> {
        self.db.with_conn(|conn| {
            let selection = &input.filter.selection;
            let limit = input.limit.clamp(0, 500);
            let offset = input.offset.max(0);

            let mut bindings: Vec<SqlValue> = Vec::new();
            let mut scope_clauses: Vec<String> = Vec::new();

            let matches_fts = Self::to_fts_match(&input.query);
            let use_fts = matches_fts.is_some();
            if matches!(selection, Selection::Trash) {
                scope_clauses.push("n.deleted_at IS NOT NULL".to_owned());
            } else {
                scope_clauses.push("n.deleted_at IS NULL".to_owned());
            }

            if let Some(expression) = matches_fts {
                bindings.push(SqlValue::Text(expression));
            }

            let scope_clause: Option<String> = match selection {
                Selection::Pinned => Some("n.is_pinned = 1".to_owned()),
                Selection::Folder { id } => {
                    bindings.push(SqlValue::Text(id.clone()));
                    Some("n.folder_id = ?S".to_owned())
                }
                Selection::Tag { id } => {
                    bindings.push(SqlValue::Text(id.clone()));
                    Some(
                        "EXISTS (SELECT 1 FROM note_tags nt
                                  WHERE nt.note_id = n.id AND nt.tag_id = ?S)"
                            .to_owned(),
                    )
                }
                Selection::All | Selection::Trash => None,
            };
            if let Some(clause) = scope_clause {
                let position = bindings.len();
                scope_clauses.push(clause.replace("?S", &format!("?{position}")));
            }

            let scope = scope_clauses.join(" AND ");
            let count_len = bindings.len();

            if use_fts {
                let limit_position = bindings.len() + 1;
                let offset_position = bindings.len() + 2;
                bindings.push(SqlValue::Integer(limit));
                bindings.push(SqlValue::Integer(offset));

                let sql = format!(
                    "SELECT {SUMMARY_COLUMNS},
                            bm25(notes_fts, 8.0, 1.0) AS rank,
                            snippet(notes_fts, 1, '<mark>', '</mark>', '…', 12) AS snippet
                       FROM notes_fts
                       JOIN notes n ON n.rowid = notes_fts.rowid
                      WHERE notes_fts MATCH ?1 AND {scope}
                   ORDER BY rank
                      LIMIT ?{limit_position} OFFSET ?{offset_position}"
                );
                let count_sql = format!(
                    "SELECT COUNT(*)
                       FROM notes_fts
                       JOIN notes n ON n.rowid = notes_fts.rowid
                      WHERE notes_fts MATCH ?1 AND {scope}"
                );

                let page_bindings = bindings.clone();
                let hits = collect(conn, &sql, &page_bindings)?;

                let mut count_bindings = page_bindings;
                count_bindings.truncate(count_len);
                let total = query_count(conn, &count_sql, &count_bindings)?;

                return finish(conn, hits, total, limit, offset);
            }

            let limit_position = bindings.len() + 1;
            let offset_position = bindings.len() + 2;
            bindings.push(SqlValue::Integer(limit));
            bindings.push(SqlValue::Integer(offset));

            let sql = format!(
                "SELECT {SUMMARY_COLUMNS}, 0.0 AS rank, n.excerpt AS snippet
                   FROM notes n
                  WHERE {scope}
               ORDER BY {}
                  LIMIT ?{limit_position} OFFSET ?{offset_position}",
                order_sql(selection)
            );
            let count_sql = format!("SELECT COUNT(*) FROM notes n WHERE {scope}");

            let page_bindings = bindings.clone();
            let hits = collect(conn, &sql, &page_bindings)?;

            let mut count_bindings = page_bindings;
            count_bindings.truncate(count_len);
            let total = query_count(conn, &count_sql, &count_bindings)?;

            finish(conn, hits, total, limit, offset)
        })
    }
}

fn collect(
    conn: &rusqlite::Connection,
    sql: &str,
    bindings: &[SqlValue],
) -> Result<Vec<HitRow>, AppError> {
    let params = as_params(bindings);
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params.as_slice(), read_hit)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

fn query_count(
    conn: &rusqlite::Connection,
    sql: &str,
    bindings: &[SqlValue],
) -> Result<i64, AppError> {
    let params = as_params(bindings);
    Ok(conn.query_row(sql, params.as_slice(), |row| row.get(0))?)
}

fn as_params(values: &[SqlValue]) -> Vec<&dyn rusqlite::ToSql> {
    values
        .iter()
        .map(|value| value as &dyn rusqlite::ToSql)
        .collect()
}

fn read_hit(row: &rusqlite::Row<'_>) -> rusqlite::Result<HitRow> {
    Ok(HitRow {
        summary: SummaryRow::read(row)?,
        rank: row.get(7)?,
        snippet: row.get(8)?,
    })
}

fn finish(
    conn: &rusqlite::Connection,
    rows: Vec<HitRow>,
    total: i64,
    limit: i64,
    offset: i64,
) -> Result<SearchPage, AppError> {
    let summaries: Vec<SummaryRow> = rows.iter().map(|hit| hit.summary.clone()).collect();
    let resolved = attach(conn, &summaries)?;

    let hits: Vec<SearchHit> = rows
        .iter()
        .zip(resolved.iter())
        .map(|(hit, summary)| SearchHit {
            summary: summary.clone(),
            rank: hit.rank,
            snippet: hit.snippet.clone(),
        })
        .collect();

    let next_offset = (offset + limit < total).then_some(offset + limit);
    Ok(SearchPage {
        hits,
        total,
        next_offset,
    })
}

fn order_sql(selection: &Selection) -> &'static str {
    if matches!(selection, Selection::Trash) {
        "n.deleted_at DESC"
    } else {
        "n.is_pinned DESC, n.updated_at DESC"
    }
}
