//! Tauri commands exposed to the frontend for the Settings vertical slice.

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
