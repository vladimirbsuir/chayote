use std::sync::Arc;

use tauri::Manager;

use crate::db::Database;
use crate::error::AppError;
use crate::repo::{FoldersRepo, NotesRepo, TagsRepo};

/// The command surface: validation, error mapping, no business logic
/// (`02-architecture.md` §3). Everything below delegates to a repository.
pub struct Services {
    pub notes: Arc<dyn NotesRepo>,
    pub folders: Arc<dyn FoldersRepo>,
    pub tags: Arc<dyn TagsRepo>,
    pub search: Arc<crate::services::search::SearchService>,
    pub sync: Arc<crate::sync::SyncService>,
}

impl Services {
    pub fn new(db: Arc<Database>) -> Self {
        let notes = Arc::new(crate::repo::notes::SqliteNotesRepo::new(Arc::clone(&db)));
        let folders = Arc::new(crate::repo::folders::SqliteFoldersRepo::new(Arc::clone(
            &db,
        )));
        let tags = Arc::new(crate::repo::tags::SqliteTagsRepo::new(Arc::clone(&db)));
        let search = Arc::new(crate::services::search::SearchService::new(Arc::clone(&db)));
        let sync = Arc::new(crate::sync::SyncService::new(db));
        Self {
            notes,
            folders,
            tags,
            search,
            sync,
        }
    }
}

pub const WINDOW_LABEL: &str = "main";

/// Every command returns `Result<T, AppError>` (R7). The names below are the
/// complete v1 surface and match `02-architecture.md` §7 exactly.
pub fn handler() -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        window_ready,
        crate::commands::notes::notes_list,
        crate::commands::notes::notes_get,
        crate::commands::notes::notes_create,
        crate::commands::notes::notes_save,
        crate::commands::notes::notes_move,
        crate::commands::notes::notes_set_pinned,
        crate::commands::notes::notes_set_title,
        crate::commands::notes::notes_soft_delete,
        crate::commands::notes::notes_restore,
        crate::commands::notes::notes_destroy,
        crate::commands::notes::notes_empty_trash,
        crate::commands::folders::folders_list,
        crate::commands::folders::folders_create,
        crate::commands::folders::folders_rename,
        crate::commands::folders::folders_move,
        crate::commands::folders::folders_delete,
        crate::commands::tags::tags_list,
        crate::commands::tags::tags_create,
        crate::commands::tags::tags_rename,
        crate::commands::tags::tags_delete,
        crate::commands::search::search_query,
        crate::commands::sync::sync_get_status,
        crate::commands::sync::sync_set_config,
        crate::commands::sync::sync_now,
        crate::commands::sync::sync_reupload,
        crate::commands::sync::sync_list_conflicts,
        crate::commands::sync::sync_resolve_conflict,
    ]
}

/// Shown after the frontend's first paint, so the window never opens white.
/// `06-platform.md` §1: the window is created hidden.
#[tauri::command]
pub fn window_ready(app: tauri::AppHandle) -> Result<(), AppError> {
    let Some(window) = app.get_webview_window(WINDOW_LABEL) else {
        return Err(AppError::internal(format!(
            "window {WINDOW_LABEL} not found"
        )));
    };
    window.show().map_err(AppError::internal)
}

pub mod folders;
pub mod notes;
pub mod search;
pub mod sync;
pub mod tags;
