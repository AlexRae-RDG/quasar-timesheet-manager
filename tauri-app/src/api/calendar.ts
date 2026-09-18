import { invoke } from "@tauri-apps/api/core";

export interface TimeEntry {
  id: number;
  activityId: number | null;
  activityName: string;
  jiraKey: string | null;
  color: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  notes: string;
  jiraProject: string | null;
  issueType: string | null;
  jiraUploadedAt: string | null;
}

export interface NewTimeEntry {
  activityId: number;
  date: string;
  startTime: string;
  endTime: string;
  notes?: string;
}

export interface UpdateTimeEntry {
  id: number;
  /** null = leave this entry's Activity (or lack of one) unchanged -- only
   * a real reassignment (the Edit panel's Activity dropdown) should pass
   * an id here. See calendar.rs's UpdateTimeEntry for why. */
  activityId: number | null;
  date: string;
  startTime: string;
  endTime: string;
  notes: string;
}

export function listTimeEntries(startDate: string, endDate: string): Promise<TimeEntry[]> {
  return invoke("list_time_entries", { startDate, endDate });
}

export function createTimeEntry(input: NewTimeEntry): Promise<TimeEntry> {
  return invoke("create_time_entry", { input });
}

export function updateTimeEntry(input: UpdateTimeEntry): Promise<TimeEntry> {
  return invoke("update_time_entry", { input });
}

export function deleteTimeEntry(id: number): Promise<void> {
  return invoke("delete_time_entry", { id });
}
