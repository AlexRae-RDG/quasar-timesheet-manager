//! Jira API token storage via the OS keychain (macOS Keychain / Windows
//! Credential Manager / Secret Service on Linux), through the `keyring`
//! crate.
//!
//! This deliberately replaces the Python app's Fernet-file-encrypted
//! `settings` row (see the old app's `jira_client.py`): Tauri's native
//! platform bindings give us real OS-backed secret storage, so there's no
//! need to invent our own encryption scheme or a sibling key file that has
//! to be deliberately excluded from backup/restore. The token is never
//! written to the SQLite database at all now, so a shared/backed-up `.db`
//! file carries no token material in any form.

use keyring::Entry;

const SERVICE: &str = "com.quasartimesheetmanager.app";
const USERNAME: &str = "jira_api_token";

fn entry() -> Result<Entry, String> {
    // Same QUASAR_DATA_DIR dev override as db::app_dir() -- keeps `tauri
    // dev` testing (e.g. clicking "Save & Verify" with a throwaway token)
    // out of the real OS keychain entry a packaged build would use.
    let service = match std::env::var("QUASAR_DATA_DIR") {
        Ok(_) => "com.quasartimesheetmanager.app.dev",
        Err(_) => SERVICE,
    };
    Entry::new(service, USERNAME).map_err(|e| e.to_string())
}

pub fn get_token() -> Option<String> {
    entry().ok()?.get_password().ok()
}

pub fn has_token() -> bool {
    get_token().map(|t| !t.is_empty()).unwrap_or(false)
}

pub fn set_token(token: &str) -> Result<(), String> {
    entry()?.set_password(token).map_err(|e| e.to_string())
}

pub fn delete_token() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
