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
//!
//! `tauri dev` (launched via `cargo run`, not a signed, installed .app) is
//! a separate story: macOS ties a keychain item's read access to the
//! requesting binary's code identity, which an ad-hoc/unsigned dev binary
//! doesn't have a stable one of -- `set_password` reports success, but a
//! `get_password` moments later (even same-process) can come back empty,
//! confirmed by direct testing in this environment. Rather than have Jira
//! import silently look "disconnected" right after someone verifies their
//! token, QUASAR_DATA_DIR (already the existing `tauri dev`-vs-packaged
//! signal -- see db::app_dir) also switches token storage to a plain file
//! alongside the scratch database. That file is never used by a real
//! packaged build, which always goes through the real OS keychain as
//! designed.

use keyring::Entry;
use std::fs;

const SERVICE: &str = "com.quasartimesheetmanager.app";
const USERNAME: &str = "jira_api_token";
const DEV_TOKEN_FILENAME: &str = "dev_jira_token";

fn dev_token_path() -> Option<std::path::PathBuf> {
    std::env::var("QUASAR_DATA_DIR")
        .ok()
        .map(|_| crate::db::app_dir().join(DEV_TOKEN_FILENAME))
}

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, USERNAME).map_err(|e| e.to_string())
}

pub fn get_token() -> Option<String> {
    if let Some(path) = dev_token_path() {
        return fs::read_to_string(path).ok().filter(|t| !t.is_empty());
    }
    entry().ok()?.get_password().ok()
}

pub fn has_token() -> bool {
    get_token().map(|t| !t.is_empty()).unwrap_or(false)
}

pub fn set_token(token: &str) -> Result<(), String> {
    if let Some(path) = dev_token_path() {
        return fs::write(path, token).map_err(|e| e.to_string());
    }
    entry()?.set_password(token).map_err(|e| e.to_string())
}

pub fn delete_token() -> Result<(), String> {
    if let Some(path) = dev_token_path() {
        return match fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.to_string()),
        };
    }
    match entry()?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
