//! Tasks -- the Tasks tab's kanban board (To Do / In Progress / Done), kept
//! entirely separate from Activities/TimeEntries: a Task has no Jira link
//! and never appears on the Timesheet, it's just a personal to-do list with
//! a priority and an optional deadline.
//!
//! `sort_order` is a float rather than an integer so a card dropped between
//! two others can take the midpoint of their two sort_orders without ever
//! needing to renumber the rest of the column.

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: i64,
    pub title: String,
    pub description: String,
    /// "todo" | "in_progress" | "done" -- not a Rust enum since it's never
    /// branched on here, only stored and handed back; the kanban columns
    /// themselves are a frontend concept.
    pub status: String,
    /// "low" | "medium" | "high".
    pub priority: String,
    pub deadline: Option<String>,
    pub sort_order: f64,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NewTask {
    pub title: String,
    pub description: Option<String>,
    pub priority: Option<String>,
    pub deadline: Option<String>,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTask {
    pub id: i64,
    pub title: String,
    pub description: String,
    pub status: String,
    pub priority: String,
    pub deadline: Option<String>,
    pub sort_order: f64,
}

const TASK_COLUMNS: &str = "id, title, description, status, priority, deadline, sort_order";

fn row_to_task(row: &rusqlite::Row) -> rusqlite::Result<Task> {
    Ok(Task {
        id: row.get(0)?,
        title: row.get(1)?,
        description: row.get(2)?,
        status: row.get(3)?,
        priority: row.get(4)?,
        deadline: row.get(5)?,
        sort_order: row.get(6)?,
    })
}

/// The board's weekly "clear the Done column" boundary: the most recent
/// Friday 21:00, in local time -- computed entirely in SQL rather than
/// pulling in a date/time crate for this one call site (same choice
/// templates.rs's own add_days makes). `weekday 5` advances to the next
/// Friday (a no-op if today already is one), always giving a date >= today;
/// if that candidate 21:00 hasn't happened yet, the real most-recent one is
/// a week earlier.
fn most_recent_friday_9pm(conn: &Connection) -> rusqlite::Result<String> {
    conn.query_row(
        "SELECT CASE WHEN candidate <= current THEN candidate ELSE datetime(candidate, '-7 days') END
         FROM (
             SELECT date('now', 'localtime', 'weekday 5') || ' 21:00:00' AS candidate,
                    datetime('now', 'localtime') AS current
         )",
        [],
        |row| row.get(0),
    )
}

/// Deletes every Done task once the most recent Friday 21:00 boundary has
/// passed since the last time this ran -- so the board doesn't get clogged
/// up with finished cards, without ever touching To Do or In Progress.
/// Runs on every list_tasks call (cheap: one extra query in the common
/// case) rather than on a timer, since there's no guarantee the app is
/// still open when 9pm Friday actually arrives -- this instead catches up
/// the first time it's opened afterwards, then doesn't repeat until the
/// following Friday.
fn cleanup_done_if_due(conn: &Connection) -> rusqlite::Result<()> {
    let boundary = most_recent_friday_9pm(conn)?;

    let last_cleanup: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'tasks_done_cleanup_boundary'",
            [],
            |row| row.get(0),
        )
        .optional()?;

    if last_cleanup.as_deref() >= Some(boundary.as_str()) {
        return Ok(());
    }

    conn.execute("DELETE FROM tasks WHERE status = 'done'", [])?;
    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('tasks_done_cleanup_boundary', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [&boundary],
    )?;
    Ok(())
}

pub fn list_tasks(conn: &Connection) -> rusqlite::Result<Vec<Task>> {
    cleanup_done_if_due(conn)?;
    let mut stmt = conn.prepare(&format!("SELECT {TASK_COLUMNS} FROM tasks ORDER BY sort_order"))?;
    let rows = stmt.query_map([], row_to_task)?;
    rows.collect()
}

fn get_task(conn: &Connection, id: i64) -> rusqlite::Result<Task> {
    conn.query_row(&format!("SELECT {TASK_COLUMNS} FROM tasks WHERE id = ?1"), [id], row_to_task)
}

pub fn create_task(conn: &Connection, input: &NewTask) -> rusqlite::Result<Task> {
    // New cards land at the bottom of To Do -- one past whatever's already
    // the highest sort_order in that column (0 for an empty column).
    let next_order: f64 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), 0) + 1 FROM tasks WHERE status = 'todo'",
        [],
        |row| row.get(0),
    )?;
    conn.execute(
        "INSERT INTO tasks (title, description, status, priority, deadline, sort_order, created_at, updated_at)
         VALUES (?1, ?2, 'todo', ?3, ?4, ?5, datetime('now'), datetime('now'))",
        rusqlite::params![
            input.title,
            input.description.clone().unwrap_or_default(),
            input.priority.clone().unwrap_or_else(|| "medium".to_string()),
            input.deadline,
            next_order,
        ],
    )?;
    get_task(conn, conn.last_insert_rowid())
}

pub fn update_task(conn: &Connection, input: &UpdateTask) -> rusqlite::Result<Task> {
    conn.execute(
        "UPDATE tasks
         SET title = ?1, description = ?2, status = ?3, priority = ?4, deadline = ?5,
             sort_order = ?6, updated_at = datetime('now')
         WHERE id = ?7",
        rusqlite::params![
            input.title,
            input.description,
            input.status,
            input.priority,
            input.deadline,
            input.sort_order,
            input.id,
        ],
    )?;
    get_task(conn, input.id)
}

pub fn delete_task(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM tasks WHERE id = ?1", [id])?;
    Ok(())
}
