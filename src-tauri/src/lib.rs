#![deny(clippy::all)]

mod constants;

use tauri::{AppHandle, Manager};

const WINDOW_LABEL: &str = "main";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let built = tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![window_ready])
        .build(tauri::generate_context!());

    match built {
        Ok(app) => app.run(|_handle, _event| {}),
        Err(err) => eprintln!("chayote: build failed: {err}"),
    }
}

/// Shown after the frontend's first paint, so the window never opens white.
/// `06-platform.md` §1: the window is created hidden.
#[tauri::command]
fn window_ready(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(WINDOW_LABEL)
        .ok_or_else(|| format!("window {WINDOW_LABEL} not found"))?;
    window.show().map_err(|err| err.to_string())
}
