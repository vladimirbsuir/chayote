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
        app_info,
        /* The updater plugin is compiled for Android too (ADR-025), so these two
        exist there and only iOS lacks them. `app_info` is everywhere, which
        is how a platform that cannot update learns so before the UI offers
        a button that could only fail. */
        #[cfg(any(desktop, target_os = "android"))]
        crate::commands::updates::updates_check,
        #[cfg(any(desktop, target_os = "android"))]
        crate::commands::updates::updates_install,
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

/// The version and platform facts the Updates tab needs before it can decide
/// whether to offer a check at all.
///
/// Here rather than in `commands/updates.rs` because it is the one updater
/// command that must exist on a platform with no updater: it is how that
/// platform learns it cannot update, and the tab's disabled button and its
/// reason both come from this reply.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    /// The version in `tauri.conf.json`, which is what `latest.json` compares
    /// against, so this is the number the tab shows and the number an update
    /// has to beat. Android's `versionCode` is derived from it as
    /// `major * 1e6 + minor * 1e3 + patch` (§4.1).
    pub version: String,
    /// A label for the sentence explaining why updating is unavailable.
    pub os: String,
    /// False on macOS only. Android updates itself as of ADR-025; iOS never
    /// reaches this command.
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

/// ADR-024, ADR-025. `cfg(mobile)` rather than `cfg(desktop)` because Android
/// can install after all: the plugin's own `install_inner` cannot, and
/// `commands/updates.rs` replaces it with a Kotlin plugin. iOS is the only
/// platform left out, and it has no updater of any kind.
#[cfg(any(desktop, target_os = "android"))]
pub mod updates;

/// Separated from `app_info` so the assertion about it is one line rather than a
/// second copy of the same `cfg!` — which would pass if both were edited together
/// and say nothing about the platform.
pub(crate) fn updates_supported() -> bool {
    cfg!(any(
        target_os = "windows",
        target_os = "linux",
        target_os = "android"
    ))
}
