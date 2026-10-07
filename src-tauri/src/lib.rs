mod clock;
mod commands;
mod constants;
mod db;
mod doc;
mod error;
mod repo;
mod services;

#[cfg(test)]
mod tests;

use std::sync::Arc;

use tauri::Manager;

use commands::Services;

/// Settings live in the Tauri store, never in the notes database, so resetting
/// or syncing settings can never touch notes (`05-ui-ux.md` §6.6).
const SETTINGS_FILE: &str = "settings.json";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let built = tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(commands::handler())
        .setup(|app| {
            // Tauri's app data directory is not created for us, and on a first
            // launch it does not exist at all. Opening the database must not be
            // the thing that creates it, or the error is opaque.
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir).map_err(|err| {
                error::AppError::internal(format!(
                    "could not create {}: {err}",
                    dir.display()
                ))
            })?;
            let db = Arc::new(db::Database::open(&dir)?);
            app.manage(Services::new(db));
            Ok(())
        })
        .build(tauri::generate_context!());

    match built {
        Ok(app) => app.run(|_handle, _event| {}),
        Err(err) => {
            eprintln!("chayote: build failed: {err}");
            std::process::exit(1);
        }
    }
}

/// Present so the settings filename has one home. Read from
/// `@tauri-apps/plugin-store` on the frontend side.
#[allow(dead_code)]
pub fn settings_filename() -> &'static str {
    SETTINGS_FILE
}
