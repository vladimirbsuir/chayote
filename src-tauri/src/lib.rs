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
    let built = with_pending_update(with_android_installer(with_updater(with_single_instance(
        tauri::Builder::default(),
    ))))
    .plugin(tauri_plugin_store::Builder::new().build())
    .invoke_handler(commands::handler())
    .setup(|app| {
        let dir = app.path().app_data_dir().unwrap_or_else(|err| {
            fail_startup(&format!("Chayote could not find its data folder: {err}"))
        });
        let db =
            open_database(&dir).unwrap_or_else(|err| fail_startup(&startup_message(&dir, &err)));
        app.manage(Services::new(Arc::new(db)));
        disable_browser_accelerators(app);
        Ok(())
    })
    .build(tauri::generate_context!());

    match built {
        Ok(app) => app.run(|_handle, _event| {}),
        Err(err) => fail_startup(&format!("Chayote could not start: {err}")),
    }
}

fn fail_startup(message: &str) -> ! {
    eprintln!("chayote: {message}");
    report_startup_failure(message);
    std::process::exit(1);
}

fn open_database(dir: &std::path::Path) -> Result<db::Database, error::AppError> {
    std::fs::create_dir_all(dir).map_err(|err| {
        error::AppError::DbOpen(format!("could not create {}: {err}", dir.display()))
    })?;
    db::Database::open(dir)
}

fn startup_message(dir: &std::path::Path, err: &error::AppError) -> String {
    let detail = err.details().unwrap_or_else(|| err.to_string());
    format!(
        "Chayote could not open your notes, so it has stopped before changing anything.\n\n\
         Folder: {}\n\
         Reason: {detail}\n\n\
         Make sure no other program is using that folder and that the disk is not full, \
         then start Chayote again.",
        dir.display()
    )
}

#[cfg(desktop)]
fn report_startup_failure(message: &str) {
    rfd::MessageDialog::new()
        .set_level(rfd::MessageLevel::Error)
        .set_title("Chayote could not start")
        .set_description(message)
        .set_buttons(rfd::MessageButtons::Ok)
        .show();
}

#[cfg(not(desktop))]
fn report_startup_failure(_message: &str) {}

#[cfg(desktop)]
fn with_single_instance(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        if let Some(window) = app.get_webview_window(commands::WINDOW_LABEL) {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }))
}

#[cfg(not(desktop))]
fn with_single_instance(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder
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
