//! Typed view over the `settings` key/value table, matching the Python
//! app's `config.py`/`main_window.py` settings schema key-for-key so an
//! existing database's saved preferences are picked up unchanged.

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

pub const DEFAULT_JIRA_SITE_URL: &str = "raildeliverygroup.atlassian.net";

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CustomThemeSeeds {
    pub app_bg: String,
    pub panel_bg: String,
    pub text_primary: String,
    pub accent: String,
}

impl Default for CustomThemeSeeds {
    fn default() -> Self {
        // Same default seeds as theme.py's _custom_seeds (Cobalt Rush).
        Self {
            app_bg: "#05070F".into(),
            panel_bg: "#0B1020".into(),
            text_primary: "#EAF0FF".into(),
            accent: "#2F6FED".into(),
        }
    }
}

/// One weekday's working window, in whole hours (0-24). `workHours` below
/// holds seven of these, Monday first -- the same order the Settings screen
/// and the calendar's own weekday indexing use.
#[derive(Serialize, Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DayHours {
    pub start: i32,
    pub end: i32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub display_name: String,
    pub first_name: String,
    pub last_name: String,
    /// General profile contact email, captured at onboarding -- separate
    /// from jira_email below, though onboarding seeds both from the same
    /// input since it's a single-user app.
    pub email: String,
    /// "quality_assurance" | "accreditation" | "" (unset). Purely a stored
    /// classification for now -- nothing else in the app reads it yet.
    pub department: String,
    pub theme_mode: String,
    pub custom_theme: CustomThemeSeeds,
    pub work_hours: Vec<DayHours>,
    pub show_weekends: bool,
    pub header_style: String,
    pub show_timer_bar: bool,
    /// Whether the optional Notes tab is shown. Off by default so the main
    /// interface stays uncluttered for anyone who doesn't want it.
    pub notes_enabled: bool,
    /// Whether the Tasks (kanban board) tab is shown. On by default so an
    /// existing install doesn't lose a tab it already uses -- it can now be
    /// switched off from Settings → Optional Features.
    pub tasks_enabled: bool,
    /// Whether the optional Pomodoro tab is shown, plus its four tunables.
    pub pomodoro_enabled: bool,
    pub pomodoro_focus_minutes: i32,
    pub pomodoro_short_break_minutes: i32,
    pub pomodoro_long_break_minutes: i32,
    pub pomodoro_sessions_before_long: i32,
    /// Whether the end-of-session beep plays.
    pub pomodoro_sound: bool,
    pub jira_site_url: String,
    pub jira_email: String,
    /// The Activity sidebar's drag-to-resize width, shared by Timesheet and
    /// Template (the same sidebar content, so one width for both rather than
    /// two independently-remembered ones). Previously component-local state
    /// that reset to the default on every tab switch, since CalendarScreen/
    /// TemplateScreen fully unmount when the tab changes.
    pub sidebar_width: i32,
    /// Whether a Jira API token is currently stored in the OS keychain.
    /// The token value itself is never sent to the frontend once saved --
    /// only this presence flag -- so it can never be displayed in plain
    /// text after entry.
    pub has_jira_token: bool,
    /// Whether the mandatory-fields form + guided tour has been completed.
    /// Defaults false for both brand-new AND pre-existing databases, so an
    /// upgrade from a version without onboarding still prompts existing
    /// users once to backfill the now-required fields.
    pub onboarding_completed: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SaveSettingsInput {
    pub display_name: String,
    pub first_name: String,
    pub last_name: String,
    pub email: String,
    pub department: String,
    pub theme_mode: String,
    pub custom_theme: CustomThemeSeeds,
    pub work_hours: Vec<DayHours>,
    pub show_weekends: bool,
    pub header_style: String,
    pub show_timer_bar: bool,
    pub notes_enabled: bool,
    pub tasks_enabled: bool,
    pub pomodoro_enabled: bool,
    pub pomodoro_focus_minutes: i32,
    pub pomodoro_short_break_minutes: i32,
    pub pomodoro_long_break_minutes: i32,
    pub pomodoro_sessions_before_long: i32,
    /// Whether the end-of-session beep plays.
    pub pomodoro_sound: bool,
    pub jira_site_url: String,
    pub jira_email: String,
    pub sidebar_width: i32,
}

fn get(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
        row.get(0)
    })
    .optional()
}

fn set(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, value],
    )?;
    Ok(())
}

/// An integer setting read back through the same bounds it's saved with, so
/// a hand-edited database value can't produce a zero-length timer.
fn get_clamped(conn: &Connection, key: &str, default: i32, min: i32, max: i32) -> rusqlite::Result<i32> {
    Ok(get(conn, key)?
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
        .clamp(min, max))
}

