mod commands;
mod db;
mod jira;
mod keychain;
mod settings;

use rusqlite::Connection;
use std::sync::Mutex;

pub struct AppState {
    pub db: Mutex<Connection>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let conn = db::connect().expect("failed to open the local SQLite database");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            db: Mutex::new(conn),
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::save_settings,
            commands::verify_jira_credentials,
            commands::save_jira_token,
            commands::clear_jira_token,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
