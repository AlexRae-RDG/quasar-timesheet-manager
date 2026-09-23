import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createTimeEntry, deleteTimeEntry, listTimeEntries, updateTimeEntry, type TimeEntry } from "../api/calendar";
import {
  archiveActivity,
  createActivity,
  listActivities,
  listProjects,
  setProjectCollapsed,
  updateActivity,
  type Activity,
  type Project,
} from "../api/activities";
import { closeJiraIssue, reopenJiraIssue } from "../api/jira";
import { applyTemplateToWeek } from "../api/templates";
import { ActivitySidebar } from "../components/ActivitySidebar";
import { useNavActionsSlot } from "../components/AppShell";
import { CalendarGrid } from "../components/CalendarGrid";
import { CreateEntryModal } from "../components/CreateEntryModal";
import { EditActivityModal, type ActivityFormValues } from "../components/EditActivityModal";
import { EditEntryModal } from "../components/EditEntryModal";
import { ImportOutlookModal } from "../components/ImportOutlookModal";
import { JiraIcon } from "../components/JiraIcon";
import { UploadToJiraModal } from "../components/UploadToJiraModal";
import { addDays, minutesToTime, timeToMinutes, toISODate, weekStart } from "../lib/date";
import { useResizableSidebar } from "../lib/useResizableSidebar";
import { projectKeyForDepartment, setSidebarWidth, type AppSettings } from "../api/settings";

type ActivityModalState = { mode: "new"; projectId: number } | { mode: "edit"; activity: Activity } | null;

const DEFAULT_DURATION_MINUTES = 30;
const NUDGE_MINUTES = 15;
const ZOOM_MIN = 0.7;
const ZOOM_MAX = 1.3;
const ZOOM_STEP = 0.1;
const UNDO_LIMIT = 50;
const MIN_SIDEBAR_WIDTH = 160;
const MAX_SIDEBAR_WIDTH = 420;

interface EntryFields {
  // API-ready, not just descriptive: null means "leave this entry's
  // Activity alone" (see api/calendar.ts's UpdateTimeEntry) -- a plain
  // move/resize command stores null on both sides so undo/redo never
  // forces an activity_id onto an entry that's genuinely unassigned
  // (activities.ON DELETE SET NULL means this happens in real data).
  activityId: number | null;
  date: string;
  startTime: string;
  endTime: string;
  notes: string;
}

type Command =
  | { kind: "add"; entry: TimeEntry }
  | { kind: "remove"; entry: TimeEntry }
  | { kind: "update"; id: number; before: EntryFields; after: EntryFields };

