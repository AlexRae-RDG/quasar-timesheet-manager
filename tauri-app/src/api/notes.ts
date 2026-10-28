import { invoke } from "@tauri-apps/api/core";

export interface Note {
  id: number;
  title: string;
  body: string;
  /** UTC ISO-8601, parseable straight by `new Date()`. */
  updatedAt: string;
}

export interface UpdateNote {
  id: number;
  title: string;
  body: string;
}

export function listNotes(): Promise<Note[]> {
  return invoke("list_notes");
}

export function createNote(): Promise<Note> {
  return invoke("create_note");
}

export function updateNote(input: UpdateNote): Promise<Note> {
  return invoke("update_note", { input });
}

export function deleteNote(id: number): Promise<void> {
  return invoke("delete_note", { id });
}
