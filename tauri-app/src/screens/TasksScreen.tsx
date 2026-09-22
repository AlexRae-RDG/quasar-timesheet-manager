import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { createTask, deleteTask, listTasks, updateTask, type Task, type TaskStatus } from "../api/tasks";
import { EditTaskModal, type TaskFormValues } from "../components/EditTaskModal";

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: "todo", label: "To Do" },
  { status: "in_progress", label: "In Progress" },
  { status: "done", label: "Done" },
];

const PRIORITY_LABEL: Record<Task["priority"], string> = { low: "Low", medium: "Medium", high: "High" };

// Below this, a press-and-release counts as a click (open the card), not a
// drag -- same threshold CalendarGrid's own pointer-based dragging uses.
const DRAG_THRESHOLD_PX = 4;

type ModalState = { mode: "new"; status: TaskStatus } | { mode: "edit"; task: Task } | null;
type DropTarget = { status: TaskStatus; index: number } | null;
type Ghost = { task: Task; x: number; y: number; width: number } | null;

/** Reads which card the pointer is over in `container` (by DOM position --
 * there's no drag-event geometry to lean on here) and returns the index a
 * card would land at if dropped now. */
function dropIndexAt(container: HTMLElement, clientY: number): number {
  const cards = Array.from(container.querySelectorAll<HTMLElement>(".kanban-card"));
  let index = 0;
  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    if (clientY > rect.top + rect.height / 2) index++;
    else break;
  }
  return index;
}

function isOverdue(task: Task): boolean {
  if (!task.deadline || task.status === "done") return false;
  return task.deadline < new Date().toISOString().slice(0, 10);
}

function CardBody({ task }: { task: Task }) {
  return (
    <>
      <div className="kanban-card-title">{task.title}</div>
      {task.description && <div className="kanban-card-desc">{task.description}</div>}
      <div className="kanban-card-footer">
        <span className={`kanban-priority kanban-priority-${task.priority}`}>{PRIORITY_LABEL[task.priority]}</span>
        {task.deadline && (
          <span className={"kanban-deadline" + (isOverdue(task) ? " kanban-deadline-overdue" : "")}>
            {task.deadline}
          </span>
        )}
      </div>
    </>
  );
}

