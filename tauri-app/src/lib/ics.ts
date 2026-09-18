import { addDays, toISODate } from "./date";

/** Minimal RFC 5545 (iCalendar) parser + occurrence expansion, scoped to
 * what "Import from Outlook Calendar" needs: pulling the events that land
 * on the days currently shown on the Timesheet, including simple DAILY/
 * WEEKLY recurrence (the two patterns real meeting invites actually use --
 * daily standups, weekly syncs on specific weekdays). Not a general-purpose
 * ICS library: MONTHLY/YEARLY rules and things like BYMONTHDAY/BYSETPOS
 * aren't expanded (only the rule's own DTSTART occurrence is checked
 * against the window), and a DTSTART/EXDATE with a TZID is treated as
 * already-local wall-clock time rather than converted from that zone --
 * fine for a team working in one timezone, which is what this app assumes
 * everywhere else (see lib/date.ts's toJiraStarted). */

export interface IcsOccurrence {
  uid: string;
  summary: string;
  description: string;
  location: string;
  date: string; // YYYY-MM-DD, local
  startTime: string; // HH:MM, local
  endTime: string; // HH:MM, local
}

export interface ParsedEvent {
  uid: string;
  summary: string;
  description: string;
  location: string;
  start: Date;
  end: Date;
  allDay: boolean;
  cancelled: boolean;
  /** Set only on a single-instance override of a recurring series (a
   * meeting edited or cancelled for one specific day, which Outlook/Google
   * export as a separate VEVENT sharing the series' own UID) -- the
   * YYYY-MM-DD of the original occurrence it replaces. */
  recurrenceId: string | null;
  rrule: Record<string, string> | null;
  exdates: number[]; // epoch ms, for O(1)-ish exclusion checks
}

const DAY_CODES: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
// A generous safety cap on how many occurrences a single recurring event's
// expansion loop will walk through before giving up -- guards against a
// pathological or malformed RRULE looping effectively forever, not a real
// expected count (a WEEKLY rule reaches 10 years in ~520 iterations).
const MAX_OCCURRENCE_STEPS = 3660;

function unescapeText(s: string): string {
  return s.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

/** Un-folds RFC 5545 line continuations (a line starting with a space or
 * tab is a continuation of the previous one) and drops blank lines. */
function unfoldLines(text: string): string[] {
  const raw = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const lines: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else if (line.trim() !== "") {
      lines.push(line);
    }
  }
  return lines;
}

interface Property {
  params: Record<string, string>;
  value: string;
}

function parseLine(line: string): { name: string; prop: Property } {
  const colonIdx = line.indexOf(":");
  const head = colonIdx === -1 ? line : line.slice(0, colonIdx);
  const value = colonIdx === -1 ? "" : line.slice(colonIdx + 1);
  const parts = head.split(";");
  const name = parts[0].toUpperCase();
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf("=");
    if (eq === -1) continue;
    params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
  }
  return { name, prop: { params, value } };
}

/** Parses an ICS date/date-time value ("20260115", "20260115T090000", or
 * "20260115T090000Z") into a local-time Date. A "Z" suffix converts from
 * UTC; anything else is treated as already-local wall-clock time. */
function parseIcsDate(value: string): { date: Date; allDay: boolean } {
  const v = value.trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return { date: new Date(Number(y), Number(m) - 1, Number(d)), allDay: true };
  }
  const dt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v);
  if (!dt) return { date: new Date(NaN), allDay: false };
  const [, y, mo, d, hh, mi, ss, z] = dt;
  const date = z
    ? new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mi), Number(ss)))
    : new Date(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mi), Number(ss));
  return { date, allDay: false };
}

export function parseIcsEvents(text: string): ParsedEvent[] {
  const lines = unfoldLines(text);
  const events: ParsedEvent[] = [];
  let cur: Record<string, Property[]> | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      cur = {};
      continue;
    }
    if (line === "END:VEVENT") {
      if (cur) {
        const built = buildEvent(cur);
        if (built) events.push(built);
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const { name, prop } = parseLine(line);
    (cur[name] ??= []).push(prop);
  }

  return events;
}

