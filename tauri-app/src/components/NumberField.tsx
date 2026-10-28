import { useEffect, useState } from "react";

/** A whole-number input that lets you clear the box and retype freely --
 * the value is only validated/clamped and handed back on blur or Enter,
 * not on every keystroke (which would snap an emptied field straight back
 * to its old value mid-edit). */
export function NumberField({
  label,
  value,
  min,
  max,
  suffix,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  function commit() {
    const parsed = Math.round(Number(draft));
    if (draft.trim() === "" || !Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    setDraft(String(clamped));
    if (clamped !== value) onCommit(clamped);
  }

  return (
    <label className="field number-field">
      <span>{label}</span>
      <span className="number-field-input">
        <input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
        />
        {suffix && <span className="muted">{suffix}</span>}
      </span>
    </label>
  );
}
