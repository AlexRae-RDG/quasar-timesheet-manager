// Kept in sync with package.json / src-tauri/tauri.conf.json /
// src-tauri/Cargo.toml by hand (all four should be bumped together on
// release) -- not read from any of them at runtime, so the Settings
// footer doesn't need an IPC round trip just to show a version number.
export const APP_VERSION = "2.2.0";
