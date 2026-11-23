import { useState } from "react";
import type { KeyboardEvent } from "react";
import { isBlankEntry, type TimeEntry } from "../api/calendar";
import type { Activity } from "../api/activities";
import { Dropdown, DropdownOption } from "./Dropdown";

const NO_ACTIVITY_SENTINEL = -2;

export function EditEntryModal({
  entry,
  activities,
  onSave,
  onDelete,
  onClose,
  dateLabel,
  allowNoActivity,
}: {
  entry: TimeEntry;
  activities: Activity[];
  /** activityId is null when "No activity" is chosen (only possible with
   * allowNoActivity). */
  onSave: (activityId: number | null, notes: string) => void;
  onDelete: () => void;
  onClose: () => void;
  /** Overrides the displayed date -- the Template tab passes a weekday
   * name here since entry.date is really just a synthetic stand-in (see
   * TemplateScreen.tsx) rather than a real calendar date. */
  dateLabel?: string;
  /** Adds a "No activity (just a note)" choice to the Activity dropdown --
   * Timesheet only. Such a block has no Jira key, so it's never uploaded. */
  allowNoActivity?: boolean;
}) {
  const [activityId, setActivityId] = useState(
    allowNoActivity && isBlankEntry(entry) ? NO_ACTIVITY_SENTINEL : (entry.activityId ?? activities[0]?.id ?? 0),
  );
  const submit = () => onSave(activityId === NO_ACTIVITY_SENTINEL ? null : activityId, notes);
  const [notes, setNotes] = useState(entry.notes);

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key !== "Enter" || e.shiftKey) return;
    // Shift+Enter still falls through to the textarea's own default (a
    // newline) since we only preventDefault/save on the plain-Enter path.
    e.preventDefault();
    submit();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <h2>Edit Time Block</h2>
        <p className="muted">
          {dateLabel ?? entry.date} · {entry.startTime}–{entry.endTime}
        </p>

        {entry.jiraUploadedAt && (
          <p className="status status-warning">
            Already uploaded to Jira. Changes here won't update or remove its Jira worklog -- fix that in Jira.
          </p>
        )}

        <label className="field">
          <span>Activity</span>
          <Dropdown value={activityId} onChange={(v) => setActivityId(Number(v))}>
            {activities.map((a) => (
              <DropdownOption key={a.id} value={a.id}>
                {a.name}
              </DropdownOption>
            ))}
            {allowNoActivity && <DropdownOption value={NO_ACTIVITY_SENTINEL}>No activity (just a note)</DropdownOption>}
          </Dropdown>
          {activityId === NO_ACTIVITY_SENTINEL && (
            <span className="muted">Not linked to an Activity or Jira key, so it won't be uploaded to Jira.</span>
          )}
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
            <button type="button" className="btn btn-accent" onClick={submit}>
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
