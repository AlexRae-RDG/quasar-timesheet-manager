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
    pub work_start_hour: i32,
    pub work_end_hour: i32,
    pub show_weekends: bool,
    pub header_style: String,
    pub show_timer_bar: bool,
    pub jira_site_url: String,
    pub jira_email: String,
    /// The user's published Outlook (or Google) shared-calendar .ics link --
    /// stored so "Import from Outlook" on the Timesheet can fetch straight
    /// away instead of asking for it every time. Optional; empty until set.
    pub outlook_ics_url: String,
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
    pub work_start_hour: i32,
    pub work_end_hour: i32,
    pub show_weekends: bool,
    pub header_style: String,
    pub show_timer_bar: bool,
    pub jira_site_url: String,
    pub jira_email: String,
    pub outlook_ics_url: String,
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
        work_start_hour: get(conn, "work_start_hour")?
            .and_then(|v| v.parse().ok())
            .unwrap_or(9),
        work_end_hour: get(conn, "work_end_hour")?
            .and_then(|v| v.parse().ok())
            .unwrap_or(17),
        show_weekends: get(conn, "show_weekends")?
            .map(|v| v == "1")
            .unwrap_or(false),
        header_style,
        show_timer_bar: get(conn, "show_timer_bar")?
            .map(|v| v == "1")
            .unwrap_or(true),
        jira_site_url: get(conn, "jira_site_url")?
            .unwrap_or_else(|| DEFAULT_JIRA_SITE_URL.to_string()),
        jira_email: get(conn, "jira_email")?.unwrap_or_default(),
        outlook_ics_url: get(conn, "outlook_ics_url")?.unwrap_or_default(),
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
    set(conn, "work_start_hour", &input.work_start_hour.to_string())?;
    set(conn, "work_end_hour", &input.work_end_hour.to_string())?;
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
    set(conn, "jira_site_url", &input.jira_site_url)?;
    set(conn, "jira_email", &input.jira_email)?;
    set(conn, "outlook_ics_url", &input.outlook_ics_url)?;
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
