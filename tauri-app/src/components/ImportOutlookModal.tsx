import { useEffect, useMemo, useState } from "react";
import { fetchIcsCalendar } from "../api/ics";
import { createTimeEntry, type NewTimeEntry, type TimeEntry } from "../api/calendar";
import type { Activity, Project } from "../api/activities";
import { toISODate } from "../lib/date";
import { occurrencesForDays, parseIcsEvents, type IcsOccurrence } from "../lib/ics";
import { Dropdown, DropdownGroup, DropdownOption } from "./Dropdown";

type Status = "idle" | "loading" | "loaded" | "error";

// Sentinel for a row with no Activity chosen yet -- distinct from any real
// Activity id (always a positive database row), same pattern as
// ImportQdmModal's UNSORTED bucket.
const UNASSIGNED = -1;

function occKey(o: IcsOccurrence): string {
  return `${o.uid}__${o.date}__${o.startTime}`;
}

function normalizeForMatch(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function autoMatchActivity(summary: string, activities: Activity[]): Activity | undefined {
  const normalized = normalizeForMatch(summary);
  if (!normalized) return undefined;
  return activities.find((a) => normalizeForMatch(a.name) === normalized);
}

function formatDayLabel(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

/** Search + review panel for pulling meetings out of a published Outlook
 * (or Google) "shared calendar" .ics link and creating a time block for
 * each one picked -- see src-tauri/src/ics.rs for the fetch and
 * src/lib/ics.ts for the parsing/recurrence expansion. Scoped to whichever
 * days are currently shown on the Timesheet (`days`), same as the rest of
 * this screen. An occurrence whose date/start/end already matches an
 * existing block this week is treated as already imported and left out.
 * `savedIcsUrl` (Settings' Outlook Calendar Import field) pre-fills the link
 * and, when present, fetches automatically on open -- so with it set,
 * opening this modal goes straight to reviewing this week's events instead
 * of pasting the same link in again every time. */
export function ImportOutlookModal({
  activities,
  projects,
  entries,
  days,
  savedIcsUrl,
  onImported,
  onClose,
}: {
  activities: Activity[];
  projects: Project[];
  entries: TimeEntry[];
  days: Date[];
  savedIcsUrl: string;
  onImported: () => void;
  onClose: () => void;
}) {
  const [url, setUrl] = useState(savedIcsUrl);
  const [showPaste, setShowPaste] = useState(false);
  const [pastedText, setPastedText] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [occurrences, setOccurrences] = useState<IcsOccurrence[]>([]);
  const [skippedExisting, setSkippedExisting] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignments, setAssignments] = useState<Record<string, number>>({});
  const [importing, setImporting] = useState(false);
  const [importWarning, setImportWarning] = useState<string | null>(null);

  const activitiesByProject = useMemo(() => {
    const map = new Map<number, Activity[]>();
    for (const a of activities) {
      if (a.projectId == null) continue;
      const list = map.get(a.projectId) ?? [];
      list.push(a);
      map.set(a.projectId, list);
    }
    return map;
  }, [activities]);

  function loadFromText(text: string) {
    setStatus("loading");
    setError(null);
    try {
      const events = parseIcsEvents(text);
      const all = occurrencesForDays(events, days);

      const existingKeys = new Set(entries.map((e) => `${e.date}__${e.startTime}__${e.endTime}`));
      const fresh = all.filter((o) => !existingKeys.has(`${o.date}__${o.startTime}__${o.endTime}`));
      setSkippedExisting(all.length - fresh.length);

      setOccurrences(fresh);
      setSelected(new Set(fresh.map(occKey)));
      setAssignments(
        Object.fromEntries(
          fresh.map((o) => {
            const match = autoMatchActivity(o.summary, activities);
            return [occKey(o), match?.id ?? UNASSIGNED];
          }),
        ),
      );
      setStatus("loaded");
    } catch (e) {
      setError(String(e));
      setStatus("error");
    }
  }

  async function handleFetch() {
    if (!url.trim()) return;
    setStatus("loading");
    setError(null);
    try {
      const text = await fetchIcsCalendar(url.trim());
      loadFromText(text);
    } catch (e) {
      setError(String(e));
      setStatus("error");
    }
  }

  // Only when Settings already has a link saved -- otherwise there's
  // nothing to fetch yet and this would just flash a blank error on open.
  useEffect(() => {
    if (savedIcsUrl.trim()) handleFetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleParsePasted() {
    if (!pastedText.trim()) return;
    loadFromText(pastedText);
  }

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(occurrences.map(occKey)));
  }

  function deselectAll() {
    setSelected(new Set());
  }

  const grouped = useMemo(() => {
    const map = new Map<string, IcsOccurrence[]>();
    for (const o of occurrences) {
      const list = map.get(o.date) ?? [];
      list.push(o);
      map.set(o.date, list);
    }
    return map;
  }, [occurrences]);

  const selectedCount = occurrences.filter((o) => {
    const key = occKey(o);
    return selected.has(key) && assignments[key] != null && assignments[key] !== UNASSIGNED;
  }).length;

  async function handleImport() {
    if (selectedCount === 0) return;
    setImporting(true);
    setError(null);
    setImportWarning(null);
    const failures: string[] = [];
    try {
      for (const o of occurrences) {
        const key = occKey(o);
        if (!selected.has(key)) continue;
        const activityId = assignments[key];
        if (activityId == null || activityId === UNASSIGNED) continue;
        const input: NewTimeEntry = {
          activityId,
          date: o.date,
          startTime: o.startTime,
          endTime: o.endTime,
          notes: o.summary || "Imported from calendar",
        };
        try {
          await createTimeEntry(input);
        } catch (e) {
          failures.push(`${o.summary || o.date} -- ${e}`);
        }
      }
      onImported();
      if (failures.length > 0) {
        setImportWarning(`Imported, but ${failures.length} block${failures.length === 1 ? "" : "s"} failed -- ${failures.join("; ")}`);
      } else {
        onClose();
      }
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card import-qdm-card import-ics-card" onClick={(e) => e.stopPropagation()}>
        <h2>Import from Outlook Calendar</h2>
        <p className="muted">
          Paste your shared calendar's link (Outlook: Calendar settings → Shared calendars → Publish a calendar,
          copy the ICS link). Only events on the days currently shown on the Timesheet are pulled in.
        </p>

        <div className="import-ics-source">
          <div className="import-ics-url-row">
            <label className="field">
              <span>Calendar link (.ics)</span>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://outlook.office.com/owa/calendar/.../calendar.ics"
                onKeyDown={(e) => e.key === "Enter" && handleFetch()}
              />
            </label>
            <button type="button" className="btn btn-secondary" onClick={handleFetch} disabled={!url.trim() || status === "loading"}>
              {status === "loading" ? "Fetching…" : "Fetch Events"}
            </button>
          </div>
          <button type="button" className="link-button" onClick={() => setShowPaste((v) => !v)}>
            {showPaste ? "Hide paste option" : "Or paste .ics file contents instead"}
          </button>
          {showPaste && (
            <div className="import-ics-paste-row">
              <label className="field">
                <span>.ics contents</span>
                <textarea
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                  placeholder="BEGIN:VCALENDAR..."
                  rows={4}
                />
              </label>
              <button type="button" className="btn btn-secondary" onClick={handleParsePasted} disabled={!pastedText.trim()}>
                Parse
              </button>
            </div>
          )}
        </div>

        <div className="qdm-scroll-area">
          {status === "error" && <p className="status status-error">{error}</p>}

          {status === "loaded" && (
            <>
              {occurrences.length === 0 ? (
                <p className="muted">
                  No events found on the days shown{skippedExisting > 0 ? ` (${skippedExisting} already on your timesheet were skipped)` : ""}.
                </p>
              ) : (
                <>
                  <div className="qdm-column-headers">
                    <span className="qdm-select-controls">
                      Events
                      <button type="button" className="link-button" onClick={selectAll}>
                        Select All
                      </button>
                      <button type="button" className="link-button" onClick={deselectAll}>
                        Deselect All
                      </button>
                    </span>
                    <span>Assign to Activity</span>
                  </div>
                  {skippedExisting > 0 && (
                    <p className="muted">{skippedExisting} event{skippedExisting === 1 ? "" : "s"} already on your timesheet skipped.</p>
                  )}

                  <div className="qdm-groups">
                    {days
                      .map(toISODate)
                      .filter((dateKey) => grouped.has(dateKey))
                      .map((dateKey) => (
                        <div key={dateKey} className="qdm-group">
                          <div className="qdm-group-header">
                            <span>{formatDayLabel(dateKey)}</span>
                            <span className="muted">({grouped.get(dateKey)!.length})</span>
                          </div>
                          <ul className="qdm-list">
                            {grouped.get(dateKey)!.map((o) => (
                              <OccurrenceRow
                                key={occKey(o)}
                                occurrence={o}
                                checked={selected.has(occKey(o))}
                                onToggle={() => toggle(occKey(o))}
                                activities={activities}
                                activitiesByProject={activitiesByProject}
                                projects={projects}
                                activityId={assignments[occKey(o)] ?? UNASSIGNED}
                                onSelect={(value) => setAssignments((prev) => ({ ...prev, [occKey(o)]: Number(value) }))}
                              />
                            ))}
                          </ul>
                        </div>
                      ))}
                  </div>
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
          <button
            type="button"
            className="btn btn-accent"
            disabled={status !== "loaded" || selectedCount === 0 || importing}
            onClick={handleImport}
          >
            {importing ? "Importing…" : `Import Selected (${selectedCount})`}
          </button>
        </div>
      </div>
    </div>
  );
}

function OccurrenceRow({
  occurrence,
  checked,
  onToggle,
  activities,
  activitiesByProject,
  projects,
  activityId,
  onSelect,
}: {
  occurrence: IcsOccurrence;
  checked: boolean;
  onToggle: () => void;
  activities: Activity[];
  activitiesByProject: Map<number, Activity[]>;
  projects: Project[];
  activityId: number;
  onSelect: (value: string) => void;
}) {
  const unassignedActivities = activities.filter((a) => a.projectId == null);
  return (
    <li className="qdm-row">
      <label className="qdm-row-label">
        <input type="checkbox" checked={checked} onChange={onToggle} />
        <span className="badge">
          {occurrence.startTime}–{occurrence.endTime}
        </span>
        <span className="qdm-row-summary">{occurrence.summary || "(no title)"}</span>
      </label>
      <Dropdown
        className={"qdm-row-project" + (activityId === UNASSIGNED ? " qdm-row-project-unsorted" : "")}
        value={activityId === UNASSIGNED ? "" : activityId}
        onChange={onSelect}
        placeholder="Choose an Activity…"
      >
        {projects.map((project) => {
          const list = activitiesByProject.get(project.id);
          if (!list || list.length === 0) return null;
          return (
            <DropdownGroup key={project.id} label={project.name}>
              {list.map((a) => (
                <DropdownOption key={a.id} value={a.id}>
                  {a.name}
                </DropdownOption>
              ))}
            </DropdownGroup>
          );
        })}
        {unassignedActivities.length > 0 && (
          <DropdownGroup label="Other">
            {unassignedActivities.map((a) => (
              <DropdownOption key={a.id} value={a.id}>
                {a.name}
              </DropdownOption>
            ))}
          </DropdownGroup>
        )}
      </Dropdown>
    </li>
  );
}