const DEFAULT_WORK_START: i32 = 9;
const DEFAULT_WORK_END: i32 = 17;

/// Each weekday has its own `work_start_hour_N` / `work_end_hour_N` pair
/// (N = 0 for Monday ... 6 for Sunday). A day that has never been saved
/// individually falls back to the single `work_start_hour` / `work_end_hour`
/// pair every version before per-day hours wrote -- so an upgrading install
/// keeps exactly the hours it already had, on every day, until it's edited.
fn load_work_hours(conn: &Connection) -> rusqlite::Result<Vec<DayHours>> {
    let legacy_start = get(conn, "work_start_hour")?
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_WORK_START);
    let legacy_end = get(conn, "work_end_hour")?
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_WORK_END);
    (0..7)
        .map(|day| {
            let start = get(conn, &format!("work_start_hour_{day}"))?
                .and_then(|v| v.parse().ok())
                .unwrap_or(legacy_start);
            let end = get(conn, &format!("work_end_hour_{day}"))?
                .and_then(|v| v.parse().ok())
                .unwrap_or(legacy_end);
            Ok(normalize_day_hours(DayHours { start, end }))
        })
        .collect()
}

/// Clamped to a real 0-24 window with end never before start, so a
/// hand-edited database value can't produce a negative-height grid.
fn normalize_day_hours(hours: DayHours) -> DayHours {
    let start = hours.start.clamp(0, 24);
    let end = hours.end.clamp(start, 24);
    DayHours { start, end }
}

fn save_work_hours(conn: &Connection, hours: &[DayHours]) -> rusqlite::Result<()> {
    for day in 0..7 {
        let h = normalize_day_hours(hours.get(day).copied().unwrap_or(DayHours {
            start: DEFAULT_WORK_START,
            end: DEFAULT_WORK_END,
        }));
        set(conn, &format!("work_start_hour_{day}"), &h.start.to_string())?;
        set(conn, &format!("work_end_hour_{day}"), &h.end.to_string())?;
    }
    Ok(())
}

pub fn load(conn: &Connection) -> rusqlite::Result<AppSettings> {
    let defaults = CustomThemeSeeds::default();
    let custom_theme = CustomThemeSeeds {
        app_bg: get(conn, "custom_theme_app_bg")?.unwrap_or(defaults.app_bg),
        panel_bg: get(conn, "custom_theme_panel_bg")?.unwrap_or(defaults.panel_bg),
        text_primary: get(conn, "custom_theme_text")?.unwrap_or(defaults.text_primary),
        accent: get(conn, "custom_theme_accent")?.unwrap_or(defaults.accent),
    };

    let header_style = get(conn, "header_style")?.unwrap_or_else(|| "standard".to_string());
    let header_style = if ["standard", "compact", "hidden"].contains(&header_style.as_str()) {
        header_style
    } else {
        "standard".to_string()
    };

    Ok(AppSettings {
        display_name: get(conn, "jira_display_name")?.unwrap_or_default(),
        first_name: get(conn, "first_name")?.unwrap_or_default(),
        last_name: get(conn, "last_name")?.unwrap_or_default(),
        email: get(conn, "email")?.unwrap_or_default(),
        department: get(conn, "department")?.unwrap_or_default(),
        theme_mode: get(conn, "theme_mode")?.unwrap_or_else(|| "dark".to_string()),
        custom_theme,
        work_hours: load_work_hours(conn)?,
        show_weekends: get(conn, "show_weekends")?
            .map(|v| v == "1")
            .unwrap_or(false),
        header_style,
        show_timer_bar: get(conn, "show_timer_bar")?
            .map(|v| v == "1")
            .unwrap_or(true),
        notes_enabled: get(conn, "notes_enabled")?
            .map(|v| v == "1")
            .unwrap_or(false),
        tasks_enabled: get(conn, "tasks_enabled")?
            .map(|v| v == "1")
            .unwrap_or(true),
        pomodoro_enabled: get(conn, "pomodoro_enabled")?
            .map(|v| v == "1")
            .unwrap_or(false),
        pomodoro_focus_minutes: get_clamped(conn, "pomodoro_focus_minutes", 25, 1, 180)?,
        pomodoro_short_break_minutes: get_clamped(conn, "pomodoro_short_break_minutes", 5, 1, 60)?,
        pomodoro_long_break_minutes: get_clamped(conn, "pomodoro_long_break_minutes", 15, 1, 120)?,
        pomodoro_sessions_before_long: get_clamped(conn, "pomodoro_sessions_before_long", 4, 1, 12)?,
        pomodoro_sound: get(conn, "pomodoro_sound")?
            .map(|v| v == "1")
            .unwrap_or(true),
        jira_site_url: get(conn, "jira_site_url")?
            .unwrap_or_else(|| DEFAULT_JIRA_SITE_URL.to_string()),
        jira_email: get(conn, "jira_email")?.unwrap_or_default(),
        // Clamped defensively (the frontend's own drag handler already
        // clamps to its min/max, this only guards a hand-edited DB value or
        // a future bug from wedging the sidebar at an unusable width).
        sidebar_width: get(conn, "sidebar_width")?
            .and_then(|v| v.parse().ok())
            .unwrap_or(210)
            .clamp(100, 600),
        has_jira_token: crate::keychain::has_token(),
        onboarding_completed: get(conn, "onboarding_completed")?
            .map(|v| v == "1")
            .unwrap_or(false),
    })
}

