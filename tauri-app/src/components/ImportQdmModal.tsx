import { useEffect, useMemo, useState } from "react";
import { createActivity, createProject, type Activity, type Project } from "../api/activities";
import { reopenJiraIssue } from "../api/jira";
import { searchQdms, type QdmResult } from "../api/qdm";
import { projectKeyForDepartment, type AppSettings } from "../api/settings";
import { EditProjectModal } from "./EditProjectModal";

type Status = "loading" | "loaded" | "error";

// Sentinel bucket id for QDMs that couldn't be auto-matched to a Project --
// distinct from any real Project id (which are always positive database
// rows), so it can share the same assignment map/grouping logic below
// rather than needing a parallel "unsorted" data structure.
const UNSORTED = -1;
// The dropdown option that opens the inline "+ New Project" modal, instead
// of a real project id.
const NEW_PROJECT_OPTION = "__new__";
const ARCHIVED_PROJECT_NAME = "Archived";

// Real QDM parent issues turn out to use many different "QA <phase>"
// suffixes -- Delivery, Execution, Prep, Analysis & Design, Requirement
// Traceability, CI CD/DevOps Set Up, and probably more -- not just
// "QA Delivery". Stripping from the first standalone "QA" onward (rather
// than one exact literal suffix) recovers the Project-ish prefix across
// all of them, e.g. "Railcard Mulesoft BAU Releases - Mulesoft Release 10 -
// QA Execution" -> "Railcard Mulesoft BAU Releases - Mulesoft Release 10".
// A parent with no "QA" segment at all (e.g. "Quasar Admin") is left as-is.
function deriveProjectCandidateName(parentSummary: string | null): string | null {
  if (!parentSummary) return null;
  const stripped = parentSummary.replace(/\s*-?\s*\bQA\b.*$/i, "").trim();
  return stripped || null;
}

// Display/prefill guess only -- a Closed QDM still prefers its own epic
// name (same as an open one) so "+ New Project" and the "looks like X?"
// hint suggest the real Project it belongs to; "Archived" is only the
// fallback when there's no parent to derive a name from at all. Actual
// matching (matchProjectForQdm below) applies the same fallback rule
// against real Projects, so this and that stay in sync.
function candidateNameFor(q: QdmResult): string | null {
  return deriveProjectCandidateName(q.parentSummary) ?? (q.status === "Closed" ? ARCHIVED_PROJECT_NAME : null);
}

// Case/whitespace/punctuation-insensitive, and tolerant of a trailing 's'
// so "Railcard" (how these epics are named) and a Project named "Railcards"
// still line up.
function normalizeForMatch(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .replace(/s$/, "");
}

// Real epic names rarely reduce to an exact Project name even after
// stripping the QA-phase suffix (e.g. "Railcard Mulesoft BAU Releases -
// Mulesoft Release 10" for a Project just called "Railcards") -- so this
// tries an exact match first, and falls back to "the candidate starts with
// the Project's name" (its whole first-word-or-more, not a fuzzy edit
// distance) before giving up. A 3-character floor on the Project name
// keeps that fallback from matching on something like "QA" or "DR". When
// more than one Project's name is a prefix, the longest (most specific)
// one wins, e.g. "Railcard Automation" over "Railcard" if both exist.
function matchProjectByName(candidateName: string | null, projects: Project[]): Project | undefined {
  if (!candidateName) return undefined;
  const normalized = normalizeForMatch(candidateName);
  if (!normalized) return undefined;

  const exact = projects.find((p) => normalizeForMatch(p.name) === normalized);
  if (exact) return exact;

  const prefixMatches = projects.filter((p) => {
    const pn = normalizeForMatch(p.name);
    return pn.length >= 3 && normalized.startsWith(pn);
  });
  if (prefixMatches.length === 0) return undefined;
  return prefixMatches.reduce((best, p) =>
    normalizeForMatch(p.name).length > normalizeForMatch(best.name).length ? p : best,
  );
}

// "Archived" is never a real epic-name match target -- it's a manual
// fallback only (see matchProjectForQdm), so it's always excluded from the
// generic name-matching pool, Closed QDM or not. Without this, an open OR
// closed QDM whose epic name happens to contain "archive" could get swept
// in there by the generic name-matching tiers for the wrong reason.
function projectsExcludingArchived(projects: Project[]): Project[] {
  return projects.filter((p) => normalizeForMatch(p.name) !== normalizeForMatch(ARCHIVED_PROJECT_NAME));
}

