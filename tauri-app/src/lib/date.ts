export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

/** Monday of the week containing `d`, matching config.WEEKDAY_NAMES
 * starting on Monday. */
export function weekStart(d: Date): Date {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = copy.getDay(); // 0=Sun..6=Sat
  const diffFromMonday = dow === 0 ? -6 : 1 - dow;
  return addDays(copy, diffFromMonday);
}

export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60)
    .toString()
    .padStart(2, "0");
  const m = (minutes % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

export const WEEKDAY_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
export const WEEKEND_LABELS = ["Saturday", "Sunday"];

export function monthStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** Day 0 of next month == the last day of this one. */
export function monthEnd(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

/** Mon-Fri days in [start, end], inclusive of both ends. */
export function countWeekdays(start: Date, end: Date): number {
  let count = 0;
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (cur <= last) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

/** Formats a date + "HH:MM" as Jira's worklog `started` field expects --
 * ISO-ish with milliseconds and a numeric (not "Z") UTC offset, e.g.
 * "2026-09-18T09:00:00.000+0100". Uses the browser's own local timezone
 * offset (via Date, which already accounts for DST) rather than assuming
 * UTC, so a block logged at 9am local shows as 9am local in Jira too. */
export function toJiraStarted(date: string, time: string): string {
  const local = new Date(`${date}T${time}:00`);
  const offsetMin = -local.getTimezoneOffset(); // Date's own offset is UTC-minus-local, so negate
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const offsetHours = String(Math.floor(abs / 60)).padStart(2, "0");
  const offsetMinutes = String(abs % 60).padStart(2, "0");
  return `${date}T${time}:00.000${sign}${offsetHours}${offsetMinutes}`;
}
