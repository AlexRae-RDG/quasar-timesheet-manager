//! Tauri commands exposed to the frontend.

use crate::activities::{self, Activity, NewActivity, NewProject, Project, UpdateActivity, UpdateProject};
use crate::calendar::{self, NewTimeEntry, TimeEntry, UpdateTimeEntry};
use crate::keychain;
use crate::settings::{self, AppSettings, SaveSettingsInput};
use crate::tasks::{self, NewTask, Task, UpdateTask};
use crate::templates::{self, ApplyTemplateResult, NewTemplateEntry, TemplateEntry, UpdateTemplateEntry};
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

#[tauri::command]
pub fn complete_onboarding(state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    settings::complete_onboarding(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reset_onboarding(state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    settings::reset_onboarding(&conn).map_err(|e| e.to_string())
}

/// Separate from the general save_settings path the same way onboarding's
/// complete/reset are -- a sidebar drag should stick the moment the user
/// lets go, not wait for them to visit Settings and click Save (which
/// every OTHER preference here does wait for). See useResizableSidebar.ts.
#[tauri::command]
pub fn set_sidebar_width(state: State<AppState>, width: i32) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    settings::set_sidebar_width(&conn, width).map_err(|e| e.to_string())
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

/// Searches for QDMs (Jira Sub-tasks in a team's delivery-management
/// project, assigned to the current user) to import as Activities --
/// `project_key` is QDM or TISACC depending on the user's department (see
/// api/settings.ts's projectKeyForDepartment, resolved on the frontend
/// since that's where the department->key mapping already lives for the UI
/// copy too) -- see qdm.rs for the JQL and field mapping.
#[tauri::command]
pub async fn search_qdms(
    site_url: String,
    email: String,
    project_key: String,
) -> Result<Vec<crate::qdm::QdmResult>, String> {
    let token = keychain::get_token().ok_or_else(|| "Connect Jira in Settings first.".to_string())?;
    crate::qdm::search_qdms(&site_url, &email, &token, &project_key).await
}

/// Fetches the raw contents of an Outlook/Google "shared calendar" .ics
/// link for the Timesheet's Import from Outlook feature -- done in Rust
/// (not a browser fetch) so an arbitrary external calendar host isn't
/// subject to the webview's own CORS restrictions. Parsing and occurrence
/// expansion happen entirely on the frontend (see src/lib/ics.ts).
#[tauri::command]
pub async fn fetch_ics_calendar(url: String) -> Result<String, String> {
    crate::ics::fetch_ics(&url).await
}

/// Transitions a QDM back to "In Progress" -- used by the Edit Activity
/// panel's "Reopen in Jira" button for an Activity whose QDM was Closed
/// (e.g. imported into Archived) but now needs time logged against it again.
#[tauri::command]
pub async fn reopen_jira_issue(site_url: String, email: String, jira_key: String) -> Result<(), String> {
    let token = keychain::get_token().ok_or_else(|| "Connect Jira in Settings first.".to_string())?;
    crate::jira::transition_issue(&site_url, &email, &token, &jira_key, "In Progress").await
}

/// Transitions a QDM to "Closed" -- fired alongside archive_activity when an
/// archived Activity has a linked QDM, so archiving locally and closing the
/// ticket in Jira stay in sync instead of drifting apart.
#[tauri::command]
pub async fn close_jira_issue(site_url: String, email: String, jira_key: String) -> Result<(), String> {
    let token = keychain::get_token().ok_or_else(|| "Connect Jira in Settings first.".to_string())?;
    crate::jira::transition_issue(&site_url, &email, &token, &jira_key, "Closed").await
}

/// Uploads a batch of TimeEntries to Jira as worklogs -- see worklog.rs.
/// Each item's own started/timeSpentSeconds is pre-computed by the
/// frontend; this just posts them one at a time and stamps
/// jira_uploaded_at on whichever ones succeed, so a partial failure (e.g.
/// one QDM rejects a worklog) doesn't lose track of the ones that worked.
#[tauri::command]
pub async fn upload_worklogs(
    state: State<'_, AppState>,
    site_url: String,
    email: String,
    items: Vec<crate::worklog::WorklogUploadItem>,
) -> Result<Vec<crate::worklog::WorklogUploadOutcome>, String> {
    let token = keychain::get_token().ok_or_else(|| "Connect Jira in Settings first.".to_string())?;
    let mut outcomes = Vec::with_capacity(items.len());
    for item in items {
        let result = crate::worklog::post_worklog(&site_url, &email, &token, &item).await;
        match result {
            Ok(()) => {
                {
                    let conn = state.db.lock().map_err(|e| e.to_string())?;
                    let _ = calendar::mark_jira_uploaded(&conn, item.entry_id);
                }
                outcomes.push(crate::worklog::WorklogUploadOutcome {
                    entry_id: item.entry_id,
                    error: None,
                });
            }
            Err(e) => outcomes.push(crate::worklog::WorklogUploadOutcome {
                entry_id: item.entry_id,
                error: Some(e),
            }),
        }
    }
    Ok(outcomes)
}

#[tauri::command]
pub fn list_projects(state: State<AppState>) -> Result<Vec<Project>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    activities::list_projects(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_activities(state: State<AppState>) -> Result<Vec<Activity>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    activities::list_activities(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_all_activities(state: State<AppState>) -> Result<Vec<Activity>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    activities::list_all_activities(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_project(state: State<AppState>, input: NewProject) -> Result<Project, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    activities::create_project(&conn, &input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_project(state: State<AppState>, input: UpdateProject) -> Result<Project, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    activities::update_project(&conn, &input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_project(state: State<AppState>, id: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    activities::delete_project(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_project_collapsed(state: State<AppState>, id: i64, collapsed: bool) -> Result<Project, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    activities::set_project_collapsed(&conn, id, collapsed).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_activity(state: State<AppState>, input: NewActivity) -> Result<Activity, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    activities::create_activity(&conn, &input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_activity(state: State<AppState>, input: UpdateActivity) -> Result<Activity, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    activities::update_activity(&conn, &input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn archive_activity(state: State<AppState>, id: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    activities::archive_activity(&conn, id).map_err(|e| e.to_string())
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

#[tauri::command]
pub fn list_template_entries(state: State<AppState>) -> Result<Vec<TemplateEntry>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    templates::list_template_entries(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_template_entry(state: State<AppState>, input: NewTemplateEntry) -> Result<TemplateEntry, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    templates::create_template_entry(&conn, &input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_template_entry(state: State<AppState>, input: UpdateTemplateEntry) -> Result<TemplateEntry, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    templates::update_template_entry(&conn, &input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_template_entry(state: State<AppState>, id: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    templates::delete_template_entry(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn apply_template_to_week(state: State<AppState>, week_start: String) -> Result<ApplyTemplateResult, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    templates::apply_template_to_week(&conn, &week_start).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_tasks(state: State<AppState>) -> Result<Vec<Task>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    tasks::list_tasks(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_task(state: State<AppState>, input: NewTask) -> Result<Task, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    tasks::create_task(&conn, &input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_task(state: State<AppState>, input: UpdateTask) -> Result<Task, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    tasks::update_task(&conn, &input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_task(state: State<AppState>, id: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    tasks::delete_task(&conn, id).map_err(|e| e.to_string())
}
