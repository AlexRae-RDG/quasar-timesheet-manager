import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createTemplateEntry,
  deleteTemplateEntry,
  listTemplateEntries,
  updateTemplateEntry,
  type TemplateEntry,
} from "../api/templates";
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
import type { TimeEntry } from "../api/calendar";
import { ActivitySidebar } from "../components/ActivitySidebar";
import { CalendarGrid } from "../components/CalendarGrid";
import { CreateEntryModal } from "../components/CreateEntryModal";
import { EditActivityModal, type ActivityFormValues } from "../components/EditActivityModal";
import { EditEntryModal } from "../components/EditEntryModal";
import { addDays, toISODate, WEEKDAY_LABELS } from "../lib/date";
import { useResizableSidebar } from "../lib/useResizableSidebar";
import type { AppSettings } from "../api/settings";

type ActivityModalState = { mode: "new"; projectId: number } | { mode: "edit"; activity: Activity } | null;

const DEFAULT_DURATION_MINUTES = 30;
const ZOOM_MIN = 0.7;
const ZOOM_MAX = 1.3;
const ZOOM_STEP = 0.1;
const DEFAULT_SIDEBAR_WIDTH = 210;
const MIN_SIDEBAR_WIDTH = 160;
const MAX_SIDEBAR_WIDTH = 420;

// Template entries are keyed by day_of_week (0=Mon..4=Fri), not a real
// date, but CalendarGrid only knows how to key by date -- so it's driven
// here with a fixed, arbitrary Monday (confirmed a real Monday; never
// shown to the user, and far enough in the past that it can never collide
// with "today", which keeps CalendarGrid's own now-line/today-highlight
// logic naturally inert here without needing a prop to disable it).
const REFERENCE_MONDAY = new Date(2024, 0, 1);
const REFERENCE_DAYS = Array.from({ length: 5 }, (_, i) => addDays(REFERENCE_MONDAY, i));
const REFERENCE_ISO = REFERENCE_DAYS.map(toISODate);

function dateToDayOfWeek(date: string): number {
  const idx = REFERENCE_ISO.indexOf(date);
  return idx === -1 ? 0 : idx;
}

function dayOfWeekToDate(dayOfWeek: number): string {
  return REFERENCE_ISO[Math.max(0, Math.min(4, dayOfWeek))];
}

function toFakeEntry(t: TemplateEntry): TimeEntry {
  return {
    id: t.id,
    activityId: t.activityId,
    activityName: t.activityName,
    jiraKey: t.jiraKey,
    color: t.color,
    date: dayOfWeekToDate(t.dayOfWeek),
    startTime: t.startTime,
    endTime: t.endTime,
    notes: t.notes,
    jiraProject: t.jiraProject,
    issueType: t.issueType,
    jiraUploadedAt: null,
  };
}

