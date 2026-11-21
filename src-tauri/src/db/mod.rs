use std::path::Path;
use std::sync::Mutex;

use rusqlite::Connection;

use crate::constants::DB_FILENAME;
use crate::error::AppError;

pub mod migrate;

pub struct Database {
    #[allow(dead_code)]
    path: Mutex<String>,
    conn: Mutex<Connection>,
}

impl Database {
    pub fn open(dir: &Path) -> Result<Self, AppError> {
        let path = dir.join(DB_FILENAME);
        let conn = Connection::open(&path)?;
        Self::from_connection(conn, path.to_string_lossy().into_owned())
    }

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

    #[cfg(test)]
    pub fn path(&self) -> Option<String> {
        self.path.lock().ok().map(|guard| guard.clone())
    }

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

fn apply_pragmas(conn: &Connection) -> Result<(), AppError> {
    let _mode: String =
        conn.pragma_update_and_check(None, "journal_mode", "WAL", |row| row.get(0))?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "busy_timeout", 5000)?;
    conn.pragma_update(None, "temp_store", "MEMORY")?;
    Ok(())
}
