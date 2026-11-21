use rusqlite::Connection;
use serde_json::Value;

use crate::db::Database;
use crate::error::AppError;
use crate::services::derive;

type DataPass = fn(&rusqlite::Transaction<'_>) -> Result<(), AppError>;

struct Migration {
    name: &'static str,
    sql: &'static str,
    data: Option<DataPass>,
}

const MIGRATIONS: &[Migration] = &[
    Migration {
        name: "0001_initial.sql",
        sql: include_str!("../../migrations/0001_initial.sql"),
        data: None,
    },
    Migration {
        name: "0002_fts.sql",
        sql: include_str!("../../migrations/0002_fts.sql"),
        data: None,
    },
    Migration {
        name: "0003_outbox.sql",
        sql: include_str!("../../migrations/0003_outbox.sql"),
        data: None,
    },
    Migration {
        name: "0004_sync.sql",
        sql: include_str!("../../migrations/0004_sync.sql"),
        data: None,
    },
    Migration {
        name: "0005_sync_backoff.sql",
        sql: include_str!("../../migrations/0005_sync_backoff.sql"),
        data: None,
    },
    Migration {
        name: "0006_note_title_field.sql",
        sql: include_str!("../../migrations/0006_note_title_field.sql"),
        data: Some(lift_leading_heading_into_title),
    },
    Migration {
        name: "0007_tags_live_unique.sql",
        sql: include_str!("../../migrations/0007_tags_live_unique.sql"),
        data: None,
    },
    Migration {
        name: "0008_fts_update_columns.sql",
        sql: include_str!("../../migrations/0008_fts_update_columns.sql"),
        data: None,
    },
];

pub fn run(db: &Database) -> Result<(), AppError> {
    ensure_table(db)?;
    let applied = applied_versions(db)?;
    for step in pending(applied) {
        apply_one(db, step.version, &step)?;
    }
    Ok(())
}

fn ensure_table(db: &Database) -> Result<(), AppError> {
    db.with_conn(|conn| {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
               version    INTEGER PRIMARY KEY NOT NULL,
               name       TEXT    NOT NULL,
               applied_at INTEGER NOT NULL
             );",
        )?;
        Ok(())
    })
}

fn applied_versions(db: &Database) -> Result<Vec<i64>, AppError> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare("SELECT version FROM schema_migrations")?;
        let rows = stmt.query_map([], |row| row.get::<_, i64>(0))?;
        let mut versions = Vec::new();
        for row in rows {
            versions.push(row?);
        }
        Ok(versions)
    })
}

struct Pending {
    version: i64,
    name: &'static str,
    sql: &'static str,
    data: Option<DataPass>,
}

fn pending(applied: Vec<i64>) -> Vec<Pending> {
    MIGRATIONS
        .iter()
        .enumerate()
        .filter_map(|(index, migration)| {
            let version = (index + 1) as i64;
            if applied.contains(&version) {
                None
            } else {
                Some(Pending {
                    version,
                    name: migration.name,
                    sql: migration.sql,
                    data: migration.data,
                })
            }
        })
        .collect()
}

fn apply_one(db: &Database, version: i64, step: &Pending) -> Result<(), AppError> {
    db.with_conn(|conn| apply_in_tx(conn, version, step))
}

fn apply_in_tx(conn: &mut Connection, version: i64, step: &Pending) -> Result<(), AppError> {
    let tx = conn.transaction()?;
    tx.execute_batch(step.sql)?;
    if let Some(data) = step.data {
        data(&tx)?;
    }
    tx.execute(
        "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?1, ?2, ?3)",
        rusqlite::params![version, step.name, crate::clock::now_ms()],
    )?;
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
pub use lift_leading_heading_into_title as lift_leading_heading_into_title_for_tests;

pub fn lift_leading_heading_into_title(tx: &rusqlite::Transaction<'_>) -> Result<(), AppError> {
    let candidates: Vec<(String, String, String, i64)> = {
        let mut stmt = tx.prepare(
            "SELECT id, doc_json, title_source, rev FROM notes
              WHERE json_extract(doc_json, '$.content[0].type') = 'heading'",
        )?;
        let rows = stmt.query_map((), |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };

    for (id, doc_json, title_source, rev) in candidates {
        if title_source == "manual" {
            continue;
        }
        let mut doc: Value = serde_json::from_str(&doc_json).map_err(|err| {
            AppError::internal(format!("stored document is not valid JSON: {err}"))
        })?;

        let Some(heading) = derive::leading_heading_text(&doc) else {
            continue;
        };
        let title = derive::truncate_title(&heading);
        if title.is_empty() {
            continue;
        }

        {
            let content = doc
                .get_mut("content")
                .and_then(Value::as_array_mut)
                .ok_or_else(|| AppError::internal("stored document has no content array"))?;
            content.remove(0);
            if content.is_empty() {
                content.push(serde_json::json!({ "type": "paragraph" }));
            }
        }

        let derived = derive::derive(&doc);
        let stripped = serde_json::to_string(&doc).map_err(AppError::internal)?;

        tx.execute(
            "UPDATE notes
                SET title = ?2, title_source = 'manual', doc_json = ?3, plain_text = ?4,
                    excerpt = ?5, word_count = ?6, dirty = 1
              WHERE id = ?1",
            rusqlite::params![
                id,
                title,
                stripped,
                derived.plain_text,
                derived.excerpt,
                derived.word_count,
            ],
        )?;
        crate::repo::append_outbox(tx, "note", &id, "upsert", None, rev)?;
    }
    Ok(())
}

#[cfg(test)]
pub fn applied_all(db: &Database) -> Result<Vec<(i64, String)>, AppError> {
    db.with_conn(|conn| {
        let mut stmt =
            conn.prepare("SELECT version, name FROM schema_migrations ORDER BY version")?;
        let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    })
}
