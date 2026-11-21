use std::sync::Arc;

use tauri::Manager;

use crate::db::Database;
use crate::error::AppError;
use crate::repo::{FoldersRepo, NotesRepo, TagsRepo};

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
        app_info,
        #[cfg(any(desktop, target_os = "android"))]
        crate::commands::updates::updates_check,
        #[cfg(any(desktop, target_os = "android"))]
        crate::commands::updates::updates_install,
    ]
}

#[tauri::command]
pub fn window_ready(app: tauri::AppHandle) -> Result<(), AppError> {
    let Some(window) = app.get_webview_window(WINDOW_LABEL) else {
        return Err(AppError::internal(format!(
            "window {WINDOW_LABEL} not found"
        )));
    };
    window.show().map_err(AppError::internal)
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub os: String,
    pub updates_supported: bool,
}

#[tauri::command]
pub fn app_info(app: tauri::AppHandle) -> Result<AppInfo, AppError> {
    Ok(AppInfo {
        version: app.package_info().version.to_string(),
        os: os_label(),
        updates_supported: updates_supported(),
    })
}

pub(crate) fn os_label() -> String {
    let label = if cfg!(target_os = "windows") {
        "Windows"
    } else if cfg!(target_os = "macos") {
        "macOS"
    } else if cfg!(target_os = "linux") {
        "Linux"
    } else if cfg!(target_os = "android") {
        "Android"
    } else if cfg!(target_os = "ios") {
        "iOS"
    } else {
        "Unknown"
    };
    label.to_owned()
}

pub mod folders;
pub mod notes;
pub mod search;
pub mod sync;
pub mod tags;

#[cfg(any(desktop, target_os = "android"))]
pub mod updates;

pub(crate) fn updates_supported() -> bool {
    cfg!(any(
        target_os = "windows",
        target_os = "linux",
        target_os = "android"
    ))
}
