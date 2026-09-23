import { useEffect, useMemo, useRef, useState } from "react";
import { fetchIcsCalendar } from "../api/ics";
import { createTimeEntry, type NewTimeEntry, type TimeEntry } from "../api/calendar";
import type { Activity, Project } from "../api/activities";
import { listOutlookCalendars, type OutlookCalendar } from "../api/outlookCalendars";
import { toISODate } from "../lib/date";
import { occurrencesForDays, parseIcsEvents, type IcsOccurrence } from "../lib/ics";
import { Dropdown, DropdownGroup, DropdownOption } from "./Dropdown";

type Status = "idle" | "loading" | "loaded" | "error";

// Sentinel for a row with no Activity chosen yet -- distinct from any real
// Activity id (always a positive database row), same pattern as
// ImportQdmModal's UNSORTED bucket.
const UNASSIGNED = -1;

/** Which saved calendar (or "Pasted" for the manual .ics-contents path) an
 * occurrence came from -- shown as a small tag on its row now that more
 * than one source can be merged together, so it's clear which is which. */
type SourcedOccurrence = IcsOccurrence & { sourceLabel: string };

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

/** Search + review panel for pulling meetings out of one or more published
 * Outlook (or Google) "shared calendar" .ics links and creating a time
 * block for each one picked -- see src-tauri/src/ics.rs for the fetch and
 * src/lib/ics.ts for the parsing/recurrence expansion. Scoped to whichever
 * days are currently shown on the Timesheet (`days`), same as the rest of
 * this screen. An occurrence whose date/start/end already matches an
 * existing block this week is treated as already imported and left out.
 * Every calendar saved in Settings → Outlook Calendars is fetched
 * automatically on open and merged into one reviewable list (deduplicated
 * by uid+date+start-time, in case the same meeting genuinely appears on
 * more than one of them) -- so with at least one saved, opening this modal
 * goes straight to reviewing this week's events instead of pasting a link
 * in every time. The manual link/paste fields below stay available as a
 * one-off addition on top of that, for a calendar not worth saving
 * permanently -- merged in the same way, not a replacement for it. */
export function ImportOutlookModal({
  activities,
  projects,
  entries,
  days,
  onImported,
  onClose,
}: {
  activities: Activity[];
  projects: Project[];
  entries: TimeEntry[];
  days: Date[];
  onImported: () => void;
  onClose: () => void;
}) {
  const [url, setUrl] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [pastedText, setPastedText] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [occurrences, setOccurrences] = useState<SourcedOccurrence[]>([]);
  const [skippedExisting, setSkippedExisting] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignments, setAssignments] = useState<Record<string, number>>({});
  const [importing, setImporting] = useState(false);
  const [importWarning, setImportWarning] = useState<string | null>(null);
  // Every occurrence merged in so far, across every fetch/paste this modal
  // session -- kept separately from `occurrences` (the deduplicated,
  // already-imported-filtered view actually rendered) so a second merge
  // has the full history to re-dedupe against, not just what's currently
  // on screen.
  const rawPoolRef = useRef<SourcedOccurrence[]>([]);

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

  // Merges newly-parsed occurrences into the running pool (deduplicating by
  // uid+date+start-time against everything merged in so far, not just this
  // batch -- the same meeting can genuinely appear on more than one saved
  // calendar), re-filters against already-imported entries, and updates
  // selection/assignments for whatever's newly appeared without disturbing
  // choices already made for occurrences from an earlier merge.
  function mergeOccurrences(fresh: SourcedOccurrence[]) {
    const known = new Set(rawPoolRef.current.map(occKey));
    const toAdd = fresh.filter((o) => !known.has(occKey(o)));
    rawPoolRef.current = [...rawPoolRef.current, ...toAdd];

    const existingKeys = new Set(entries.map((e) => `${e.date}__${e.startTime}__${e.endTime}`));
    const notAlreadyOnTimesheet = rawPoolRef.current.filter(
      (o) => !existingKeys.has(`${o.date}__${o.startTime}__${o.endTime}`),
    );
    setSkippedExisting(rawPoolRef.current.length - notAlreadyOnTimesheet.length);
    setOccurrences(notAlreadyOnTimesheet);

    setSelected((prev) => {
      const next = new Set(prev);
      for (const o of toAdd) next.add(occKey(o));
      return next;
    });
    setAssignments((prev) => {
      const next = { ...prev };
      for (const o of toAdd) {
        const match = autoMatchActivity(o.summary, activities);
        next[occKey(o)] = match?.id ?? UNASSIGNED;
      }
      return next;
    });
  }

  function loadFromText(text: string, sourceLabel: string) {
    const events = parseIcsEvents(text);
    const occs = occurrencesForDays(events, days).map((o) => ({ ...o, sourceLabel }));
    mergeOccurrences(occs);
  }

  /** Never rejects -- a failed calendar reports itself as {ok:false} rather
   * than losing which calendar it was via Promise.allSettled's separate
   * rejection reason, so a partial failure can still name which one(s)
   * failed alongside the results from the rest. */
  async function fetchOne(cal: { label: string; icsUrl: string }) {
    try {
      const text = await fetchIcsCalendar(cal.icsUrl);
      return { label: cal.label, ok: true as const, text };
    } catch (e) {
      return { label: cal.label, ok: false as const, error: String(e) };
    }
  }

  async function fetchAndMergeAll(cals: OutlookCalendar[]) {
    if (cals.length === 0) return;
    setStatus("loading");
    setError(null);
    const results = await Promise.all(cals.map(fetchOne));
    const failedLabels = results.filter((r) => !r.ok).map((r) => r.label);
    for (const r of results) {
      if (!r.ok) continue;
      try {
        loadFromText(r.text, r.label);
      } catch {
        // A calendar returning content that fails to parse is reported the
        // same as a fetch failure, not silently dropped.
        failedLabels.push(r.label);
      }
    }
    setStatus("loaded");
    setError(
      failedLabels.length > 0
        ? `Couldn't fetch ${failedLabels.join(", ")} -- showing results from the rest.`
        : null,
    );
  }

  async function handleFetch() {
    if (!url.trim()) return;
    setStatus("loading");
    setError(null);
    try {
      const text = await fetchIcsCalendar(url.trim());
      loadFromText(text, "Pasted link");
      setStatus("loaded");
    } catch (e) {
      setError(String(e));
      setStatus(occurrences.length > 0 ? "loaded" : "error");
    }
  }

  // Fetches every calendar saved in Settings on open -- nothing to do if
  // none are saved yet, same as the old single-URL version's own guard.
  useEffect(() => {
    listOutlookCalendars()
      .then(fetchAndMergeAll)
      .catch((e) => {
        setError(String(e));
        setStatus("error");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleParsePasted() {
    if (!pastedText.trim()) return;
    try {
      loadFromText(pastedText, "Pasted");
      setStatus("loaded");
    } catch (e) {
      setError(String(e));
      setStatus(occurrences.length > 0 ? "loaded" : "error");
    }
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
    const map = new Map<string, SourcedOccurrence[]>();
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
          Events from every calendar saved in Settings → Outlook Calendars are fetched and merged below.
          Only events on the days currently shown on the Timesheet are pulled in. Add a one-off link here
          too if you have one that's not worth saving permanently.
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
  occurrence: SourcedOccurrence;
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
        <span className="qdm-row-source">{occurrence.sourceLabel}</span>
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
