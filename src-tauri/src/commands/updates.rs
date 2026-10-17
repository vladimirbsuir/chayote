use serde::Serialize;
use tauri::AppHandle;

use crate::error::AppError;

/// What the Updates tab needs before it can decide whether to offer a check at
/// all. One call, because the two facts are the same decision: a platform that
/// cannot install (`06-platform.md` §3.8) must not be offered a button whose
/// only possible outcome is a failure.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    /// The version in `tauri.conf.json`, which is what `latest.json` compares
    /// against, so this is the number the tab shows and the number an update
    /// has to beat.
    pub version: String,
    /// A label for the sentence explaining why updating is unavailable.
    ///
    /// Deliberately *not* `tauri_plugin_updater::target()`, which is a manifest
    /// key (`darwin`, not `macos`) and lives in a crate this app does not
    /// compile on Android — where this command is the only one that runs.
    pub os: String,
    /// False on macOS, where §3.7 ships an unsigned `.app` that cannot replace
    /// itself, and on Android, where `install_inner` is `UnsupportedOs` (§3.8.1).
    pub updates_supported: bool,
}

#[tauri::command]
pub fn app_info(app: AppHandle) -> Result<AppInfo, AppError> {
    Ok(AppInfo {
        version: app.package_info().version.to_string(),
        os: os_label(),
        updates_supported: updates_supported(),
    })
}

/// ADR-024: Windows and Linux install an update in place; macOS and Android
/// cannot, for the reasons in `06-platform.md` §3.8. The tab disables its
/// button from this flag rather than letting a check fail visibly.
pub(crate) fn updates_supported() -> bool {
    cfg!(any(target_os = "windows", target_os = "linux"))
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

/// The update a check found, held between `updates_check` and `updates_install`.
/// `Update` owns the URL and signature it was built from, so it cannot be
/// reconstructed from a version string — and holding it is what makes the
/// install verify against the *checked* artifact rather than against whatever
/// the endpoint says a moment later.
#[cfg(desktop)]
#[derive(Default)]
pub struct PendingUpdate(pub std::sync::Mutex<Option<tauri_plugin_updater::Update>>);

#[cfg(desktop)]
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSummary {
    pub version: String,
    /// Release notes, or an empty string. `latest.json` may omit `notes`
    /// entirely, and the tab has no use for a key it cannot render.
    pub notes: String,
    /// RFC 3339, formatted for the reader rather than parsed anywhere.
    pub date: Option<String>,
}

/// Progress for the download, streamed so the tab can show a real bar rather
/// than an indeterminate spinner over a 15 MB transfer.
///
/// A `Channel` rather than polling shared state: the frontend owns the progress
/// display, and this keeps the transfer's start / length / finish events in
/// order without the tab re-reading anything.
#[cfg(desktop)]
#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data")]
pub enum DownloadEvent {
    #[serde(rename = "started", rename_all = "camelCase")]
    Started { content_length: Option<u64> },
    #[serde(rename = "progress", rename_all = "camelCase")]
    Progress { chunk_length: usize },
    #[serde(rename = "finished")]
    Finished,
}

#[cfg(desktop)]
#[tauri::command]
pub async fn updates_check(
    app: AppHandle,
    pending: tauri::State<'_, PendingUpdate>,
) -> Result<Option<UpdateSummary>, AppError> {
    use tauri_plugin_updater::UpdaterExt;

    let update = app
        .updater()
        .map_err(network)?
        .check()
        .await
        .map_err(network)?;
    let summary = update.as_ref().map(|found| UpdateSummary {
        version: found.version.clone(),
        notes: found.body.clone().unwrap_or_default(),
        date: found.date.map(|date| date.to_string()),
    });
    *lock(&pending)? = update;
    Ok(summary)
}

#[cfg(desktop)]
#[tauri::command]
pub async fn updates_install(
    app: AppHandle,
    pending: tauri::State<'_, PendingUpdate>,
    on_event: tauri::ipc::Channel<DownloadEvent>,
) -> Result<(), AppError> {
    let update = lock(&pending)?.take().ok_or_else(|| {
        AppError::Validation("There is no update waiting to be installed.".to_owned())
    })?;
    let started = std::cell::Cell::new(false);
    let progress = on_event.clone();
    update
        .download_and_install(
            move |chunk_length, content_length| {
                if !started.get() {
                    started.set(true);
                    let _ = progress.send(DownloadEvent::Started { content_length });
                }
                let _ = progress.send(DownloadEvent::Progress { chunk_length });
            },
            move || {
                let _ = on_event.send(DownloadEvent::Finished);
            },
        )
        .await
        .map_err(network)?;
    restart_after_install(&app);
    Ok(())
}

/// Linux replaces the AppImage on disk, so the running process is still the old
/// one and the restart is ours to do. Windows exits the process as part of
/// installing and the installer takes over; macOS never reaches this command
/// (`06-platform.md` §3.8).
///
/// A function rather than an `#[cfg]` attribute at the call site, for one reason:
/// `AppHandle::restart` returns `!`, so a `cfg`-gated call leaves the `Ok(())`
/// after it looking unreachable on Linux and clippy rejects the build there.
/// Returning `()` puts the divergence inside a function whose signature says so.
#[cfg(target_os = "linux")]
fn restart_after_install(app: &AppHandle) {
    app.restart();
}

#[cfg(not(target_os = "linux"))]
fn restart_after_install(_app: &AppHandle) {}

#[cfg(desktop)]
fn lock(
    pending: &PendingUpdate,
) -> Result<std::sync::MutexGuard<'_, Option<tauri_plugin_updater::Update>>, AppError> {
    pending
        .0
        .lock()
        .map_err(|err| AppError::internal(format!("updater state poisoned: {err}")))
}

/// Every updater failure is a network failure from the user's point of view: the
/// endpoint was unreachable, the manifest was absent, or the signature did not
/// verify. `NETWORK` is the code that means "try again later"
/// (`10-conventions.md` §6), and the detail goes to `details` and the log rather
/// than into the sentence the user reads.
#[cfg(desktop)]
pub(crate) fn network(err: tauri_plugin_updater::Error) -> AppError {
    AppError::Network(err.to_string())
}
