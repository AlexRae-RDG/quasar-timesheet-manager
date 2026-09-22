import { useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

const TOGGLE_DRAG_THRESHOLD_PX = 4;

/** Drives a sidebar's drag-to-resize handle and click-to-collapse toggle --
 * shared by Timesheet and Template, which both show the same Activity
 * sidebar next to a CalendarGrid. */
export function useResizableSidebar({
  defaultWidth,
  minWidth,
  maxWidth,
}: {
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
}) {
  const [width, setWidth] = useState(defaultWidth);
  const [resizing, setResizing] = useState(false);
  const [visible, setVisible] = useState(true);

  function handleResizeStart(e: ReactPointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    setResizing(true);

    function onMove(ev: PointerEvent) {
      const next = Math.max(minWidth, Math.min(maxWidth, startWidth + (ev.clientX - startX)));
      setWidth(next);
    }
    function onUp() {
      setResizing(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  // The toggle button itself: a plain click (released before crossing the
  // threshold) toggles visibility; holding and moving past it resizes
  // instead, same gesture as the bare handle strip. Collapsed, there's
  // nothing to resize, so any press there just re-expands.
  function handleToggleButtonPointerDown(e: ReactPointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (!visible) {
      setVisible(true);
      return;
    }

    const startX = e.clientX;
    const startWidth = width;
    let moved = false;

    function onMove(ev: PointerEvent) {
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) > TOGGLE_DRAG_THRESHOLD_PX) {
        moved = true;
        setResizing(true);
      }
      if (moved) {
        setWidth(Math.max(minWidth, Math.min(maxWidth, startWidth + dx)));
      }
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setResizing(false);
      if (!moved) setVisible((v) => !v);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  return { width, resizing, visible, setVisible, handleResizeStart, handleToggleButtonPointerDown };
}