// A Closed QDM still gets sorted by its own epic name first, same as an
// open one -- only when that name doesn't match any real Project does it
// fall back to "Archived", so a Closed QDM whose Project already exists
// (e.g. "Railcards") lands there directly instead of always defaulting to
// Archived regardless of where it actually belongs.
function matchProjectForQdm(q: QdmResult, projects: Project[]): Project | undefined {
  const epicMatch = matchProjectByName(deriveProjectCandidateName(q.parentSummary), projectsExcludingArchived(projects));
  if (epicMatch) return epicMatch;
  if (q.status === "Closed") {
    return projects.find((p) => normalizeForMatch(p.name) === normalizeForMatch(ARCHIVED_PROJECT_NAME));
  }
  return undefined;
}

/** Search + review panel for pulling QDMs (Jira Sub-tasks assigned to the
 * current user in the QDM project) straight from the Jira API and creating
 * an Activity for each one picked -- see src-tauri/src/qdm.rs for the JQL
 * this is built on. Rows already represented by an existing Activity's
 * jiraKey are shown but not selectable, so re-opening this after an import
 * never creates duplicates.
 *
 * Each QDM carries its own target Project (projectAssignments) -- guessed
 * from its parent issue's name where possible, Closed or not; a Closed QDM
 * only falls back to "Archived" when no real Project matches. Anything with
 * neither is left in the Unsorted bucket rather than defaulted somewhere
 * arbitrary. The list is grouped by that assignment so
 * sorting a QDM into its Project is a visible, direct-manipulation act:
 * pick a Project on its row and it moves to that group. Picking "+ New
 * Project" creates one on the spot (pre-filled with the guessed name, if
 * any) and re-checks every still-Unsorted row against it, so creating e.g.
 * "Archived" once sorts every Closed QDM in the same pass. */
