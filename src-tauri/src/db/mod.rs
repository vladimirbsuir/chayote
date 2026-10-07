use std::path::Path;
use std::sync::Mutex;

use rusqlite::Connection;

use crate::constants::DB_FILENAME;
use crate::error::AppError;

pub mod migrate;

/// The single connection shared by every command.
///
/// `10-conventions.md` §4: `Mutex<Connection>` in Tauri state, no pool.
/// A pool would imply query concurrency this app does not have.
pub struct Database {
    /// Held for diagnostics: `06-platform.md` §2 documents the location, and a
    /// user reporting a problem needs to be told which file to look at.
    #[allow(dead_code)]
    path: Mutex<String>,
    conn: Mutex<Connection>,
}

impl Database {
    /// Opens `chayote.db` in `dir`, applies pragmas, then runs migrations.
    pub fn open(dir: &Path) -> Result<Self, AppError> {
        let path = dir.join(DB_FILENAME);
        let conn = Connection::open(&path)?;
        Self::from_connection(conn, path.to_string_lossy().into_owned())
    }

    /// An isolated database. WAL and the cross-connection cascades do not
    /// apply, so this is for tests and for inspection that must never touch the
    /// user's notes — never for a repository under test.
    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self, AppError> {
        let conn = Connection::open_in_memory()?;
        Self::from_connection(conn, ":memory:".to_owned())
    }

    fn from_connection(conn: Connection, path: String) -> Result<Self, AppError> {
        apply_pragmas(&conn)?;
        let db = Self {
            path: Mutex::new(path),
            conn: Mutex::new(conn),
        };
        migrate::run(&db)?;
        Ok(db)
    }

    /// Where this database lives. Reported to the user, never written to by
    /// anything but `open`.
    #[cfg(test)]
    pub fn path(&self) -> Option<String> {
        self.path.lock().ok().map(|guard| guard.clone())
    }

    /// Locks the connection for the duration of `body`.
    ///
    /// Every caller runs inside a transaction, so the lock covers the whole
    /// unit of work rather than a single statement. A write and its outbox
    /// row commit together or not at all (R5).
    pub fn with_conn<T>(
        &self,
        body: impl FnOnce(&mut Connection) -> Result<T, AppError>,
    ) -> Result<T, AppError> {
        let mut guard = self
            .conn
            .lock()
            .map_err(|_| AppError::Internal("database lock poisoned".into()))?;
        body(&mut guard)
    }
}

/// `03-data-model.md` §2. Applied on every open, before any query.
fn apply_pragmas(conn: &Connection) -> Result<(), AppError> {
    // Readers must not block the autosave writer: search reads while a save
    // commits. `synchronous = NORMAL` is crash-safe against process
    // termination under WAL; only power loss can lose the last commits.
    //
    // `journal_mode` returns the resulting mode rather than setting it, so it
    // goes through `pragma_update_and_check`. WAL is a file-only journal mode;
    // an in-memory database keeps `memory`, which is why the mode is not
    // asserted here and nowhere else.
    let _mode: String =
        conn.pragma_update_and_check(None, "journal_mode", "WAL", |row| row.get(0))?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "busy_timeout", 5000)?;
    conn.pragma_update(None, "temp_store", "MEMORY")?;
    Ok(())
}
