import { useEffect, useRef, useState } from "react";
import { createTimeEntry } from "../api/calendar";
import { listActivities, type Activity } from "../api/activities";
import { toISODate } from "../lib/date";
import type { AppSettings } from "../api/settings";

const ROUND_TO_MINUTES = 15;

/** Rounds elapsed timer time to the nearest 15 minutes, with a 15-minute
 * floor -- a 0-minute time block would be meaningless in a timesheet, so
 * any timer that ran at all (even a few seconds -- Stop clicked right
 * after Start by mistake) logs at least one quarter hour rather than
 * silently logging nothing. Ported from the Python app's
 * time_rounding.round_duration_minutes. */
function roundDurationMinutes(elapsedMinutes: number): number {
  if (elapsedMinutes <= 0) return 0;
  const rounded = Math.round(elapsedMinutes / ROUND_TO_MINUTES) * ROUND_TO_MINUTES;
  return Math.max(ROUND_TO_MINUTES, rounded);
}

function formatElapsed(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Pick an activity, click Start, and it counts up in real time; click
 * Stop and it logs a time block for *today* automatically, with its
 * duration rounded to the nearest 15 minutes -- the fast path for "what
 * am I doing right now" with no dragging on the grid or picking exact
 * start/end times by hand. Lives in AppShell (always mounted, above the
 * per-tab content) rather than inside the Timesheet screen, since it
 * always logs against today's real date regardless of which tab or which
 * week is currently on screen -- ported from the Python app's
 * app/timer_bar.py.
 *
 * Always mounted regardless of Settings' "Show the timer bar" toggle --
 * only its own visible row is skipped when that's off (see the early
 * return below) -- so a timer already running keeps running/ticking, and
 * a close-while-running confirmation still fires, even while hidden. */
export function TimerBar({ settings }: { settings: AppSettings }) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [selectedActivityId, setSelectedActivityId] = useState<number | "">("");
  const [startDt, setStartDt] = useState<Date | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [closeConfirm, setCloseConfirm] = useState(false);

  // Read by the window close-requested handler below, which is set up once
  // on mount -- refs (not the state values directly) so that closure
  // always sees the current running/selected activity rather than whatever
  // they were the moment the listener was attached.
  const startDtRef = useRef<Date | null>(null);
  const selectedActivityRef = useRef<Activity | null>(null);
  startDtRef.current = startDt;
  const selectedActivity = activities.find((a) => a.id === selectedActivityId) ?? null;
  selectedActivityRef.current = selectedActivity;

  useEffect(() => {
    listActivities().then(setActivities).catch(() => {});
  }, []);

  useEffect(() => {
    if (!startDt) return;
    const tick = () => setElapsedSeconds(Math.floor((Date.now() - startDt.getTime()) / 1000));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [startDt]);

  // Intercepts the window's own close button/Cmd+Q while the timer is
  // running, so time-so-far isn't silently lost -- a no-op wrapped in
  // try/catch outside a real Tauri window (e.g. the ?mock=1 browser
  // preview), which has no window-close event to hook into at all.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        const un = await win.onCloseRequested((event) => {
          if (startDtRef.current) {
            event.preventDefault();
            setCloseConfirm(true);
          }
        });
        if (cancelled) un();
        else unlisten = un;
      } catch {
        // Not inside a real Tauri window -- nothing to hook into.
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  async function logEntry(start: Date, end: Date, activity: Activity): Promise<string> {
    const elapsedMinutes = (end.getTime() - start.getTime()) / 60000;
    const duration = roundDurationMinutes(elapsedMinutes);
    if (duration <= 0) return "Timer stopped -- nothing logged.";

    const date = toISODate(start);
    const pad = (n: number) => String(n).padStart(2, "0");
    const startTime = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
    const endDt = new Date(start.getTime() + duration * 60000);
    const endTime = `${pad(endDt.getHours())}:${pad(endDt.getMinutes())}`;

    // Overlapping an existing block is fine -- the calendar renders
    // overlapping blocks side by side rather than rejecting them, so
    // there's no need to check for that first here either.
    await createTimeEntry({ activityId: activity.id, date, startTime, endTime, notes: "" });
    // Timesheet only fetches its own entries on mount/week-change; this
    // tells an already-mounted one (if today's week happens to be showing)
    // to pull the block this just logged in without needing a manual
    // refresh or a tab switch.
    window.dispatchEvent(new CustomEvent("quasar:time-entry-logged"));
    return `Logged ${duration} min to ${activity.name}.`;
  }

  function handleStart() {
    if (!selectedActivity) return;
    setStatusMessage(null);
    setStartDt(new Date());
  }

  async function handleStop() {
    if (!startDt) return;
    const start = startDt;
    const activity = selectedActivity;
    setStartDt(null);
    setElapsedSeconds(0);
    if (!activity) {
      setStatusMessage("Timer stopped -- nothing logged.");
      return;
    }
    try {
      const message = await logEntry(start, new Date(), activity);
      setStatusMessage(message);
    } catch (e) {
      setStatusMessage(`Timer stopped, but couldn't log it -- ${e}`);
    }
  }

  async function handleCloseConfirm(action: "log" | "discard") {
    setCloseConfirm(false);
    const start = startDtRef.current;
    const activity = selectedActivityRef.current;
    setStartDt(null);
    setElapsedSeconds(0);
    try {
      if (action === "log" && start && activity) {
        await logEntry(start, new Date(), activity);
      }
    } finally {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      getCurrentWindow().destroy();
    }
  }

  const running = startDt != null;

  return (
    <>
      {settings.showTimerBar && (
        <div className="timer-bar">
          <span className="timer-bar-label">Timer</span>
          <select
            className="timer-bar-select"
            value={selectedActivityId}
            onChange={(e) => setSelectedActivityId(e.target.value ? Number(e.target.value) : "")}
            disabled={running}
          >
            <option value="" disabled>
              Select an Activity…
            </option>
            {activities.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          {running ? (
            <button type="button" className="btn btn-danger" onClick={handleStop}>
              Stop Timer
            </button>
          ) : (
            <button type="button" className="btn btn-accent" onClick={handleStart} disabled={!selectedActivity}>
              Start Timer
            </button>
          )}
          {running && (
            <>
              <span className="timer-bar-dot" />
              <span className="timer-bar-elapsed">{formatElapsed(elapsedSeconds)}</span>
            </>
          )}
          {statusMessage && <span className="timer-bar-status">{statusMessage}</span>}
        </div>
      )}

      {closeConfirm && (
        <div className="modal-backdrop" onClick={() => setCloseConfirm(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h2>Timer is still running</h2>
            <p className="muted">
              {selectedActivity
                ? `Stop it and log the time so far to ${selectedActivity.name}, close without logging it (the time is discarded), or go back to the timer.`
                : "Close without logging the time so far (it will be discarded), or go back to the timer."}
            </p>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setCloseConfirm(false)}>
                Cancel
              </button>
              <div className="row">
                <button type="button" className="btn btn-danger" onClick={() => handleCloseConfirm("discard")}>
                  Discard &amp; Close
                </button>
                {selectedActivity && (
                  <button type="button" className="btn btn-accent" onClick={() => handleCloseConfirm("log")}>
                    Stop &amp; Log
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
