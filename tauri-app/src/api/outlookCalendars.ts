import { invoke } from "@tauri-apps/api/core";

export interface OutlookCalendar {
  id: number;
  label: string;
  icsUrl: string;
}

export interface NewOutlookCalendar {
  label: string;
  icsUrl: string;
}

export interface UpdateOutlookCalendar {
  id: number;
  label: string;
  icsUrl: string;
}

export function listOutlookCalendars(): Promise<OutlookCalendar[]> {
  return invoke("list_outlook_calendars");
}

export function createOutlookCalendar(input: NewOutlookCalendar): Promise<OutlookCalendar> {
  return invoke("create_outlook_calendar", { input });
}

export function updateOutlookCalendar(input: UpdateOutlookCalendar): Promise<OutlookCalendar> {
  return invoke("update_outlook_calendar", { input });
}

export function deleteOutlookCalendar(id: number): Promise<void> {
  return invoke("delete_outlook_calendar", { id });
}
