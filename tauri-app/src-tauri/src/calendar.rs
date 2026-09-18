//! TimeEntries data access for the Timesheet (weekly calendar) screen.
//! Project/Activity CRUD lives in activities.rs; this module only reads
//! them (to snapshot onto a TimeEntry -- see resolve_activity_snapshot).

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TimeEntry {
    pub id: i64,
    pub activity_id: Option<i64>,
    pub activity_name: String,
    pub jira_key: Option<String>,
    pub color: String,
    pub date: String,
    pub start_time: String,
    pub end_time: String,
    pub notes: String,
    pub jira_project: Option<String>,
    pub issue_type: Option<String>,
    pub jira_uploaded_at: Option<String>,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NewTimeEntry {
    pub activity_id: i64,
    pub date: String,
    pub start_time: String,
    pub end_time: String,
    /// Carried over when duplicating a block or recreating one for undo --
    /// omitted (-> "") for an ordinary new block from a drag.
    pub notes: Option<String>,
}

/// Covers move, resize, reassigning to a different Activity, and editing
/// notes. `activity_id: None` means "leave whichever Activity (or lack of
/// one) this entry already has alone" -- a plain move/resize must NOT force
/// an activity_id onto an entry whose Activity was since deleted (a real
/// case in existing data: activities.project_id/time_entries.activity_id
/// use ON DELETE SET NULL, and the entry keeps its own snapshotted
/// name/color regardless). Only `Some(id)` (the Edit panel's Activity
/// dropdown) re-snapshots activity_name/jira_key/color/jira_project/
/// issue_type from that Activity.
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTimeEntry {
    pub id: i64,
    pub activity_id: Option<i64>,
    pub date: String,
    pub start_time: String,
    pub end_time: String,
    pub notes: String,
}

const TIME_ENTRY_COLUMNS: &str = "id, activity_id, activity_name, jira_key, color, date, \
    start_time, end_time, notes, jira_project, issue_type, jira_uploaded_at";

fn row_to_time_entry(row: &rusqlite::Row) -> rusqlite::Result<TimeEntry> {
    Ok(TimeEntry {
        id: row.get(0)?,
        activity_id: row.get(1)?,
        activity_name: row.get(2)?,
        jira_key: row.get(3)?,
        color: row.get(4)?,
        date: row.get(5)?,
        start_time: row.get(6)?,
        end_time: row.get(7)?,
        notes: row.get(8)?,
        jira_project: row.get(9)?,
        issue_type: row.get(10)?,
        jira_uploaded_at: row.get(11)?,
    })
}

pub fn list_time_entries(
    conn: &Connection,
    start_date: &str,
    end_date: &str,
) -> rusqlite::Result<Vec<TimeEntry>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {TIME_ENTRY_COLUMNS} FROM time_entries
         WHERE date >= ?1 AND date <= ?2
         ORDER BY date, start_time"
    ))?;
    let rows = stmt.query_map(rusqlite::params![start_date, end_date], row_to_time_entry)?;
    rows.collect()
}

fn get_time_entry(conn: &Connection, id: i64) -> rusqlite::Result<TimeEntry> {
    conn.query_row(
        &format!("SELECT {TIME_ENTRY_COLUMNS} FROM time_entries WHERE id = ?1"),
        [id],
        row_to_time_entry,
    )
}

pub(crate) struct ActivitySnapshot {
    pub name: String,
    pub jira_key: Option<String>,
    pub color: String,
    pub jira_project: Option<String>,
    pub issue_type: Option<String>,
}

/// The fields a TimeEntry (or TemplateEntry -- see templates.rs, which
/// reuses this) copies from its Activity (and, through it, the Activity's
/// Project) at write time -- see models.py's TimeEntry docstring on why
/// these are snapshotted rather than looked up live.
pub(crate) fn resolve_activity_snapshot(conn: &Connection, activity_id: i64) -> rusqlite::Result<ActivitySnapshot> {
    conn.query_row(
        "SELECT a.name, a.jira_key, COALESCE(p.color, '#4C6EF5'), a.jira_project, a.issue_type
         FROM activities a LEFT JOIN projects p ON p.id = a.project_id
         WHERE a.id = ?1",
        [activity_id],
        |row| {
            Ok(ActivitySnapshot {
                name: row.get(0)?,
                jira_key: row.get(1)?,
                color: row.get(2)?,
                jira_project: row.get(3)?,
                issue_type: row.get(4)?,
            })
        },
    )
    .optional()?
    .ok_or(rusqlite::Error::QueryReturnedNoRows)
}

pub fn create_time_entry(conn: &Connection, input: &NewTimeEntry) -> rusqlite::Result<TimeEntry> {
    let snap = resolve_activity_snapshot(conn, input.activity_id)?;
    let notes = input.notes.clone().unwrap_or_default();

    conn.execute(
        "INSERT INTO time_entries
            (activity_id, activity_name, jira_key, color, date, start_time, end_time, notes,
             created_at, updated_at, jira_project, issue_type)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, datetime('now'), datetime('now'), ?9, ?10)",
        rusqlite::params![
            input.activity_id,
            snap.name,
            snap.jira_key,
            snap.color,
            input.date,
            input.start_time,
            input.end_time,
            notes,
            snap.jira_project,
            snap.issue_type,
        ],
    )?;
    get_time_entry(conn, conn.last_insert_rowid())
}

pub fn update_time_entry(conn: &Connection, input: &UpdateTimeEntry) -> rusqlite::Result<TimeEntry> {
    match input.activity_id {
        Some(activity_id) => {
            let snap = resolve_activity_snapshot(conn, activity_id)?;
            conn.execute(
                "UPDATE time_entries
                 SET activity_id = ?1, activity_name = ?2, jira_key = ?3, color = ?4,
                     date = ?5, start_time = ?6, end_time = ?7, notes = ?8,
                     jira_project = ?9, issue_type = ?10, updated_at = datetime('now')
                 WHERE id = ?11",
                rusqlite::params![
                    activity_id,
                    snap.name,
                    snap.jira_key,
                    snap.color,
                    input.date,
                    input.start_time,
                    input.end_time,
                    input.notes,
                    snap.jira_project,
                    snap.issue_type,
                    input.id,
                ],
            )?;
        }
        None => {
            conn.execute(
                "UPDATE time_entries
                 SET date = ?1, start_time = ?2, end_time = ?3, notes = ?4, updated_at = datetime('now')
                 WHERE id = ?5",
                rusqlite::params![input.date, input.start_time, input.end_time, input.notes, input.id],
            )?;
        }
    }
    get_time_entry(conn, input.id)
}

pub fn delete_time_entry(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM time_entries WHERE id = ?1", [id])?;
    Ok(())
}

/// Stamps jira_uploaded_at after a successful worklog upload (see
/// worklog.rs) -- deliberately not bundled into update_time_entry, since
/// this is a one-way marker set by the upload flow itself, not something a
/// normal edit should ever touch.
pub fn mark_jira_uploaded(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE time_entries SET jira_uploaded_at = datetime('now') WHERE id = ?1",
        [id],
    )?;
    Ok(())
}
