import { useRef, useState } from "react";
import type { Project } from "../api/activities";

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

// A curated set of quick picks distinct enough to tell projects apart at a
// glance -- the full spectrum is still one click away via the swatch, which
// opens the OS's own color picker, so this isn't the only way to set a
// color, just a faster one for the common case.
const PRESET_COLORS = [
  "#4C6EF5",
  "#12B886",
  "#F06595",
  "#FAB005",
  "#7048E8",
  "#E8590C",
  "#20C997",
  "#1098AD",
  "#E64980",
  "#495057",
];

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
  // Lets the hex field hold a mid-edit string (e.g. the user has backspaced
  // it down to "#4C") without that half-typed value ever reaching `color`
  // (and so the live swatch/preview) -- only a syntactically complete hex
  // commits. Reverts to the last valid `color` on blur if never completed.
  const [hexDraft, setHexDraft] = useState(color);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const colorInputRef = useRef<HTMLInputElement | null>(null);

  function commitColor(next: string) {
    setColor(next);
    setHexDraft(next);
  }

  function handleHexChange(value: string) {
    setHexDraft(value);
    if (HEX_COLOR_RE.test(value)) setColor(value);
  }

  function handleHexBlur() {
    setHexDraft(HEX_COLOR_RE.test(hexDraft) ? hexDraft.toUpperCase() : color);
  }

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

            <div className="field">
              <span>Color</span>
              <div className="color-picker-box">
                <div className="color-picker-preview-row">
                  {/* The swatch is a real <input type="color">, not just a
                      colored div -- clicking it still opens the OS's own
                      color picker for full, unrestricted customization
                      (a wheel/spectrum + sliders no in-app widget here
                      tries to reproduce), it's just now styled as a large
                      preview tile rather than a small native control. */}
                  <input
                    ref={colorInputRef}
                    type="color"
                    className="color-swatch-input"
                    value={color}
                    onChange={(e) => commitColor(e.target.value.toUpperCase())}
                    aria-label="Choose a custom color"
                  />
                  <input
                    type="text"
                    className="color-hex-input"
                    value={hexDraft}
                    onChange={(e) => handleHexChange(e.target.value)}
                    onBlur={handleHexBlur}
                    spellCheck={false}
                    maxLength={7}
                  />
                </div>

                <div className="color-picker-presets">
                  {PRESET_COLORS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className={"color-preset-swatch" + (preset === color ? " color-preset-swatch-selected" : "")}
                      style={{ background: preset }}
                      aria-label={preset}
                      aria-pressed={preset === color}
                      onClick={() => commitColor(preset)}
                    />
                  ))}
                </div>

                {/* The OS color panel the swatch opens is its own floating
                    window, not part of this box -- it has no "done" button
                    of its own and doesn't close just because you've picked
                    a color, which made it easy to feel stuck with no
                    obvious way off it. Blurring the input is the actual
                    signal that ends that interaction (the color itself is
                    already live via onChange regardless); this just gives
                    that a visible, clickable target that reads as part of
                    the Color box, not the modal's own Cancel/Save. */}
                <div className="color-picker-footer">
                  <button
                    type="button"
                    className="btn btn-secondary btn-color-confirm"
                    onClick={() => colorInputRef.current?.blur()}
                  >
                    Confirm color
                  </button>
                </div>
              </div>
            </div>

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
