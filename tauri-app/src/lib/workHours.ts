import type { DayHours } from "../api/settings";
import { addDays } from "./date";

const FALLBACK: DayHours = { start: 9, end: 17 };

/** Monday = 0 ... Sunday = 6 -- the order settings.workHours is stored in
 * (JS's own getDay() starts at Sunday = 0, which is why this exists). */
export function weekdayIndex(d: Date): number {
  const dow = d.getDay();
  return dow === 0 ? 6 : dow - 1;
}

export function hoursForDate(workHours: DayHours[], d: Date): DayHours {
  return workHours[weekdayIndex(d)] ?? FALLBACK;
}

export function isWorkingDay(h: DayHours): boolean {
  return h.end > h.start;
}

/** The single hour range a grid showing `days` needs to cover -- the
 * earliest start and latest end across those days' own hours, since every
 * column on the grid shares one set of hour rows. Days off don't widen it;
 * if every day shown is a day off, falls back to a normal working day so
 * the grid never collapses to zero height. */
export function gridHourRange(workHours: DayHours[], days: Date[]): DayHours {
  const working = days.map((d) => hoursForDate(workHours, d)).filter(isWorkingDay);
  if (working.length === 0) return FALLBACK;
  return {
    start: Math.min(...working.map((h) => h.start)),
    end: Math.max(...working.map((h) => h.end)),
  };
}

/** Expected work minutes across the Mon-Fri days in [start, end] inclusive,
 * each weekday using its own configured hours. Weekends never count, same
 * as before per-day hours existed -- "show weekends" only controls
 * visibility on the calendar. */
export function expectedMinutesBetween(workHours: DayHours[], start: Date, end: Date): number {
  let minutes = 0;
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  for (let cur = new Date(start.getFullYear(), start.getMonth(), start.getDate()); cur <= last; cur = addDays(cur, 1)) {
    const idx = weekdayIndex(cur);
    if (idx > 4) continue;
    const h = workHours[idx] ?? FALLBACK;
    minutes += Math.max(0, h.end - h.start) * 60;
  }
  return minutes;
}
