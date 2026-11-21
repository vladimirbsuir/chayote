use serde::Serialize;
use tauri::ipc::Channel;
#[cfg(target_os = "android")]
use tauri::Manager;
use tauri::{AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::error::AppError;

#[derive(Default)]
pub struct PendingUpdate(std::sync::Mutex<Pending>);

#[derive(Default)]
struct Pending {
    update: Option<Update>,
    #[cfg(target_os = "android")]
    apk: Option<std::path::PathBuf>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSummary {
    pub version: String,
    pub date: Option<String>,
}

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

#[tauri::command]
pub async fn updates_check(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
) -> Result<Option<UpdateSummary>, AppError> {
    let update = updater(&app)?.check().await.map_err(network)?;
    let summary = update.as_ref().map(|found| UpdateSummary {
        version: found.version.clone(),
        date: found.date.map(|date| date.to_string()),
    });
    let mut state = lock(&pending)?;
    #[cfg(target_os = "android")]
    if version_of(&state.update) != version_of(&update) {
        state.apk = None;
    }
    state.update = update;
    Ok(summary)
}

#[cfg(desktop)]
#[tauri::command]
pub async fn updates_install(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
    on_event: Channel<DownloadEvent>,
) -> Result<(), AppError> {
    let update = current(&pending)?;
    let bytes = download(&update, &on_event).await?;
    update.install(&bytes).map_err(network)?;
    restart_after_install(&app);
    Ok(())
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn updates_install(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
    on_event: Channel<DownloadEvent>,
) -> Result<(), AppError> {
    let update = current(&pending)?;
    let verified = lock(&pending)?.apk.clone().filter(|path| path.is_file());
    let path = match verified {
        Some(path) => {
            let size = std::fs::metadata(&path).map(|meta| meta.len()).ok();
            let _ = on_event.send(DownloadEvent::Started {
                content_length: size,
            });
            let _ = on_event.send(DownloadEvent::Progress {
                chunk_length: size.and_then(|len| usize::try_from(len).ok()).unwrap_or(0),
            });
            let _ = on_event.send(DownloadEvent::Finished);
            path
        }
        None => {
            let bytes = download(&update, &on_event).await?;
            let path = write_apk(&app, &update, &bytes)?;
            let mut state = lock(&pending)?;
            if version_of(&state.update) == Some(&update.version) {
                state.apk = Some(path.clone());
            }
            path
        }
    };
    install_on_android(&app, &path).await
}

#[cfg(target_os = "android")]
fn version_of(update: &Option<Update>) -> Option<&String> {
    update.as_ref().map(|held| &held.version)
}

async fn download(update: &Update, on_event: &Channel<DownloadEvent>) -> Result<Vec<u8>, AppError> {
    let started = std::cell::Cell::new(false);
    let progress = on_event.clone();
    update
        .download(
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
        .map_err(network)
}

fn updater(app: &AppHandle) -> Result<tauri_plugin_updater::Updater, AppError> {
    #[cfg_attr(not(target_os = "android"), allow(unused_mut))]
    let builder = app.updater_builder();
    #[cfg(target_os = "android")]
    let builder = builder.target(android_target());
    builder.build().map_err(network)
}

#[cfg(target_os = "android")]
fn android_target() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "android-aarch64"
    } else if cfg!(target_arch = "arm") {
        "android-armv7"
    } else {
        "android-x86_64"
    }
}

#[cfg(all(desktop, target_os = "linux"))]
fn restart_after_install(app: &AppHandle) {
    app.restart();
}

#[cfg(all(desktop, not(target_os = "linux")))]
fn restart_after_install(_app: &AppHandle) {}

#[cfg(target_os = "android")]
pub struct Installer(pub tauri::plugin::PluginHandle<tauri::Wry>);

#[cfg(target_os = "android")]
async fn install_on_android(app: &AppHandle, path: &std::path::Path) -> Result<(), AppError> {
    #[derive(Serialize)]
    struct InstallArgs {
        path: String,
    }

    #[derive(Debug, serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct InstallOutcome {
        status: String,
    }

    let outcome: InstallOutcome = app
        .state::<Installer>()
        .0
        .run_mobile_plugin_async(
            "install",
            InstallArgs {
                path: path.to_string_lossy().into_owned(),
            },
        )
        .await
        .map_err(AppError::from_detail)?;

    match outcome.status.as_str() {
        "committed" => Ok(()),
        "needs-permission" => Err(AppError::UpdatePermissionRequired),
        other => Err(AppError::internal(format!("installer reported {other}"))),
    }
}

#[cfg(target_os = "android")]
fn write_apk(
    app: &AppHandle,
    update: &Update,
    bytes: &[u8],
) -> Result<std::path::PathBuf, AppError> {
    let dir = package_dir(app)?;
    std::fs::create_dir_all(&dir).map_err(AppError::from_detail)?;
    let path = dir.join(format!("{PACKAGE_PREFIX}{}.apk", update.version));
    let partial = path.with_extension("apk.part");
    std::fs::write(&partial, bytes).map_err(AppError::from_detail)?;
    std::fs::rename(&partial, &path).map_err(AppError::from_detail)?;
    Ok(path)
}

#[cfg(target_os = "android")]
const PACKAGE_PREFIX: &str = "chayote-";

#[cfg(target_os = "android")]
fn package_dir(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    app.path()
        .app_cache_dir()
        .map_err(|err| AppError::internal(format!("no cache directory: {err}")))
}

#[cfg(target_os = "android")]
pub fn clear_stale_packages(app: &AppHandle) {
    let Ok(dir) = package_dir(app) else { return };
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with(PACKAGE_PREFIX)
            && (name.ends_with(".apk") || name.ends_with(".apk.part"))
        {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

fn current(pending: &PendingUpdate) -> Result<Update, AppError> {
    lock(pending)?.update.clone().ok_or_else(|| {
        AppError::Validation(
            "The update is no longer on offer. Check for updates again.".to_owned(),
        )
    })
}

fn lock(pending: &PendingUpdate) -> Result<std::sync::MutexGuard<'_, Pending>, AppError> {
    pending
        .0
        .lock()
        .map_err(|err| AppError::internal(format!("updater state poisoned: {err}")))
}

pub(crate) fn network(err: tauri_plugin_updater::Error) -> AppError {
    AppError::Network(err.to_string())
}
