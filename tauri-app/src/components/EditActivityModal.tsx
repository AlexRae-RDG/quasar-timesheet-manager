import { useState } from "react";
import type { Activity, Project } from "../api/activities";
import { reopenJiraIssue } from "../api/jira";
import { jiraProjectNameForDepartment, projectKeyForDepartment, type AppSettings } from "../api/settings";
import { Dropdown, DropdownOption } from "./Dropdown";

export interface ActivityFormValues {
  name: string;
  projectId: number;
  jiraKey: string;
  defaultDurationMinutes: string;
  jiraProject: string;
}

/** Pulls just the numeric part out of an existing "QDM-1234"/"TISACC-99"
 * style key, for the number-only input -- tolerant of whatever prefix an
 * older entry happened to be saved under, since only the digits are ever
 * user-editable now. */
function jiraKeyDigits(jiraKey: string | null | undefined): string {
  return (jiraKey ?? "").replace(/\D/g, "");
}

type ReopenState = { kind: "idle" } | { kind: "loading" } | { kind: "success" } | { kind: "error"; message: string };

export function EditActivityModal({
  activity,
  projects,
  defaultProjectId,
  settings,
  onSave,
  onArchive,
  onClose,
}: {
  /** null when creating a new Activity. */
  activity: Activity | null;
  projects: Project[];
  defaultProjectId: number | null;
  settings: AppSettings;
  onSave: (values: ActivityFormValues) => void;
  onArchive?: () => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(activity?.name ?? "");
  const [projectId, setProjectId] = useState(activity?.projectId ?? defaultProjectId ?? projects[0]?.id ?? 0);
  const [jiraKeyNumber, setJiraKeyNumber] = useState(jiraKeyDigits(activity?.jiraKey));
  const [defaultDurationMinutes, setDefaultDurationMinutes] = useState(
    activity?.defaultDurationMinutes != null ? String(activity.defaultDurationMinutes) : "",
  );
  const [reopenState, setReopenState] = useState<ReopenState>({ kind: "idle" });
  const [archiving, setArchiving] = useState(false);
  const teamKey = projectKeyForDepartment(settings.department);

  // Archive and Reopen are two sides of the same action -- whichever one
  // applies to this Activity's current state gets the one slot, rather than
  // showing both (or an "Archive" that doesn't really mean much for
  // something whose QDM is already Closed). Falls back to Archive when
  // there's no jiraKey to reopen, even if the Project happens to be
  // "Archived" (a manually-created Activity with nothing in Jira to act on).
  const isArchivedProject = projects.find((p) => p.id === projectId)?.name.trim().toLowerCase() === "archived";
  const showReopen = isArchivedProject && !!activity?.jiraKey;
  const showArchive = !!activity && !!onArchive && !showReopen;

  async function handleArchive() {
    if (!onArchive) return;
    setArchiving(true);
    try {
      await onArchive();
    } finally {
      setArchiving(false);
    }
  }

  async function handleReopen() {
    if (!activity?.jiraKey) return;
    setReopenState({ kind: "loading" });
    try {
      await reopenJiraIssue(settings.jiraSiteUrl, settings.email, activity.jiraKey);
      setReopenState({ kind: "success" });
    } catch (e) {
      setReopenState({ kind: "error", message: String(e) });
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card edit-activity-card" onClick={(e) => e.stopPropagation()}>
        <h2>{activity ? "Edit Activity" : "New Activity"}</h2>

        <label className="field">
          <span>Name</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Activity name" />
        </label>

        <label className="field">
          <span>Project</span>
          <Dropdown value={projectId} onChange={(v) => setProjectId(Number(v))}>
            {projects.map((p) => (
              <DropdownOption key={p.id} value={p.id}>
                {p.name}
              </DropdownOption>
            ))}
          </Dropdown>
        </label>

        <label className="field">
          <span>Jira Key *</span>
          <div className="jira-key-input">
            <span className="jira-key-prefix">{teamKey}-</span>
            <input
              type="text"
              inputMode="numeric"
              value={jiraKeyNumber}
              onChange={(e) => setJiraKeyNumber(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="1234"
            />
          </div>
          <span className="muted">Required -- needed to upload this Activity's time to Jira.</span>
        </label>

        <label className="field">
          <span>Default Duration (minutes)</span>
          <input
            type="text"
            inputMode="numeric"
            value={defaultDurationMinutes}
            onChange={(e) => setDefaultDurationMinutes(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="30 (optional -- used for quick-assign)"
          />
        </label>

        {(showArchive || showReopen) && (
          <div className="field">
            {showReopen ? (
              <>
                <div className="row">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleReopen}
                    disabled={reopenState.kind === "loading"}
                  >
                    {reopenState.kind === "loading" ? "Reopening…" : "Reopen in Jira"}
                  </button>
                  <span className="muted">Moves {activity!.jiraKey} back to "In Progress" in Jira.</span>
                </div>
                {reopenState.kind === "success" && (
                  <p className="status status-success">Done -- {activity!.jiraKey} is now In Progress.</p>
                )}
                {reopenState.kind === "error" && <p className="status status-error">{reopenState.message}</p>}
              </>
            ) : (
              <div className="row">
                <button type="button" className="btn btn-danger" onClick={handleArchive} disabled={archiving}>
                  {archiving ? "Archiving…" : "Archive"}
                </button>
                <span className="muted">
                  {activity!.jiraKey
                    ? `Hides this Activity and closes ${activity!.jiraKey} in Jira.`
                    : "Hides this Activity."}
                </span>
              </div>
            )}
          </div>
        )}

        <div className="modal-actions">
          <div />
          <div className="row">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-accent"
              disabled={!name.trim() || !projectId || !jiraKeyNumber.trim()}
              onClick={() =>
                onSave({
                  name: name.trim(),
                  projectId,
                  jiraKey: `${teamKey}-${jiraKeyNumber.trim()}`,
                  defaultDurationMinutes,
                  jiraProject: jiraProjectNameForDepartment(settings.department),
                })
              }
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
