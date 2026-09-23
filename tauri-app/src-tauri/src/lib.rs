mod activities;
mod calendar;
mod commands;
mod db;
mod ics;
mod jira;
mod keychain;
mod qdm;
mod settings;
mod tasks;
mod templates;
mod worklog;

use rusqlite::Connection;
use std::sync::Mutex;

pub struct AppState {
    pub db: Mutex<Connection>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let conn = db::connect().expect("failed to open the local SQLite database");
    settings::ensure_onboarding_for_pre_v2(&conn, env!("CARGO_PKG_VERSION"))
        .expect("failed to check onboarding version gate");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState {
            db: Mutex::new(conn),
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::save_settings,
            commands::complete_onboarding,
            commands::reset_onboarding,
            commands::verify_jira_credentials,
            commands::save_jira_token,
            commands::clear_jira_token,
            commands::search_qdms,
            commands::fetch_ics_calendar,
            commands::reopen_jira_issue,
            commands::close_jira_issue,
            commands::upload_worklogs,
            commands::list_projects,
            commands::list_activities,
            commands::list_all_activities,
            commands::create_project,
            commands::update_project,
            commands::delete_project,
            commands::set_project_collapsed,
            commands::create_activity,
            commands::update_activity,
            commands::archive_activity,
            commands::list_time_entries,
            commands::create_time_entry,
            commands::update_time_entry,
            commands::delete_time_entry,
            commands::list_template_entries,
            commands::create_template_entry,
            commands::update_template_entry,
            commands::delete_template_entry,
            commands::apply_template_to_week,
            commands::list_tasks,
            commands::create_task,
            commands::update_task,
            commands::delete_task,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
