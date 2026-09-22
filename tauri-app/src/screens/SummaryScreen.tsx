import { useEffect, useMemo, useState } from "react";
import { listTimeEntries, type TimeEntry } from "../api/calendar";
import { listAllActivities, listProjects, type Activity, type Project } from "../api/activities";
import {
  addDays,
  addMonths,
  countWeekdays,
  monthEnd,
  monthStart,
  timeToMinutes,
  toISODate,
  weekStart,
} from "../lib/date";
import { blockTextColor } from "../theme/palettes";
import type { AppSettings } from "../api/settings";

type Mode = "week" | "month";

interface GroupTotal {
  key: string;
  name: string;
  color: string;
  minutes: number;
}

function entryMinutes(e: TimeEntry): number {
  return timeToMinutes(e.endTime) - timeToMinutes(e.startTime);
}

// Keyed by activityId when present, else by name -- entries whose Activity
// has since been deleted still fall into one bucket per (preserved) name
// instead of scattering across separate rows, matching the Python app's
// SummaryPanel grouping.
function groupByActivity(entries: TimeEntry[]): GroupTotal[] {
  const map = new Map<string, GroupTotal>();
  for (const e of entries) {
    const key = e.activityId != null ? `id:${e.activityId}` : `name:${e.activityName}`;
    const minutes = entryMinutes(e);
    const existing = map.get(key);
    if (existing) existing.minutes += minutes;
    else map.set(key, { key, name: e.activityName, color: e.color, minutes });
  }
  return [...map.values()].sort((a, b) => b.minutes - a.minutes);
}

// Grouped by each entry's Activity's *current* Project -- not the Project
// implied by the entry's own snapshotted color/name -- so reassigning an
// Activity to a different Project changes where its past time counts here.
// An entry whose Activity was deleted (there's no way to know which
// Project it used to belong to) falls back to its own preserved name.
function groupByProject(entries: TimeEntry[], activities: Activity[], projects: Project[]): GroupTotal[] {
  const map = new Map<string, GroupTotal>();
  for (const e of entries) {
    const minutes = entryMinutes(e);
    const activity = e.activityId != null ? activities.find((a) => a.id === e.activityId) : undefined;
    const project = activity?.projectId != null ? projects.find((p) => p.id === activity.projectId) : undefined;
    const key = project ? `id:${project.id}` : `orphan:${e.activityName}`;
    const existing = map.get(key);
    if (existing) {
      existing.minutes += minutes;
      continue;
    }
    map.set(
      key,
      project
        ? { key, name: project.name, color: project.color, minutes }
        : { key, name: e.activityName, color: e.color, minutes },
    );
  }
  return [...map.values()].sort((a, b) => b.minutes - a.minutes);
}

function formatHours(minutes: number): string {
  return (minutes / 60).toFixed(1);
}

