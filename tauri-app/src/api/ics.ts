import { invoke } from "@tauri-apps/api/core";

/** Fetches the raw .ics text for a shared calendar link (Outlook/Google) --
 * see src-tauri/src/ics.rs for why this goes through Rust rather than a
 * browser-side fetch. Parsing lives in src/lib/ics.ts. */
export function fetchIcsCalendar(url: string): Promise<string> {
  return invoke("fetch_ics_calendar", { url });
}
