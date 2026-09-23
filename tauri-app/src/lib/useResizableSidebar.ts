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
  onResizeEnd,
}: {
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  /** Called once a drag-resize gesture ends, with the final width -- not
   * on every pointermove, so a caller persisting this (see CalendarScreen/
   * TemplateScreen's onChange({ sidebarWidth })) isn't hammered dozens of
   * times per drag. Not fired by the plain collapse/expand click, only an
   * actual resize. */
  onResizeEnd?: (width: number) => void;
}) {
  const [width, setWidth] = useState(defaultWidth);
  const [resizing, setResizing] = useState(false);
  const [visible, setVisible] = useState(true);

  function handleResizeStart(e: ReactPointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    setResizing(true);
    // A plain closure variable, not the `width` state -- onUp needs the
    // truly final value at the moment the pointer's released, and reading
    // `width` there would see whatever it was when handleResizeStart ran
    // (a stale closure), not the last value onMove computed during the drag.
    let finalWidth = startWidth;

    function onMove(ev: PointerEvent) {
      const next = Math.max(minWidth, Math.min(maxWidth, startWidth + (ev.clientX - startX)));
      finalWidth = next;
      setWidth(next);
    }
    function onUp() {
      setResizing(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      onResizeEnd?.(finalWidth);
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
    let finalWidth = startWidth;

    function onMove(ev: PointerEvent) {
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) > TOGGLE_DRAG_THRESHOLD_PX) {
        moved = true;
        setResizing(true);
      }
      if (moved) {
        finalWidth = Math.max(minWidth, Math.min(maxWidth, startWidth + dx));
        setWidth(finalWidth);
      }
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setResizing(false);
      if (!moved) setVisible((v) => !v);
      else onResizeEnd?.(finalWidth);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  return { width, resizing, visible, setVisible, handleResizeStart, handleToggleButtonPointerDown };
}
