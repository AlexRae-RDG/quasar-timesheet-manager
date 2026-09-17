//! Tauri commands exposed to the frontend.

use crate::calendar::{self, Activity, NewTimeEntry, Project, TimeEntry, UpdateTimeEntry};
use crate::keychain;
use crate::settings::{self, AppSettings, SaveSettingsInput};
use crate::AppState;
use tauri::State;

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Result<AppSettings, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    settings::load(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_settings(state: State<AppState>, input: SaveSettingsInput) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    settings::save(&conn, &input).map_err(|e| e.to_string())
}

/// Verifies Site URL / Email / API Token against Jira's `GET /myself`.
/// `token` is `None` when the user hasn't retyped a new one -- in that case
/// the previously-stored keychain token is used, so re-verifying (e.g.
/// after changing just the site URL) doesn't require re-entering the token.
#[tauri::command]
pub async fn verify_jira_credentials(
    site_url: String,
    email: String,
    token: Option<String>,
) -> Result<String, String> {
    let token = match token {
        Some(t) if !t.trim().is_empty() => t,
        _ => keychain::get_token().ok_or_else(|| "Enter an API Token first.".to_string())?,
    };
    crate::jira::verify_credentials(&site_url, &email, &token).await
}

#[tauri::command]
pub fn save_jira_token(token: String) -> Result<(), String> {
    keychain::set_token(&token)
}

#[tauri::command]
pub fn clear_jira_token() -> Result<(), String> {
    keychain::delete_token()
}

#[tauri::command]
pub fn list_projects(state: State<AppState>) -> Result<Vec<Project>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    calendar::list_projects(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_activities(state: State<AppState>) -> Result<Vec<Activity>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    calendar::list_activities(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_time_entries(
    state: State<AppState>,
    start_date: String,
    end_date: String,
) -> Result<Vec<TimeEntry>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    calendar::list_time_entries(&conn, &start_date, &end_date).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_time_entry(state: State<AppState>, input: NewTimeEntry) -> Result<TimeEntry, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    calendar::create_time_entry(&conn, &input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_time_entry(state: State<AppState>, input: UpdateTimeEntry) -> Result<TimeEntry, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    calendar::update_time_entry(&conn, &input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_time_entry(state: State<AppState>, id: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    calendar::delete_time_entry(&conn, id).map_err(|e| e.to_string())
}
