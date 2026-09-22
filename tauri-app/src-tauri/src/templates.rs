//! Template (recurring weekly) entries -- the Template tab's own set of
//! blocks, keyed by day_of_week (0=Monday..4=Friday) instead of a real
//! date. CRUD here mirrors calendar.rs's TimeEntry CRUD closely; the one
//! real difference is apply_to_week, which turns a template into real
//! TimeEntries for a given week.

use crate::calendar::resolve_activity_snapshot;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TemplateEntry {
    pub id: i64,
    pub activity_id: Option<i64>,
    pub activity_name: String,
    pub jira_key: Option<String>,
    pub color: String,
    pub day_of_week: i64,
    pub start_time: String,
    pub end_time: String,
    pub notes: String,
    pub jira_project: Option<String>,
    pub issue_type: Option<String>,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NewTemplateEntry {
    pub activity_id: i64,
    pub day_of_week: i64,
    pub start_time: String,
    pub end_time: String,
    pub notes: Option<String>,
}

/// Same `activity_id: None` = "don't touch" convention as
/// calendar.rs's UpdateTimeEntry -- see its own docs for why.
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTemplateEntry {
    pub id: i64,
    pub activity_id: Option<i64>,
    pub day_of_week: i64,
    pub start_time: String,
    pub end_time: String,
    pub notes: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ApplyTemplateResult {
    pub applied: i64,
    pub skipped: i64,
}

const TEMPLATE_ENTRY_COLUMNS: &str = "id, activity_id, activity_name, jira_key, color, day_of_week, \
    start_time, end_time, notes, jira_project, issue_type";

fn row_to_template_entry(row: &rusqlite::Row) -> rusqlite::Result<TemplateEntry> {
    Ok(TemplateEntry {
        id: row.get(0)?,
        activity_id: row.get(1)?,
        activity_name: row.get(2)?,
        jira_key: row.get(3)?,
        color: row.get(4)?,
        day_of_week: row.get(5)?,
        start_time: row.get(6)?,
        end_time: row.get(7)?,
        notes: row.get(8)?,
        jira_project: row.get(9)?,
        issue_type: row.get(10)?,
    })
}

pub fn list_template_entries(conn: &Connection) -> rusqlite::Result<Vec<TemplateEntry>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {TEMPLATE_ENTRY_COLUMNS} FROM template_entries ORDER BY day_of_week, start_time"
    ))?;
    let rows = stmt.query_map([], row_to_template_entry)?;
    rows.collect()
}

fn get_template_entry(conn: &Connection, id: i64) -> rusqlite::Result<TemplateEntry> {
    conn.query_row(
        &format!("SELECT {TEMPLATE_ENTRY_COLUMNS} FROM template_entries WHERE id = ?1"),
        [id],
        row_to_template_entry,
    )
}

pub fn create_template_entry(conn: &Connection, input: &NewTemplateEntry) -> rusqlite::Result<TemplateEntry> {
    let snap = resolve_activity_snapshot(conn, input.activity_id)?;
    let notes = input.notes.clone().unwrap_or_default();

    conn.execute(
        "INSERT INTO template_entries
            (activity_id, activity_name, jira_key, color, day_of_week, start_time, end_time, notes,
             created_at, updated_at, jira_project, issue_type)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, datetime('now'), datetime('now'), ?9, ?10)",
        rusqlite::params![
            input.activity_id,
            snap.name,
            snap.jira_key,
            snap.color,
            input.day_of_week,
            input.start_time,
            input.end_time,
            notes,
            snap.jira_project,
            snap.issue_type,
        ],
    )?;
    get_template_entry(conn, conn.last_insert_rowid())
}

pub fn update_template_entry(conn: &Connection, input: &UpdateTemplateEntry) -> rusqlite::Result<TemplateEntry> {
    match input.activity_id {
        Some(activity_id) => {
            let snap = resolve_activity_snapshot(conn, activity_id)?;
            conn.execute(
                "UPDATE template_entries
                 SET activity_id = ?1, activity_name = ?2, jira_key = ?3, color = ?4,
                     day_of_week = ?5, start_time = ?6, end_time = ?7, notes = ?8,
                     jira_project = ?9, issue_type = ?10, updated_at = datetime('now')
                 WHERE id = ?11",
                rusqlite::params![
                    activity_id,
                    snap.name,
                    snap.jira_key,
                    snap.color,
                    input.day_of_week,
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
                "UPDATE template_entries
                 SET day_of_week = ?1, start_time = ?2, end_time = ?3, notes = ?4, updated_at = datetime('now')
                 WHERE id = ?5",
                rusqlite::params![input.day_of_week, input.start_time, input.end_time, input.notes, input.id],
            )?;
        }
    }
    get_template_entry(conn, input.id)
}

pub fn delete_template_entry(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM template_entries WHERE id = ?1", [id])?;
    Ok(())
}

/// Copies every template entry onto the real week starting `week_start`
/// (a Monday, "YYYY-MM-DD"), skipping any day/time range that already
/// overlaps an existing real TimeEntry that day -- same
/// half-open-interval overlap check calendar_view.py's own
/// template_entries_overlap() uses, and the same "skip, don't overwrite"
/// behavior apply_template_to_week() has always had. Copies each
/// template entry's own snapshotted fields directly rather than
/// re-resolving from its Activity, since the template's own content is
/// the thing being applied, not necessarily whatever that Activity looks
/// like today.
pub fn apply_template_to_week(conn: &Connection, week_start: &str) -> rusqlite::Result<ApplyTemplateResult> {
    let template_entries = list_template_entries(conn)?;
    let mut applied = 0i64;
    let mut skipped = 0i64;

    for day_of_week in 0..5i64 {
        let date = add_days(conn, week_start, day_of_week)?;
        let existing: Vec<(String, String)> = {
            let mut stmt = conn.prepare("SELECT start_time, end_time FROM time_entries WHERE date = ?1")?;
            let rows = stmt.query_map([&date], |row| Ok((row.get(0)?, row.get(1)?)))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };
        let mut occupied = existing;

        for entry in template_entries.iter().filter(|e| e.day_of_week == day_of_week) {
            let overlaps = occupied
                .iter()
                .any(|(s, e)| entry.start_time < *e && *s < entry.end_time);
            if overlaps {
                skipped += 1;
                continue;
            }
            conn.execute(
                "INSERT INTO time_entries
                    (activity_id, activity_name, jira_key, color, date, start_time, end_time, notes,
                     created_at, updated_at, jira_project, issue_type)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, datetime('now'), datetime('now'), ?9, ?10)",
                rusqlite::params![
                    entry.activity_id,
                    entry.activity_name,
                    entry.jira_key,
                    entry.color,
                    date,
                    entry.start_time,
                    entry.end_time,
                    entry.notes,
                    entry.jira_project,
                    entry.issue_type,
                ],
            )?;
            applied += 1;
            occupied.push((entry.start_time.clone(), entry.end_time.clone()));
        }
    }

    Ok(ApplyTemplateResult { applied, skipped })
}

/// Plain calendar-date arithmetic via SQLite's own date() function rather
/// than pulling in a date/time crate for this one call site.
fn add_days(conn: &Connection, iso_date: &str, days: i64) -> rusqlite::Result<String> {
    conn.query_row(
        "SELECT date(?1, '+' || ?2 || ' days')",
        rusqlite::params![iso_date, days],
        |row| row.get(0),
    )
}
