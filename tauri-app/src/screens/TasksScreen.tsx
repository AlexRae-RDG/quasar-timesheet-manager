import { useEffect, useMemo, useState } from "react";
import type { DragEvent } from "react";
import { createTask, deleteTask, listTasks, updateTask, type Task, type TaskStatus } from "../api/tasks";
import { EditTaskModal, type TaskFormValues } from "../components/EditTaskModal";

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: "todo", label: "To Do" },
  { status: "in_progress", label: "In Progress" },
  { status: "done", label: "Done" },
];

const PRIORITY_LABEL: Record<Task["priority"], string> = { low: "Low", medium: "Medium", high: "High" };

type ModalState = { mode: "new"; status: TaskStatus } | { mode: "edit"; task: Task } | null;

/** Reads which card the pointer is over in `container` (by DOM position,
 * since drag events can't be relied on to carry live geometry any other
 * way) and returns the index it should land at if dropped now -- the
 * dragged card itself is skipped so dropping it back near its own old spot
 * doesn't count itself as a neighbor. */
function dropIndexAt(container: HTMLElement, clientY: number, draggingId: number): number {
  const cards = Array.from(container.querySelectorAll<HTMLElement>(".kanban-card"));
  let index = 0;
  for (const card of cards) {
    if (Number(card.dataset.taskId) === draggingId) continue;
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

export function TasksScreen() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null);

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

  function handleCardDragStart(e: DragEvent<HTMLDivElement>, task: Task) {
    setDraggingId(task.id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(task.id));
  }

  function handleColumnDragOver(e: DragEvent<HTMLDivElement>, status: TaskStatus) {
    if (draggingId == null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverStatus(status);
  }

  async function handleColumnDrop(e: DragEvent<HTMLDivElement>, status: TaskStatus) {
    e.preventDefault();
    setDragOverStatus(null);
    const draggedTask = tasks.find((t) => t.id === draggingId);
    setDraggingId(null);
    if (!draggedTask) return;

    const index = dropIndexAt(e.currentTarget, e.clientY, draggedTask.id);
    const neighbors = (columnTasks.get(status) ?? []).filter((t) => t.id !== draggedTask.id);
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

  return (
    <div className="calendar-screen">
      <div className="calendar-toolbar">
        <h1 className="tasks-title">Tasks</h1>
      </div>

      {error && <p className="status status-error">{error}</p>}

      <div className="kanban-board">
        {COLUMNS.map(({ status, label }) => {
          const list = columnTasks.get(status) ?? [];
          return (
            <div
              key={status}
              className={"kanban-column" + (dragOverStatus === status ? " kanban-column-dragover" : "")}
              onDragOver={(e) => handleColumnDragOver(e, status)}
              onDragLeave={() => setDragOverStatus((s) => (s === status ? null : s))}
              onDrop={(e) => handleColumnDrop(e, status)}
            >
              <div className="kanban-column-header">
                <span>{label}</span>
                <span className="kanban-column-count">{list.length}</span>
              </div>

              <div className="kanban-column-body">
                {list.map((task) => (
                  <div
                    key={task.id}
                    data-task-id={task.id}
                    className={"kanban-card" + (draggingId === task.id ? " kanban-card-dragging" : "")}
                    draggable
                    onDragStart={(e) => handleCardDragStart(e, task)}
                    onDragEnd={() => {
                      setDraggingId(null);
                      setDragOverStatus(null);
                    }}
                    onClick={() => setModal({ mode: "edit", task })}
                  >
                    <div className="kanban-card-title">{task.title}</div>
                    {task.description && <div className="kanban-card-desc">{task.description}</div>}
                    <div className="kanban-card-footer">
                      <span className={`kanban-priority kanban-priority-${task.priority}`}>
                        {PRIORITY_LABEL[task.priority]}
                      </span>
                      {task.deadline && (
                        <span className={"kanban-deadline" + (isOverdue(task) ? " kanban-deadline-overdue" : "")}>
                          {task.deadline}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <button type="button" className="btn btn-secondary kanban-add-btn" onClick={() => setModal({ mode: "new", status })}>
                + Add Task
              </button>
            </div>
          );
        })}
      </div>

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
