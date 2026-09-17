//! Project/Activity management -- create, edit, and archive, backing the
//! Activities tab. calendar.rs imports these same Project/Activity structs
//! for its own read-only needs (the Timesheet screen's sidebar and
//! TimeEntry snapshotting) rather than duplicating them.

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub sort_order: i64,
    pub collapsed: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub id: i64,
    pub name: String,
    pub jira_key: Option<String>,
    pub default_duration_minutes: Option<i64>,
    pub project_id: Option<i64>,
    /// Denormalized from the parent Project -- a time block's color always
    /// comes from its Activity's Project, never set on the Activity itself.
    pub color: String,
    pub jira_project: Option<String>,
    pub issue_type: Option<String>,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NewProject {
    pub name: String,
    pub color: String,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProject {
    pub id: i64,
    pub name: String,
    pub color: String,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NewActivity {
    pub name: String,
    pub project_id: i64,
    pub jira_key: Option<String>,
    pub default_duration_minutes: Option<i64>,
    pub jira_project: Option<String>,
    pub issue_type: Option<String>,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdateActivity {
    pub id: i64,
    pub name: String,
    pub project_id: i64,
    pub jira_key: Option<String>,
    pub default_duration_minutes: Option<i64>,
    pub jira_project: Option<String>,
    pub issue_type: Option<String>,
}

const PROJECT_COLUMNS: &str = "id, name, color, sort_order, collapsed";

fn row_to_project(row: &rusqlite::Row) -> rusqlite::Result<Project> {
    Ok(Project {
        id: row.get(0)?,
        name: row.get(1)?,
        color: row.get(2)?,
        sort_order: row.get(3)?,
        collapsed: row.get::<_, i64>(4)? != 0,
    })
}

pub fn list_projects(conn: &Connection) -> rusqlite::Result<Vec<Project>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {PROJECT_COLUMNS} FROM projects ORDER BY sort_order, name"
    ))?;
    let rows = stmt.query_map([], row_to_project)?;
    rows.collect()
}

fn get_project(conn: &Connection, id: i64) -> rusqlite::Result<Project> {
    conn.query_row(
        &format!("SELECT {PROJECT_COLUMNS} FROM projects WHERE id = ?1"),
        [id],
        row_to_project,
    )
}

pub fn create_project(conn: &Connection, input: &NewProject) -> rusqlite::Result<Project> {
    let next_sort_order: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM projects",
        [],
        |row| row.get(0),
    )?;
    conn.execute(
        "INSERT INTO projects (name, color, sort_order, collapsed, created_at)
         VALUES (?1, ?2, ?3, 0, datetime('now'))",
        rusqlite::params![input.name, input.color, next_sort_order],
    )?;
    get_project(conn, conn.last_insert_rowid())
}

pub fn update_project(conn: &Connection, input: &UpdateProject) -> rusqlite::Result<Project> {
    conn.execute(
        "UPDATE projects SET name = ?1, color = ?2 WHERE id = ?3",
        rusqlite::params![input.name, input.color, input.id],
    )?;
    get_project(conn, input.id)
}

/// A separate, narrow command (rather than routing through update_project)
/// since this fires on every sidebar expand/collapse click -- it shouldn't
/// need the full name/color payload just to flip one flag.
pub fn set_project_collapsed(conn: &Connection, id: i64, collapsed: bool) -> rusqlite::Result<Project> {
    conn.execute(
        "UPDATE projects SET collapsed = ?1 WHERE id = ?2",
        rusqlite::params![collapsed as i64, id],
    )?;
    get_project(conn, id)
}

