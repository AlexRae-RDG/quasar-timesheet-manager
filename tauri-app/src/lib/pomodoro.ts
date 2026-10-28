import { useSyncExternalStore } from "react";

/** The Pomodoro engine behind the optional Pomodoro tab. A module-level
 * store rather than component state on purpose: the countdown has to keep
 * running while you're on another tab (PomodoroScreen unmounts on a tab
 * switch), and subscribing components -- the screen and the tab's own
 * label -- re-render on their own each second without dragging the whole
 * app tree (the calendar grid especially) along with them. Time is
 * measured against a wall-clock end timestamp rather than by counting
 * ticks, so a throttled background webview can't make it drift. */

export type PomodoroPhase = "focus" | "short" | "long";

export interface PomodoroConfig {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  sessionsBeforeLong: number;
  soundEnabled: boolean;
}

/** A focus session that ran to the bell and hasn't been logged to the
 * Timesheet (or dismissed) yet. */
export interface CompletedSession {
  startMs: number;
  endMs: number;
}

export interface PomodoroState {
  phase: PomodoroPhase;
  running: boolean;
  remainingSec: number;
  /** Focus sessions finished in the current cycle (resets after the long break). */
  completedFocus: number;
  /** True once a break has run out and the next focus session is waiting
   * for the user to start it -- breaks start on their own, focus never does. */
  awaitingFocus: boolean;
  /** True once started and not reset -- paused mid-phase counts. */
  active: boolean;
  /** Focus sessions that finished naturally and are waiting to be logged. */
  unlogged: readonly CompletedSession[];
  config: PomodoroConfig;
}

export const DEFAULT_POMODORO_CONFIG: PomodoroConfig = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  sessionsBeforeLong: 4,
  soundEnabled: true,
};

let config: PomodoroConfig = DEFAULT_POMODORO_CONFIG;
let phase: PomodoroPhase = "focus";
let completedFocus = 0;
let awaitingFocus = false;
let unlogged: readonly CompletedSession[] = [];
let endAt: number | null = null;
let pausedRemainingSec: number | null = null;
let ticker: number | undefined;
let audio: AudioContext | null = null;

const listeners = new Set<() => void>();

export function phaseSeconds(p: PomodoroPhase, c: PomodoroConfig = config): number {
  const minutes = p === "focus" ? c.focusMinutes : p === "short" ? c.shortBreakMinutes : c.longBreakMinutes;
  return Math.max(1, minutes) * 60;
}

function compute(): PomodoroState {
  const running = endAt !== null;
  const remainingSec = running
    ? Math.max(0, Math.ceil((endAt! - Date.now()) / 1000))
    : (pausedRemainingSec ?? phaseSeconds(phase));
  return {
    phase,
    running,
    remainingSec,
    completedFocus,
    awaitingFocus,
    active: running || pausedRemainingSec !== null,
    unlogged,
    config,
  };
}

let state: PomodoroState = compute();

function emit() {
  state = compute();
  listeners.forEach((l) => l());
}

function stopTicker() {
  window.clearInterval(ticker);
  ticker = undefined;
}

function beginRunning() {
  endAt = Date.now() + (pausedRemainingSec ?? phaseSeconds(phase)) * 1000;
  pausedRemainingSec = null;
  stopTicker();
  ticker = window.setInterval(tick, 250);
}

function tick() {
  if (endAt === null) return;
  const remaining = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
  if (remaining <= 0) advance(true);
  else if (remaining !== state.remainingSec) emit();
}

// Created on the first Start click: a webview only lets audio play once a
// user gesture has happened, so this can't be set up any earlier.
function ensureAudio() {
  try {
    audio ??= new AudioContext();
    void audio.resume();
  } catch {
    audio = null;
  }
}

function beep() {
  if (!audio) return;
  const ctx = audio;
  for (let i = 0; i < 3; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const t = ctx.currentTime + i * 0.28;
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.25);
  }
}

/** Moves to the next phase. After focus, the break starts straight away
 * (a break you have to remember to start defeats the point); after a break,
 * the next focus session waits for you. */
function advance(natural: boolean) {
  endAt = null;
  pausedRemainingSec = null;
  stopTicker();
  if (phase === "focus") {
    // Only a session that ran to the bell is worth offering to log --
    // skipping one early isn't a block of focused time.
    if (natural) {
      const endMs = Date.now();
      unlogged = [...unlogged, { startMs: endMs - phaseSeconds("focus") * 1000, endMs }];
    }
    completedFocus += 1;
    phase = completedFocus >= config.sessionsBeforeLong ? "long" : "short";
    awaitingFocus = false;
    beginRunning();
  } else {
    if (phase === "long") completedFocus = 0;
    phase = "focus";
    awaitingFocus = true;
  }
  if (natural && config.soundEnabled) beep();
  emit();
}

export const pomodoro = {
  start() {
    if (endAt !== null) return;
    ensureAudio();
    awaitingFocus = false;
    beginRunning();
    emit();
  },
  pause() {
    if (endAt === null) return;
    pausedRemainingSec = Math.max(1, Math.ceil((endAt - Date.now()) / 1000));
    endAt = null;
    stopTicker();
    emit();
  },
  reset() {
    endAt = null;
    pausedRemainingSec = null;
    stopTicker();
    phase = "focus";
    completedFocus = 0;
    awaitingFocus = false;
    emit();
  },
  skip() {
    advance(false);
  },
  /** Clears the completed-sessions list once they've been logged or dismissed. */
  clearUnlogged() {
    if (unlogged.length === 0) return;
    unlogged = [];
    emit();
  },
  setConfig(next: PomodoroConfig) {
    if (
      next.focusMinutes === config.focusMinutes &&
      next.shortBreakMinutes === config.shortBreakMinutes &&
      next.longBreakMinutes === config.longBreakMinutes &&
      next.sessionsBeforeLong === config.sessionsBeforeLong &&
      next.soundEnabled === config.soundEnabled
    ) {
      return;
    }
    config = next;
    emit();
  },
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePomodoro(): PomodoroState {
  return useSyncExternalStore(subscribe, () => state);
}

export function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export const PHASE_LABEL: Record<PomodoroPhase, string> = {
  focus: "Focus",
  short: "Short break",
  long: "Long break",
};
