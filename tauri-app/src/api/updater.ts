import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type { Update };

/** Asks the endpoint in tauri.conf.json's plugins.updater (a `latest.json`
 * published alongside every GitHub Release -- see .github/workflows/release.yml's
 * includeUpdaterJson) whether a newer, signed build exists. Resolves to
 * `null` when already current; throws on a real check failure (offline,
 * no releases yet, a corrupt/unsigned manifest) -- callers decide whether
 * to surface that or fail silently. Not usable outside a real Tauri
 * window (the browser-pane mock has no updater backend of its own), so it
 * always throws there too, which every caller here already treats the
 * same as "couldn't check."
 */
export function checkForUpdate(): Promise<Update | null> {
  return check();
}

/** Downloads and installs an update found by checkForUpdate, then restarts
 * the app into it. `onProgress` reports bytes as they arrive if the server
 * sent a content-length; total may be null/undefined for a compressed
 * transfer where it isn't known ahead of time. */
export async function installUpdate(
  update: Update,
  onProgress?: (downloaded: number, total: number | null) => void,
): Promise<void> {
  let total: number | null = null;
  let downloaded = 0;
  await update.downloadAndInstall((event) => {
    if (event.event === "Started") {
      total = event.data.contentLength ?? null;
      onProgress?.(0, total);
    } else if (event.event === "Progress") {
      downloaded += event.data.chunkLength;
      onProgress?.(downloaded, total);
    }
  });
  await relaunch();
}
