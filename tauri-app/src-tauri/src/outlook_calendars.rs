//! Multiple saved Outlook/Google shared-calendar .ics links -- Settings used
//! to hold just one (the `outlook_ics_url` key/value pair), which
//! ImportOutlookModal pre-filled and auto-fetched from on open. This is the
//! same idea extended to a real list, mirroring activities.rs's
//! Project/Activity CRUD pattern rather than growing the settings table into
//! a JSON blob.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OutlookCalendar {
    pub id: i64,
    pub label: String,
    pub ics_url: String,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NewOutlookCalendar {
    pub label: String,
    pub ics_url: String,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdateOutlookCalendar {
    pub id: i64,
    pub label: String,
    pub ics_url: String,
}

const COLUMNS: &str = "id, label, ics_url";

fn row_to_calendar(row: &rusqlite::Row) -> rusqlite::Result<OutlookCalendar> {
    Ok(OutlookCalendar {
        id: row.get(0)?,
        label: row.get(1)?,
        ics_url: row.get(2)?,
    })
}

pub fn list(conn: &Connection) -> rusqlite::Result<Vec<OutlookCalendar>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM outlook_calendars ORDER BY sort_order, id"
    ))?;
    let rows = stmt.query_map([], row_to_calendar)?;
    rows.collect()
}

fn get(conn: &Connection, id: i64) -> rusqlite::Result<OutlookCalendar> {
    conn.query_row(
        &format!("SELECT {COLUMNS} FROM outlook_calendars WHERE id = ?1"),
        [id],
        row_to_calendar,
    )
}

pub fn create(conn: &Connection, input: &NewOutlookCalendar) -> rusqlite::Result<OutlookCalendar> {
    let next_sort_order: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM outlook_calendars",
        [],
        |row| row.get(0),
    )?;
    conn.execute(
        "INSERT INTO outlook_calendars (label, ics_url, sort_order, created_at)
         VALUES (?1, ?2, ?3, datetime('now'))",
        rusqlite::params![input.label, input.ics_url, next_sort_order],
    )?;
    get(conn, conn.last_insert_rowid())
}

pub fn update(conn: &Connection, input: &UpdateOutlookCalendar) -> rusqlite::Result<OutlookCalendar> {
    conn.execute(
        "UPDATE outlook_calendars SET label = ?1, ics_url = ?2 WHERE id = ?3",
        rusqlite::params![input.label, input.ics_url, input.id],
    )?;
    get(conn, input.id)
}

pub fn delete(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM outlook_calendars WHERE id = ?1", [id])?;
    Ok(())
}

/// Runs once at startup (see lib.rs), after outlook_calendars has already
/// been created by db.rs's schema -- carries a pre-existing single
/// outlook_ics_url setting forward into this table as its first row, then
/// clears the old key so this never double-runs. A brand new database (no
/// legacy key at all) or one that's already been migrated is a no-op.
pub fn migrate_from_legacy_url(conn: &Connection) -> rusqlite::Result<()> {
    let legacy: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'outlook_ics_url'",
            [],
            |row| row.get(0),
        )
        .ok();
    let Some(url) = legacy.filter(|u| !u.trim().is_empty()) else {
        return Ok(());
    };
    create(
        conn,
        &NewOutlookCalendar {
            label: "Outlook Calendar".to_string(),
            ics_url: url,
        },
    )?;
    conn.execute("DELETE FROM settings WHERE key = 'outlook_ics_url'", [])?;
    Ok(())
}
