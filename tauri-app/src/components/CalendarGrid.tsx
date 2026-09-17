import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { TimeEntry } from "../api/calendar";
import { minutesToTime, timeToMinutes, toISODate } from "../lib/date";
import { layoutDayEntries } from "../lib/overlapLayout";
import { blockTextColor } from "../theme/palettes";

const SLOT_MINUTES = 15;
const BASE_SLOT_HEIGHT_PX = 30;
const MIN_SLOT_HEIGHT_PX = 12;
const MAX_SLOT_HEIGHT_PX = 60;
const BASE_DAY_WIDTH_PX = 168;
const MIN_DAY_WIDTH_PX = 90;
const GUTTER_WIDTH_PX = 52;
const HEADER_HEIGHT_PX = 40;
const RESIZE_GRIP_PX = 7;
const DRAG_THRESHOLD_PX = 4;
const BLOCK_GAP_PX = 2;
// The first/last hour labels are vertically centered ON their gridline, so
// without room above/below the grid's own top/bottom edge they'd be cut in
// half by calendar-scroll's overflow -- this is exactly that room.
const GRID_TOP_PAD_PX = 12;
const GRID_BOTTOM_PAD_PX = 16;

type DragMode = "create" | "move" | "resize-top" | "resize-bottom";

interface DragState {
  mode: DragMode;
  dayIndex: number;
  entryId?: number;
  color?: string; // move/resize only: the dragged entry's own color, for its preview
  label?: string; // move/resize only: the dragged entry's activity name
  anchorMin: number; // create only: the slot where the drag began
  startMin: number;
  endMin: number;
  durationMin: number; // move only: preserved duration
  grabOffsetMin: number; // move only: pointer position minus entry.startMin at grab time
  pointerDownX: number;
  pointerDownY: number;
  moved: boolean;
}

