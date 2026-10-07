use tauri::State;

use crate::error::AppError;
use crate::repo::FolderNode;

use super::Services;

#[tauri::command]
pub fn folders_list(services: State<'_, Services>) -> Result<Vec<FolderNode>, AppError> {
    services.folders.list()
}

#[tauri::command]
pub fn folders_create(
    services: State<'_, Services>,
    name: String,
    parent_id: Option<String>,
) -> Result<FolderNode, AppError> {
    services.folders.create(&name, parent_id.as_deref())
}

#[tauri::command]
pub fn folders_rename(
    services: State<'_, Services>,
    id: String,
    name: String,
) -> Result<FolderNode, AppError> {
    services.folders.rename(&id, &name)
}

#[tauri::command]
pub fn folders_move(
    services: State<'_, Services>,
    id: String,
    new_parent_id: Option<String>,
    position: i64,
) -> Result<FolderNode, AppError> {
    services
        .folders
        .move_to(&id, new_parent_id.as_deref(), position)
}

#[tauri::command]
pub fn folders_delete(services: State<'_, Services>, id: String) -> Result<(), AppError> {
    services.folders.delete(&id)
}
