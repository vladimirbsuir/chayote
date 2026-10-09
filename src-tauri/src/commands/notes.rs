use tauri::State;

use crate::error::AppError;
use crate::repo::{Note, NoteFilter, NoteSummary, SaveNoteInput};

use super::Services;

/// Managed state reaches a command only through a type it can prove is
/// `Send + Sync + 'static`. Every repository is `Send + Sync` by trait bound,
/// and `Database` is `Mutex<Connection>`, so `Services` is too.

#[tauri::command]
pub fn notes_list(
    services: State<'_, Services>,
    filter: NoteFilter,
) -> Result<Vec<NoteSummary>, AppError> {
    services.notes.list(&filter)
}

#[tauri::command]
pub fn notes_get(services: State<'_, Services>, id: String) -> Result<Note, AppError> {
    services.notes.get(&id)
}

#[tauri::command]
pub fn notes_create(
    services: State<'_, Services>,
    folder_id: Option<String>,
) -> Result<Note, AppError> {
    services.notes.create(folder_id.as_deref())
}

#[tauri::command]
pub fn notes_save(services: State<'_, Services>, input: SaveNoteInput) -> Result<Note, AppError> {
    services.notes.save(&input)
}

#[tauri::command]
pub fn notes_move(
    services: State<'_, Services>,
    id: String,
    folder_id: Option<String>,
) -> Result<Note, AppError> {
    services.notes.move_to(&id, folder_id.as_deref())
}

#[tauri::command]
pub fn notes_set_pinned(
    services: State<'_, Services>,
    id: String,
    is_pinned: bool,
) -> Result<Note, AppError> {
    services.notes.set_pinned(&id, is_pinned)
}

#[tauri::command]
pub fn notes_soft_delete(services: State<'_, Services>, id: String) -> Result<(), AppError> {
    services.notes.soft_delete(&id)
}

#[tauri::command]
pub fn notes_restore(services: State<'_, Services>, id: String) -> Result<(), AppError> {
    services.notes.restore(&id)
}

#[tauri::command]
pub fn notes_destroy(services: State<'_, Services>, id: String) -> Result<(), AppError> {
    services.notes.destroy(&id)
}

#[tauri::command]
pub fn notes_empty_trash(services: State<'_, Services>) -> Result<i64, AppError> {
    services.notes.empty_trash()
}