function buildEvent(props: Record<string, Property[]>): ParsedEvent | null {
  // Not dropped outright even when cancelled -- a cancelled single instance
  // of a recurring series still needs its RECURRENCE-ID recorded so the
  // series' own RRULE expansion knows to skip that date too (see
  // occurrencesForDays); it's excluded from the final display list there,
  // by `cancelled`, once that's done.
  const cancelled = props.STATUS?.[0]?.value?.toUpperCase() === "CANCELLED";

  const dtstartProp = props.DTSTART?.[0];
  if (!dtstartProp) return null;
  const { date: start, allDay } = parseIcsDate(dtstartProp.value);
  if (isNaN(start.getTime())) return null;

  let end: Date;
  const dtendProp = props.DTEND?.[0];
  if (dtendProp) {
    end = parseIcsDate(dtendProp.value).date;
    if (isNaN(end.getTime())) end = new Date(start.getTime() + 30 * 60 * 1000);
  } else {
    // No DTEND and DURATION isn't handled (rare on real meeting invites) --
    // default to a 30-minute block, or a single day for an all-day entry.
    end = new Date(start.getTime() + (allDay ? 24 * 60 * 60 * 1000 : 30 * 60 * 1000));
  }

  let rrule: Record<string, string> | null = null;
  const rruleProp = props.RRULE?.[0];
  if (rruleProp) {
    rrule = {};
    for (const part of rruleProp.value.split(";")) {
      const [k, v] = part.split("=");
      if (k && v) rrule[k.toUpperCase()] = v;
    }
  }

  const exdates: number[] = [];
  for (const prop of props.EXDATE ?? []) {
    for (const v of prop.value.split(",")) {
      const { date } = parseIcsDate(v);
      if (!isNaN(date.getTime())) exdates.push(date.getTime());
    }
  }

  const recurrenceIdProp = props["RECURRENCE-ID"]?.[0];
  let recurrenceId: string | null = null;
  if (recurrenceIdProp) {
    const { date } = parseIcsDate(recurrenceIdProp.value);
    if (!isNaN(date.getTime())) recurrenceId = toISODate(date);
  }

  return {
    uid: props.UID?.[0]?.value ?? `${dtstartProp.value}-${props.SUMMARY?.[0]?.value ?? ""}`,
    summary: unescapeText(props.SUMMARY?.[0]?.value ?? ""),
    description: unescapeText(props.DESCRIPTION?.[0]?.value ?? ""),
    location: unescapeText(props.LOCATION?.[0]?.value ?? ""),
    start,
    end,
    allDay,
    cancelled,
    recurrenceId,
    rrule,
    exdates,
  };
}

function isExcluded(occStart: Date, exdates: number[]): boolean {
  return exdates.includes(occStart.getTime());
}

function dayCodeToIndex(code: string): number | null {
  const idx = DAY_CODES[code.toUpperCase().slice(-2)];
  return idx == null ? null : idx;
}

/** Start times (not full occurrences) for `ev` that fall within
 * [rangeStart, rangeEndExclusive). Non-recurring events are a single
 * check; DAILY/WEEKLY rules are walked from DTSTART, capped by
 * MAX_OCCURRENCE_STEPS; anything else falls back to just the rule's own
 * first occurrence. */
function expandOccurrenceStarts(ev: ParsedEvent, rangeStart: Date, rangeEndExclusive: Date): Date[] {
  if (!ev.rrule) {
    return ev.start < rangeEndExclusive && ev.end > rangeStart ? [ev.start] : [];
  }

  const freq = ev.rrule.FREQ;
  const interval = Math.max(1, parseInt(ev.rrule.INTERVAL ?? "1", 10) || 1);
  const count = ev.rrule.COUNT ? parseInt(ev.rrule.COUNT, 10) : null;
  const until = ev.rrule.UNTIL ? parseIcsDate(ev.rrule.UNTIL).date : null;
  const results: Date[] = [];

  if (freq === "DAILY") {
    let cur = new Date(ev.start);
    for (let i = 0; i < MAX_OCCURRENCE_STEPS; i++) {
      if ((count != null && i >= count) || (until && cur > until) || cur >= rangeEndExclusive) break;
      if (cur >= rangeStart && !isExcluded(cur, ev.exdates)) results.push(cur);
      cur = addDays(cur, interval);
    }
    return results;
  }

  if (freq === "WEEKLY") {
    const byDayCodes = ev.rrule.BYDAY?.split(",").map(dayCodeToIndex).filter((d): d is number => d != null);
    const daysOfWeek = byDayCodes && byDayCodes.length > 0 ? byDayCodes : [ev.start.getDay()];
    // Monday of DTSTART's own week, so BYDAY offsets below are relative to
    // a consistent anchor regardless of which weekday DTSTART itself falls on.
    let weekAnchor = addDays(ev.start, -((ev.start.getDay() + 6) % 7));
    let occurrenceCount = 0;

    for (let w = 0; w < MAX_OCCURRENCE_STEPS; w++) {
      const weekOccs = daysOfWeek
        .map((dow) => {
          const dayOffset = dow === 0 ? 6 : dow - 1; // Monday-anchored offset within the week
          const day = addDays(weekAnchor, dayOffset);
          return new Date(day.getFullYear(), day.getMonth(), day.getDate(), ev.start.getHours(), ev.start.getMinutes(), ev.start.getSeconds());
        })
        .filter((occ) => occ.getTime() >= ev.start.getTime())
        .sort((a, b) => a.getTime() - b.getTime());

      let stop = false;
      for (const occ of weekOccs) {
        if (until && occ > until) {
          stop = true;
          break;
        }
        if (count != null && occurrenceCount >= count) {
          stop = true;
          break;
        }
        if (occ >= rangeStart && occ < rangeEndExclusive && !isExcluded(occ, ev.exdates)) results.push(occ);
        occurrenceCount++;
      }
      if (stop) break;

      weekAnchor = addDays(weekAnchor, 7 * interval);
      if (weekAnchor >= rangeEndExclusive) break;
    }
    return results;
  }

  // MONTHLY/YEARLY/unrecognised -- expansion isn't implemented, so only the
  // rule's own first occurrence is checked against the window.
  return ev.start < rangeEndExclusive && ev.end > rangeStart ? [ev.start] : [];
}

