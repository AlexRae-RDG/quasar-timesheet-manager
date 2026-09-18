import { invoke } from "@tauri-apps/api/core";

export interface TemplateEntry {
  id: number;
  activityId: number | null;
  activityName: string;
  jiraKey: string | null;
  color: string;
  dayOfWeek: number; // 0=Monday..4=Friday
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  notes: string;
  jiraProject: string | null;
  issueType: string | null;
}

export interface NewTemplateEntry {
  activityId: number;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  notes?: string;
}

export interface UpdateTemplateEntry {
  id: number;
  /** null = leave this entry's Activity unchanged -- see api/calendar.ts's
   * UpdateTimeEntry, same convention. */
  activityId: number | null;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  notes: string;
}

export interface ApplyTemplateResult {
  applied: number;
  skipped: number;
}

export function listTemplateEntries(): Promise<TemplateEntry[]> {
  return invoke("list_template_entries");
}

export function createTemplateEntry(input: NewTemplateEntry): Promise<TemplateEntry> {
  return invoke("create_template_entry", { input });
}

export function updateTemplateEntry(input: UpdateTemplateEntry): Promise<TemplateEntry> {
  return invoke("update_template_entry", { input });
}

export function deleteTemplateEntry(id: number): Promise<void> {
  return invoke("delete_template_entry", { id });
}

/** weekStart: "YYYY-MM-DD" (a Monday). Skips any day/time range that
 * already overlaps an existing real TimeEntry that day. */
export function applyTemplateToWeek(weekStart: string): Promise<ApplyTemplateResult> {
  return invoke("apply_template_to_week", { weekStart });
}
