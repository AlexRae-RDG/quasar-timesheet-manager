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
    pub theme_mode: String,
    pub custom_theme: CustomThemeSeeds,
    pub work_start_hour: i32,
    pub work_end_hour: i32,
    pub show_weekends: bool,
    pub header_style: String,
    pub show_timer_bar: bool,
    pub jira_site_url: String,
    pub jira_email: String,
    /// Whether a Jira API token is currently stored in the OS keychain.
    /// The token value itself is never sent to the frontend once saved --
    /// only this presence flag -- so it can never be displayed in plain
    /// text after entry.
    pub has_jira_token: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SaveSettingsInput {
    pub display_name: String,
    pub theme_mode: String,
    pub custom_theme: CustomThemeSeeds,
    pub work_start_hour: i32,
    pub work_end_hour: i32,
    pub show_weekends: bool,
    pub header_style: String,
    pub show_timer_bar: bool,
    pub jira_site_url: String,
    pub jira_email: String,
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
        theme_mode: get(conn, "theme_mode")?.unwrap_or_else(|| "system".to_string()),
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
        has_jira_token: crate::keychain::has_token(),
    })
}

pub fn save(conn: &Connection, input: &SaveSettingsInput) -> rusqlite::Result<()> {
    set(conn, "jira_display_name", &input.display_name)?;
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
    Ok(())
}
