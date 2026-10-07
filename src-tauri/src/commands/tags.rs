use tauri::State;

use crate::error::AppError;
use crate::repo::TagWithCount;

use super::Services;

#[tauri::command]
pub fn tags_list(services: State<'_, Services>) -> Result<Vec<TagWithCount>, AppError> {
    services.tags.list()
}

#[tauri::command]
pub fn tags_create(services: State<'_, Services>, name: String) -> Result<TagWithCount, AppError> {
    services.tags.create(&name)
}

#[tauri::command]
pub fn tags_rename(
    services: State<'_, Services>,
    id: String,
    name: String,
) -> Result<TagWithCount, AppError> {
    services.tags.rename(&id, &name)
}

#[tauri::command]
pub fn tags_delete(services: State<'_, Services>, id: String) -> Result<(), AppError> {
    services.tags.delete(&id)
}
