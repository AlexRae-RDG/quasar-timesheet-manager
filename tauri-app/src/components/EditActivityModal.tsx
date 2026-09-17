import { useState } from "react";
import type { Activity, Project } from "../api/activities";

export interface ActivityFormValues {
  name: string;
  projectId: number;
  jiraKey: string;
  defaultDurationMinutes: string;
  jiraProject: string;
  issueType: string;
}

export function EditActivityModal({
  activity,
  projects,
  defaultProjectId,
  onSave,
  onArchive,
  onClose,
}: {
  /** null when creating a new Activity. */
  activity: Activity | null;
  projects: Project[];
  defaultProjectId: number | null;
  onSave: (values: ActivityFormValues) => void;
  onArchive?: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(activity?.name ?? "");
  const [projectId, setProjectId] = useState(activity?.projectId ?? defaultProjectId ?? projects[0]?.id ?? 0);
  const [jiraKey, setJiraKey] = useState(activity?.jiraKey ?? "");
  const [defaultDurationMinutes, setDefaultDurationMinutes] = useState(
    activity?.defaultDurationMinutes != null ? String(activity.defaultDurationMinutes) : "",
  );
  const [jiraProject, setJiraProject] = useState(activity?.jiraProject ?? "");
  const [issueType, setIssueType] = useState(activity?.issueType ?? "");

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h2>{activity ? "Edit Activity" : "New Activity"}</h2>

        <label className="field">
          <span>Name</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Activity name" />
        </label>

        <label className="field">
          <span>Project</span>
          <select value={projectId} onChange={(e) => setProjectId(Number(e.target.value))}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Jira Key</span>
          <input
            type="text"
            value={jiraKey}
            onChange={(e) => setJiraKey(e.target.value)}
            placeholder="QDM-1234 (optional)"
          />
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

        <div className="row">
          <label className="field field-inline">
            <span>Jira Project override</span>
            <input
              type="text"
              value={jiraProject}
              onChange={(e) => setJiraProject(e.target.value)}
              placeholder="Uses the app default"
            />
          </label>
          <label className="field field-inline">
            <span>Issue Type override</span>
            <input
              type="text"
              value={issueType}
              onChange={(e) => setIssueType(e.target.value)}
              placeholder="Uses the app default"
            />
          </label>
        </div>

        <div className="modal-actions">
          {activity && onArchive ? (
            <button type="button" className="btn btn-danger" onClick={onArchive}>
              Archive
            </button>
          ) : (
            <div />
          )}
          <div className="row">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-accent"
              disabled={!name.trim() || !projectId}
              onClick={() =>
                onSave({
                  name: name.trim(),
                  projectId,
                  jiraKey: jiraKey.trim(),
                  defaultDurationMinutes,
                  jiraProject: jiraProject.trim(),
                  issueType: issueType.trim(),
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
