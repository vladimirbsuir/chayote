use tauri::State;

use crate::error::AppError;
use crate::sync::{SyncConflict, SyncStatus, SyncSummary};

use super::Services;

#[tauri::command]
pub fn sync_get_status(services: State<'_, Services>) -> Result<SyncStatus, AppError> {
    services.sync.status()
}

#[tauri::command]
pub fn sync_set_config(
    services: State<'_, Services>,
    connection_string: String,
    enabled: bool,
) -> Result<(), AppError> {
    services.sync.set_config(&connection_string, enabled)
}

#[tauri::command]
pub async fn sync_now(
    services: State<'_, Services>,
    open_note_id: Option<String>,
) -> Result<SyncSummary, AppError> {
    services.sync.run_cycle(open_note_id.as_deref()).await
}

#[tauri::command]
pub fn sync_reupload(services: State<'_, Services>) -> Result<i64, AppError> {
    services.sync.reupload_all()
}

#[tauri::command]
pub fn sync_list_conflicts(services: State<'_, Services>) -> Result<Vec<SyncConflict>, AppError> {
    services.sync.list_conflicts()
}

#[tauri::command]
pub async fn sync_resolve_conflict(
    services: State<'_, Services>,
    id: String,
    keep_local: bool,
) -> Result<(), AppError> {
    services.sync.resolve_conflict(&id, keep_local).await
}
