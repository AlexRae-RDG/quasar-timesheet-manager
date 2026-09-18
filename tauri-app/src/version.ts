// Kept in sync with package.json / src-tauri/tauri.conf.json by hand (all
// three should be bumped together on release) -- not read from either at
// runtime, so the Settings footer doesn't need an IPC round trip just to
// show a version number.
export const APP_VERSION = "0.1.0";
