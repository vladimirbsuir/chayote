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
#[derive(Default)]
pub struct PendingUpdate(pub std::sync::Mutex<Option<Update>>);

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
        notes: found.body.clone().unwrap_or_default(),
        date: found.date.map(|date| date.to_string()),
    });
    *lock(&pending)? = update;
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
    let update = take(&pending)?;
    let bytes = download(&update, &on_event).await?;
    update.install(&bytes).map_err(network)?;
    restart_after_install(&app);
    Ok(())
}

/// ADR-025. Same download and same verification as desktop; the install is ours.
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn updates_install(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
    on_event: Channel<DownloadEvent>,
) -> Result<(), AppError> {
    let update = take(&pending)?;
    let bytes = download(&update, &on_event).await?;
    install_on_android(&app, &update, &bytes).await
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
async fn install_on_android(
    app: &AppHandle,
    update: &Update,
    bytes: &[u8],
) -> Result<(), AppError> {
    #[derive(Serialize)]
    struct InstallArgs {
        path: String,
    }

    #[derive(Debug, serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct InstallOutcome {
        status: String,
    }

    let path = write_apk(app, update, bytes)?;
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
        /* The session is committed and Android replaces the app from here. A
        reply at all means this process outlived it, which is not what a
        successful update does. */
        "committed" => Err(AppError::internal(
            "the installer committed without the app being replaced",
        )),
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
/// mistaken for this one, and so two attempts do not collide.
#[cfg(target_os = "android")]
fn write_apk(
    app: &AppHandle,
    update: &Update,
    bytes: &[u8],
) -> Result<std::path::PathBuf, AppError> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|err| AppError::internal(format!("no cache directory: {err}")))?;
    std::fs::create_dir_all(&dir).map_err(AppError::from_detail)?;
    let path = dir.join(format!("chayote-{}.apk", update.version));
    std::fs::write(&path, bytes).map_err(AppError::from_detail)?;
    Ok(path)
}

fn take(pending: &PendingUpdate) -> Result<Update, AppError> {
    lock(pending)?.take().ok_or_else(|| {
        AppError::Validation("There is no update waiting to be installed.".to_owned())
    })
}

fn lock(pending: &PendingUpdate) -> Result<std::sync::MutexGuard<'_, Option<Update>>, AppError> {
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
