import { useState } from "react";
import type { KeyboardEvent } from "react";
import type { Activity, Project } from "../api/activities";

const NEW_ACTIVITY_SENTINEL = -1;

export function CreateEntryModal({
  date,
  startTime,
  endTime,
  activities,
  projects,
  onCreate,
  onCreateWithNewActivity,
  onClose,
}: {
  date: string;
  startTime: string;
  endTime: string;
  activities: Activity[];
  projects: Project[];
  onCreate: (activityId: number, notes: string) => void;
  onCreateWithNewActivity: (name: string, projectId: number, notes: string) => void;
  onClose: () => void;
}) {
  const [activityId, setActivityId] = useState(activities[0]?.id ?? NEW_ACTIVITY_SENTINEL);
  const [newActivityName, setNewActivityName] = useState("");
  const [newActivityProjectId, setNewActivityProjectId] = useState(projects[0]?.id ?? 0);
  const [notes, setNotes] = useState("");

  const creatingNew = activityId === NEW_ACTIVITY_SENTINEL;
  const canSubmit = creatingNew ? newActivityName.trim().length > 0 && newActivityProjectId : activityId > 0;

  function submit() {
    if (!canSubmit) return;
    if (creatingNew) {
      onCreateWithNewActivity(newActivityName.trim(), newActivityProjectId, notes);
    } else {
      onCreate(activityId, notes);
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    submit();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <h2>New Time Block</h2>
        <p className="muted">
          {date} · {startTime}–{endTime}
        </p>

        <label className="field">
          <span>Activity</span>
          <select value={activityId} onChange={(e) => setActivityId(Number(e.target.value))}>
            {activities.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
            <option value={NEW_ACTIVITY_SENTINEL}>+ New Activity…</option>
          </select>
        </label>

        {creatingNew && (
          <>
            <label className="field">
              <span>New Activity Name</span>
              <input
                type="text"
                autoFocus
                value={newActivityName}
                onChange={(e) => setNewActivityName(e.target.value)}
                placeholder="Activity name"
              />
            </label>
            <label className="field">
              <span>Project</span>
              <select value={newActivityProjectId} onChange={(e) => setNewActivityProjectId(Number(e.target.value))}>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        <label className="field">
          <span>Notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder="Work description for this block"
          />
        </label>

        <div className="modal-actions">
          <div />
          <div className="row">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn-accent" disabled={!canSubmit} onClick={submit}>
              Create
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
