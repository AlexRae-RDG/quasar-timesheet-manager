//! SQLite data layer. Deliberately points at the same on-disk location the
//! existing Python/Tkinter app uses (`~/.jira_timesheet/timesheet.db`) so a
//! user's existing Activities/Projects/time entries carry over untouched.
//!
//! `CREATE TABLE IF NOT EXISTS` below is the *current* (post-migration)
//! schema from the Python app's `db.py`. The three historical renames that
//! Python's `_migrate_legacy_activity_naming` /
//! `_migrate_folder_rename_to_activity_project` handle are NOT replicated
//! here -- by the time someone switches to this app they'll already be on a
//! current release of the Python one, so their on-disk schema is already
//! fully migrated. A truly ancient, never-upgraded database would need to be
//! opened with the old Python app first.

use rusqlite::Connection;
use std::path::PathBuf;

pub fn app_dir() -> PathBuf {
    // QUASAR_DATA_DIR lets `tauri dev` point at a scratch copy instead of
    // the real ~/.jira_timesheet -- useful so iterating on this app never
    // risks writing test data into the live Python app's database.
    if let Ok(dir) = std::env::var("QUASAR_DATA_DIR") {
        return PathBuf::from(dir);
    }
    let mut dir = dirs::home_dir().expect("could not resolve home directory");
    dir.push(".jira_timesheet");
    dir
}

pub fn db_path() -> PathBuf {
    app_dir().join("timesheet.db")
}

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS projects (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    color       TEXT NOT NULL DEFAULT '#4C6EF5',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    collapsed   INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activities (
    id                        INTEGER PRIMARY KEY AUTOINCREMENT,
    name                      TEXT NOT NULL,
    jira_key                  TEXT,
    default_duration_minutes  INTEGER,
    archived                  INTEGER NOT NULL DEFAULT 0,
    created_at                TEXT NOT NULL,
    jira_project              TEXT,
    issue_type                TEXT,
    project_id                INTEGER,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS time_entries (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    activity_id     INTEGER,
    activity_name   TEXT NOT NULL,
    jira_key        TEXT,
    color           TEXT NOT NULL DEFAULT '#4C6EF5',
    date            TEXT NOT NULL,
    start_time      TEXT NOT NULL,
    end_time        TEXT NOT NULL,
    notes           TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    jira_project    TEXT,
    issue_type      TEXT,
    jira_uploaded_at TEXT,
    FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS template_entries (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    activity_id     INTEGER,
    activity_name   TEXT NOT NULL,
    jira_key        TEXT,
    color           TEXT NOT NULL DEFAULT '#4C6EF5',
    day_of_week     INTEGER NOT NULL,
    start_time      TEXT NOT NULL,
    end_time        TEXT NOT NULL,
    notes           TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    jira_project    TEXT,
    issue_type      TEXT,
    FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key     TEXT PRIMARY KEY,
    value   TEXT
);
"#;

pub fn connect() -> rusqlite::Result<Connection> {
    std::fs::create_dir_all(app_dir()).expect("could not create app data directory");
    let conn = Connection::open(db_path())?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    conn.execute_batch(SCHEMA)?;
    Ok(conn)
}
