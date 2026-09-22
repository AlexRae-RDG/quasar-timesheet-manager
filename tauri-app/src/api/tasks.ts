import { invoke } from "@tauri-apps/api/core";

export type TaskStatus = "todo" | "in_progress" | "done";
export type TaskPriority = "low" | "medium" | "high";

export interface Task {
  id: number;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  deadline: string | null; // "YYYY-MM-DD"
  sortOrder: number;
}

export interface NewTask {
  title: string;
  description?: string;
  priority?: TaskPriority;
  deadline?: string | null;
}

export interface UpdateTask {
  id: number;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  deadline: string | null;
  sortOrder: number;
}

export function listTasks(): Promise<Task[]> {
  return invoke("list_tasks");
}

/** Always created in the To Do column -- see tasks.rs's create_task. */
export function createTask(input: NewTask): Promise<Task> {
  return invoke("create_task", { input });
}

export function updateTask(input: UpdateTask): Promise<Task> {
  return invoke("update_task", { input });
}

export function deleteTask(id: number): Promise<void> {
  return invoke("delete_task", { id });
}
