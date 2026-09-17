import { invoke } from "@tauri-apps/api/core";

export interface Project {
  id: number;
  name: string;
  color: string;
  sortOrder: number;
}

export interface Activity {
  id: number;
  name: string;
  jiraKey: string | null;
  defaultDurationMinutes: number | null;
  projectId: number | null;
  /** Denormalized from the parent Project. */
  color: string;
  jiraProject: string | null;
  issueType: string | null;
}

export interface NewProject {
  name: string;
  color: string;
}

export interface UpdateProject {
  id: number;
  name: string;
  color: string;
}

export interface NewActivity {
  name: string;
  projectId: number;
  jiraKey?: string;
  defaultDurationMinutes?: number;
  jiraProject?: string;
  issueType?: string;
}

export interface UpdateActivity {
  id: number;
  name: string;
  projectId: number;
  jiraKey?: string;
  defaultDurationMinutes?: number;
  jiraProject?: string;
  issueType?: string;
}

export function listProjects(): Promise<Project[]> {
  return invoke("list_projects");
}

export function listActivities(): Promise<Activity[]> {
  return invoke("list_activities");
}

export function createProject(input: NewProject): Promise<Project> {
  return invoke("create_project", { input });
}

export function updateProject(input: UpdateProject): Promise<Project> {
  return invoke("update_project", { input });
}

/** Reassigns the Project's Activities to a catch-all "General" Project
 * before deleting -- see activities.rs's delete_project. */
export function deleteProject(id: number): Promise<void> {
  return invoke("delete_project", { id });
}

export function createActivity(input: NewActivity): Promise<Activity> {
  return invoke("create_activity", { input });
}

export function updateActivity(input: UpdateActivity): Promise<Activity> {
  return invoke("update_activity", { input });
}

export function archiveActivity(id: number): Promise<void> {
  return invoke("archive_activity", { id });
}