export function TasksScreen() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);
  const [ghost, setGhost] = useState<Ghost>(null);

  // Read inside the window-level pointer listeners below instead of the
  // `tasks` state directly, so a drag that outlives a background refresh
  // still commits against the latest data -- same reason CalendarScreen
  // keeps its own entriesRef alongside `entries`.
  const tasksRef = useRef<Task[]>([]);
  tasksRef.current = tasks;

  const refresh = () => {
    listTasks().then(setTasks).catch((e) => setError(String(e)));
  };
  useEffect(refresh, []);

  const columnTasks = useMemo(() => {
    const grouped = new Map<TaskStatus, Task[]>();
    for (const { status } of COLUMNS) grouped.set(status, []);
    for (const task of [...tasks].sort((a, b) => a.sortOrder - b.sortOrder)) {
      grouped.get(task.status)?.push(task);
    }
    return grouped;
  }, [tasks]);

  async function handleSave(values: TaskFormValues) {
    try {
      if (modal?.mode === "edit") {
        const updated = await updateTask({ id: modal.task.id, sortOrder: modal.task.sortOrder, ...values });
        setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      } else {
        const created = await createTask(values);
        // create_task always lands the new card in To Do regardless of which
        // status the form's own dropdown had selected -- if the user picked
        // something else there, move it there in the same stroke instead of
        // silently ignoring that choice.
        const final =
          values.status === created.status
            ? created
            : await updateTask({ ...created, status: values.status, sortOrder: created.sortOrder });
        setTasks((prev) => [...prev, final]);
      }
      setModal(null);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleDelete() {
    if (modal?.mode !== "edit") return;
    try {
      await deleteTask(modal.task.id);
      setTasks((prev) => prev.filter((t) => t.id !== modal.task.id));
      setModal(null);
    } catch (e) {
      setError(String(e));
    }
  }

  async function commitDrop(taskId: number, clientX: number, clientY: number) {
    const draggedTask = tasksRef.current.find((t) => t.id === taskId);
    setDraggingId(null);
    setDropTarget(null);
    setGhost(null);
    document.body.classList.remove("kanban-dragging");
    if (!draggedTask) return;

    const columnEl = (document.elementFromPoint(clientX, clientY) as HTMLElement | null)?.closest<HTMLElement>(
      ".kanban-column",
    );
    if (!columnEl) return; // dropped outside any column -- cancel
    const status = columnEl.dataset.status as TaskStatus;

    const index = dropIndexAt(columnEl, clientY);
    const neighbors = tasksRef.current
      .filter((t) => t.status === status && t.id !== taskId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const prev = neighbors[index - 1];
    const next = neighbors[index];
    let sortOrder: number;
    if (!prev && !next) sortOrder = 0;
    else if (!prev) sortOrder = next.sortOrder - 1;
    else if (!next) sortOrder = prev.sortOrder + 1;
    else sortOrder = (prev.sortOrder + next.sortOrder) / 2;

    if (status === draggedTask.status && sortOrder === draggedTask.sortOrder) return;

    try {
      const updated = await updateTask({
        id: draggedTask.id,
        title: draggedTask.title,
        description: draggedTask.description,
        priority: draggedTask.priority,
        deadline: draggedTask.deadline,
        status,
        sortOrder,
      });
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    } catch (err) {
      setError(String(err));
    }
  }

  // Plain pointer events rather than native HTML5 drag-and-drop -- the same
  // choice CalendarGrid's block dragging and the sidebar resize handle both
  // make elsewhere in this app, because WebKit (the Tauri webview on macOS)
  // can swallow native drag gestures outright. Sticking to the pattern
  // that's already proven reliable here rather than adding a second,
  // independent drag mechanism.
  function handleCardPointerDown(e: ReactPointerEvent<HTMLDivElement>, task: Task) {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const rect = e.currentTarget.getBoundingClientRect();
    // Where inside the card it was grabbed, so the ghost tracks naturally
    // under the cursor instead of snapping its top-left corner there.
    const grabX = e.clientX - rect.left;
    const grabY = e.clientY - rect.top;
    let moved = false;

    function onMove(ev: PointerEvent) {
      if (!moved) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD_PX) return;
        moved = true;
        setDraggingId(task.id);
        document.body.classList.add("kanban-dragging");
      }
      setGhost({ task, x: ev.clientX - grabX, y: ev.clientY - grabY, width: rect.width });

      const columnEl = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>(
        ".kanban-column",
      );
      if (!columnEl) {
        setDropTarget(null);
        return;
      }
      const status = columnEl.dataset.status as TaskStatus;
      setDropTarget({ status, index: dropIndexAt(columnEl, ev.clientY) });
    }

    function onUp(ev: PointerEvent) {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (moved) {
        commitDrop(task.id, ev.clientX, ev.clientY);
      } else {
        setModal({ mode: "edit", task });
      }
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  return (
    <div className="calendar-screen">
      <div className="calendar-toolbar">
        <h1 className="tasks-title">Tasks</h1>
      </div>

      {error && <p className="status status-error">{error}</p>}

      <div className="kanban-board">
        {COLUMNS.map(({ status, label }) => {
          // The card being dragged is lifted out of its column entirely
          // while in flight (the ghost below stands in for it) rather than
          // shown dimmed in its old spot, so the drop-position indicator is
          // the only gap on screen at any moment.
          const list = (columnTasks.get(status) ?? []).filter((t) => t.id !== draggingId);
          const indicatorIndex = dropTarget && dropTarget.status === status ? dropTarget.index : null;

          const body: ReactNode[] = [];
          list.forEach((task, i) => {
            if (indicatorIndex === i) body.push(<div key="indicator" className="kanban-drop-indicator" />);
            body.push(
              <div
                key={task.id}
                data-task-id={task.id}
                className="kanban-card"
                onPointerDown={(e) => handleCardPointerDown(e, task)}
              >
                <CardBody task={task} />
              </div>,
            );
          });
          if (indicatorIndex === list.length) body.push(<div key="indicator" className="kanban-drop-indicator" />);

          return (
            <div
              key={status}
              data-status={status}
              className={"kanban-column" + (indicatorIndex != null ? " kanban-column-dragover" : "")}
            >
              <div className="kanban-column-header">
                <span>{label}</span>
                <span className="kanban-column-count">{list.length}</span>
              </div>

              <div className="kanban-column-body">{body}</div>

              <button type="button" className="btn btn-secondary kanban-add-btn" onClick={() => setModal({ mode: "new", status })}>
                + Add Task
              </button>
            </div>
          );
        })}
      </div>

      {ghost && (
        <div
          className="kanban-card kanban-card-ghost"
          style={{ left: ghost.x, top: ghost.y, width: ghost.width }}
        >
          <CardBody task={ghost.task} />
        </div>
      )}

      {modal && (
        <EditTaskModal
          task={modal.mode === "edit" ? modal.task : null}
          defaultStatus={modal.mode === "new" ? modal.status : "todo"}
          onSave={handleSave}
          onDelete={modal.mode === "edit" ? handleDelete : undefined}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
