import { invoke } from "@tauri-apps/api/core";
import type { PaletteSeeds } from "../theme/palettes";

export type Department = "quality_assurance" | "accreditation" | "";

/** Each department's sub-tasks live under a different Jira project -- QA
 * uses QDM, Accreditation uses TISACC. Searching/importing has to use the
 * right one or it silently finds nothing for whichever team isn't QDM.
 * `projectName` is that same project's full Jira display name, used to fill
 * an Activity's Jira Project automatically -- see jiraProjectNameForDepartment. */
export const DEPARTMENTS: Array<{ id: Exclude<Department, "">; label: string; projectKey: string; projectName: string }> = [
  { id: "quality_assurance", label: "Quality Assurance", projectKey: "QDM", projectName: "QUASAR Delivery Management" },
  { id: "accreditation", label: "Accreditation", projectKey: "TISACC", projectName: "TISACC RDG Admin" },
];

const DEFAULT_PROJECT_KEY = "QDM";
const DEFAULT_PROJECT_NAME = "QUASAR Delivery Management";

/** Falls back to QDM (the original, pre-department behavior) when
 * department is unset, so existing users who never picked one keep
 * searching/importing exactly as before. */
export function projectKeyForDepartment(department: Department): string {
  return DEPARTMENTS.find((d) => d.id === department)?.projectKey ?? DEFAULT_PROJECT_KEY;
}

/** An Activity's Jira Project is no longer user-editable -- it's always
 * whichever project the signed-in user's department uses, computed here
 * rather than stored as a per-Activity override, so it can never drift out
 * of sync with a later department change. */
export function jiraProjectNameForDepartment(department: Department): string {
  return DEPARTMENTS.find((d) => d.id === department)?.projectName ?? DEFAULT_PROJECT_NAME;
}

export interface AppSettings {
  displayName: string;
  firstName: string;
  lastName: string;
  /** General profile contact email -- also used as the Jira account email
   * (jiraEmail below) everywhere in the UI; there's no separate input for
   * it anymore, so the two are always saved equal. */
  email: string;
  department: Department;
  themeMode: string;
  customTheme: PaletteSeeds;
  workStartHour: number;
  workEndHour: number;
  showWeekends: boolean;
  headerStyle: "standard" | "compact" | "hidden";
  showTimerBar: boolean;
  /** No longer user-editable (see SettingsScreen/OnboardingForm) -- carried
   * through untouched on every save so it can't be broken by accident. */
  jiraSiteUrl: string;
  jiraEmail: string;
  /** Published Outlook/Google shared-calendar .ics link, used by the
   * Timesheet's "Import from Outlook" so it doesn't have to be pasted in
   * every time. Optional -- "" until the user sets one. */
  outlookIcsUrl: string;
  /** The Activity sidebar's drag-to-resize width, shared by Timesheet and
   * Template (the same sidebar content, so one width for both). Kept in
   * sync here (not just component-local state) so it survives switching
   * tabs -- CalendarScreen/TemplateScreen fully unmount when the tab
   * changes, which used to reset it back to the default every time. */
  sidebarWidth: number;
  hasJiraToken: boolean;
  onboardingCompleted: boolean;
}

export type SaveSettingsInput = Omit<AppSettings, "hasJiraToken" | "onboardingCompleted">;

/** Where a Jira Cloud account creates/manages its API tokens -- account
 * level, not tied to a specific site, so this URL is the same regardless
 * of jiraSiteUrl. */
export const JIRA_API_TOKEN_URL = "https://id.atlassian.com/manage-profile/security/api-tokens";

/** firstname.lastname@raildeliverygroup.com -- a double-barreled name part
 * (whitespace-separated, e.g. "Mary Anne") is hyphenated rather than
 * dropped or squashed, so "Mary Anne Smith" becomes "mary-anne.smith@...". */
export function computeDefaultEmail(firstName: string, lastName: string): string {
  const clean = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "-");
  const first = clean(firstName);
  const last = clean(lastName);
  if (!first || !last) return "";
  return `${first}.${last}@raildeliverygroup.com`;
}

export function getSettings(): Promise<AppSettings> {
  return invoke("get_settings");
}

export function saveSettings(input: SaveSettingsInput): Promise<void> {
  return invoke("save_settings", { input });
}

export function completeOnboarding(): Promise<void> {
  return invoke("complete_onboarding");
}

/** For Settings' "Replay Welcome Tour" button -- the caller reloads the app
 * afterward so App.tsx re-reads settings fresh and drops back into the
 * mandatory form, same as a genuinely new install. */
export function resetOnboarding(): Promise<void> {
  return invoke("reset_onboarding");
}

export function verifyJiraCredentials(
  siteUrl: string,
  email: string,
  token: string | null,
): Promise<string> {
  return invoke("verify_jira_credentials", { siteUrl, email, token });
}

export function saveJiraToken(token: string): Promise<void> {
  return invoke("save_jira_token", { token });
}

export function clearJiraToken(): Promise<void> {
  return invoke("clear_jira_token");
}

/** Persists immediately (unlike every other preference here, which waits
 * for Settings' "Save Settings" click) -- see useResizableSidebar.ts. */
export function setSidebarWidth(width: number): Promise<void> {
  return invoke("set_sidebar_width", { width });
}
