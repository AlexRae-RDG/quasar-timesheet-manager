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

/** What a time block with no Activity is called (and coloured) -- must match
 * NO_ACTIVITY_NAME in src-tauri/src/calendar.rs. Such a block is just a date,
 * a time range and a description (Notes), with no Jira key, so it's never
 * uploaded. */
export const NO_ACTIVITY_NAME = "No activity";

/** True for a block created (or turned) into one with no Activity -- as
 * opposed to one whose Activity was since deleted, which also has a null
 * activityId but keeps its old name and Jira key. */
export function isBlankEntry(entry: Pick<TimeEntry, "activityId" | "activityName" | "jiraKey">): boolean {
  return entry.activityId == null && !entry.jiraKey && entry.activityName === NO_ACTIVITY_NAME;
}

export interface NewTimeEntry {
  /** null = a block with no Activity (see NO_ACTIVITY_NAME). Also how undo
   * and duplicate recreate a block whose Activity was since deleted, using
   * the snapshot fields below to keep its old name/colour/Jira key. */
  activityId: number | null;
  /** Only read when activityId is null. */
  activityName?: string;
  color?: string;
  jiraKey?: string;
  /** Pass the original block's jiraUploadedAt when undo/redo recreates it,
   * so the copy isn't offered for upload (and logged in Jira) again. */
  jiraUploadedAt?: string;
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
  /** true = turn this block into one with no Activity (drops its Jira key);
   * takes priority over activityId. */
  clearActivity?: boolean;
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
