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
  /** Accreditation only: the "Accreditation Delivery" epic above this
   * sub-task's story (parentSummary is the story's own name). null for QDMs. */
  epicSummary: string | null;
}

/** The caller's Jira sub-tasks to import. Quality Assurance searches the QDM
 * project (`projectKey`, from projectKeyForDepartment in api/settings.ts).
 * Accreditation has no single project -- an empty `projectKey` searches the
 * "Accreditation Delivery" epics' stories across every Jira project instead.
 * See src-tauri/src/qdm.rs for the exact JQL. Uses whatever Jira API token is
 * already saved in the OS keychain (Settings / onboarding's Jira Connection). */
export function searchQdms(siteUrl: string, email: string, projectKey: string): Promise<QdmResult[]> {
  if (!projectKey) return invoke("search_accreditation_tasks", { siteUrl, email });
  return invoke("search_qdms", { siteUrl, email, projectKey });
}