export function ImportQdmModal({
  settings,
  projects,
  activities,
  onImported,
  onProjectCreated,
  onClose,
}: {
  settings: AppSettings;
  projects: Project[];
  activities: Activity[];
  onImported: () => void;
  onProjectCreated: (project: Project) => void;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<Status>("loading");
  const [results, setResults] = useState<QdmResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [projectAssignments, setProjectAssignments] = useState<Record<string, number>>({});
  const [importing, setImporting] = useState(false);
  const [newProjectFor, setNewProjectFor] = useState<{ jiraKey: string; suggestedName: string } | null>(null);
  const [importWarning, setImportWarning] = useState<string | null>(null);
  const [reopenConfirm, setReopenConfirm] = useState<QdmResult[] | null>(null);
  // QDM for Quality Assurance, TISACC for Accreditation -- both the search
  // itself (runSearch below) and every "QDM" mention in this screen's copy
  // follow whichever project the signed-in user's department actually uses.
  const teamKey = projectKeyForDepartment(settings.department);
  // Closed QDMs vastly outnumber open ones in practice (see the "Archived"
  // routing above) -- splitting them into their own tab keeps the default
  // view usable instead of burying the few rows that actually need a human
  // decision under a hundred already-understood Closed ones.
  const [showArchived, setShowArchived] = useState(false);

  const existingKeys = useMemo(
    () => new Set(activities.map((a) => a.jiraKey).filter((k): k is string => !!k)),
    [activities],
  );

  function autoMatchAll(qdms: QdmResult[], currentProjects: Project[]) {
    return Object.fromEntries(
      qdms.map((q) => {
        const match = matchProjectForQdm(q, currentProjects);
        return [q.jiraKey, match?.id ?? UNSORTED];
      }),
    );
  }

  function runSearch() {
    setStatus("loading");
    setError(null);
    searchQdms(settings.jiraSiteUrl, settings.email, teamKey)
      .then((r) => {
        setResults(r);
        const importableQdms = r.filter((q) => !existingKeys.has(q.jiraKey));
        // Archived (Closed) ones default to unchecked -- they're unlikely
        // to be wanted on a first import, and defaulting them on made it
        // easy to import a pile of already-finished work by accident. Open
        // ones still default to checked, same as before.
        setSelected(new Set(importableQdms.filter((q) => q.status !== "Closed").map((q) => q.jiraKey)));
        setProjectAssignments(autoMatchAll(importableQdms, projects));
        setStatus("loaded");
      })
      .catch((e) => {
        setError(String(e));
        setStatus("error");
      });
  }

  useEffect(runSearch, []); // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Select/deselect only touch the currently visible tab -- switching tabs
  // shouldn't silently lose selections already made in the other one.
  function selectAll() {
    setSelected((prev) => new Set([...prev, ...visibleQdms.map((q) => q.jiraKey)]));
  }

  function deselectAll() {
    const visibleKeys = new Set(visibleQdms.map((q) => q.jiraKey));
    setSelected((prev) => new Set([...prev].filter((k) => !visibleKeys.has(k))));
  }

  function handleRowSelect(qdm: QdmResult, value: string) {
    if (value === NEW_PROJECT_OPTION) {
      setNewProjectFor({ jiraKey: qdm.jiraKey, suggestedName: candidateNameFor(qdm) ?? "" });
      return;
    }
    setProjectAssignments((prev) => ({ ...prev, [qdm.jiraKey]: Number(value) }));
  }

  async function handleCreateProject(name: string, color: string) {
    if (!newProjectFor) return;
    try {
      const created = await createProject({ name, color });
      onProjectCreated(created);
      const updatedProjects = [...projects, created];
      setProjectAssignments((prev) => {
        const next = { ...prev, [newProjectFor.jiraKey]: created.id };
        // Creating a Project can resolve more than just the row that
        // triggered it -- e.g. making "Archived" sorts every Closed QDM
        // still sitting in Unsorted, not just the one row clicked.
        for (const q of importable) {
          if (next[q.jiraKey] !== UNSORTED) continue;
          const match = matchProjectForQdm(q, updatedProjects);
          if (match) next[q.jiraKey] = match.id;
        }
        return next;
      });
      setNewProjectFor(null);
    } catch (e) {
      setError(String(e));
    }
  }

  const importable = results.filter((q) => !existingKeys.has(q.jiraKey));
  const alreadyImported = results.filter((q) => existingKeys.has(q.jiraKey));

  const activeQdms = importable.filter((q) => q.status !== "Closed");
  const archivedQdms = importable.filter((q) => q.status === "Closed");
  const visibleQdms = showArchived ? archivedQdms : activeQdms;
  const visibleAlreadyImported = alreadyImported.filter((q) => (q.status === "Closed") === showArchived);

  // Scoped to the visible tab, not every selected row across both --
  // Import Selected while on Active should only ever act on Active rows,
  // never silently sweep in whatever's still checked on Archived (or vice
  // versa) just because it happens to be selected in the background.
  const selectedCount = visibleQdms.filter(
    (q) => selected.has(q.jiraKey) && projectAssignments[q.jiraKey] != null && projectAssignments[q.jiraKey] !== UNSORTED,
  ).length;

  // Grouped for display -- Unsorted (if non-empty) always leads, then any
  // Project that currently has at least one QDM assigned to it, in the
  // same order as the sidebar. Scoped to the visible tab only.
  const groups = useMemo(() => {
    const map = new Map<number, QdmResult[]>();
    for (const q of visibleQdms) {
      const pid = projectAssignments[q.jiraKey];
      if (pid == null) continue;
      const list = map.get(pid) ?? [];
      list.push(q);
      map.set(pid, list);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleQdms, projectAssignments]);

  // A Closed QDM sorted into a real (non-Archived) Project is about to get
  // reopened in Jira as a side effect of importing it -- worth a confirm
  // step of its own rather than folding silently into "Import Selected",
  // since it changes something in Jira beyond just creating a local
  // Activity.
  function qdmsPendingReopen(): QdmResult[] {
    return visibleQdms.filter((q) => {
      if (!selected.has(q.jiraKey) || q.status !== "Closed") return false;
      const projectId = projectAssignments[q.jiraKey];
      if (projectId == null || projectId === UNSORTED) return false;
      const project = projects.find((p) => p.id === projectId);
      return !(project && normalizeForMatch(project.name) === normalizeForMatch(ARCHIVED_PROJECT_NAME));
    });
  }

  function handleImportClick() {
    if (selectedCount === 0) return;
    const pending = qdmsPendingReopen();
    if (pending.length > 0) {
      setReopenConfirm(pending);
    } else {
      performImport();
    }
  }

  async function performImport() {
    setImporting(true);
    setError(null);
    setImportWarning(null);
    // A Closed QDM sorted into a real (non-Archived) Project just told us
    // it's active again -- reopening it here means the resulting Activity
    // is never in the confusing state of "not Archived locally, still
    // Closed in Jira", the same pairing Edit Activity's own Project change
    // does for an already-imported one.
    const reopenFailures: string[] = [];
    try {
      for (const q of visibleQdms) {
        if (!selected.has(q.jiraKey)) continue;
        const projectId = projectAssignments[q.jiraKey];
        if (projectId == null || projectId === UNSORTED) continue;
        await createActivity({ name: q.summary || q.jiraKey, projectId, jiraKey: q.jiraKey });

        if (q.status === "Closed") {
          const project = projects.find((p) => p.id === projectId);
          const stillArchived =
            project && normalizeForMatch(project.name) === normalizeForMatch(ARCHIVED_PROJECT_NAME);
          if (!stillArchived) {
            try {
              await reopenJiraIssue(settings.jiraSiteUrl, settings.email, q.jiraKey);
            } catch (e) {
              reopenFailures.push(`${q.jiraKey}: ${e}`);
            }
          }
        }
      }
      onImported();
      if (reopenFailures.length > 0) {
        setImportWarning(
          `Imported, but couldn't reopen ${reopenFailures.length} ticket${reopenFailures.length === 1 ? "" : "s"} in Jira -- ${reopenFailures.join("; ")}`,
        );
      } else {
        onClose();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setImporting(false);
    }
  }

  const unsortedRows = groups.get(UNSORTED);

  return (
    <div className="modal-backdrop">
      <div className="modal-card import-qdm-card">
        <h2>Import {teamKey}s from Jira</h2>
        <p className="muted">
          Sub-tasks in the {teamKey} project assigned to you. Each one needs a Project to sort into --
          use the <strong>Project</strong> dropdown on its row (already guessed where possible from
          its parent issue's name, falling back to "Archived" for a Closed one with no match).
          Uncheck a row to leave it for next time.
        </p>

        <div className="qdm-scroll-area">
          {status === "loading" && <p className="muted">Searching Jira…</p>}

          {status === "error" && (
            <>
              <p className="status status-error">{error}</p>
              <button type="button" className="btn btn-secondary" onClick={runSearch}>
                Try Again
              </button>
            </>
          )}

          {status === "loaded" && (
            <>
              {results.length === 0 ? (
                <p className="muted">No matching {teamKey}s found.</p>
              ) : (
                <>
                  {projects.length === 0 && (
                    <p className="muted">
                      You don't have any Projects yet -- pick "+ New Project…" from any row's dropdown
                      below to create one on the spot.
                    </p>
                  )}
                  <div className="segmented qdm-tabs">
                    <button
                      type="button"
                      className={"segment" + (!showArchived ? " segment-active" : "")}
                      onClick={() => setShowArchived(false)}
                    >
                      Active ({activeQdms.length})
                    </button>
                    <button
                      type="button"
                      className={"segment" + (showArchived ? " segment-active" : "")}
                      onClick={() => setShowArchived(true)}
                    >
                      Archived ({archivedQdms.length})
                    </button>
                  </div>

                  {visibleQdms.length === 0 && visibleAlreadyImported.length === 0 ? (
                    <p className="muted">No {showArchived ? "archived" : "active"} {teamKey}s here.</p>
                  ) : (
                    <>
                      {visibleQdms.length > 0 && (
                        <div className="qdm-column-headers">
                          <span className="qdm-select-controls">
                            {teamKey}
                            <button type="button" className="link-button" onClick={selectAll}>
                              Select All
                            </button>
                            <button type="button" className="link-button" onClick={deselectAll}>
                              Deselect All
                            </button>
                          </span>
                          <span>Sort into Project</span>
                        </div>
                      )}

                  <div className="qdm-groups">
                    {unsortedRows && unsortedRows.length > 0 && (
                      <div className="qdm-group">
                        <div className="qdm-group-header qdm-group-header-unsorted">
                          <span>⚠ Couldn't auto-match</span>
                          <span className="muted">({unsortedRows.length})</span>
                        </div>
                        <ul className="qdm-list">
                          {unsortedRows.map((q) => (
                            <QdmRow
                              key={q.jiraKey}
                              qdm={q}
                              checked={selected.has(q.jiraKey)}
                              onToggle={() => toggle(q.jiraKey)}
                              projects={projects}
                              projectId={null}
                              guessedName={candidateNameFor(q)}
                              onSelect={(value) => handleRowSelect(q, value)}
                            />
                          ))}
                        </ul>
                      </div>
                    )}

                    {projects.map((project) => {
                      const rows = groups.get(project.id);
                      if (!rows || rows.length === 0) return null;
                      return (
                        <div key={project.id} className="qdm-group">
                          <div className="qdm-group-header">
                            <span className="color-dot" style={{ background: project.color }} />
                            <span>{project.name}</span>
                            <span className="muted">({rows.length})</span>
                          </div>
                          <ul className="qdm-list">
                            {rows.map((q) => (
                              <QdmRow
                                key={q.jiraKey}
                                qdm={q}
                                checked={selected.has(q.jiraKey)}
                                onToggle={() => toggle(q.jiraKey)}
                                projects={projects}
                                projectId={project.id}
                                guessedName={null}
                                onSelect={(value) => handleRowSelect(q, value)}
                              />
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                  </div>

                      {visibleAlreadyImported.length > 0 && (
                        <div className="qdm-group">
                          <div className="qdm-group-header">
                            <span>Already Imported</span>
                            <span className="muted">({visibleAlreadyImported.length})</span>
                          </div>
                          <ul className="qdm-list">
                            {visibleAlreadyImported.map((q) => (
                              <li key={q.jiraKey} className="qdm-row">
                                <label className="qdm-row-label qdm-row-disabled">
                                  <input type="checkbox" checked disabled />
                                  <span className="badge">{q.jiraKey}</span>
                                  <span className="qdm-row-summary">{q.summary || "(no summary)"}</span>
                                </label>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}

              {importWarning && <p className="status status-error">{importWarning}</p>}
              {error && <p className="status status-error">{error}</p>}
            </>
          )}
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <div className="row">
            {status === "loaded" && (
              <button type="button" className="btn btn-secondary" onClick={runSearch} disabled={importing}>
                Refresh
              </button>
            )}
            <button
              type="button"
              className="btn btn-accent"
              disabled={status !== "loaded" || selectedCount === 0 || importing}
              onClick={handleImportClick}
            >
              {importing ? "Importing…" : `Import Selected (${selectedCount})`}
            </button>
          </div>
        </div>
      </div>

      {reopenConfirm && (
        <div className="modal-backdrop" onClick={() => setReopenConfirm(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h2>
              Reopen {reopenConfirm.length} {teamKey}
              {reopenConfirm.length === 1 ? "" : "s"} in Jira?
            </h2>
            <p className="muted">
              {reopenConfirm.length === 1 ? `This ${teamKey} is` : `These ${teamKey}s are`} Closed in Jira. Sorting{" "}
              {reopenConfirm.length === 1 ? "it" : "them"} into an active Project will also transition{" "}
              {reopenConfirm.length === 1 ? "it" : "them"} back to "In Progress" in Jira. Continue?
            </p>
            <ul className="qdm-list">
              {reopenConfirm.map((q) => (
                <li key={q.jiraKey} className="qdm-row">
                  <span className="badge">{q.jiraKey}</span>
                  <span className="qdm-row-summary">{q.summary || "(no summary)"}</span>
                </li>
              ))}
            </ul>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setReopenConfirm(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-accent"
                onClick={() => {
                  setReopenConfirm(null);
                  performImport();
                }}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {newProjectFor && (
        <EditProjectModal
          project={null}
          initialName={newProjectFor.suggestedName}
          onSave={handleCreateProject}
          onClose={() => setNewProjectFor(null)}
        />
      )}
    </div>
  );
}

function QdmRow({
  qdm,
  checked,
  onToggle,
  projects,
  projectId,
  guessedName,
  onSelect,
}: {
  qdm: QdmResult;
  checked: boolean;
  onToggle: () => void;
  projects: Project[];
  /** null when this row is in the Unsorted bucket -- shows a placeholder
   * option until a real Project is picked. */
  projectId: number | null;
  /** Shown as a hint only when Unsorted and a candidate name was guessed
   * but didn't match an existing Project -- lets the user see what "+ New
   * Project" would pre-fill without having to open it first. */
  guessedName: string | null;
  onSelect: (value: string) => void;
}) {
  return (
    <li className="qdm-row">
      <label className="qdm-row-label">
        <input type="checkbox" checked={checked} onChange={onToggle} />
        <span className="badge">{qdm.jiraKey}</span>
        <span className="qdm-row-summary">
          {qdm.summary || "(no summary)"}
          {projectId == null && guessedName && (
            <span className="qdm-row-guess"> -- looks like "{guessedName}"?</span>
          )}
        </span>
      </label>
      <select
        className={"qdm-row-project" + (projectId == null ? " qdm-row-project-unsorted" : "")}
        value={projectId ?? ""}
        onChange={(e) => onSelect(e.target.value)}
        onClick={(e) => e.stopPropagation()}
      >
        {projectId == null && (
          <option value="" disabled>
            Choose a Project…
          </option>
        )}
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
        <option value={NEW_PROJECT_OPTION}>+ New Project…</option>
      </select>
    </li>
  );
}
