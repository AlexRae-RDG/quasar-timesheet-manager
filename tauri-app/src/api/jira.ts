import { invoke } from "@tauri-apps/api/core";

/** Transitions a QDM back to "In Progress" in Jira -- see
 * src-tauri/src/jira.rs's transition_issue for how the target transition
 * is looked up (Jira has no "set status" endpoint, only "fire one of the
 * transitions available from the current status"). */
export function reopenJiraIssue(siteUrl: string, email: string, jiraKey: string): Promise<void> {
  return invoke("reopen_jira_issue", { siteUrl, email, jiraKey });
}

/** Transitions a QDM to "Closed" in Jira -- the counterpart of
 * reopenJiraIssue, fired when an Activity with a linked QDM is archived. */
export function closeJiraIssue(siteUrl: string, email: string, jiraKey: string): Promise<void> {
  return invoke("close_jira_issue", { siteUrl, email, jiraKey });
}

export interface WorklogUploadItem {
  entryId: number;
  jiraKey: string;
  /** Pre-formatted, e.g. "2026-09-18T09:00:00.000+0100" -- see
   * lib/date.ts's toJiraStarted, which reads the browser's own timezone
   * offset so this doesn't need a Rust-side date/time dependency. */
  started: string;
  timeSpentSeconds: number;
  comment: string;
}

export interface WorklogUploadOutcome {
  entryId: number;
  /** null/undefined = uploaded successfully. */
  error?: string | null;
}

/** Uploads a batch of TimeEntries to Jira as worklogs, one per item.
 * Partial failure is expected and handled -- each item gets its own
 * outcome rather than the whole batch succeeding or failing together. */
export function uploadWorklogs(
  siteUrl: string,
  email: string,
  items: WorklogUploadItem[],
): Promise<WorklogUploadOutcome[]> {
  return invoke("upload_worklogs", { siteUrl, email, items });
}
