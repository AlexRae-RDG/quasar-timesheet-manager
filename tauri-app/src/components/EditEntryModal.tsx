import { useState } from "react";
import type { KeyboardEvent } from "react";
import type { TimeEntry } from "../api/calendar";
import type { Activity } from "../api/activities";

export function EditEntryModal({
  entry,
  activities,
  onSave,
  onDelete,
  onClose,
}: {
  entry: TimeEntry;
  activities: Activity[];
  onSave: (activityId: number, notes: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [activityId, setActivityId] = useState(entry.activityId ?? activities[0]?.id ?? 0);
  const [notes, setNotes] = useState(entry.notes);

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key !== "Enter" || e.shiftKey) return;
    // Shift+Enter still falls through to the textarea's own default (a
    // newline) since we only preventDefault/save on the plain-Enter path.
    e.preventDefault();
    onSave(activityId, notes);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <h2>Edit Time Block</h2>
        <p className="muted">
          {entry.date} · {entry.startTime}–{entry.endTime}
        </p>

        <label className="field">
          <span>Activity</span>
          <select value={activityId} onChange={(e) => setActivityId(Number(e.target.value))}>
            {activities.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>

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
          <button type="button" className="btn btn-danger" onClick={onDelete}>
            Delete
          </button>
          <div className="row">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn-accent" onClick={() => onSave(activityId, notes)}>
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
