//! Free-form notes backing the optional Notes tab (enabled from Settings).
//! A plain list of title + body pairs -- no linking to entries or Jira, so
//! it stays a scratchpad rather than another system to keep in sync.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: i64,
    pub title: String,
    pub body: String,
    pub updated_at: String,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdateNote {
    pub id: i64,
    pub title: String,
    pub body: String,
}

const COLUMNS: &str = "id, title, body, updated_at";
const NOW: &str = "strftime('%Y-%m-%dT%H:%M:%SZ', 'now')";

fn row_to_note(row: &rusqlite::Row) -> rusqlite::Result<Note> {
    Ok(Note {
        id: row.get(0)?,
        title: row.get(1)?,
        body: row.get(2)?,
        updated_at: row.get(3)?,
    })
}

pub fn list(conn: &Connection) -> rusqlite::Result<Vec<Note>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM notes ORDER BY updated_at DESC, id DESC"
    ))?;
    let rows = stmt.query_map([], row_to_note)?;
    rows.collect()
}

fn get(conn: &Connection, id: i64) -> rusqlite::Result<Note> {
    conn.query_row(
        &format!("SELECT {COLUMNS} FROM notes WHERE id = ?1"),
        [id],
        row_to_note,
    )
}

pub fn create(conn: &Connection) -> rusqlite::Result<Note> {
    conn.execute(
        &format!("INSERT INTO notes (title, body, created_at, updated_at) VALUES ('', '', {NOW}, {NOW})"),
        [],
    )?;
    get(conn, conn.last_insert_rowid())
}

pub fn update(conn: &Connection, input: &UpdateNote) -> rusqlite::Result<Note> {
    conn.execute(
        &format!("UPDATE notes SET title = ?1, body = ?2, updated_at = {NOW} WHERE id = ?3"),
        rusqlite::params![input.title, input.body, input.id],
    )?;
    get(conn, input.id)
}

pub fn delete(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM notes WHERE id = ?1", [id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL DEFAULT '',
                body TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn create_update_list_delete_round_trip() {
        let conn = conn();
        let note = create(&conn).unwrap();
        assert_eq!((note.title.as_str(), note.body.as_str()), ("", ""));
        assert!(note.updated_at.ends_with('Z'));

        let updated = update(
            &conn,
            &UpdateNote { id: note.id, title: "T".into(), body: "B".into() },
        )
        .unwrap();
        assert_eq!((updated.title.as_str(), updated.body.as_str()), ("T", "B"));

        let second = create(&conn).unwrap();
        let ids: Vec<i64> = list(&conn).unwrap().iter().map(|n| n.id).collect();
        assert_eq!(ids.len(), 2);
        assert!(ids.contains(&second.id));

        delete(&conn, note.id).unwrap();
        let remaining = list(&conn).unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, second.id);
    }
}
