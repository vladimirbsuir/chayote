use serde::Serialize;
use tauri::ipc::Channel;
#[cfg(target_os = "android")]
use tauri::Manager;
use tauri::{AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::error::AppError;

/// The update a check found, held between `updates_check` and `updates_install`.
/// `Update` owns the URL and signature it was built from, so it cannot be
/// reconstructed from a version string — and holding it is what makes the
/// install verify against the *checked* artifact rather than against whatever
/// the endpoint says a moment later.
///
/// **An install reads it, never consumes it.** It used to be `take()`n on the
/// first press, so every outcome short of the process being replaced — Android
/// asking for its install grant, a dropped connection, a cancelled confirmation
/// — left the next press with nothing to install, and the tab printed "There is
/// no update waiting to be installed" under a button offering exactly that.
/// Only a new check replaces it.
#[derive(Default)]
pub struct PendingUpdate(std::sync::Mutex<Pending>);

#[derive(Default)]
struct Pending {
    update: Option<Update>,
    /// Android: the package `update` was downloaded to, already verified. The
    /// grant round trip (ADR-025) is the usual second press, and it should
    /// install these bytes rather than fetch 20 MB again. Held in memory only,
    /// so a restarted process downloads afresh rather than trusting a file it
    /// did not verify itself.
    #[cfg(target_os = "android")]
    apk: Option<std::path::PathBuf>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSummary {
    pub version: String,
    /// RFC 3339, formatted for the reader rather than parsed anywhere.
    pub date: Option<String>,
}

/// Progress for the download, streamed so the tab can show a real bar rather
/// than an indeterminate spinner over a 15 MB transfer.
///
/// A `Channel` rather than polling shared state: the frontend owns the progress
/// display, and this keeps the transfer's start / length / finish events in
/// order without the tab re-reading anything.
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
    /* A verified package is kept only while it is still the version on offer. */
    #[cfg(target_os = "android")]
    if version_of(&state.update) != version_of(&update) {
        state.apk = None;
    }
    state.update = update;
    Ok(summary)
}

/// Download, verify, and install.
///
/// The download and the verification are the plugin's on every platform
/// (ADR-024, ADR-025): `download()` checks the minisign signature and the signed
/// version before returning a byte. Only the last step differs, and only because
/// `install_inner` is `UnsupportedOs` under `cfg(mobile)`.
///
/// Two definitions rather than one with a `cfg` block inside, because the two
/// tails are genuinely different and a block expression would leave whichever
/// platform did not need a line looking like dead code.
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

/// ADR-025. Same download and same verification as desktop; the install is ours.
///
/// A second press — after the grant screen, or after a dismissed confirmation —
/// reuses the package the first one verified, and reports it to the tab as one
/// finished transfer so the progress line does not sit at "0 B".
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
            /* A check that ran during the download may have moved on to a
            different version; then these bytes are not the ones on offer. */
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

/// The updater, with the manifest key this platform must ask for.
///
/// Android is the reason this exists. `tauri-plugin-updater` has no Android
/// target of its own — `target()` returns `None` — because it has no Android
/// install. Its download path works regardless, and the manifest can carry an
/// `android-aarch64` key that `target()` names explicitly (ADR-025). The spelling
/// matches the plugin's own so the two manifests read alike: `aarch64` and
/// `armv7`, not `arm64`.
fn updater(app: &AppHandle) -> Result<tauri_plugin_updater::Updater, AppError> {
    #[cfg_attr(not(target_os = "android"), allow(unused_mut))]
    let builder = app.updater_builder();
    #[cfg(target_os = "android")]
    let builder = builder.target(android_target());
    builder.build().map_err(network)
}

/// An x86 emulator has no shipped artifact, so its key is absent from the
/// manifest and the check fails visibly rather than silently offering nothing.
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

/// Windows exits the process as part of installing and the installer takes over.
/// Linux replaces the AppImage but keeps the old process running, so the restart
/// is ours to do. macOS never reaches this — `app_info` reports no support
/// there (`06-platform.md` §3.8).
///
/// A function rather than a `cfg` attribute at the call site, and returning `()`
/// on every platform including Linux.
///
/// `AppHandle::restart` returns `!`, so a `cfg`-gated call at the call site
/// leaves the `Ok(())` after it unreachable *on Linux only* — which passes clippy
/// on a Windows machine and fails the Linux CI job. Declaring the return type
/// `()` here moves the divergence inside the body, where `app.restart();` is a
/// statement whose `!` coerces to `()`, and the caller's `Ok(())` is reachable
/// again on both.
#[cfg(all(desktop, target_os = "linux"))]
fn restart_after_install(app: &AppHandle) {
    app.restart();
}

#[cfg(all(desktop, not(target_os = "linux")))]
fn restart_after_install(_app: &AppHandle) {}

/// ADR-025: the Android install.
///
/// The plugin's `install_inner` cannot write the package anywhere Android will
/// accept, so this hands the verified bytes to a Kotlin plugin registered in
/// `setup` (`crate::register_android_installer`). Everything security-relevant
/// has already happened by the time this runs: the bytes came from the
/// configured endpoint and their signature verified in `download`.
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
        /* The session is committed and Android takes it from here, silently or
        behind its own confirmation screen. `commit` is asynchronous — it
        returns before the package is replaced — so this reply is the normal
        one. It used to be an error, which flashed a failure under every update
        that was in fact on its way, and stayed there if the reader dismissed
        Android's confirmation. */
        "committed" => Ok(()),
        /* `REQUEST_INSTALL_PACKAGES` is not granted. Not an error the user
        caused and not a failure of the update: the tab says what to do, and
        the next press retries the same verified bytes. */
        "needs-permission" => Err(AppError::UpdatePermissionRequired),
        other => Err(AppError::internal(format!("installer reported {other}"))),
    }
}

/// The APK goes in the cache directory, which is where the session reads it
/// from. `PackageInstaller.openWrite` streams it in, so — unlike the
/// `ACTION_INSTALL_PACKAGE` route — no `FileProvider` grant is needed and no
/// other app can read the file.
///
/// The version is in the name so a stale file from an earlier attempt cannot be
/// mistaken for this one, and so two attempts do not collide. Written beside its
/// final name and renamed, so a process killed mid-write never leaves a
/// truncated package under a name that looks complete.
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

/// Deletes the packages an earlier process downloaded. Run at startup, when none
/// can be in use: the verified path lives in memory only, so a file that outlived
/// its process is either the update now installed or one that was abandoned —
/// about 20 MB each, and nothing else ever removed them.
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

/// The update the last check found — cloned, so a failed install can be retried.
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

/// Every updater failure is a network failure from the user's point of view: the
/// endpoint was unreachable, the manifest was absent, or the signature did not
/// verify. `NETWORK` is the code that means "try again later"
/// (`10-conventions.md` §6), and the detail goes to `details` and the log rather
/// than into the sentence the user reads.
pub(crate) fn network(err: tauri_plugin_updater::Error) -> AppError {
    AppError::Network(err.to_string())
}
