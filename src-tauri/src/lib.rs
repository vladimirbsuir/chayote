mod clock;
mod commands;
mod constants;
mod db;
mod doc;
mod error;
mod repo;
mod services;
mod sync;

#[cfg(test)]
mod tests;

use std::sync::Arc;

use tauri::Manager;

use commands::Services;

/// Settings live in the Tauri store, never in the notes database, so resetting
/// or syncing settings can never touch notes (`05-ui-ux.md` §6.6).
const SETTINGS_FILE: &str = "settings.json";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let built = with_pending_update(with_android_installer(with_updater(
        tauri::Builder::default(),
    )))
    .plugin(tauri_plugin_store::Builder::new().build())
    .invoke_handler(commands::handler())
    .setup(|app| {
        // Tauri's app data directory is not created for us, and on a first
        // launch it does not exist at all. Opening the database must not be
        // the thing that creates it, or the error is opaque.
        let dir = app.path().app_data_dir()?;
        std::fs::create_dir_all(&dir).map_err(|err| {
            error::AppError::internal(format!("could not create {}: {err}", dir.display()))
        })?;
        let db = Arc::new(db::Database::open(&dir)?);
        app.manage(Services::new(db));
        disable_browser_accelerators(app);
        Ok(())
    })
    .build(tauri::generate_context!());

    match built {
        Ok(app) => app.run(|_handle, _event| {}),
        Err(err) => {
            eprintln!("chayote: build failed: {err}");
            std::process::exit(1);
        }
    }
}

/// ADR-024: the updater plugin. Desktop and Android alike as of ADR-025 —
/// Android keeps the plugin's check, download and signature verification and
/// supplies its own install, so the dependency is no longer target-gated.
///
/// `plugins.updater` stays in `tauri.conf.json` unconditionally because it is
/// also where the public key lives, and the key is compiled into every target.
#[cfg(any(desktop, target_os = "android"))]
fn with_updater(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder.plugin(tauri_plugin_updater::Builder::new().build())
}

#[cfg(not(any(desktop, target_os = "android")))]
fn with_updater(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder
}

/// The checked-but-not-yet-installed update, carried between `updates_check` and
/// `updates_install`. Registered here rather than in the command module so the
/// builder chain reads in the order the app is wired, and the state has one home.
#[cfg(any(desktop, target_os = "android"))]
fn with_pending_update(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder.manage(commands::updates::PendingUpdate::default())
}

#[cfg(not(any(desktop, target_os = "android")))]
fn with_pending_update(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder
}

/// ADR-025: the Kotlin half of the Android install.
///
/// The plugin's `install_inner` is `UnsupportedOs` under `cfg(mobile)` — it
/// cannot put the package anywhere the platform will accept — so this registers
/// ours, whose `PackageInstaller` session does. Same shape as ADR-020's Kotlin
/// bridge and for the same reason: the platform has no Rust-reachable API for
/// what is being asked of it.
///
/// `register_android_plugin` lives on `PluginApi`, not on the builder, so the
/// registration happens inside our own plugin's `setup` — which is the only
/// place Tauri hands one out. The resulting handle is managed so the install can
/// call back into Kotlin without registering twice.
#[cfg(target_os = "android")]
fn with_android_installer(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder.plugin(
        tauri::plugin::Builder::<tauri::Wry>::new("chayote-updater")
            .setup(|app, api| {
                let handle = api
                    .register_android_plugin("com.chayote.app", "UpdaterPlugin")
                    .map_err(|err| {
                        error::AppError::internal(format!(
                            "could not register UpdaterPlugin: {err}"
                        ))
                    })?;
                app.manage(commands::updates::Installer(handle));
                Ok(())
            })
            .build(),
    )
}

#[cfg(not(target_os = "android"))]
fn with_android_installer(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder
}

/// Present so the settings filename has one home. Read from
/// `@tauri-apps/plugin-store` on the frontend side.
#[allow(dead_code)]
pub fn settings_filename() -> &'static str {
    SETTINGS_FILE
}

/// Windows only: WebView2 handles browser accelerators (Ctrl+F find, Ctrl+P
/// print, Ctrl+R reload, …) natively *before* the page sees them, so the
/// app's own shortcuts (`05-ui-ux.md` §7) never fire and a browser find bar
/// opens instead of the note search. Disabling them hands every keystroke to
/// the page; editing and movement keys are unaffected by the setting.
///
/// Best effort by design: if the controller is ever unreachable the app still
/// starts and only the shortcuts degrade, so failures log and continue.
#[cfg(windows)]
fn disable_browser_accelerators(app: &mut tauri::App) {
    use tauri::Manager;
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
    use windows_core::Interface;
    let Some(window) = app.get_webview_window(crate::commands::WINDOW_LABEL) else {
        eprintln!("chayote: main window not found while disabling browser accelerators");
        return;
    };
    if let Err(err) = window.with_webview(|webview| {
        // SAFETY: WebView2 COM calls on the controller of the live webview;
        // every fallible step is reported, never unwrapped.
        unsafe {
            match webview.controller().CoreWebView2() {
                Ok(core) => match core.Settings() {
                    Ok(settings) => match settings.cast::<ICoreWebView2Settings3>() {
                        Ok(settings) => {
                            if let Err(err) = settings.SetAreBrowserAcceleratorKeysEnabled(false) {
                                eprintln!(
                                    "chayote: could not disable browser accelerator keys: {err}"
                                );
                            }
                        }
                        Err(err) => {
                            eprintln!("chayote: WebView2 settings3 unreachable: {err}");
                        }
                    },
                    Err(err) => {
                        eprintln!("chayote: WebView2 settings unreachable: {err}");
                    }
                },
                Err(err) => {
                    eprintln!("chayote: WebView2 core unreachable: {err}");
                }
            }
        }
    }) {
        eprintln!("chayote: could not reach the webview: {err}");
    }
}

#[cfg(not(windows))]
fn disable_browser_accelerators(_app: &mut tauri::App) {}
