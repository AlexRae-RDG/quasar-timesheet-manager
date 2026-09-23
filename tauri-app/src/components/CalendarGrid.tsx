import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { TimeEntry } from "../api/calendar";
import { minutesToTime, timeToMinutes, toISODate } from "../lib/date";
import { layoutDayEntries } from "../lib/overlapLayout";
import { blockTextColor, BLOCK_TEXT_LIGHT } from "../theme/palettes";

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
  /** move only: set when Ctrl/Cmd was held at grab -- the original entry
   * this drag is a copy of. Its presence, not a separate flag, is what
   * this drag branches on: with it, the drop creates a duplicate at the
   * new spot and the original stays put; without it, the drag just moves
   * the original there. */
  duplicateSource?: TimeEntry;
}

export function CalendarGrid({
  days,
  startHour,
  endHour,
  entries,
  zoom,
  onZoomIn,
  onZoomOut,
  armedActivityId,
  armedActivityColor,
  armedDefaultDurationMinutes,
  selectedEntryId,
  onSelectEntry,
  onCreate,
  onRequestCreate,
  onMove,
  onDuplicate,
  onEditEntry,
  missingNotesEntryIds,
}: {
  days: Date[];
  startHour: number;
  endHour: number;
  entries: TimeEntry[];
  zoom: number;
  /** Omitted on the Template screen, which keeps its own zoom buttons in
   * its own toolbar rather than this floating corner control. */
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  armedActivityId: number | null;
  armedActivityColor: string | null;
  armedDefaultDurationMinutes: number;
  selectedEntryId: number | null;
  onSelectEntry: (id: number | null) => void;
  onCreate: (activityId: number, date: string, startTime: string, endTime: string) => void;
  /** Drag/click-to-create with no Activity armed -- the caller opens a
   * modal to pick (or create) one instead of creating immediately. */
  onRequestCreate: (date: string, startTime: string, endTime: string) => void;
  onMove: (id: number, date: string, startTime: string, endTime: string) => void;
  /** `openEdit` (Shift+click) opens Edit Entry for the new duplicate right
   * away, rather than leaving the user to double-click it themselves. A
   * plain Ctrl/Cmd+click (no drag) duplicates in place, same as before --
   * `date`/`startTime`/`endTime` are only passed for a Ctrl/Cmd+drag,
   * putting the copy at the drop location instead of the original's own.
   * See CalendarScreen's handleDuplicate. */
  onDuplicate: (
    entry: TimeEntry,
    options?: { openEdit?: boolean; date?: string; startTime?: string; endTime?: string },
  ) => void;
  onEditEntry: (entry: TimeEntry) => void;
  /** Entries flagged as missing Notes by the last Upload to Jira attempt --
   * outlined in red until each one's actually fixed. Omitted on the
   * Template screen, which has no Jira upload concept. */
  missingNotesEntryIds?: Set<number>;
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
  //
  // Math.floor, not the raw division: each of the 5 day columns gets this
  // exact width applied as its own inline style, and the browser rounds
  // each one to a real device pixel independently -- a raw fractional
  // value can round UP often enough that the 5 columns' summed width ends
  // up a pixel wider than the space actually available, tipping
  // .calendar-scroll's overflow:auto into showing a horizontal scrollbar
  // it doesn't really need. That shrinks the container (ResizeObserver
  // picks it up), which recomputes a *different* width, which can flip
  // the scrollbar back off, regrowing the container, recomputing the
  // original width again -- a genuine feedback loop, visible as the whole
  // grid "vibrating" during anything that re-renders on every pointermove
  // (a drag), worst right at the last (Friday) column where the summed
  // rounding error is largest. Flooring guarantees the total is never
  // larger than what's actually available, only ever equal or smaller.
  const DAY_WIDTH_PX =
    containerSize.width > 0
      ? Math.max(MIN_DAY_WIDTH_PX, Math.floor((containerSize.width - GUTTER_WIDTH_PX) / days.length))
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
  // Floored for the same reason DAY_WIDTH_PX is -- at zoom 1 this is meant
  // to fit with no vertical scrollbar at all, and a raw fractional value
  // rounding up by even one device pixel per slot can sum to just enough
  // extra height to trigger one anyway, feeding the same
  // ResizeObserver-vs-overflow oscillation loop described there.
  const fitSlotHeight =
    containerSize.height > 0
      ? Math.max(
          MIN_SLOT_HEIGHT_PX,
          Math.min(
            MAX_SLOT_HEIGHT_PX,
            Math.floor((containerSize.height - GRID_TOP_PAD_PX - GRID_BOTTOM_PAD_PX) / totalSlots),
          ),
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

  // Translucent preview of where a click/drag would land while an Activity
  // is armed -- purely a hover indicator, so it's cleared the moment a real
  // drag starts (that has its own preview) or the pointer leaves the grid.
  const [hover, setHover] = useState<{ dayIndex: number; startMin: number } | null>(null);

  const gridContentHeight = (totalMinutes / SLOT_MINUTES) * SLOT_HEIGHT_PX;
  const gridHeight = gridContentHeight + GRID_TOP_PAD_PX + GRID_BOTTOM_PAD_PX;
  const minutesToPx = (min: number) => GRID_TOP_PAD_PX + (min / SLOT_MINUTES) * SLOT_HEIGHT_PX;
  const dayIso = useMemo(() => days.map(toISODate), [days]);
  const todayIso = toISODate(new Date());

  // Drives both the "now" line and each block's isHappeningNow check.
  // Updated on a timer (not just once at mount) so the line actually
  // creeps down the grid and a block stops looking "current" the moment
  // its end time passes, without needing a page reload.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(interval);
  }, []);
  const nowMinutesSinceStart = now.getHours() * 60 + now.getMinutes() - startHour * 60;
  const showNowLine = toISODate(now) === todayIso && nowMinutesSinceStart >= 0 && nowMinutesSinceStart <= totalMinutes;

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
    // No armedActivityId check here anymore -- dragging/clicking with
    // nothing armed still starts a create-drag; onPointerUp below routes
    // it to onRequestCreate (a picker modal) instead of onCreate.
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

  const beginMove = (
    entry: TimeEntry,
    dayIndex: number,
    y: number,
    clientX: number,
    clientY: number,
    duplicate: boolean,
  ) => {
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
      duplicateSource: duplicate ? entry : undefined,
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

      if (finalDrag.mode === "create") {
        const date = dayIso[finalDrag.dayIndex];
        let startMin: number;
        let endMin: number;
        if (finalDrag.moved) {
          startMin = finalDrag.startMin;
          endMin = finalDrag.endMin;
        } else {
          // A plain click (no drag): fall back to the armed Activity's own
          // default duration, or the generic default when nothing's armed
          // (armedDefaultDurationMinutes already carries that fallback --
          // see CalendarScreen).
          startMin = finalDrag.anchorMin;
          endMin = clampMinutes(Math.max(startMin + SLOT_MINUTES, startMin + armedDefaultDurationMinutes));
        }
        const startTime = minutesToTime(startMin + startHour * 60);
        const endTime = minutesToTime(endMin + startHour * 60);
        if (armedActivityId != null) {
          onCreate(armedActivityId, date, startTime, endTime);
        } else {
          onRequestCreate(date, startTime, endTime);
        }
        return;
      }

      if (!finalDrag.moved) {
        if (finalDrag.duplicateSource) {
          // A plain Ctrl/Cmd+click, no drag -- same in-place duplicate this
          // gesture has always done.
          onDuplicate(finalDrag.duplicateSource);
        } else if (finalDrag.entryId != null) {
          onSelectEntry(finalDrag.entryId);
        }
        return;
      }

      if (finalDrag.entryId != null) {
        const date = dayIso[finalDrag.dayIndex];
        const startTime = minutesToTime(finalDrag.startMin + startHour * 60);
        const endTime = minutesToTime(finalDrag.endMin + startHour * 60);
        if (finalDrag.duplicateSource) {
          onDuplicate(finalDrag.duplicateSource, { date, startTime, endTime });
        } else {
          onMove(finalDrag.entryId, date, startTime, endTime);
        }
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
    <div className="calendar-wrapper" data-tour="calendar-grid">
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
        onPointerMove={(e) => {
          if (drag || armedActivityId == null) return;
          const point = gridPointFromEvent(e);
          if (!point || point.x < 0 || point.y < 0) {
            setHover(null);
            return;
          }
          const dayIndex = xToDayIndex(point.x);
          const startMin = yToMinutes(point.y);
          setHover((prev) =>
            prev && prev.dayIndex === dayIndex && prev.startMin === startMin ? prev : { dayIndex, startMin },
          );
        }}
        onPointerLeave={() => setHover(null)}
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
                  // rather than disappearing until the drag ends. A
                  // duplicate-drag is the one exception: the original isn't
                  // going anywhere, so it stays put and only the floating
                  // copy-preview follows the pointer.
                  if (drag?.entryId === entry.id && drag.moved && !drag.duplicateSource) return null;

                  const startMin = timeToMinutes(entry.startTime) - startHour * 60;
                  const endMin = timeToMinutes(entry.endTime) - startHour * 60;
                  const slot = layout.get(entry.id) ?? { colIndex: 0, colCount: 1 };
                  const colWidth = (DAY_WIDTH_PX - BLOCK_GAP_PX * (slot.colCount - 1)) / slot.colCount;
                  const left = slot.colIndex * (colWidth + BLOCK_GAP_PX);
                  const top = minutesToPx(startMin);
                  const height = Math.max(SLOT_HEIGHT_PX, ((endMin - startMin) / SLOT_MINUTES) * SLOT_HEIGHT_PX);
                  const isActiveNow =
                    iso === todayIso && showNowLine && nowMinutesSinceStart >= startMin && nowMinutesSinceStart < endMin;
                  const isMissingNotes = !!missingNotesEntryIds?.has(entry.id) && !entry.notes.trim();

                  return (
                    <div
                      key={entry.id}
                      className={
                        "calendar-entry" +
                        (selectedEntryId === entry.id ? " calendar-entry-selected" : "") +
                        (isActiveNow ? " calendar-entry-active" : "") +
                        (isMissingNotes ? " calendar-entry-missing-notes" : "")
                      }
                      title={
                        entry.notes
                          ? `${entry.activityName} · ${entry.startTime}–${entry.endTime}\n${entry.notes}`
                          : isMissingNotes
                            ? `${entry.activityName} · ${entry.startTime}–${entry.endTime}\nMissing Notes -- required before uploading to Jira`
                            : `${entry.activityName} · ${entry.startTime}–${entry.endTime}`
                      }
                      style={{
                        left,
                        top,
                        width: colWidth,
                        height,
                        background: entry.color,
                        color: blockTextColor(entry.color),
                        // Missing-notes takes visual priority over the
                        // active-now halo when a block is both -- its color
                        // is fixed (the theme's danger red), not computed
                        // per-block like activeNowAccent, so it's set via
                        // the CSS class below instead of inline here; an
                        // inline outlineColor from the active-now branch
                        // would otherwise win over that class regardless.
                        ...(isMissingNotes
                          ? {}
                          : isActiveNow
                            ? {
                                outlineColor: activeNowAccent(entry.color),
                                boxShadow: `0 0 8px 1px ${activeNowAccent(entry.color)}, 0 2px 8px rgba(0, 0, 0, 0.35)`,
                              }
                            : {}),
                      }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        if (e.button !== 0) return;
                        if (e.shiftKey) {
                          onDuplicate(entry, { openEdit: true });
                          return;
                        }
                        const point = gridPointFromEvent(e);
                        if (!point) return;
                        beginMove(entry, dayIndex, point.y, e.clientX, e.clientY, e.ctrlKey || e.metaKey);
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

                {!drag &&
                  hover &&
                  hover.dayIndex === dayIndex &&
                  armedActivityId != null &&
                  (() => {
                    const hoverEnd = clampMinutes(hover.startMin + armedDefaultDurationMinutes);
                    return (
                      <div
                        className="calendar-entry calendar-hover-preview"
                        style={{
                          left: 0,
                          top: minutesToPx(hover.startMin),
                          width: DAY_WIDTH_PX,
                          height: Math.max(
                            SLOT_HEIGHT_PX,
                            ((hoverEnd - hover.startMin) / SLOT_MINUTES) * SLOT_HEIGHT_PX,
                          ),
                          background: armedActivityColor ?? "var(--accent)",
                        }}
                      />
                    );
                  })()}

                {drag &&
                  drag.mode === "create" &&
                  drag.dayIndex === dayIndex &&
                  drag.moved && (
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
                      className={
                        "calendar-entry calendar-entry-dragging" +
                        (drag.duplicateSource ? " calendar-entry-duplicating" : "")
                      }
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

                {iso === todayIso && showNowLine && (
                  <div className="calendar-now-line" style={{ top: minutesToPx(nowMinutesSinceStart) }}>
                    <span className="calendar-now-dot" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {onZoomIn && onZoomOut && (
        <div className="calendar-zoom-control" data-tour="calendar-zoom">
          <button type="button" onClick={onZoomOut} aria-label="Zoom out" title={`Zoom out (${Math.round(zoom * 100)}%)`}>
            <ZoomGlyph mode="out" />
          </button>
          <button type="button" onClick={onZoomIn} aria-label="Zoom in" title={`Zoom in (${Math.round(zoom * 100)}%)`}>
            <ZoomGlyph mode="in" />
          </button>
        </div>
      )}
    </div>
  );
}

/** Magnifying glass with a +/- stroke -- kept as a plain inline SVG (same
 * approach as JiraIcon/Logo) rather than an icon font dependency, using
 * currentColor so it follows the corner control's own hover/idle color. */
function ZoomGlyph({ mode }: { mode: "in" | "out" }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
      <line x1="15" y1="15" x2="21" y2="21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="7" y1="10" x2="13" y2="10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      {mode === "in" && (
        <line x1="10" y1="7" x2="10" y2="13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      )}
    </svg>
  );
}

/** A translucent version of whichever of black/white actually contrasts
 * with this specific block's own background (see blockTextColor) -- used
 * for the "happening now" outline/glow so it's always visible regardless
 * of the block's own color, instead of a fixed theme color that can end up
 * close to (or the same hue as) the block it's supposed to highlight. */
function activeNowAccent(bgHex: string): string {
  return blockTextColor(bgHex) === BLOCK_TEXT_LIGHT ? "rgba(255, 255, 255, 0.9)" : "rgba(0, 0, 0, 0.75)";
}

function formatHour(h: number): string {
  const period = h < 12 || h === 24 ? "AM" : "PM";
  let hour12 = h % 12;
  if (hour12 === 0) hour12 = 12;
  return `${hour12} ${period}`;
}
