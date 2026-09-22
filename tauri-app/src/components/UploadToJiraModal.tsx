import { useState } from "react";
import type { TimeEntry } from "../api/calendar";
import { uploadWorklogs, type WorklogUploadOutcome } from "../api/jira";
import { projectKeyForDepartment, type AppSettings } from "../api/settings";
import { timeToMinutes, toJiraStarted } from "../lib/date";

type Phase = "review" | "uploading" | "done";

function formatDuration(entry: TimeEntry): string {
  const minutes = timeToMinutes(entry.endTime) - timeToMinutes(entry.startTime);
  const hours = minutes / 60;
  return hours === Math.round(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

/** Review + upload panel for pushing this week's logged time to Jira as
 * worklogs (POST .../issue/{key}/worklog -- see src-tauri/src/worklog.rs).
 * Only entries linked to a QDM (jiraKey set) are eligible; entries already
 * uploaded (jiraUploadedAt set) are shown locked, same "can't re-select"
 * pattern as ImportQdmModal's Already Imported section, so reopening this
 * after a previous upload never double-logs work. A partial failure (one
 * QDM rejects its worklog, say) doesn't lose track of what succeeded --
 * each entry gets its own outcome, and only the successes are marked
 * uploaded, so simply reopening this modal again naturally retries just
 * the ones that failed. */
export function UploadToJiraModal({
  entries,
  settings,
  onUploaded,
  onClose,
}: {
  entries: TimeEntry[];
  settings: AppSettings;
  onUploaded: () => void;
  onClose: () => void;
}) {
  const teamKey = projectKeyForDepartment(settings.department);
  const uploadable = entries.filter((e) => e.jiraKey && !e.jiraUploadedAt);
  const alreadyUploaded = entries.filter((e) => e.jiraKey && e.jiraUploadedAt);
  const unlinked = entries.filter((e) => !e.jiraKey);

  const [selected, setSelected] = useState<Set<number>>(new Set(uploadable.map((e) => e.id)));
  const [phase, setPhase] = useState<Phase>("review");
  const [error, setError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<WorklogUploadOutcome[]>([]);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedCount = uploadable.filter((e) => selected.has(e.id)).length;

  async function handleUpload() {
    setPhase("uploading");
    setError(null);
    try {
      const items = uploadable
        .filter((e) => selected.has(e.id))
        .map((e) => ({
          entryId: e.id,
          jiraKey: e.jiraKey as string,
          started: toJiraStarted(e.date, e.startTime),
          timeSpentSeconds: (timeToMinutes(e.endTime) - timeToMinutes(e.startTime)) * 60,
          comment: e.notes,
        }));
      const result = await uploadWorklogs(settings.jiraSiteUrl, settings.email, items);
      setOutcomes(result);
      setPhase("done");
      onUploaded();
    } catch (e) {
      setError(String(e));
      setPhase("review");
    }
  }

  const succeeded = outcomes.filter((o) => !o.error);
  const failed = outcomes.filter((o) => o.error);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card upload-jira-card" onClick={(e) => e.stopPropagation()}>
        <h2>Upload to Jira</h2>

        {phase !== "done" && (
          <>
            <p className="muted">
              Logs this week's time as Jira worklogs, one per block. Only blocks linked to a {teamKey}
              can be uploaded.
              {unlinked.length > 0 &&
                ` ${unlinked.length} block${unlinked.length === 1 ? "" : "s"} this week aren't linked to a ${teamKey} and won't be included.`}
            </p>

            {uploadable.length === 0 && alreadyUploaded.length === 0 ? (
              <p className="muted">No {teamKey}-linked time this week.</p>
            ) : (
              <div className="qdm-scroll-area">
                {uploadable.length > 0 && (
                  <ul className="qdm-list">
                    {uploadable.map((e) => (
                      <li key={e.id} className="qdm-row">
                        <label className="qdm-row-label">
                          <input
                            type="checkbox"
                            checked={selected.has(e.id)}
                            onChange={() => toggle(e.id)}
                            disabled={phase === "uploading"}
                          />
                          <span className="badge">{e.jiraKey}</span>
                          <span className="qdm-row-summary">
                            {e.activityName} -- {e.date}, {e.startTime}–{e.endTime} ({formatDuration(e)})
                            {e.notes && <span className="qdm-row-guess"> -- "{e.notes}"</span>}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}

                {alreadyUploaded.length > 0 && (
                  <div className="qdm-group">
                    <div className="qdm-group-header">
                      <span>Already Uploaded</span>
                      <span className="muted">({alreadyUploaded.length})</span>
                    </div>
                    <ul className="qdm-list">
                      {alreadyUploaded.map((e) => (
                        <li key={e.id} className="qdm-row">
                          <label className="qdm-row-label qdm-row-disabled">
                            <input type="checkbox" checked disabled />
                            <span className="badge">{e.jiraKey}</span>
                            <span className="qdm-row-summary">
                              {e.activityName} -- {e.date}, {e.startTime}–{e.endTime}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {error && <p className="status status-error">{error}</p>}
          </>
        )}

        {phase === "done" && (
          <div className="qdm-scroll-area">
            <p className="status status-success">
              Uploaded {succeeded.length} block{succeeded.length === 1 ? "" : "s"}
              {failed.length > 0 ? `, ${failed.length} failed.` : "."}
            </p>
            {failed.length > 0 && (
              <ul className="qdm-list">
                {failed.map((o) => {
                  const entry = uploadable.find((e) => e.id === o.entryId);
                  return (
                    <li key={o.entryId} className="qdm-row">
                      <span className="badge">{entry?.jiraKey ?? o.entryId}</span>
                      <span className="status status-error">{o.error}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {phase === "done" ? "Close" : "Cancel"}
          </button>
          {phase !== "done" && (
            <button
              type="button"
              className="btn btn-accent"
              disabled={selectedCount === 0 || phase === "uploading"}
              onClick={handleUpload}
            >
              {phase === "uploading" ? "Uploading…" : `Upload Selected (${selectedCount})`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