pub fn save(conn: &Connection, input: &SaveSettingsInput) -> rusqlite::Result<()> {
    set(conn, "jira_display_name", &input.display_name)?;
    set(conn, "first_name", &input.first_name)?;
    set(conn, "last_name", &input.last_name)?;
    set(conn, "email", &input.email)?;
    set(conn, "department", &input.department)?;
    set(conn, "theme_mode", &input.theme_mode)?;
    set(conn, "custom_theme_app_bg", &input.custom_theme.app_bg)?;
    set(conn, "custom_theme_panel_bg", &input.custom_theme.panel_bg)?;
    set(conn, "custom_theme_text", &input.custom_theme.text_primary)?;
    set(conn, "custom_theme_accent", &input.custom_theme.accent)?;
    save_work_hours(conn, &input.work_hours)?;
    set(
        conn,
        "show_weekends",
        if input.show_weekends { "1" } else { "0" },
    )?;
    set(conn, "header_style", &input.header_style)?;
    set(
        conn,
        "show_timer_bar",
        if input.show_timer_bar { "1" } else { "0" },
    )?;
    set(
        conn,
        "notes_enabled",
        if input.notes_enabled { "1" } else { "0" },
    )?;
    set(
        conn,
        "tasks_enabled",
        if input.tasks_enabled { "1" } else { "0" },
    )?;
    set(
        conn,
        "pomodoro_enabled",
        if input.pomodoro_enabled { "1" } else { "0" },
    )?;
    set(conn, "pomodoro_focus_minutes", &input.pomodoro_focus_minutes.clamp(1, 180).to_string())?;
    set(
        conn,
        "pomodoro_short_break_minutes",
        &input.pomodoro_short_break_minutes.clamp(1, 60).to_string(),
    )?;
    set(
        conn,
        "pomodoro_long_break_minutes",
        &input.pomodoro_long_break_minutes.clamp(1, 120).to_string(),
    )?;
    set(
        conn,
        "pomodoro_sessions_before_long",
        &input.pomodoro_sessions_before_long.clamp(1, 12).to_string(),
    )?;
    set(
        conn,
        "pomodoro_sound",
        if input.pomodoro_sound { "1" } else { "0" },
    )?;
    set(conn, "jira_site_url", &input.jira_site_url)?;
    set(conn, "jira_email", &input.jira_email)?;
    set(conn, "sidebar_width", &input.sidebar_width.to_string())?;
    Ok(())
}

/// A separate, one-way command rather than a field on the general save path
/// -- keeps "onboarding is done" an explicit, intentional transition rather
/// than something that could be silently reset by a save call that forgot
/// to carry the flag forward.
pub fn complete_onboarding(conn: &Connection) -> rusqlite::Result<()> {
    set(conn, "onboarding_completed", "1")
}

/// The inverse -- lets Settings' "Replay Welcome Tour" button send a real
/// install back through the mandatory form + guided tour without touching
/// any other data, for previewing what a brand new user sees.
pub fn reset_onboarding(conn: &Connection) -> rusqlite::Result<()> {
    set(conn, "onboarding_completed", "0")
}

/// Clamped the same way load()'s own read of this key is, for the same
/// reason -- a stray value here shouldn't be able to wedge the sidebar at
/// an unusable width.
pub fn set_sidebar_width(conn: &Connection, width: i32) -> rusqlite::Result<()> {
    set(conn, "sidebar_width", &width.clamp(100, 600).to_string())
}

