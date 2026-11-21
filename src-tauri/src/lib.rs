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

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_com_chayote_app_ChayoteApplication_nativeInit<'local>(
    mut unowned_env: jni::EnvUnowned<'local>,
    _class: jni::objects::JClass<'local>,
    context: jni::objects::JObject<'local>,
) {
    let _ = unowned_env
        .with_env(|mut env| rustls_platform_verifier::android::init_with_env(&mut env, context));
}

use std::sync::Arc;

use tauri::Manager;

use commands::Services;

const SETTINGS_FILE: &str = "settings.json";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let built = with_pending_update(with_android_installer(with_updater(
        tauri::Builder::default(),
    )))
    .plugin(tauri_plugin_store::Builder::new().build())
    .invoke_handler(commands::handler())
    .setup(|app| {
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

#[cfg(any(desktop, target_os = "android"))]
fn with_updater(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder.plugin(tauri_plugin_updater::Builder::new().build())
}

#[cfg(not(any(desktop, target_os = "android")))]
fn with_updater(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder
}

#[cfg(any(desktop, target_os = "android"))]
fn with_pending_update(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder.manage(commands::updates::PendingUpdate::default())
}

#[cfg(not(any(desktop, target_os = "android")))]
fn with_pending_update(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder
}

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
                commands::updates::clear_stale_packages(app);
                Ok(())
            })
            .build(),
    )
}

#[cfg(not(target_os = "android"))]
fn with_android_installer(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder
}

#[allow(dead_code)]
pub fn settings_filename() -> &'static str {
    SETTINGS_FILE
}

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
        // SAFETY: COM calls on the live webview's controller; every failure is reported, not unwrapped.
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
