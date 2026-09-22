import { invoke } from "@tauri-apps/api/core";

export interface QdmResult {
  jiraKey: string;
  summary: string;
  /** The QDM's parent issue's own summary (e.g. "Railcards QA Delivery") --
   * used to guess which internal Project this QDM belongs to. */
  parentSummary: string | null;
  /** "In Progress" | "Pipeline" | "Closed" -- constrained by the JQL's own
   * status filter. "Closed" is routed to an Archived Project rather than
   * by parent name. */
  status: string;
}

/** Sub-tasks in the caller's team project (QDM or TISACC -- see
 * projectKeyForDepartment in api/settings.ts), assigned to the current user
 * and in an active status -- see src-tauri/src/qdm.rs for the exact JQL.
 * Uses whatever Jira API token is already saved in the OS keychain
 * (Settings / onboarding's Jira Connection). */
export function searchQdms(siteUrl: string, email: string, projectKey: string): Promise<QdmResult[]> {
  return invoke("search_qdms", { siteUrl, email, projectKey });
}