export function CalendarGrid({
  days,
  startHour,
  endHour,
  entries,
  zoom,
  armedActivityId,
  armedDefaultDurationMinutes,
  selectedEntryId,
  onSelectEntry,
  onCreate,
  onMove,
  onDuplicate,
  onEditEntry,
}: {
  days: Date[];
  startHour: number;
  endHour: number;
  entries: TimeEntry[];
  zoom: number;
  armedActivityId: number | null;
  armedDefaultDurationMinutes: number;
  selectedEntryId: number | null;
  onSelectEntry: (id: number | null) => void;
  onCreate: (activityId: number, date: string, startTime: string, endTime: string) => void;
  onMove: (id: number, date: string, startTime: string, endTime: string) => void;
  onDuplicate: (entry: TimeEntry) => void;
  onEditEntry: (entry: TimeEntry) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // The day-column area's own rendered size, in pixels -- tracked via
  // ResizeObserver since this drives real layout math (drag/hit-test pixel
  // conversion, auto-fit sizing) that plain CSS can't hand back to JS.
  // calendar-scroll's height comes from flexbox filling whatever room the
  // header/toolbar/day-header rows above it leave, not from its own
  // content, so there's no feedback loop in also using that height as the
  // target to fit the grid's content into.
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((observed) => {
      for (const entry of observed) {
        setContainerSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Width always fills the available space regardless of zoom -- zoom is a
  // vertical density control only. Multiplying width by zoom too used to
  // leave dead space on the right at anything below 100%, since the fitted
  // width was computed for zoom 1 and then shrunk without the container
  // shrinking to match.
  const DAY_WIDTH_PX =
    containerSize.width > 0
      ? Math.max(MIN_DAY_WIDTH_PX, (containerSize.width - GUTTER_WIDTH_PX) / days.length)
      : BASE_DAY_WIDTH_PX;

  const totalMinutes = (endHour - startHour) * 60;
  const totalSlots = totalMinutes / SLOT_MINUTES;

  // The "100%" (zoom 1) slot height is whatever fits the full work-hours
  // range into the visible area with no vertical scrolling -- on a big
  // enough display that's a real auto-fit; on a small one it floors out at
  // MIN_SLOT_HEIGHT_PX and scrolling returns, same tradeoff Python's own
  // config.zoom_clamp makes. zoom then scales up/down from that baseline
  // via the toolbar's +/- buttons, same as day width scaling from its own
  // fitted baseline used to (now width no longer moves with zoom -- see
  // DAY_WIDTH_PX above -- only height does).
  const fitSlotHeight =
    containerSize.height > 0
      ? Math.max(
          MIN_SLOT_HEIGHT_PX,
          Math.min(MAX_SLOT_HEIGHT_PX, (containerSize.height - GRID_TOP_PAD_PX - GRID_BOTTOM_PAD_PX) / totalSlots),
        )
      : BASE_SLOT_HEIGHT_PX;
  const SLOT_HEIGHT_PX = fitSlotHeight * zoom;

  // A ref mirrors this state so onPointerUp can read the truly-current drag
  // value and fire its one-time side effect (create/move) directly, rather
  // than inside a setState updater -- React's Strict Mode double-invokes
  // updater functions in dev to catch impure ones, which was silently
  // creating two entries per drag when the DB call lived inside setDrag().
  const [drag, setDragState] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const setDrag = useCallback((updater: DragState | null | ((prev: DragState | null) => DragState | null)) => {
    const next = typeof updater === "function" ? (updater as (p: DragState | null) => DragState | null)(dragRef.current) : updater;
    dragRef.current = next;
    setDragState(next);
  }, []);

  const gridContentHeight = (totalMinutes / SLOT_MINUTES) * SLOT_HEIGHT_PX;
  const gridHeight = gridContentHeight + GRID_TOP_PAD_PX + GRID_BOTTOM_PAD_PX;
  const minutesToPx = (min: number) => GRID_TOP_PAD_PX + (min / SLOT_MINUTES) * SLOT_HEIGHT_PX;
  const dayIso = useMemo(() => days.map(toISODate), [days]);
  const todayIso = toISODate(new Date());

  const entriesByDay = useMemo(() => {
    const map = new Map<string, TimeEntry[]>();
    for (const iso of dayIso) map.set(iso, []);
    for (const entry of entries) {
      const list = map.get(entry.date);
      if (list) list.push(entry);
    }
    return map;
  }, [entries, dayIso]);

  const clampMinutes = useCallback(
    (m: number) => Math.max(0, Math.min(totalMinutes, m)),
    [totalMinutes],
  );

  const yToMinutes = useCallback(
    (y: number) => {
      const raw = ((y - GRID_TOP_PAD_PX) / SLOT_HEIGHT_PX) * SLOT_MINUTES;
      const snapped = Math.round(raw / SLOT_MINUTES) * SLOT_MINUTES;
      return clampMinutes(snapped);
    },
    [clampMinutes, SLOT_HEIGHT_PX],
  );

  const xToDayIndex = useCallback(
    (x: number) => {
      const idx = Math.floor(x / DAY_WIDTH_PX);
      return Math.max(0, Math.min(days.length - 1, idx));
    },
    [days.length, DAY_WIDTH_PX],
  );

  // Coordinates relative to the top-left of the day-column area: the
  // header row is a sibling *outside* calendar-scroll, so only the
  // gutter (a real child inside it) needs to be subtracted from x.
  const gridPointFromEvent = useCallback((e: PointerEvent | ReactPointerEvent) => {
    const el = containerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      x: e.clientX - rect.left - GUTTER_WIDTH_PX + el.scrollLeft,
      y: e.clientY - rect.top + el.scrollTop,
    };
  }, []);

  const beginCreate = (dayIndex: number, y: number, clientX: number, clientY: number) => {
    if (armedActivityId == null) return;
    const anchor = yToMinutes(y);
    setDrag({
      mode: "create",
      dayIndex,
      anchorMin: anchor,
      startMin: anchor,
      endMin: clampMinutes(anchor + SLOT_MINUTES),
      durationMin: SLOT_MINUTES,
      grabOffsetMin: 0,
      pointerDownX: clientX,
      pointerDownY: clientY,
      moved: false,
    });
  };

  const beginMove = (entry: TimeEntry, dayIndex: number, y: number, clientX: number, clientY: number) => {
    const startMin = timeToMinutes(entry.startTime) - startHour * 60;
    const endMin = timeToMinutes(entry.endTime) - startHour * 60;
    const clickMin = yToMinutes(y);
    setDrag({
      mode: "move",
      dayIndex,
      entryId: entry.id,
      color: entry.color,
      label: entry.activityName,
      anchorMin: startMin,
      startMin,
      endMin,
      durationMin: endMin - startMin,
      grabOffsetMin: clickMin - startMin,
      pointerDownX: clientX,
      pointerDownY: clientY,
      moved: false,
    });
  };

  const beginResize = (
    entry: TimeEntry,
    dayIndex: number,
    edge: "top" | "bottom",
    clientX: number,
    clientY: number,
  ) => {
    const startMin = timeToMinutes(entry.startTime) - startHour * 60;
    const endMin = timeToMinutes(entry.endTime) - startHour * 60;
    setDrag({
      mode: edge === "top" ? "resize-top" : "resize-bottom",
      dayIndex,
      entryId: entry.id,
      color: entry.color,
      label: entry.activityName,
      anchorMin: edge === "top" ? endMin : startMin,
      startMin,
      endMin,
      durationMin: endMin - startMin,
      grabOffsetMin: 0,
      pointerDownX: clientX,
      pointerDownY: clientY,
      moved: false,
    });
  };

  useEffect(() => {
    if (!drag) return;

    function onPointerMove(e: PointerEvent) {
      const point = gridPointFromEvent(e);
      const current = dragRef.current;
      if (!point || !current) return;

      const dx = Math.abs(e.clientX - current.pointerDownX);
      const dy = Math.abs(e.clientY - current.pointerDownY);
      const exceeded = current.moved || dx > DRAG_THRESHOLD_PX || dy > DRAG_THRESHOLD_PX;
      if (!exceeded) return;

      // Pure state computation only -- no side effects here. React Strict
      // Mode may invoke this updater twice in dev; that's fine as long as
      // it just computes the next preview position.
      setDrag((prev) => {
        if (!prev) return prev;
        const minutes = yToMinutes(point.y);

        if (prev.mode === "create") {
          const start = Math.min(prev.anchorMin, minutes);
          const end = Math.max(prev.anchorMin, minutes, prev.anchorMin + SLOT_MINUTES);
          return { ...prev, startMin: start, endMin: clampMinutes(end), moved: true };
        }
        if (prev.mode === "move") {
          const dayIndex = xToDayIndex(point.x);
          let newStart = minutes - prev.grabOffsetMin;
          newStart = Math.round(newStart / SLOT_MINUTES) * SLOT_MINUTES;
          newStart = Math.max(0, Math.min(totalMinutes - prev.durationMin, newStart));
          return { ...prev, dayIndex, startMin: newStart, endMin: newStart + prev.durationMin, moved: true };
        }
        if (prev.mode === "resize-top") {
          const newStart = Math.min(minutes, prev.endMin - SLOT_MINUTES);
          return { ...prev, startMin: Math.max(0, newStart), moved: true };
        }
        // resize-bottom
        const newEnd = Math.max(minutes, prev.startMin + SLOT_MINUTES);
        return { ...prev, endMin: clampMinutes(newEnd), moved: true };
      });
    }

    // Reads the final drag value directly from the ref and fires the one
    // real side effect (create/move) here, in the event handler itself --
    // never inside a setState updater (see the setDrag wrapper's comment).
    function onPointerUp() {
      const finalDrag = dragRef.current;
      setDrag(null);
      if (!finalDrag) return;

      if (!finalDrag.moved) {
        if (finalDrag.mode === "create" && armedActivityId != null) {
          const date = dayIso[finalDrag.dayIndex];
          const start = finalDrag.anchorMin;
          const end = clampMinutes(start + armedDefaultDurationMinutes);
          onCreate(
            armedActivityId,
            date,
            minutesToTime(start + startHour * 60),
            minutesToTime(Math.max(end, start + SLOT_MINUTES) + startHour * 60),
          );
        } else if (finalDrag.entryId != null) {
          onSelectEntry(finalDrag.entryId);
        }
        return;
      }

      if (finalDrag.mode === "create" && armedActivityId != null) {
        const date = dayIso[finalDrag.dayIndex];
        onCreate(
          armedActivityId,
          date,
          minutesToTime(finalDrag.startMin + startHour * 60),
          minutesToTime(finalDrag.endMin + startHour * 60),
        );
      } else if (finalDrag.entryId != null) {
        const date = dayIso[finalDrag.dayIndex];
        onMove(
          finalDrag.entryId,
          date,
          minutesToTime(finalDrag.startMin + startHour * 60),
          minutesToTime(finalDrag.endMin + startHour * 60),
        );
      }
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.mode]);

  const hourMarks: number[] = [];
  for (let h = startHour; h <= endHour; h++) {
    hourMarks.push(h);
  }

  return (
    <div className="calendar-wrapper">
      <div className="calendar-header" style={{ paddingLeft: GUTTER_WIDTH_PX, height: HEADER_HEIGHT_PX }}>
        {days.map((d, i) => (
          <div
            key={i}
            className={"calendar-day-header" + (dayIso[i] === todayIso ? " calendar-day-header-today" : "")}
            style={{ width: DAY_WIDTH_PX }}
          >
            <div className="calendar-day-name">{d.toLocaleDateString(undefined, { weekday: "short" })}</div>
            <div className="calendar-day-date">{d.getDate()}</div>
          </div>
        ))}
      </div>

      <div
        className="calendar-scroll"
        ref={containerRef}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          // Without this, WebKit (the Tauri webview on macOS) can start a
          // native text-selection/drag gesture on mousedown that swallows
          // the pointermove events our own drag logic depends on -- the
          // create-drag silently doing nothing was this, not a logic bug.
          e.preventDefault();
          const point = gridPointFromEvent(e);
          if (!point || point.x < 0 || point.y < 0) return;
          const dayIndex = xToDayIndex(point.x);
          beginCreate(dayIndex, point.y, e.clientX, e.clientY);
        }}
      >
        <div className="calendar-gutter" style={{ width: GUTTER_WIDTH_PX, height: gridHeight }}>
          {hourMarks.map((h) => (
            <div key={h} className="calendar-hour-label" style={{ top: minutesToPx((h - startHour) * 60) }}>
              {formatHour(h)}
            </div>
          ))}
        </div>

        <div className="calendar-days" style={{ height: gridHeight }}>
          {days.map((_, dayIndex) => {
            const iso = dayIso[dayIndex];
            const dayEntries = entriesByDay.get(iso) ?? [];
            const layoutInputs = dayEntries.map((entry) => ({
              id: entry.id,
              startMin: timeToMinutes(entry.startTime) - startHour * 60,
              endMin: timeToMinutes(entry.endTime) - startHour * 60,
            }));
            const layout = layoutDayEntries(layoutInputs);

            return (
              <div
                key={dayIndex}
                className="calendar-day-col"
                style={{ width: DAY_WIDTH_PX, height: gridHeight }}
              >
                {hourMarks.slice(0, -1).map((h) => (
                  <div key={h} className="calendar-hour-line" style={{ top: minutesToPx((h - startHour) * 60) }} />
                ))}

                {dayEntries.map((entry) => {
                  // While this entry is actively being moved/resized (past
                  // the drag threshold), it's drawn once via the unified
                  // preview below instead -- which follows drag.dayIndex,
                  // so it can visibly cross into a different day column
                  // rather than disappearing until the drag ends.
                  if (drag?.entryId === entry.id && drag.moved) return null;

                  const startMin = timeToMinutes(entry.startTime) - startHour * 60;
                  const endMin = timeToMinutes(entry.endTime) - startHour * 60;
                  const slot = layout.get(entry.id) ?? { colIndex: 0, colCount: 1 };
                  const colWidth = (DAY_WIDTH_PX - BLOCK_GAP_PX * (slot.colCount - 1)) / slot.colCount;
                  const left = slot.colIndex * (colWidth + BLOCK_GAP_PX);
                  const top = minutesToPx(startMin);
                  const height = Math.max(SLOT_HEIGHT_PX, ((endMin - startMin) / SLOT_MINUTES) * SLOT_HEIGHT_PX);

                  return (
                    <div
                      key={entry.id}
                      className={"calendar-entry" + (selectedEntryId === entry.id ? " calendar-entry-selected" : "")}
                      title={
                        entry.notes
                          ? `${entry.activityName} · ${entry.startTime}–${entry.endTime}\n${entry.notes}`
                          : `${entry.activityName} · ${entry.startTime}–${entry.endTime}`
                      }
                      style={{
                        left,
                        top,
                        width: colWidth,
                        height,
                        background: entry.color,
                        color: blockTextColor(entry.color),
                      }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        if (e.button !== 0) return;
                        if (e.ctrlKey || e.metaKey) {
                          onDuplicate(entry);
                          return;
                        }
                        const point = gridPointFromEvent(e);
                        if (!point) return;
                        beginMove(entry, dayIndex, point.y, e.clientX, e.clientY);
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        onEditEntry(entry);
                      }}
                    >
                      {/* Separate hit zones (rather than inspecting click Y
                          in one handler) so CSS can give each its own
                          hover cursor -- ns-resize on the grips, grab on
                          the body -- without JS-driven cursor tracking. */}
                      <div
                        className="calendar-entry-grip calendar-entry-grip-top"
                        style={{ height: RESIZE_GRIP_PX }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          if (e.button !== 0) return;
                          beginResize(entry, dayIndex, "top", e.clientX, e.clientY);
                        }}
                      />
                      <div className="calendar-entry-label">{entry.activityName}</div>
                      <div className="calendar-entry-time">
                        {entry.startTime}–{entry.endTime}
                      </div>
                      {entry.notes && <div className="calendar-entry-notes">{entry.notes}</div>}
                      <div
                        className="calendar-entry-grip calendar-entry-grip-bottom"
                        style={{ height: RESIZE_GRIP_PX }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          if (e.button !== 0) return;
                          beginResize(entry, dayIndex, "bottom", e.clientX, e.clientY);
                        }}
                      />
                    </div>
                  );
                })}

                {drag &&
                  drag.mode === "create" &&
                  drag.dayIndex === dayIndex &&
                  drag.moved &&
                  armedActivityId != null && (
                    <div
                      className="calendar-entry calendar-entry-preview"
                      style={{
                        left: 0,
                        top: minutesToPx(drag.startMin),
                        width: DAY_WIDTH_PX,
                        height: Math.max(
                          SLOT_HEIGHT_PX,
                          ((drag.endMin - drag.startMin) / SLOT_MINUTES) * SLOT_HEIGHT_PX,
                        ),
                      }}
                    />
                  )}

                {drag &&
                  drag.mode !== "create" &&
                  drag.entryId != null &&
                  drag.dayIndex === dayIndex &&
                  drag.moved && (
                    <div
                      className="calendar-entry calendar-entry-dragging"
                      style={{
                        left: 0,
                        top: minutesToPx(drag.startMin),
                        width: DAY_WIDTH_PX,
                        height: Math.max(
                          SLOT_HEIGHT_PX,
                          ((drag.endMin - drag.startMin) / SLOT_MINUTES) * SLOT_HEIGHT_PX,
                        ),
                        background: drag.color,
                        color: blockTextColor(drag.color ?? "#4C6EF5"),
                      }}
                    >
                      <div className="calendar-entry-label">{drag.label}</div>
                      <div className="calendar-entry-time">
                        {minutesToTime(drag.startMin + startHour * 60)}–{minutesToTime(drag.endMin + startHour * 60)}
                      </div>
                    </div>
                  )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function formatHour(h: number): string {
  const period = h < 12 || h === 24 ? "AM" : "PM";
  let hour12 = h % 12;
  if (hour12 === 0) hour12 = 12;
  return `${hour12} ${period}`;
}