export function TemplateScreen({ settings }: { settings: AppSettings }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [templateEntries, setTemplateEntries] = useState<TemplateEntry[]>([]);
  const [armedActivityId, setArmedActivityId] = useState<number | null>(null);
  const [selectedEntryId, setSelectedEntryId] = useState<number | null>(null);
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
  const [creatingEntry, setCreatingEntry] = useState<{ dayOfWeek: number; startTime: string; endTime: string } | null>(
    null,
  );
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [activityModal, setActivityModal] = useState<ActivityModalState>(null);
  const sidebar = useResizableSidebar({
    defaultWidth: DEFAULT_SIDEBAR_WIDTH,
    minWidth: MIN_SIDEBAR_WIDTH,
    maxWidth: MAX_SIDEBAR_WIDTH,
  });

  const entriesRef = useRef<TemplateEntry[]>([]);
  entriesRef.current = templateEntries;

  const refresh = useCallback(() => {
    listTemplateEntries().then(setTemplateEntries).catch((e) => setError(String(e)));
  }, []);

  const refreshActivities = useCallback(() => {
    listProjects().then(setProjects).catch((e) => setError(String(e)));
    listActivities().then(setActivities).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    refreshActivities();
    refresh();
  }, [refresh, refreshActivities]);

  const armedActivity = activities.find((a) => a.id === armedActivityId) ?? null;
  const entries = useMemo(() => templateEntries.map(toFakeEntry), [templateEntries]);

  // Same projects.collapsed column the Timesheet sidebar uses -- shared
  // data, so collapsing a Project here also collapses it there.
  function handleToggleCollapse(projectId: number) {
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;
    const collapsed = !project.collapsed;
    setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, collapsed } : p)));
    setProjectCollapsed(projectId, collapsed).catch((e) => setError(String(e)));
  }

  function isArchivedProjectId(projectId: number | null): boolean {
    const project = projects.find((p) => p.id === projectId);
    return !!project && project.name.trim().toLowerCase() === "archived";
  }

  // Mirrors CalendarScreen's handling of the sidebar's hover pencil/+ --
  // Activities are shared data, not Template-specific, so editing one here
  // follows the same Jira reopen/close pairing the Activities tab does.
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

  async function handleCreate(activityId: number, date: string, startTime: string, endTime: string) {
    try {
      await createTemplateEntry({ activityId, dayOfWeek: dateToDayOfWeek(date), startTime, endTime });
      setArmedActivityId(null);
      refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  function handleRequestCreate(date: string, startTime: string, endTime: string) {
    setCreatingEntry({ dayOfWeek: dateToDayOfWeek(date), startTime, endTime });
  }

  async function handleCreateFromModal(activityId: number, notes: string) {
    if (!creatingEntry) return;
    try {
      await createTemplateEntry({ activityId, notes, ...creatingEntry });
      setCreatingEntry(null);
      refresh();
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
      await createTemplateEntry({ activityId: activity.id, notes, ...creatingEntry });
      setCreatingEntry(null);
      refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleMove(id: number, date: string, startTime: string, endTime: string) {
    try {
      await updateTemplateEntry({
        id,
        activityId: null,
        dayOfWeek: dateToDayOfWeek(date),
        startTime,
        endTime,
        notes: entriesRef.current.find((e) => e.id === id)?.notes ?? "",
      });
      refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleDuplicate(entry: TimeEntry, openEdit?: boolean) {
    if (entry.activityId == null) return;
    try {
      const created = await createTemplateEntry({
        activityId: entry.activityId,
        dayOfWeek: dateToDayOfWeek(entry.date),
        startTime: entry.startTime,
        endTime: entry.endTime,
        notes: entry.notes,
      });
      refresh();
      if (openEdit) setEditingEntry(toFakeEntry(created));
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteTemplateEntry(id);
      setSelectedEntryId(null);
      refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleEditSave(activityId: number, notes: string) {
    if (!editingEntry) return;
    try {
      await updateTemplateEntry({
        id: editingEntry.id,
        activityId,
        dayOfWeek: dateToDayOfWeek(editingEntry.date),
        startTime: editingEntry.startTime,
        endTime: editingEntry.endTime,
        notes,
      });
      setEditingEntry(null);
      refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleEditDelete() {
    if (!editingEntry) return;
    await handleDelete(editingEntry.id);
    setEditingEntry(null);
  }

  useEffect(() => {
    function isTypingTarget(target: EventTarget | null) {
      const el = target as HTMLElement | null;
      return !!el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
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
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEntryId]);

  useEffect(() => {
    if (selectedEntryId == null) return;
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
    function onContextMenu(e: MouseEvent) {
      e.preventDefault();
      setArmedActivityId(null);
    }
    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, [armedActivityId]);

  return (
    <div className="calendar-screen">
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
            onClick={(e) => e.stopPropagation()}
          >
            {sidebar.visible ? "◂" : "▸"}
          </button>
        </div>
        <div className="calendar-main">
          <div className="calendar-toolbar">
            <div className="calendar-week-label" data-tour="template-label">
              Template -- recurring Monday to Friday blocks
            </div>
            <div className="calendar-toolbar-actions">
              {selectedEntryId != null && (
                <button className="btn btn-danger" onClick={() => handleDelete(selectedEntryId)}>
                  Delete selected block
                </button>
              )}
            </div>
          </div>

          {error && <p className="status status-error">{error}</p>}

          <CalendarGrid
            days={REFERENCE_DAYS}
            startHour={settings.workStartHour}
            endHour={settings.workEndHour}
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
          dateLabel={WEEKDAY_LABELS[dateToDayOfWeek(editingEntry.date)]}
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
          date={WEEKDAY_LABELS[creatingEntry.dayOfWeek]}
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
