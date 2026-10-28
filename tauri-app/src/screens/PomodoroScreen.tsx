import { useEffect, useState } from "react";
import { listActivities, type Activity } from "../api/activities";
import { createTimeEntry } from "../api/calendar";
import { Dropdown, DropdownOption } from "../components/Dropdown";
import { toISODate } from "../lib/date";
import {
  formatClock,
  PHASE_LABEL,
  phaseSeconds,
  pomodoro,
  usePomodoro,
  type CompletedSession,
} from "../lib/pomodoro";

const DEFAULT_NOTES = "Pomodoro focus session";

// Remembered between sessions so a run of Pomodoros on one task doesn't
// mean re-picking the Activity every time.
let lastActivityId: number | "" = "";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** The Timesheet block a finished focus session maps to -- the last N
 * minutes before the bell, on the day it ended (clamped to midnight if a
 * session straddled it, rather than writing a start time on the wrong day). */
function sessionBlock(session: CompletedSession) {
  const end = new Date(session.endMs);
  let start = new Date(session.startMs);
  const midnight = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  if (start < midnight) start = midnight;
  if (end <= start) return null;
  return {
    date: toISODate(end),
    startTime: `${pad(start.getHours())}:${pad(start.getMinutes())}`,
    endTime: `${pad(end.getHours())}:${pad(end.getMinutes())}`,
  };
}

function LogSessionsPanel({
  sessions,
  onLogged,
}: {
  sessions: readonly CompletedSession[];
  onLogged: (message: string) => void;
}) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [activityId, setActivityId] = useState<number | "">(lastActivityId);
  const [notes, setNotes] = useState(DEFAULT_NOTES);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listActivities().then(setActivities).catch(() => {});
  }, []);

  const blocks = sessions.map(sessionBlock).filter((b): b is NonNullable<typeof b> => b !== null);
  const activity = activities.find((a) => a.id === activityId) ?? null;

  async function handleLog() {
    if (!activity) return;
    setBusy(true);
    setError(null);
    try {
      for (const block of blocks) {
        await createTimeEntry({ activityId: activity.id, ...block, notes: notes.trim() });
      }
      lastActivityId = activity.id;
      // Same signal the Timer bar sends, so a Timesheet that's already
      // mounted pulls the new block(s) in without a manual refresh.
      window.dispatchEvent(new CustomEvent("quasar:time-entry-logged"));
      pomodoro.clearUnlogged();
      onLogged(`Logged ${blocks.length} focus block${blocks.length === 1 ? "" : "s"} to ${activity.name}.`);
    } catch (e) {
      setError(`Couldn't log it -- ${e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card pomodoro-log">
      <h2>
        {sessions.length} focus session{sessions.length === 1 ? "" : "s"} ready to log
      </h2>
      <p className="muted pomodoro-log-times">
        {blocks.map((b) => `${b.startTime}–${b.endTime}`).join(", ")}
      </p>
      <label className="field">
        <span>Activity</span>
        <Dropdown
          value={activityId}
          onChange={(v) => setActivityId(v ? Number(v) : "")}
          placeholder={activities.length === 0 ? "No Activities yet -- add one in the Activities tab" : "Select an Activity…"}
          disabled={activities.length === 0}
        >
          {activities.map((a) => (
            <DropdownOption key={a.id} value={a.id}>
              {a.name}
            </DropdownOption>
          ))}
        </Dropdown>
      </label>
      <label className="field">
        <span>Notes</span>
        <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      {error && <p className="status status-error">{error}</p>}
      <div className="row">
        <button type="button" className="btn btn-accent" onClick={handleLog} disabled={!activity || busy}>
          {busy ? "Logging…" : "Log to Timesheet"}
        </button>
        <button type="button" className="btn btn-secondary" onClick={pomodoro.clearUnlogged} disabled={busy}>
          Dismiss
        </button>
      </div>
    </section>
  );
}

/** The Pomodoro tab's own label -- shows the live countdown while a timer
 * is running (or paused), so it stays visible from any other tab. */
export function PomodoroTabLabel() {
  const s = usePomodoro();
  if (s.awaitingFocus) return <>Pomodoro · Ready</>;
  if (!s.active) return <>Pomodoro</>;
  const prefix = s.phase === "focus" ? "" : "Break ";
  return (
    <>
      Pomodoro · {prefix}
      <span className="tab-clock">{formatClock(s.remainingSec)}</span>
      {s.running ? "" : " (paused)"}
    </>
  );
}

/** Optional focus timer (enabled from Settings → Optional Features): 25
 * minutes of focus, then a short break, with a longer one after every
 * fourth session -- all four numbers are configurable in Settings. The
 * engine itself lives in lib/pomodoro.ts so it keeps counting down while
 * you're on another tab. */
export function PomodoroScreen() {
  const s = usePomodoro();
  const [logMessage, setLogMessage] = useState<string | null>(null);
  const total = phaseSeconds(s.phase, s.config);
  const elapsedPct = Math.min(100, Math.max(0, ((total - s.remainingSec) / total) * 100));
  const doneInCycle = s.phase === "long" ? s.config.sessionsBeforeLong : s.completedFocus;

  let hint: string;
  if (s.awaitingFocus) hint = "Break's over -- start your next focus session when you're ready.";
  else if (s.running) hint = s.phase === "focus" ? "Stay on one thing until the timer ends." : "Step away from the screen for a bit.";
  else if (s.active) hint = "Paused.";
  else hint = "Start a focus session. Breaks begin on their own when a session ends.";

  return (
    <div className="pomodoro-screen">
      <section className="card pomodoro-card">
        <span className={"pomodoro-phase pomodoro-phase-" + s.phase}>{PHASE_LABEL[s.phase]}</span>
        <div className="pomodoro-clock">{formatClock(s.remainingSec)}</div>
        <div className="pomodoro-progress" aria-hidden>
          <div className="pomodoro-progress-fill" style={{ width: `${elapsedPct}%` }} />
        </div>

        <div className="pomodoro-controls">
          {s.running ? (
            <button type="button" className="btn btn-accent" onClick={pomodoro.pause}>
              Pause
            </button>
          ) : (
            <button type="button" className="btn btn-accent" onClick={pomodoro.start}>
              {s.active ? "Resume" : "Start"}
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={pomodoro.skip}>
            Skip
          </button>
          <button type="button" className="btn btn-secondary" onClick={pomodoro.reset}>
            Reset
          </button>
        </div>

        <div className="pomodoro-dots" aria-label={`${doneInCycle} of ${s.config.sessionsBeforeLong} focus sessions done`}>
          {Array.from({ length: s.config.sessionsBeforeLong }, (_, i) => (
            <span key={i} className={"pomodoro-dot" + (i < doneInCycle ? " pomodoro-dot-done" : "")} />
          ))}
        </div>
        <p className="muted pomodoro-hint">{hint}</p>
        <p className="muted pomodoro-footnote">
          Session lengths are set in Settings → Optional Features.
        </p>
      </section>

      {s.unlogged.length > 0 ? (
        <LogSessionsPanel sessions={s.unlogged} onLogged={setLogMessage} />
      ) : (
        logMessage && <p className="status status-success">{logMessage}</p>
      )}
    </div>
  );
}
