import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { createTimeEntry, deleteTimeEntry, listTimeEntries, updateTimeEntry, type TimeEntry } from "../api/calendar";
import {
  createActivity,
  listActivities,
  listProjects,
  setProjectCollapsed,
  type Activity,
  type Project,
} from "../api/activities";
import { ActivitySidebar } from "../components/ActivitySidebar";
import { CalendarGrid } from "../components/CalendarGrid";
import { CreateEntryModal } from "../components/CreateEntryModal";
import { EditEntryModal } from "../components/EditEntryModal";
import { addDays, minutesToTime, timeToMinutes, toISODate, weekStart } from "../lib/date";
import type { AppSettings } from "../api/settings";

const DEFAULT_DURATION_MINUTES = 30;
const NUDGE_MINUTES = 15;
const ZOOM_MIN = 0.7;
const ZOOM_MAX = 1.3;
const ZOOM_STEP = 0.1;
const UNDO_LIMIT = 50;
const DEFAULT_SIDEBAR_WIDTH = 210;
const MIN_SIDEBAR_WIDTH = 160;
const MAX_SIDEBAR_WIDTH = 420;
const SIDEBAR_TOGGLE_DRAG_THRESHOLD_PX = 4;

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

export function CalendarScreen({ settings }: { settings: AppSettings }) {
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
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(true);

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

  useEffect(() => {
    listProjects().then(setProjects).catch((e) => setError(String(e)));
    listActivities().then(setActivities).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    refreshEntries();
  }, [refreshEntries]);

  const armedActivity = activities.find((a) => a.id === armedActivityId) ?? null;

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

  function handleSidebarResizeStart(e: ReactPointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    setResizingSidebar(true);

    function onMove(ev: PointerEvent) {
      const next = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, startWidth + (ev.clientX - startX)));
      setSidebarWidth(next);
    }
    function onUp() {
      setResizingSidebar(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  // The toggle button itself: a plain click (released before crossing the
  // threshold) toggles visibility, same as before; holding and moving past
  // it resizes instead, same gesture as the bare handle strip. Collapsed,
  // there's nothing to resize, so any press there just re-expands.
  function handleToggleButtonPointerDown(e: ReactPointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (!sidebarVisible) {
      setSidebarVisible(true);
      return;
    }

    const startX = e.clientX;
    const startWidth = sidebarWidth;
    let moved = false;

    function onMove(ev: PointerEvent) {
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) > SIDEBAR_TOGGLE_DRAG_THRESHOLD_PX) {
        moved = true;
        setResizingSidebar(true);
      }
      if (moved) {
        setSidebarWidth(Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, startWidth + dx)));
      }
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setResizingSidebar(false);
      if (!moved) setSidebarVisible((v) => !v);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
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
      setActivities((prev) => [...prev, activity]);
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

  async function handleDuplicate(entry: TimeEntry) {
    if (entry.activityId == null) return;
    try {
      const created = await createTimeEntry({
        activityId: entry.activityId,
        date: entry.date,
        startTime: entry.startTime,
        endTime: entry.endTime,
        notes: entry.notes,
      });
      pushCommand({ kind: "add", entry: created });
      refreshEntries();
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
      <div className="calendar-toolbar">
        <div className="row">
          <button className="btn btn-secondary" onClick={() => setAnchorDate((d) => addDays(d, -7))}>
            ‹ Prev
          </button>
          <button className="btn btn-secondary" onClick={() => setAnchorDate(new Date())}>
            Today
          </button>
          <button className="btn btn-secondary" onClick={() => setAnchorDate((d) => addDays(d, 7))}>
            Next ›
          </button>
        </div>
        <div className="calendar-week-label">
          {days[0].toLocaleDateString(undefined, { month: "short", day: "numeric" })} –{" "}
          {days[days.length - 1].toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
        </div>
        <div className="row">
          <button
            className="btn btn-secondary"
            onClick={() => setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)))}
          >
            −
          </button>
          <span className="muted">{Math.round(zoom * 100)}%</span>
          <button
            className="btn btn-secondary"
            onClick={() => setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)))}
          >
            +
          </button>
        </div>
        {selectedEntryId != null && (
          <button className="btn btn-danger" onClick={() => handleDelete(selectedEntryId)}>
            Delete selected block
          </button>
        )}
      </div>

      {error && <p className="status status-error">{error}</p>}

      <div className="calendar-body">
        {sidebarVisible && (
          <ActivitySidebar
            projects={projects}
            activities={activities}
            armedActivityId={armedActivityId}
            onArm={setArmedActivityId}
            onToggleCollapse={handleToggleCollapse}
            width={sidebarWidth}
          />
        )}
        <div
          className={
            "calendar-resize-handle" +
            (resizingSidebar ? " calendar-resize-handle-active" : "") +
            (!sidebarVisible ? " calendar-resize-handle-collapsed" : "")
          }
          onPointerDown={sidebarVisible ? handleSidebarResizeStart : undefined}
          onClick={!sidebarVisible ? () => setSidebarVisible(true) : undefined}
        >
          <button
            type="button"
            className={"calendar-resize-toggle" + (resizingSidebar ? " calendar-resize-toggle-active" : "")}
            title={sidebarVisible ? "Hide sidebar (drag to resize)" : "Show sidebar"}
            onPointerDown={handleToggleButtonPointerDown}
          >
            {sidebarVisible ? "◂" : "▸"}
          </button>
        </div>
        <CalendarGrid
          days={days}
          startHour={settings.workStartHour}
          endHour={settings.workEndHour}
          entries={entries}
          zoom={zoom}
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
        />
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
    </div>
  );
}
