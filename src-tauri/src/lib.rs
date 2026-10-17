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
    let built = with_updater(tauri::Builder::default())
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

/// ADR-024: the updater plugin is desktop-only, matching its `Cargo.toml` gate.
/// `plugins.updater` stays in `tauri.conf.json` unconditionally because it is
/// also where the public key lives, and the key is compiled into every target —
/// a build that could never verify an update does not need one.
#[cfg(desktop)]
fn with_updater(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder.plugin(tauri_plugin_updater::Builder::new().build())
}

#[cfg(mobile)]
fn with_updater(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
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