export function CalendarScreen({
  settings,
  onChange,
}: {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}) {
  const navActionsSlot = useNavActionsSlot();
  const teamKey = projectKeyForDepartment(settings.department);
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [projects, setProjects] = useState<Project[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [armedActivityId, setArmedActivityId] = useState<number | null>(null);
  const [selectedEntryId, setSelectedEntryId] = useState<number | null>(null);
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
  const [creatingEntry, setCreatingEntry] = useState<{ date: string; startTime: string; endTime: string } | null>(
    null,
  );
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [applyStatus, setApplyStatus] = useState<string | null>(null);
  const sidebar = useResizableSidebar({
    defaultWidth: settings.sidebarWidth,
    minWidth: MIN_SIDEBAR_WIDTH,
    maxWidth: MAX_SIDEBAR_WIDTH,
    onResizeEnd: (width) => {
      onChange({ sidebarWidth: width });
      setSidebarWidth(width).catch(() => {});
    },
  });
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [archivedBlock, setArchivedBlock] = useState<TimeEntry[] | null>(null);
  // Two separate pieces rather than one: dismissing the popup ("Got it")
  // shouldn't also clear the red highlight on the grid -- that's the whole
  // point of it, staying visible as a to-do list of exactly which blocks
  // still need a Note, until each one's actually fixed (checked live
  // against entries in CalendarGrid, not a frozen snapshot here).
  const [missingNotesEntries, setMissingNotesEntries] = useState<TimeEntry[] | null>(null);
  const [showMissingNotesPopup, setShowMissingNotesPopup] = useState(false);
  const [activityModal, setActivityModal] = useState<ActivityModalState>(null);
  const [importOutlookOpen, setImportOutlookOpen] = useState(false);

  const entriesRef = useRef<TimeEntry[]>([]);
  entriesRef.current = entries;

  const undoStack = useRef<Command[]>([]);
  const redoStack = useRef<Command[]>([]);

  const days = useMemo(() => {
    const start = weekStart(anchorDate);
    const count = settings.showWeekends ? 7 : 5;
    return Array.from({ length: count }, (_, i) => addDays(start, i));
  }, [anchorDate, settings.showWeekends]);

  const rangeStart = toISODate(days[0]);
  const rangeEnd = toISODate(days[days.length - 1]);

  const refreshEntries = useCallback(() => {
    listTimeEntries(rangeStart, rangeEnd).then(setEntries).catch((e) => setError(String(e)));
  }, [rangeStart, rangeEnd]);

  // Work hours are just the *default* visible range, not a hard clip --
  // widened to cover any real entry this week falls outside of (an
  // accidental Timer bar click before/after hours, most often), so
  // there's never a block that exists in the database but is impossible
  // to see, select, or delete because it's silently off the rendered
  // grid. Nothing to widen for and no entries yet both fall back to the
  // configured hours unchanged.
  const gridStartHour = useMemo(() => {
    let hour = settings.workStartHour;
    for (const e of entries) {
      hour = Math.min(hour, Math.floor(timeToMinutes(e.startTime) / 60));
    }
    return Math.max(0, hour);
  }, [entries, settings.workStartHour]);

  const gridEndHour = useMemo(() => {
    let hour = settings.workEndHour;
    for (const e of entries) {
      hour = Math.max(hour, Math.ceil(timeToMinutes(e.endTime) / 60));
    }
    return Math.min(24, hour);
  }, [entries, settings.workEndHour]);

  const refreshActivities = useCallback(() => {
    listProjects().then(setProjects).catch((e) => setError(String(e)));
    listActivities().then(setActivities).catch((e) => setError(String(e)));
  }, []);

  useEffect(refreshActivities, [refreshActivities]);

  useEffect(() => {
    refreshEntries();
  }, [refreshEntries]);

  // The Timer bar (AppShell, always mounted regardless of active tab) logs
  // straight to today's date via its own createTimeEntry call, bypassing
  // this screen entirely -- if today happens to fall in the week currently
  // shown, pull that block in without needing a manual refresh or a
  // tab-away-and-back.
  useEffect(() => {
    function onLogged() {
      refreshEntries();
    }
    window.addEventListener("quasar:time-entry-logged", onLogged);
    return () => window.removeEventListener("quasar:time-entry-logged", onLogged);
  }, [refreshEntries]);

  const armedActivity = activities.find((a) => a.id === armedActivityId) ?? null;

  const missingNotesEntryIds = useMemo(
    () => (missingNotesEntries ? new Set(missingNotesEntries.map((e) => e.id)) : undefined),
    [missingNotesEntries],
  );

  function handleToggleCollapse(projectId: number) {
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;
    const collapsed = !project.collapsed;
    // Optimistic: flips instantly, persists in the background. Worth doing
    // here since this fires on every sidebar click and a round trip before
    // the chevron responds would feel laggy for something this small.
    setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, collapsed } : p)));
    setProjectCollapsed(projectId, collapsed).catch((e) => setError(String(e)));
  }

  function isArchivedProjectId(projectId: number | null): boolean {
    const project = projects.find((p) => p.id === projectId);
    return !!project && project.name.trim().toLowerCase() === "archived";
  }

  // Mirrors ActivitiesScreen's handleSaveActivity/handleArchiveActivity --
  // the sidebar's hover pencil/+ open the same Edit/New Activity modal
  // rather than a separate inline editor, so quick fixes from Timesheet
  // stay in sync with the same Jira reopen/close pairing the Activities tab
  // already does, instead of drifting into a second, simpler edit path.
  async function handleSaveActivity(values: ActivityFormValues) {
    try {
      const input = {
        name: values.name,
        projectId: values.projectId,
        jiraKey: values.jiraKey || undefined,
        defaultDurationMinutes: values.defaultDurationMinutes ? Number(values.defaultDurationMinutes) : undefined,
        jiraProject: values.jiraProject || undefined,
      };
      if (activityModal?.mode === "edit") {
        const wasArchived = isArchivedProjectId(activityModal.activity.projectId);
        const saved = await updateActivity({ id: activityModal.activity.id, ...input });
        if (wasArchived && !isArchivedProjectId(values.projectId) && saved.jiraKey && settings.hasJiraToken) {
          try {
            await reopenJiraIssue(settings.jiraSiteUrl, settings.email, saved.jiraKey);
          } catch (e) {
            setError(`Saved, but couldn't reopen ${saved.jiraKey} in Jira -- ${e}`);
          }
        }
      } else {
        await createActivity(input);
      }
      setActivityModal(null);
      refreshActivities();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleArchiveActivityModal() {
    if (activityModal?.mode !== "edit") return;
    const { activity } = activityModal;
    try {
      if (activity.jiraKey && settings.hasJiraToken) {
        try {
          await closeJiraIssue(settings.jiraSiteUrl, settings.email, activity.jiraKey);
        } catch (e) {
          setError(`Archived locally, but couldn't close ${activity.jiraKey} in Jira -- ${e}`);
        }
      }
      await archiveActivity(activity.id);
      setActivityModal(null);
      refreshActivities();
    } catch (e) {
      setError(String(e));
    }
  }

  const pushCommand = (cmd: Command) => {
    undoStack.current.push(cmd);
    if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift();
    redoStack.current = [];
  };

  async function handleCreate(activityId: number, date: string, startTime: string, endTime: string) {
    try {
      const created = await createTimeEntry({ activityId, date, startTime, endTime });
      pushCommand({ kind: "add", entry: created });
      // Disarm after a successful placement so the next drag/click on the
      // grid doesn't silently log more time against the same Activity.
      setArmedActivityId(null);
      refreshEntries();
    } catch (e) {
      setError(String(e));
    }
  }

  function handleRequestCreate(date: string, startTime: string, endTime: string) {
    setCreatingEntry({ date, startTime, endTime });
  }

  async function handleCreateFromModal(activityId: number, notes: string) {
    if (!creatingEntry) return;
    try {
      const created = await createTimeEntry({ activityId, notes, ...creatingEntry });
      pushCommand({ kind: "add", entry: created });
      setCreatingEntry(null);
      refreshEntries();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleCreateWithNewActivity(name: string, projectId: number, notes: string) {
    if (!creatingEntry) return;
    try {
      const activity = await createActivity({ name, projectId });
      // Guarding on id presence protects against React Strict Mode
      // invoking this updater more than once in dev -- see the identical
      // fix (and its rationale) on ActivitiesScreen's onProjectCreated.
      setActivities((prev) => (prev.some((a) => a.id === activity.id) ? prev : [...prev, activity]));
      const created = await createTimeEntry({ activityId: activity.id, notes, ...creatingEntry });
      pushCommand({ kind: "add", entry: created });
      setCreatingEntry(null);
      refreshEntries();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleMove(id: number, date: string, startTime: string, endTime: string) {
    const entry = entriesRef.current.find((e) => e.id === id);
    if (!entry) return;
    // activityId: null on both sides -- a move/resize never touches which
    // Activity (or lack of one) this entry belongs to.
    const before: EntryFields = {
      activityId: null,
      date: entry.date,
      startTime: entry.startTime,
      endTime: entry.endTime,
      notes: entry.notes,
    };
    const after: EntryFields = { ...before, date, startTime, endTime };
    try {
      await updateTimeEntry({ id, ...after });
      pushCommand({ kind: "update", id, before, after });
      refreshEntries();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleDuplicate(
    entry: TimeEntry,
    options?: { openEdit?: boolean; date?: string; startTime?: string; endTime?: string },
  ) {
    if (entry.activityId == null) return;
    try {
      const created = await createTimeEntry({
        activityId: entry.activityId,
        date: options?.date ?? entry.date,
        startTime: options?.startTime ?? entry.startTime,
        endTime: options?.endTime ?? entry.endTime,
        notes: entry.notes,
      });
      pushCommand({ kind: "add", entry: created });
      refreshEntries();
      // Shift+click's whole point is "duplicate this, then let me fill in
      // Notes right away" -- jumping straight to Edit saves the extra
      // double-click that plain Ctrl/Cmd+click duplication would still need.
      if (options?.openEdit) setEditingEntry(created);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleDelete(id: number) {
    const entry = entriesRef.current.find((e) => e.id === id);
    try {
      await deleteTimeEntry(id);
      if (entry) pushCommand({ kind: "remove", entry });
      setSelectedEntryId(null);
      refreshEntries();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleEditSave(activityId: number, notes: string) {
    if (!editingEntry) return;
    // Unlike handleMove, this command's `before.activityId` is a real
    // snapshot (possibly null for a genuinely unassigned entry) rather
    // than an API-style "don't touch" -- so undoing an edit that assigned
    // an Activity to a previously-unassigned entry re-sends that same
    // Activity (the API has no "unassign" -- see UpdateTimeEntry) instead
    // of truly restoring the unassigned state. A rare edge case, not
    // worth a third API mode for.
    const before: EntryFields = {
      activityId: editingEntry.activityId,
      date: editingEntry.date,
      startTime: editingEntry.startTime,
      endTime: editingEntry.endTime,
      notes: editingEntry.notes,
    };
    const after: EntryFields = { ...before, activityId, notes };
    try {
      await updateTimeEntry({ id: editingEntry.id, ...after });
      pushCommand({ kind: "update", id: editingEntry.id, before, after });
      setEditingEntry(null);
      refreshEntries();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleEditDelete() {
    if (!editingEntry) return;
    await handleDelete(editingEntry.id);
    setEditingEntry(null);
  }

  // Applies to whichever week is currently displayed (rangeStart is always
  // that week's Monday), not always "today's" week -- lets Prev/Next be
  // used to pre-fill a future or past week from the template.
  async function handleApplyToWeek() {
    setApplyStatus(null);
    try {
      const result = await applyTemplateToWeek(rangeStart);
      setApplyStatus(
        result.skipped > 0
          ? `Applied ${result.applied} block${result.applied === 1 ? "" : "s"} from the template -- skipped ${result.skipped} that would have overlapped existing time.`
          : `Applied ${result.applied} block${result.applied === 1 ? "" : "s"} from the template.`,
      );
      refreshEntries();
    } catch (e) {
      setError(String(e));
    }
  }

  // A QDM that's Closed in Jira lives under the "Archived" Project locally
  // (see ImportQdmModal) -- that's the only signal this screen has for
  // "closed" without an extra live Jira lookup per entry, so it doubles as
  // the upload guard: clicking Upload to Jira with any of this week's
  // linked-but-not-yet-uploaded blocks still filed there stops short of the
  // review modal and explains why, instead of letting Jira's own worklog
  // rejection be the first the user hears of it.
  function isEntryArchived(entry: TimeEntry): boolean {
    if (entry.activityId == null) return false;
    const activity = activities.find((a) => a.id === entry.activityId);
    if (!activity || activity.projectId == null) return false;
    const project = projects.find((p) => p.id === activity.projectId);
    return !!project && project.name.trim().toLowerCase() === "archived";
  }

  function handleUploadClick() {
    const blocked = entries.filter((e) => e.jiraKey && !e.jiraUploadedAt && isEntryArchived(e));
    if (blocked.length > 0) {
      setArchivedBlock(blocked);
      return;
    }
    // Notes become the worklog's comment on upload (see UploadToJiraModal) --
    // an empty one silently logs time against a QDM with no explanation of
    // what it was for, which is worse than just stopping short here and
    // pointing at exactly which blocks still need one.
    const missingNotes = entries.filter((e) => e.jiraKey && !e.jiraUploadedAt && !e.notes.trim());
    if (missingNotes.length > 0) {
      setMissingNotesEntries(missingNotes);
      setShowMissingNotesPopup(true);
      return;
    }
    setMissingNotesEntries(null);
    setUploadModalOpen(true);
  }

  const handleUndo = useCallback(async () => {
    const cmd = undoStack.current.pop();
    if (!cmd) return;
    try {
      if (cmd.kind === "add") {
        await deleteTimeEntry(cmd.entry.id);
      } else if (cmd.kind === "remove") {
        if (cmd.entry.activityId == null) return;
        const recreated = await createTimeEntry({
          activityId: cmd.entry.activityId,
          date: cmd.entry.date,
          startTime: cmd.entry.startTime,
          endTime: cmd.entry.endTime,
          notes: cmd.entry.notes,
        });
        cmd.entry = { ...cmd.entry, id: recreated.id };
      } else {
        await updateTimeEntry({ id: cmd.id, ...cmd.before });
      }
      redoStack.current.push(cmd);
      refreshEntries();
    } catch (e) {
      setError(String(e));
    }
  }, [refreshEntries]);

  const handleRedo = useCallback(async () => {
    const cmd = redoStack.current.pop();
    if (!cmd) return;
    try {
      if (cmd.kind === "add") {
        if (cmd.entry.activityId == null) return;
        const recreated = await createTimeEntry({
          activityId: cmd.entry.activityId,
          date: cmd.entry.date,
          startTime: cmd.entry.startTime,
          endTime: cmd.entry.endTime,
          notes: cmd.entry.notes,
        });
        cmd.entry = { ...cmd.entry, id: recreated.id };
      } else if (cmd.kind === "remove") {
        await deleteTimeEntry(cmd.entry.id);
      } else {
        await updateTimeEntry({ id: cmd.id, ...cmd.after });
      }
      undoStack.current.push(cmd);
      refreshEntries();
    } catch (e) {
      setError(String(e));
    }
  }, [refreshEntries]);

  const nudgeSelected = useCallback(
    (deltaMinutes: number, deltaDays: number) => {
      if (selectedEntryId == null) return;
      const entry = entriesRef.current.find((e) => e.id === selectedEntryId);
      if (!entry) return;
      const durationMin = timeToMinutes(entry.endTime) - timeToMinutes(entry.startTime);
      let newStartMin = timeToMinutes(entry.startTime) + deltaMinutes;
      newStartMin = Math.max(0, Math.min(24 * 60 - durationMin, newStartMin));
      const newDate = toISODate(addDays(new Date(entry.date + "T00:00:00"), deltaDays));
      handleMove(entry.id, newDate, minutesToTime(newStartMin), minutesToTime(newStartMin + durationMin));
    },
    [selectedEntryId], // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    function isTypingTarget(target: EventTarget | null) {
      const el = target as HTMLElement | null;
      return !!el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        handleRedo();
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedEntryId != null) {
        e.preventDefault();
        handleDelete(selectedEntryId);
        return;
      }
      if (e.key === "Escape") {
        setSelectedEntryId(null);
        setEditingEntry(null);
        setCreatingEntry(null);
        setArmedActivityId(null);
        return;
      }
      if (selectedEntryId != null) {
        if (e.key === "ArrowUp") {
          e.preventDefault();
          nudgeSelected(-NUDGE_MINUTES, 0);
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          nudgeSelected(NUDGE_MINUTES, 0);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          nudgeSelected(0, -1);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          nudgeSelected(0, 1);
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEntryId, handleUndo, handleRedo, nudgeSelected]);

  useEffect(() => {
    if (selectedEntryId == null) return;

    // "click", not "pointerdown": a button whose own onClick depends on
    // selectedEntryId (e.g. "Delete selected block") fires its click
    // handler before this bubbles up to document, so clearing selection
    // here doesn't race it -- pointerdown would fire first and unmount
    // that button before its own click ever landed.
    function onDocumentClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.closest(".calendar-entry")) return;
      setSelectedEntryId(null);
    }

    document.addEventListener("click", onDocumentClick);
    return () => document.removeEventListener("click", onDocumentClick);
  }, [selectedEntryId]);

  useEffect(() => {
    if (armedActivityId == null) return;

    // Right-click cancels an armed Activity the same way Escape does --
    // this app has no context menus of its own, so repurposing it here
    // doesn't take anything away.
    function onContextMenu(e: MouseEvent) {
      e.preventDefault();
      setArmedActivityId(null);
    }

    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, [armedActivityId]);

  return (
    <div className="calendar-screen">
      {navActionsSlot &&
        createPortal(
          <button className="btn btn-accent btn-icon" onClick={handleUploadClick} disabled={!settings.hasJiraToken}>
            <JiraIcon /> Upload to Jira
          </button>,
          navActionsSlot,
        )}

      <div className="calendar-body">
        {sidebar.visible && (
          <ActivitySidebar
            projects={projects}
            activities={activities}
            armedActivityId={armedActivityId}
            onArm={setArmedActivityId}
            onToggleCollapse={handleToggleCollapse}
            onEditActivity={(activity) => setActivityModal({ mode: "edit", activity })}
            onAddActivity={(projectId) => setActivityModal({ mode: "new", projectId })}
            width={sidebar.width}
          />
        )}
        <div
          className={
            "calendar-resize-handle" +
            (sidebar.resizing ? " calendar-resize-handle-active" : "") +
            (!sidebar.visible ? " calendar-resize-handle-collapsed" : "")
          }
          onPointerDown={sidebar.visible ? sidebar.handleResizeStart : undefined}
          onClick={!sidebar.visible ? () => sidebar.setVisible(true) : undefined}
        >
          <button
            type="button"
            className={"calendar-resize-toggle" + (sidebar.resizing ? " calendar-resize-toggle-active" : "")}
            title={sidebar.visible ? "Hide sidebar (drag to resize)" : "Show sidebar"}
            onPointerDown={sidebar.handleToggleButtonPointerDown}
            // A real click always fires pointerup THEN a native click, in
            // that order. Without this, a plain click that had just
            // collapsed the sidebar (via the pointerup handler above) let
            // that trailing click event bubble to the parent handle -- whose
            // own onClick re-shows the sidebar the instant !sidebar.visible
            // becomes true -- undoing the collapse in the same gesture that
            // caused it. Stopping it here only affects clicks that
            // originate on this button; the parent's own re-expand-by-click
            // (for clicking anywhere on the collapsed strip) is unaffected.
            onClick={(e) => e.stopPropagation()}
          >
            {sidebar.visible ? "◂" : "▸"}
          </button>
        </div>
        <div className="calendar-main">
          <div className="calendar-toolbar">
            <div className="segmented calendar-nav-pill" data-tour="calendar-nav-pill">
              <button type="button" className="segment" onClick={() => setAnchorDate((d) => addDays(d, -7))} aria-label="Previous week">
                ‹
              </button>
              <button type="button" className="segment" onClick={() => setAnchorDate(new Date())}>
                Today
              </button>
              <button type="button" className="segment" onClick={() => setAnchorDate((d) => addDays(d, 7))} aria-label="Next week">
                ›
              </button>
            </div>
            <div className="calendar-week-label">
              {days[0].toLocaleDateString(undefined, { month: "short", day: "numeric" })} –{" "}
              {days[days.length - 1].toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </div>
            <div className="calendar-toolbar-actions">
              {selectedEntryId != null && (
                <button className="btn btn-danger" onClick={() => handleDelete(selectedEntryId)}>
                  Delete selected block
                </button>
              )}
              <button className="btn btn-secondary" onClick={() => setImportOutlookOpen(true)} data-tour="import-outlook">
                Import from Outlook
              </button>
              <button className="btn btn-secondary" onClick={handleApplyToWeek} data-tour="apply-template">
                Apply Template to This Week
              </button>
            </div>
          </div>

          {error && <p className="status status-error">{error}</p>}
          {applyStatus && <p className="status status-success">{applyStatus}</p>}

          <CalendarGrid
            days={days}
            startHour={gridStartHour}
            endHour={gridEndHour}
            entries={entries}
            zoom={zoom}
            onZoomIn={() => setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)))}
            onZoomOut={() => setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)))}
            armedActivityId={armedActivityId}
            armedActivityColor={armedActivity?.color ?? null}
            armedDefaultDurationMinutes={armedActivity?.defaultDurationMinutes ?? DEFAULT_DURATION_MINUTES}
            selectedEntryId={selectedEntryId}
            onSelectEntry={setSelectedEntryId}
            onCreate={handleCreate}
            onRequestCreate={handleRequestCreate}
            onMove={handleMove}
            onDuplicate={handleDuplicate}
            onEditEntry={setEditingEntry}
            onDelete={handleDelete}
            missingNotesEntryIds={missingNotesEntryIds}
          />
        </div>
      </div>

      {editingEntry && (
        <EditEntryModal
          entry={editingEntry}
          activities={activities}
          onSave={handleEditSave}
          onDelete={handleEditDelete}
          onClose={() => setEditingEntry(null)}
        />
      )}

      {activityModal && (
        <EditActivityModal
          activity={activityModal.mode === "edit" ? activityModal.activity : null}
          projects={projects}
          defaultProjectId={activityModal.mode === "new" ? activityModal.projectId : null}
          settings={settings}
          onSave={handleSaveActivity}
          onArchive={activityModal.mode === "edit" ? handleArchiveActivityModal : undefined}
          onClose={() => setActivityModal(null)}
        />
      )}

      {creatingEntry && (
        <CreateEntryModal
          date={creatingEntry.date}
          startTime={creatingEntry.startTime}
          endTime={creatingEntry.endTime}
          activities={activities}
          projects={projects}
          onCreate={handleCreateFromModal}
          onCreateWithNewActivity={handleCreateWithNewActivity}
          onClose={() => setCreatingEntry(null)}
        />
      )}

      {importOutlookOpen && (
        <ImportOutlookModal
          activities={activities}
          projects={projects}
          entries={entries}
          days={days}
          savedIcsUrl={settings.outlookIcsUrl}
          onImported={refreshEntries}
          onClose={() => setImportOutlookOpen(false)}
        />
      )}

      {uploadModalOpen && (
        <UploadToJiraModal
          entries={entries}
          settings={settings}
          onUploaded={refreshEntries}
          onClose={() => setUploadModalOpen(false)}
        />
      )}

      {archivedBlock && (
        <div className="modal-backdrop" onClick={() => setArchivedBlock(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h2>Can't upload -- {teamKey} is closed</h2>
            <p className="muted">
              {archivedBlock.length} block{archivedBlock.length === 1 ? "" : "s"} this week{" "}
              {archivedBlock.length === 1 ? "is" : "are"} linked to a {teamKey} that's Closed in Jira (filed under
              "Archived"):
            </p>
            <ul className="qdm-list">
              {archivedBlock.map((e) => (
                <li key={e.id} className="qdm-row">
                  <span className="badge">{e.jiraKey}</span>
                  <span className="qdm-row-summary">{e.activityName}</span>
                </li>
              ))}
            </ul>
            <p className="muted">
              Reopen {archivedBlock.length === 1 ? "it" : "them"} first -- in Activities, open the Activity and
              change its Project away from "Archived" to reopen {archivedBlock.length === 1 ? "it" : "them"} in
              Jira automatically.
            </p>
            <div className="modal-actions">
              <div />
              <button type="button" className="btn btn-accent" onClick={() => setArchivedBlock(null)}>
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {showMissingNotesPopup && missingNotesEntries && (
        <div className="modal-backdrop" onClick={() => setShowMissingNotesPopup(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h2>Can't upload -- notes are missing</h2>
            <p className="muted">
              {missingNotesEntries.length} block{missingNotesEntries.length === 1 ? "" : "s"} this week{" "}
              {missingNotesEntries.length === 1 ? "has" : "have"} no Notes. Notes become the worklog's comment in
              Jira, so {missingNotesEntries.length === 1 ? "it's" : "they're"} required before uploading --
              highlighted in red on the grid until fixed.
            </p>
            <ul className="qdm-list">
              {missingNotesEntries.map((e) => (
                <li key={e.id} className="qdm-row">
                  <span className="badge">{e.jiraKey}</span>
                  <span className="qdm-row-summary">
                    {e.activityName} -- {e.date}, {e.startTime}–{e.endTime}
                  </span>
                </li>
              ))}
            </ul>
            <div className="modal-actions">
              <div />
              <button type="button" className="btn btn-accent" onClick={() => setShowMissingNotesPopup(false)}>
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