function toHHMM(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** A block can't span midnight on this app's per-day grid -- an occurrence
 * that would runs past it is clamped to 23:59 of its start day instead. */
function clampToSameDay(start: Date, end: Date): Date {
  if (toISODate(end) === toISODate(start)) return end;
  return new Date(start.getFullYear(), start.getMonth(), start.getDate(), 23, 59);
}

/** Expands every event to its occurrences landing on one of `days` (an
 * explicit list rather than a start/end range, so weekends stay excluded
 * exactly when the Timesheet itself is hiding them). All-day events (OOO,
 * holidays) are skipped -- not meaningful as a single timed block.
 *
 * A recurring series edited or cancelled for one specific day comes through
 * as a second VEVENT sharing the series' UID with its own RECURRENCE-ID
 * (see buildEvent) rather than a change to the series itself -- without
 * accounting for that, the series' own RRULE would still generate its
 * original occurrence for that date *and* the override would add its own,
 * showing the same meeting twice (this is what the duplicate-key warning
 * during real-calendar testing turned out to be). Every such override's
 * date is excluded from its series' RRULE expansion below; a non-cancelled
 * override is still included, via its own (possibly retimed/renamed) entry
 * later in this same loop. */
export function occurrencesForDays(events: ParsedEvent[], days: Date[]): IcsOccurrence[] {
  if (days.length === 0) return [];
  const rangeStart = new Date(days[0].getFullYear(), days[0].getMonth(), days[0].getDate());
  const last = days[days.length - 1];
  const rangeEndExclusive = addDays(new Date(last.getFullYear(), last.getMonth(), last.getDate()), 1);
  const dayKeys = new Set(days.map(toISODate));

  const overriddenDates = new Set(
    events.filter((e) => e.recurrenceId != null).map((e) => `${e.uid}__${e.recurrenceId}`),
  );

  const out: IcsOccurrence[] = [];
  const seenKeys = new Set<string>();
  for (const ev of events) {
    if (ev.allDay || ev.cancelled) continue;
    const durationMs = Math.max(ev.end.getTime() - ev.start.getTime(), 5 * 60 * 1000);
    for (const occStart of expandOccurrenceStarts(ev, rangeStart, rangeEndExclusive)) {
      const dateKey = toISODate(occStart);
      if (!dayKeys.has(dateKey)) continue;
      if (ev.rrule && overriddenDates.has(`${ev.uid}__${dateKey}`)) continue;
      // Defensive: any other way the same event could produce the same
      // slot twice (a malformed feed, an odd RRULE/override combination
      // not accounted for above) still can't render as a duplicate key.
      const dedupeKey = `${ev.uid}__${dateKey}__${toHHMM(occStart)}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);
      const occEnd = clampToSameDay(occStart, new Date(occStart.getTime() + durationMs));
      out.push({
        uid: ev.uid,
        summary: ev.summary,
        description: ev.description,
        location: ev.location,
        date: dateKey,
        startTime: toHHMM(occStart),
        endTime: toHHMM(occEnd),
      });
    }
  }
  out.sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
  return out;
}