export function SummaryScreen({ settings }: { settings: AppSettings }) {
  const [mode, setMode] = useState<Mode>("week");
  const [anchor, setAnchor] = useState(() => new Date());
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  useEffect(() => {
    listAllActivities().then(setActivities).catch((e) => setError(String(e)));
    listProjects().then(setProjects).catch((e) => setError(String(e)));
  }, []);

  const { rangeStart, rangeEnd, label } = useMemo(() => {
    if (mode === "week") {
      const start = weekStart(anchor);
      const end = addDays(start, settings.showWeekends ? 6 : 4);
      return {
        rangeStart: toISODate(start),
        rangeEnd: toISODate(end),
        label: `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`,
      };
    }
    const start = monthStart(anchor);
    const end = monthEnd(anchor);
    return {
      rangeStart: toISODate(start),
      rangeEnd: toISODate(end),
      label: start.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
    };
  }, [mode, anchor, settings.showWeekends]);

  useEffect(() => {
    listTimeEntries(rangeStart, rangeEnd).then(setEntries).catch((e) => setError(String(e)));
  }, [rangeStart, rangeEnd]);

  useEffect(() => setHoveredKey(null), [rangeStart, rangeEnd]);

  const byProject = useMemo(() => groupByProject(entries, activities, projects), [entries, activities, projects]);
  const byActivity = useMemo(() => groupByActivity(entries), [entries]);
  const totalMinutes = useMemo(() => entries.reduce((sum, e) => sum + entryMinutes(e), 0), [entries]);

  // Expected capacity is Mon-Fri x the Settings work-hours window --
  // "showWeekends" only controls whether weekend days are visible/loggable
  // on the calendar, not whether they count as expected work time. This is
  // a placeholder baseline; a real per-person expected-hours source (e.g.
  // pulled from Jira) can replace it later without touching the rest of
  // this screen.
  const expectedMinutes = useMemo(() => {
    const hoursPerDay = Math.max(0, settings.workEndHour - settings.workStartHour);
    if (mode === "week") {
      const start = weekStart(anchor);
      return countWeekdays(start, addDays(start, 4)) * hoursPerDay * 60;
    }
    return countWeekdays(monthStart(anchor), monthEnd(anchor)) * hoursPerDay * 60;
  }, [mode, anchor, settings.workStartHour, settings.workEndHour]);

  function shiftPrev() {
    setAnchor((d) => (mode === "week" ? addDays(d, -7) : addMonths(d, -1)));
  }
  function shiftNext() {
    setAnchor((d) => (mode === "week" ? addDays(d, 7) : addMonths(d, 1)));
  }

  const expectedPct = expectedMinutes > 0 ? (totalMinutes / expectedMinutes) * 100 : 0;
  const overExpected = totalMinutes > expectedMinutes;

  return (
    <div className="calendar-screen">
      <div className="calendar-toolbar">
        <div className="segmented calendar-nav-pill">
          <button type="button" className="segment" onClick={shiftPrev} aria-label="Previous">
            ‹
          </button>
          <button type="button" className="segment" onClick={() => setAnchor(new Date())}>
            Today
          </button>
          <button type="button" className="segment" onClick={shiftNext} aria-label="Next">
            ›
          </button>
        </div>
        <div className="calendar-week-label">{label}</div>
        <div className="segmented">
          <button
            className={"segment" + (mode === "week" ? " segment-active" : "")}
            onClick={() => setMode("week")}
          >
            Week
          </button>
          <button
            className={"segment" + (mode === "month" ? " segment-active" : "")}
            onClick={() => setMode("month")}
          >
            Month
          </button>
        </div>
      </div>

      {error && <p className="status status-error">{error}</p>}

      <div className="summary-body">
        <div className="card summary-card" data-tour="summary-project-card">
          <h2>By Project</h2>
          {byProject.length === 0 ? (
            <p className="muted">No time logged in this period.</p>
          ) : (
            <>
              <DonutChart
                groups={byProject}
                totalMinutes={totalMinutes}
                hoveredKey={hoveredKey}
                onHover={setHoveredKey}
              />
              <ul className="summary-legend">
                {byProject.map((g) => (
                  <li
                    key={g.key}
                    className={"summary-legend-row" + (hoveredKey === g.key ? " summary-legend-row-active" : "")}
                    onMouseEnter={() => setHoveredKey(g.key)}
                    onMouseLeave={() => setHoveredKey(null)}
                  >
                    <span className="color-dot" style={{ background: g.color }} />
                    <span className="summary-legend-name">{g.name}</span>
                    <span className="muted">
                      {formatHours(g.minutes)}h ({Math.round((g.minutes / totalMinutes) * 100)}%)
                    </span>
                  </li>
                ))}
              </ul>
              <p className="muted">
                Total: {formatHours(totalMinutes)}h across {byProject.length} project
                {byProject.length === 1 ? "" : "s"}
              </p>
            </>
          )}
        </div>

        <div className="card summary-card">
          <h2>By Activity</h2>

          <div className="summary-expected">
            <div className="summary-bar-label">
              <span>Logged vs. expected</span>
              <span className="muted">
                {formatHours(totalMinutes)}h of {formatHours(expectedMinutes)}h expected
              </span>
            </div>
            <div className="summary-bar-track">
              <div
                className="summary-bar-fill"
                style={{
                  width: `${Math.min(100, Math.max(expectedPct, totalMinutes > 0 ? 2 : 0))}%`,
                  background: overExpected ? "#4ade80" : "var(--accent)",
                }}
              />
            </div>
            <p className="muted">
              {expectedMinutes === 0
                ? "No expected hours for this period (check Settings' work hours)."
                : overExpected
                  ? `${formatHours(totalMinutes - expectedMinutes)}h over expected`
                  : `${formatHours(expectedMinutes - totalMinutes)}h remaining`}
            </p>
          </div>

          {byActivity.length === 0 ? (
            <p className="muted">No time logged in this period.</p>
          ) : (
            <>
              <div className="summary-bars">
                {byActivity.map((g) => {
                  const pct = totalMinutes > 0 ? (g.minutes / totalMinutes) * 100 : 0;
                  return (
                    <div key={g.key} className="summary-bar-row">
                      <div className="summary-bar-label">
                        <span>{g.name}</span>
                        <span className="muted">
                          {formatHours(g.minutes)}h ({Math.round(pct)}%)
                        </span>
                      </div>
                      <div className="summary-bar-track">
                        <div
                          className="summary-bar-fill"
                          style={{ width: `${Math.max(pct, 2)}%`, background: g.color }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="muted">
                Total: {formatHours(totalMinutes)}h across {byActivity.length} activit
                {byActivity.length === 1 ? "y" : "ies"}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const PIE_SIZE = 200;
const PIE_CENTER = PIE_SIZE / 2;
const RING_RADIUS = 72;
const RING_STROKE = 30;
const RING_STROKE_HOVER = 36;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const RING_GAP = 5;
// A true-to-scale sliver for a very small share (a percent or two) can end
// up thinner than the gap that separates it from its neighbors, rendering
// as nothing at all -- this floors every segment's drawn length so even the
// smallest contributor stays a clearly visible fleck of color. Segments are
// drawn in order (largest first), each painted over whatever came before
// it, so a boosted segment's extra length is silently clipped by the next
// segment's true start -- harmless, it just means the floor only fully
// applies to whichever segment is drawn last.
const MIN_VISUAL_DEGREES = 10;
// Below this angular width a label can't fit against its own segment --
// those rows still carry their exact name/hours/percentage in the legend.
const LABEL_MIN_DEGREES = 20;

function pointOnCircle(deg: number, radius: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [PIE_CENTER + radius * Math.cos(rad), PIE_CENTER + radius * Math.sin(rad)];
}

function DonutChart({
  groups,
  totalMinutes,
  hoveredKey,
  onHover,
}: {
  groups: GroupTotal[];
  totalMinutes: number;
  hoveredKey: string | null;
  onHover: (key: string | null) => void;
}) {
  if (totalMinutes <= 0) {
    return (
      <svg viewBox={`0 0 ${PIE_SIZE} ${PIE_SIZE}`} className="summary-pie">
        <circle
          cx={PIE_CENTER}
          cy={PIE_CENTER}
          r={RING_RADIUS}
          fill="none"
          stroke="var(--border-strong)"
          strokeWidth={RING_STROKE}
        />
      </svg>
    );
  }

  let cumulative = 0;
  const segments = groups.map((g) => {
    const fraction = g.minutes / totalMinutes;
    const start = cumulative;
    cumulative += fraction;
    return { g, startFraction: start, fraction, sweepDeg: fraction * 360 };
  });
  const gap = groups.length > 1 ? RING_GAP : 0;

  return (
    <svg viewBox={`0 0 ${PIE_SIZE} ${PIE_SIZE}`} className="summary-pie" onMouseLeave={() => onHover(null)}>
      {/* Segments are drawn as dashed strokes around a plain circle -- much
          simpler than building per-slice arc paths, and it sidesteps the
          degenerate 360-degree-arc case a single-group pie would otherwise
          need a special case for. */}
      <g transform={`rotate(-90 ${PIE_CENTER} ${PIE_CENTER})`}>
        {segments.map(({ g, startFraction, sweepDeg }) => {
          const visualDeg = Math.max(sweepDeg, MIN_VISUAL_DEGREES);
          const len = (visualDeg / 360) * RING_CIRCUMFERENCE;
          const isHovered = hoveredKey === g.key;
          const dimmed = hoveredKey != null && !isHovered;
          return (
            <circle
              key={g.key}
              cx={PIE_CENTER}
              cy={PIE_CENTER}
              r={RING_RADIUS}
              fill="none"
              stroke={g.color}
              strokeWidth={isHovered ? RING_STROKE_HOVER : RING_STROKE}
              strokeDasharray={`${Math.max(0, len - gap)} ${RING_CIRCUMFERENCE - (len - gap)}`}
              strokeDashoffset={-(startFraction * RING_CIRCUMFERENCE)}
              opacity={dimmed ? 0.35 : 1}
              className="summary-pie-segment"
              onMouseEnter={() => onHover(g.key)}
            />
          );
        })}
      </g>
      {segments.map(({ g, startFraction, fraction, sweepDeg }) => {
        if (sweepDeg < LABEL_MIN_DEGREES) return null;
        const midDeg = -90 + (startFraction + fraction / 2) * 360;
        const [lx, ly] = pointOnCircle(midDeg, RING_RADIUS);
        return (
          <text
            key={g.key}
            x={lx}
            y={ly}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={11}
            fontWeight={700}
            fill={blockTextColor(g.color)}
            className="summary-pie-label"
            style={{ opacity: hoveredKey != null && hoveredKey !== g.key ? 0.35 : 1 }}
          >
            {Math.round(fraction * 100)}%
          </text>
        );
      })}
      <text x={PIE_CENTER} y={PIE_CENTER - 6} textAnchor="middle" fontSize={20} fontWeight={700} fill="var(--text-primary)">
        {formatHours(totalMinutes)}h
      </text>
      <text x={PIE_CENTER} y={PIE_CENTER + 14} textAnchor="middle" fontSize={11} fill="var(--text-secondary)">
        total logged
      </text>
    </svg>
  );
}
