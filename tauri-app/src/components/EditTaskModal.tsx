import { useState } from "react";
import type { Task, TaskPriority, TaskStatus } from "../api/tasks";
import { Dropdown, DropdownOption } from "./Dropdown";

export interface TaskFormValues {
  title: string;
  description: string;
  priority: TaskPriority;
  deadline: string | null;
  status: TaskStatus;
}

const PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const STATUSES: { value: TaskStatus; label: string }[] = [
  { value: "todo", label: "To Do" },
  { value: "in_progress", label: "In Progress" },
  { value: "done", label: "Done" },
];

export function EditTaskModal({
  task,
  defaultStatus,
  onSave,
  onDelete,
  onClose,
}: {
  /** null when creating a new Task. */
  task: Task | null;
  /** Which column "New Task" was clicked from. */
  defaultStatus: TaskStatus;
  onSave: (values: TaskFormValues) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? "medium");
  const [deadline, setDeadline] = useState(task?.deadline ?? "");
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? defaultStatus);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h2>{task ? "Edit Task" : "New Task"}</h2>

        <label className="field">
          <span>Title</span>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title" autoFocus />
        </label>

        <label className="field">
          <span>Description</span>
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional details"
          />
        </label>

        <div className="row">
          <label className="field field-inline">
            <span>Priority</span>
            <Dropdown value={priority} onChange={(v) => setPriority(v as TaskPriority)}>
              {PRIORITIES.map((p) => (
                <DropdownOption key={p.value} value={p.value}>
                  {p.label}
                </DropdownOption>
              ))}
            </Dropdown>
          </label>

          <label className="field field-inline">
            <span>Deadline</span>
            <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </label>
        </div>

        <label className="field">
          <span>Status</span>
          <Dropdown value={status} onChange={(v) => setStatus(v as TaskStatus)}>
            {STATUSES.map((s) => (
              <DropdownOption key={s.value} value={s.value}>
                {s.label}
              </DropdownOption>
            ))}
          </Dropdown>
        </label>

        <div className="modal-actions">
          {task && onDelete ? (
            <button type="button" className="btn btn-danger" onClick={onDelete}>
              Delete
            </button>
          ) : (
            <div />
          )}
          <div className="row">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-accent"
              disabled={!title.trim()}
              onClick={() =>
                onSave({
                  title: title.trim(),
                  description: description.trim(),
                  priority,
                  deadline: deadline || null,
                  status,
                })
              }
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