/// This app's database is the SAME file the old Python/Tkinter app used
/// (see db.rs) -- versions v1.0.0 through v1.9.3 were that app, which had
/// no onboarding concept at all, so a colleague migrating straight from
/// one of those already gets the form/tour today via onboarding_completed
/// simply defaulting to false. What that can't catch on its own: someone
/// who already ran an EARLY v2.x.x build of *this* app (this rewrite
/// started its own v1.x.x-style churn before "v2.0.0" -- see the git tag
/// history) and clicked through onboarding back then, on a build from
/// before a lot of this session's bug fixes landed. Called once at
/// startup (see lib.rs), this force-resets onboarding_completed the first
/// time a database's recorded last-run version is missing or pre-2.x --
/// covering both that case and a genuine v1.x Python migrator, at the
/// (accepted) cost of also re-prompting anyone already on a v2.0.x build
/// from before this tracking existed, since there's no way to tell those
/// two apart retroactively. Only ever fires once per database: after
/// this runs, last_run_version is always >= the current version, so every
/// launch after the first never re-triggers it.
pub fn ensure_onboarding_for_pre_v2(conn: &Connection, current_version: &str) -> rusqlite::Result<()> {
    let last_seen = get(conn, "last_run_version")?.unwrap_or_default();
    let last_major: u32 = last_seen
        .split('.')
        .next()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    if last_major < 2 {
        set(conn, "onboarding_completed", "0")?;
    }
    set(conn, "last_run_version", current_version)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
            [],
        )
        .unwrap();
        conn
    }

    #[test]
    fn work_hours_default_to_nine_to_five_every_day() {
        let hours = load_work_hours(&conn()).unwrap();
        assert_eq!(hours.len(), 7);
        assert!(hours.iter().all(|h| h.start == 9 && h.end == 17));
    }

    #[test]
    fn upgrading_install_keeps_its_single_legacy_hours_on_every_day() {
        let conn = conn();
        set(&conn, "work_start_hour", "8").unwrap();
        set(&conn, "work_end_hour", "16").unwrap();
        let hours = load_work_hours(&conn).unwrap();
        assert!(hours.iter().all(|h| h.start == 8 && h.end == 16));
    }

    #[test]
    fn saved_per_day_hours_override_legacy_and_round_trip() {
        let conn = conn();
        set(&conn, "work_start_hour", "8").unwrap();
        set(&conn, "work_end_hour", "16").unwrap();
        let mut custom = vec![DayHours { start: 9, end: 17 }; 7];
        custom[1] = DayHours { start: 8, end: 16 };
        custom[2] = DayHours { start: 10, end: 10 };
        save_work_hours(&conn, &custom).unwrap();
        let loaded = load_work_hours(&conn).unwrap();
        assert_eq!((loaded[0].start, loaded[0].end), (9, 17));
        assert_eq!((loaded[1].start, loaded[1].end), (8, 16));
        assert_eq!((loaded[2].start, loaded[2].end), (10, 10));
    }

    #[test]
    fn out_of_range_or_inverted_hours_are_clamped() {
        let conn = conn();
        let mut custom = vec![DayHours { start: 9, end: 17 }; 7];
        custom[0] = DayHours { start: -3, end: 99 };
        custom[1] = DayHours { start: 15, end: 6 };
        save_work_hours(&conn, &custom).unwrap();
        let loaded = load_work_hours(&conn).unwrap();
        assert_eq!((loaded[0].start, loaded[0].end), (0, 24));
        assert_eq!((loaded[1].start, loaded[1].end), (15, 15));
    }

    #[test]
    fn pomodoro_and_tasks_defaults_and_clamping() {
        let conn = conn();
        assert_eq!(get_clamped(&conn, "pomodoro_focus_minutes", 25, 1, 180).unwrap(), 25);
        set(&conn, "pomodoro_focus_minutes", "0").unwrap();
        assert_eq!(get_clamped(&conn, "pomodoro_focus_minutes", 25, 1, 180).unwrap(), 1);
        set(&conn, "pomodoro_focus_minutes", "9999").unwrap();
        assert_eq!(get_clamped(&conn, "pomodoro_focus_minutes", 25, 1, 180).unwrap(), 180);
        set(&conn, "pomodoro_focus_minutes", "banana").unwrap();
        assert_eq!(get_clamped(&conn, "pomodoro_focus_minutes", 25, 1, 180).unwrap(), 25);
    }

    #[test]
    fn a_short_list_is_padded_with_defaults() {
        let conn = conn();
        save_work_hours(&conn, &[DayHours { start: 7, end: 15 }]).unwrap();
        let loaded = load_work_hours(&conn).unwrap();
        assert_eq!(loaded.len(), 7);
        assert_eq!((loaded[0].start, loaded[0].end), (7, 15));
        assert_eq!((loaded[6].start, loaded[6].end), (9, 17));
    }
}
