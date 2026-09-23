//! SQLite data layer. Deliberately points at the same on-disk location the
//! existing Python/Tkinter app uses (`~/.jira_timesheet/timesheet.db`) so a
//! user's existing Activities/Projects/time entries carry over untouched.
//!
//! `CREATE TABLE IF NOT EXISTS` below is the *current* (post-migration)
//! schema from the Python app's `db.py`. The three historical table/column
//! renames that Python's `_migrate_legacy_activity_naming` /
//! `_migrate_folder_rename_to_activity_project` handle are NOT replicated
//! here -- by the time someone switches to this app they'll already be on a
//! current release of the Python one, so those renames will already have
//! run. A truly ancient, never-upgraded database would need to be opened
//! with the old Python app first.
//!
//! Columns added to a table *after* it was first created are a different
//! story, and very much still needed: `CREATE TABLE IF NOT EXISTS` is a
//! no-op against a real user's existing database (that's the whole point --
//! it must NOT recreate/wipe it), so a column like `time_entries
//! .jira_project` that didn't exist when that table was first created on
//! disk never gets added by the CREATE TABLE below, and every query that
//! mentions it then fails with "no such column" -- see `migrate_schema`.

use rusqlite::Connection;
use std::collections::HashSet;
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

CREATE TABLE IF NOT EXISTS tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'todo',
    priority    TEXT NOT NULL DEFAULT 'medium',
    deadline    TEXT,
    sort_order  REAL NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

-- No Python-app equivalent (same story as tasks above) -- support for more
-- than one Outlook/Google shared-calendar link was added directly here.
-- Superseded the single outlook_ics_url settings key, which a migration in
-- outlook_calendars.rs carries forward into this table's first row so an
-- existing saved link isn't silently dropped on upgrade.
CREATE TABLE IF NOT EXISTS outlook_calendars (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    label       TEXT NOT NULL,
    ics_url     TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
);
"#;

/// Columns added after each table's initial CREATE TABLE, mirroring the
/// Python app's own `_MIGRATIONS` in `app/db.py` (same tables, same
/// columns, same types) -- kept as the source of truth there; add a column
/// here whenever one's added there, so a database that's only ever been
/// opened by one of the two apps still ends up with the same final schema
/// as one that's been opened by both.
const MIGRATIONS: &[(&str, &[(&str, &str)])] = &[
    ("projects", &[("color", "TEXT NOT NULL DEFAULT '#4C6EF5'")]),
    (
        "activities",
        &[
            ("jira_project", "TEXT"),
            ("issue_type", "TEXT"),
            ("project_id", "INTEGER"),
        ],
    ),
    (
        "time_entries",
        &[
            ("jira_project", "TEXT"),
            ("issue_type", "TEXT"),
            ("jira_uploaded_at", "TEXT"),
        ],
    ),
    (
        "template_entries",
        &[("jira_project", "TEXT"), ("issue_type", "TEXT")],
    ),
];

fn migrate_schema(conn: &Connection) -> rusqlite::Result<()> {
    for (table, columns) in MIGRATIONS {
        let mut existing = HashSet::new();
        {
            let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
            let mut rows = stmt.query([])?;
            // table_info's columns are (cid, name, type, notnull, dflt_value, pk) --
            // index 1 is the column name.
            while let Some(row) = rows.next()? {
                existing.insert(row.get::<_, String>(1)?);
            }
        }
        for (col_name, col_type) in *columns {
            if !existing.contains(*col_name) {
                conn.execute(&format!("ALTER TABLE {table} ADD COLUMN {col_name} {col_type}"), [])?;
            }
        }
    }
    Ok(())
}

pub fn connect() -> rusqlite::Result<Connection> {
    std::fs::create_dir_all(app_dir()).expect("could not create app data directory");
    let conn = Connection::open(db_path())?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    conn.execute_batch(SCHEMA)?;
    migrate_schema(&conn)?;
    Ok(conn)
}
