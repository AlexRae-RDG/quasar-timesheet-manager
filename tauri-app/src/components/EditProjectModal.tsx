import { useRef, useState } from "react";
import type { Project } from "../api/activities";

export function EditProjectModal({
  project,
  initialName,
  onSave,
  onDelete,
  onClose,
}: {
  /** null when creating a new Project. */
  project: Project | null;
  /** Pre-fills Name when creating -- e.g. a name guessed from a QDM's
   * parent issue, so the QDM import flow can offer "+ New Project" without
   * making the user retype what was already guessed. Ignored when editing
   * an existing Project. */
  initialName?: string;
  onSave: (name: string, color: string) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(project?.name ?? initialName ?? "");
  const [color, setColor] = useState(project?.color ?? "#4C6EF5");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const colorInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h2>{project ? "Edit Project" : "New Project"}</h2>

        {confirmingDelete ? (
          <>
            <p className="muted">
              Delete "{project?.name}"? Its Activities will be moved to a "General" project rather than deleted --
              this can't be undone.
            </p>
            <div className="modal-actions">
              <div />
              <div className="row">
                <button type="button" className="btn btn-secondary" onClick={() => setConfirmingDelete(false)}>
                  Cancel
                </button>
                <button type="button" className="btn btn-danger" onClick={onDelete}>
                  Delete Project
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <label className="field">
              <span>Name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Project name"
              />
            </label>

            <label className="field field-color">
              <span>Color</span>
              <div className="color-picker-row">
                <input
                  ref={colorInputRef}
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value.toUpperCase())}
                />
                {/* The OS color panel this opens is its own floating window,
                    not part of this modal -- it has no "done" button of its
                    own and doesn't close on its own just because you've
                    picked a color, which made it easy to feel stuck on this
                    field with no obvious way off it. Blurring the input is
                    the actual signal that ends the picker interaction (the
                    color itself is already live in `color` via onChange
                    regardless), so this button just gives that a visible,
                    clickable target inside the modal itself. */}
                <button
                  type="button"
                  className="btn btn-secondary btn-color-confirm"
                  onClick={() => colorInputRef.current?.blur()}
                >
                  Confirm
                </button>
              </div>
            </label>

            <div className="modal-actions">
              {project && onDelete ? (
                <button type="button" className="btn btn-danger" onClick={() => setConfirmingDelete(true)}>
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
                  disabled={!name.trim()}
                  onClick={() => onSave(name.trim(), color)}
                >
                  Save
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