fn get_or_create_general_project(conn: &Connection) -> rusqlite::Result<i64> {
    let existing: Option<i64> = conn
        .query_row("SELECT id FROM projects WHERE name = 'General' LIMIT 1", [], |row| row.get(0))
        .optional()?;
    if let Some(id) = existing {
        return Ok(id);
    }
    let next_sort_order: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM projects",
        [],
        |row| row.get(0),
    )?;
    conn.execute(
        "INSERT INTO projects (name, color, sort_order, collapsed, created_at)
         VALUES ('General', '#495057', ?1, 0, datetime('now'))",
        [next_sort_order],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Deleting a Project never orphans its Activities -- they're reassigned to
/// a catch-all "General" project first (created on demand), matching the
/// Python app's own `_ensure_activities_have_projects` safety net. Deleting
/// "General" itself is the one edge case this doesn't cover (its own
/// Activities fall back to no Project via the schema's ON DELETE SET NULL,
/// same as if a Project were removed by some other means) -- rare enough,
/// and already handled gracefully by the rest of the app, not to warrant
/// its own guard.
pub fn delete_project(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    let general_id = get_or_create_general_project(conn)?;
    if general_id != id {
        conn.execute(
            "UPDATE activities SET project_id = ?1 WHERE project_id = ?2",
            rusqlite::params![general_id, id],
        )?;
    }
    conn.execute("DELETE FROM projects WHERE id = ?1", [id])?;
    Ok(())
}

const ACTIVITY_COLUMNS_QUERY: &str = "
    SELECT a.id, a.name, a.jira_key, a.default_duration_minutes, a.project_id,
           COALESCE(p.color, '#4C6EF5') AS color, a.jira_project, a.issue_type
    FROM activities a
    LEFT JOIN projects p ON p.id = a.project_id
";

fn row_to_activity(row: &rusqlite::Row) -> rusqlite::Result<Activity> {
    Ok(Activity {
        id: row.get(0)?,
        name: row.get(1)?,
        jira_key: row.get(2)?,
        default_duration_minutes: row.get(3)?,
        project_id: row.get(4)?,
        color: row.get(5)?,
        jira_project: row.get(6)?,
        issue_type: row.get(7)?,
    })
}

/// Active (non-archived) Activities only -- there's no "view archived" UI
/// yet, same as the rest of the app not needing one for ordinary use.
pub fn list_activities(conn: &Connection) -> rusqlite::Result<Vec<Activity>> {
    let mut stmt = conn.prepare(&format!("{ACTIVITY_COLUMNS_QUERY} WHERE a.archived = 0 ORDER BY a.name"))?;
    let rows = stmt.query_map([], row_to_activity)?;
    rows.collect()
}

fn get_activity(conn: &Connection, id: i64) -> rusqlite::Result<Activity> {
    conn.query_row(&format!("{ACTIVITY_COLUMNS_QUERY} WHERE a.id = ?1"), [id], row_to_activity)
}

pub fn create_activity(conn: &Connection, input: &NewActivity) -> rusqlite::Result<Activity> {
    conn.execute(
        "INSERT INTO activities
            (name, jira_key, default_duration_minutes, archived, created_at, jira_project, issue_type, project_id)
         VALUES (?1, ?2, ?3, 0, datetime('now'), ?4, ?5, ?6)",
        rusqlite::params![
            input.name,
            input.jira_key,
            input.default_duration_minutes,
            input.jira_project,
            input.issue_type,
            input.project_id,
        ],
    )?;
    get_activity(conn, conn.last_insert_rowid())
}

/// Renaming/reassigning an Activity is deliberately NOT retroactive --
/// existing TimeEntries keep whatever they already snapshotted (see
/// calendar.rs's resolve_activity_snapshot). Only entries created or
/// explicitly reassigned after this point pick up the new values.
pub fn update_activity(conn: &Connection, input: &UpdateActivity) -> rusqlite::Result<Activity> {
    conn.execute(
        "UPDATE activities
         SET name = ?1, jira_key = ?2, default_duration_minutes = ?3,
             jira_project = ?4, issue_type = ?5, project_id = ?6
         WHERE id = ?7",
        rusqlite::params![
            input.name,
            input.jira_key,
            input.default_duration_minutes,
            input.jira_project,
            input.issue_type,
            input.project_id,
            input.id,
        ],
    )?;
    get_activity(conn, input.id)
}

/// Soft delete, matching the existing `archived` column -- never a hard
/// DELETE, since activities.id is referenced by time_entries.activity_id
/// (ON DELETE SET NULL) and this app has no UI yet for reassigning or
/// reviewing orphaned entries that a hard delete would create in bulk.
pub fn archive_activity(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("UPDATE activities SET archived = 1 WHERE id = ?1", [id])?;
    Ok(())
}
