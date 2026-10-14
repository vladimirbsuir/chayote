use rusqlite::Connection;

use crate::db::Database;
use crate::error::AppError;

/// Migrations are embedded rather than read from disk, so a shipped build
/// always carries exactly the schema it was compiled against and cannot be
/// pointed at a different file.
const MIGRATIONS: &[(&str, &str)] = &[
    (
        "0001_initial.sql",
        include_str!("../../migrations/0001_initial.sql"),
    ),
    (
        "0002_fts.sql",
        include_str!("../../migrations/0002_fts.sql"),
    ),
    (
        "0003_outbox.sql",
        include_str!("../../migrations/0003_outbox.sql"),
    ),
    (
        "0004_sync.sql",
        include_str!("../../migrations/0004_sync.sql"),
    ),
    (
        "0005_sync_backoff.sql",
        include_str!("../../migrations/0005_sync_backoff.sql"),
    ),
];

/// Applies every migration not yet recorded in `schema_migrations`.
///
/// Forward-only, numbered, each in its own transaction (R8). A device that
/// was offline across a release catches up by replaying the gaps. There is no
/// down migration, by design.
pub fn run(db: &Database) -> Result<(), AppError> {
    ensure_table(db)?;
    let applied = applied_versions(db)?;
    for step in pending(applied) {
        apply_one(db, step.version, step.name, step.sql)?;
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
}

fn pending(applied: Vec<i64>) -> Vec<Pending> {
    MIGRATIONS
        .iter()
        .enumerate()
        .filter_map(|(index, (name, sql))| {
            let version = (index + 1) as i64;
            if applied.contains(&version) {
                None
            } else {
                Some(Pending { version, name, sql })
            }
        })
        .collect()
}

/// Each migration is its own transaction: a failure leaves that version
/// unrecorded and every earlier version committed, so the next launch retries
/// from exactly where it stopped.
fn apply_one(db: &Database, version: i64, name: &str, sql: &str) -> Result<(), AppError> {
    db.with_conn(|conn| apply_in_tx(conn, version, name, sql))
}

fn apply_in_tx(conn: &mut Connection, version: i64, name: &str, sql: &str) -> Result<(), AppError> {
    let tx = conn.transaction()?;
    tx.execute_batch(sql)?;
    tx.execute(
        "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?1, ?2, ?3)",
        rusqlite::params![version, name, crate::clock::now_ms()],
    )?;
    tx.commit()?;
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
