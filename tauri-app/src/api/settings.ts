import { invoke } from "@tauri-apps/api/core";
import type { PaletteSeeds } from "../theme/palettes";

export interface AppSettings {
  displayName: string;
  themeMode: string;
  customTheme: PaletteSeeds;
  workStartHour: number;
  workEndHour: number;
  showWeekends: boolean;
  headerStyle: "standard" | "compact" | "hidden";
  showTimerBar: boolean;
  jiraSiteUrl: string;
  jiraEmail: string;
  hasJiraToken: boolean;
}

export type SaveSettingsInput = Omit<AppSettings, "hasJiraToken">;

export function getSettings(): Promise<AppSettings> {
  return invoke("get_settings");
}

export function saveSettings(input: SaveSettingsInput): Promise<void> {
  return invoke("save_settings", { input });
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
