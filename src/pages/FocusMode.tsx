import { useEffect, useState, useRef, useCallback } from "react";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useAppStore } from "../stores/appStore";
import {
  stopTimeEntry,
  checkpointTimeEntry,
  updateTaskStatus,
  updateTaskNotes,
  getProjectById,
  getSetting,
} from "../db/queries";
import RichTextEditor from "../components/RichTextEditor";
import Button from "../components/Button";
import type { Project } from "../types";

const CHECKPOINT_INTERVAL_MS = 30_000;

// Defaults — overridden by settings loaded on mount
const DEFAULT_WORK_MIN = 25;
const DEFAULT_SHORT_BREAK_MIN = 5;
const DEFAULT_LONG_BREAK_MIN = 15;
const DEFAULT_CYCLES = 4;

type FocusPhase = "work" | "break" | "prompt";

interface BreakPrompt {
  isLongBreak: boolean; // true = 4th cycle, offer 15 min
}

function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(minutes)}:${pad(seconds)}`;
}

const PIP_STATE_KEY = "verseday_pip_state";
const PIP_CMD_KEY = "verseday_pip_cmd";

function playChime() {
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;

    // Two-tone chime: C5 then E5
    const frequencies = [523.25, 659.25];
    frequencies.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + i * 0.15);
      gain.gain.linearRampToValueAtTime(0.3, now + i * 0.15 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.15 + 0.6);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.15);
      osc.stop(now + i * 0.15 + 0.6);
    });

    // Clean up after sounds finish
    setTimeout(() => ctx.close(), 1500);
  } catch {
    // Silent fallback — audio may not be available
  }
}

export default function FocusMode() {
  const { focus, stopFocus } = useAppStore();

  const [project, setProject] = useState<Project | null>(null);

  // Load project info
  useEffect(() => {
    if (focus?.task.project_id) {
      getProjectById(focus.task.project_id).then(setProject).catch(() => {});
    }
  }, [focus?.task.project_id]);

  // Notes state + debounced auto-save (the editor flushes pending saves on
  // its own unmount, so navigating away from focus mode is also covered).
  const [notes, setNotes] = useState(focus?.task.notes ?? "");
  const notesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function saveNotes(value: string) {
    if (!focus) return;
    if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
    notesTimerRef.current = setTimeout(() => {
      updateTaskNotes(focus.task.id, value || null).catch(() => {});
    }, 600);
  }

  // Timer settings from DB — gated behind settingsLoaded
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [WORK_DURATION_MS, setWorkDuration] = useState(DEFAULT_WORK_MIN * 60 * 1000);
  const [SHORT_BREAK_MS, setShortBreak] = useState(DEFAULT_SHORT_BREAK_MIN * 60 * 1000);
  const [LONG_BREAK_MS, setLongBreak] = useState(DEFAULT_LONG_BREAK_MIN * 60 * 1000);
  const [SNOOZE_MS] = useState(5 * 60 * 1000);
  const [CYCLES_BEFORE_LONG_BREAK, setCycles] = useState(DEFAULT_CYCLES);

  useEffect(() => {
    async function loadTimerSettings() {
      const [w, sb, lb, c] = await Promise.all([
        getSetting("focus_work_min"),
        getSetting("focus_short_break_min"),
        getSetting("focus_long_break_min"),
        getSetting("focus_cycles_before_long"),
      ]);
      if (w) setWorkDuration(parseInt(w) * 60 * 1000);
      if (sb) setShortBreak(parseInt(sb) * 60 * 1000);
      if (lb) setLongBreak(parseInt(lb) * 60 * 1000);
      if (c) setCycles(parseInt(c));
      setSettingsLoaded(true);
    }
    loadTimerSettings();
  }, []);

  // PiP mini window
  const pipRef = useRef<WebviewWindow | null>(null);

  useEffect(() => {
    if (!focus) return;

    // Create PiP window
    (async () => {
      try {
        const existing = await WebviewWindow.getByLabel("focus-pip");
        if (existing) {
          pipRef.current = existing;
          return;
        }
        const pip = new WebviewWindow("focus-pip", {
          url: "/#focus-pip",
          title: "Focus",
          width: 220,
          height: 56,
          resizable: false,
          alwaysOnTop: true,
          decorations: false,
          transparent: false,
          skipTaskbar: true,
          x: 20,
          y: 20,
        });
        pipRef.current = pip;
      } catch {
        // PiP creation failed — not critical
      }
    })();

    return () => {
      // Close PiP when leaving focus mode
      pipRef.current?.close().catch(() => {});
      pipRef.current = null;
    };
  }, [!!focus]);

  // Total elapsed (for time entry / display)
  const priorMs = focus?.priorElapsedMs ?? 0;
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const pausedAtRef = useRef<number | null>(null);
  const pausedAccumRef = useRef(0);

  // Pomodoro state
  const [phase, setPhase] = useState<FocusPhase>("work");
  const [completedPomodoros, setCompletedPomodoros] = useState(0);
  const [, setWorkElapsed] = useState(0); // triggers re-render on work elapsed change
  const [breakRemaining, setBreakRemaining] = useState(0);
  const [breakDuration, setBreakDuration] = useState(0);
  const [prompt, setPrompt] = useState<BreakPrompt | null>(null);

  // Track when the current work cycle started (in terms of work-only time)
  const workCycleStartRef = useRef(0); // workElapsed value when cycle started
  const breakStartRef = useRef(0); // Date.now() when break started

  // Snooze: the workElapsed threshold at which to re-prompt
  const snoozeThresholdRef = useRef<number | null>(null);

  // Calculate work-only elapsed (total elapsed minus break time)
  const totalBreakTimeRef = useRef(0);

  const getWorkElapsed = useCallback(() => {
    return elapsed - totalBreakTimeRef.current;
  }, [elapsed]);

  // Timer tick
  useEffect(() => {
    if (!focus) return;

    const interval = setInterval(() => {
      if (paused) return;

      const now = Date.now();
      const raw = now - focus.startedAt - pausedAccumRef.current;
      setElapsed(raw);

      if (phase === "work") {
        const we = raw - totalBreakTimeRef.current;
        setWorkElapsed(we);

        // Check if we've hit a pomodoro boundary
        const currentCycleElapsed = we - workCycleStartRef.current;
        const threshold = snoozeThresholdRef.current;

        if (threshold !== null && we >= threshold) {
          // Snoozed prompt is due
          snoozeThresholdRef.current = null;
          const cycleNum = completedPomodoros + 1;
          const isLong = cycleNum % CYCLES_BEFORE_LONG_BREAK === 0;
          setPrompt({ isLongBreak: isLong });
          setPhase("prompt");
          playChime();
        } else if (threshold === null && currentCycleElapsed >= WORK_DURATION_MS) {
          // Normal pomodoro completed
          const newCount = completedPomodoros + 1;
          setCompletedPomodoros(newCount);
          const isLong = newCount % CYCLES_BEFORE_LONG_BREAK === 0;
          setPrompt({ isLongBreak: isLong });
          setPhase("prompt");
          playChime();
        }
      } else if (phase === "break") {
        const breakElapsed = now - breakStartRef.current;
        const remaining = breakDuration - breakElapsed;
        setBreakRemaining(remaining);

        if (remaining <= 0) {
          // Break is over — return to work
          totalBreakTimeRef.current += breakDuration;
          workCycleStartRef.current = getWorkElapsed() + (breakDuration - (breakDuration + remaining));
          // Recalculate: set workCycleStart to current workElapsed after accounting for break
          const newWorkElapsed = raw - totalBreakTimeRef.current;
          workCycleStartRef.current = newWorkElapsed;
          setPhase("work");
          setBreakRemaining(0);
          playChime();
        }
      }
    }, 200);

    return () => clearInterval(interval);
  }, [focus, paused, phase, completedPomodoros, breakDuration, getWorkElapsed]);

  // Checkpoint
  useEffect(() => {
    if (!focus) return;
    const checkpoint = setInterval(() => {
      if (!paused) {
        checkpointTimeEntry(focus.timeEntryId).catch(() => {});
      }
    }, CHECKPOINT_INTERVAL_MS);
    return () => clearInterval(checkpoint);
  }, [focus, paused]);

  // Broadcast state to PiP window
  useEffect(() => {
    if (!focus) {
      localStorage.removeItem(PIP_STATE_KEY);
      return;
    }
    const state = {
      elapsed: elapsed + priorMs,
      paused,
      phase,
      breakRemaining,
      taskTitle: focus.task.title,
      estimatedMinutes: focus.task.estimated_minutes ?? null,
    };
    localStorage.setItem(PIP_STATE_KEY, JSON.stringify(state));
  }, [focus, elapsed, paused, phase, breakRemaining, priorMs]);

  // Clean up PiP state on unmount
  useEffect(() => {
    return () => {
      localStorage.removeItem(PIP_STATE_KEY);
      localStorage.removeItem(PIP_CMD_KEY);
    };
  }, []);

  // Stable refs for handlers used in effects
  const handlePauseRef = useRef<() => void>(() => {});
  const handleDoneRef = useRef<() => void>(() => {});
  const handleStopRef = useRef<() => void>(() => {});
  const handleTakeBreakRef = useRef<(ms: number) => void>(() => {});
  const handleSnoozeRef = useRef<() => void>(() => {});
  const handleNoBreakRef = useRef<() => void>(() => {});
  const handleSkipBreakRef = useRef<() => void>(() => {});

  // Listen for PiP commands
  useEffect(() => {
    const interval = setInterval(() => {
      const cmd = localStorage.getItem(PIP_CMD_KEY);
      if (!cmd) return;
      localStorage.removeItem(PIP_CMD_KEY);
      if (cmd === "pause") handlePauseRef.current();
      else if (cmd === "done") handleDoneRef.current();
      else if (cmd === "stop") handleStopRef.current();
      else if (cmd === "requestBreak") {
        setCompletedPomodoros((c) => {
          const cycleNum = c + 1;
          const isLong = cycleNum % CYCLES_BEFORE_LONG_BREAK === 0;
          setPrompt({ isLongBreak: isLong });
          setPhase("prompt");
          playChime();
          return cycleNum;
        });
      }
      else if (cmd === "takeBreak") handleTakeBreakRef.current(SHORT_BREAK_MS);
      else if (cmd === "snooze5") handleSnoozeRef.current();
      else if (cmd === "snooze10") {
        setPrompt(null);
        const we = elapsed - totalBreakTimeRef.current;
        snoozeThresholdRef.current = we + 10 * 60 * 1000;
        setCompletedPomodoros((c) => Math.max(0, c - 1));
        setPhase("work");
      }
      else if (cmd === "noBreak") handleNoBreakRef.current();
      else if (cmd === "skipBreak") handleSkipBreakRef.current();
    }, 200);
    return () => clearInterval(interval);
  }, [elapsed, SHORT_BREAK_MS, CYCLES_BEFORE_LONG_BREAK]);

  // Listen for Space shortcut from App.tsx
  useEffect(() => {
    function onTogglePause() {
      handlePauseRef.current();
    }
    window.addEventListener("verseday:toggle-pause", onTogglePause);
    return () =>
      window.removeEventListener("verseday:toggle-pause", onTogglePause);
  }, []);

  function handlePause() {
    if (paused) {
      if (pausedAtRef.current !== null) {
        pausedAccumRef.current += Date.now() - pausedAtRef.current;
        // Also adjust break start if we're on a break
        if (phase === "break") {
          breakStartRef.current += Date.now() - pausedAtRef.current;
        }
        pausedAtRef.current = null;
      }
      setPaused(false);
    } else {
      pausedAtRef.current = Date.now();
      setPaused(true);
    }
  }

  // Break prompt responses
  function handleTakeBreak(durationMs: number) {
    setPrompt(null);
    setBreakDuration(durationMs);
    breakStartRef.current = Date.now();
    setBreakRemaining(durationMs);
    setPhase("break");
  }

  function handleNoBreak() {
    setPrompt(null);
    // Start a new work cycle from current position
    const we = elapsed - totalBreakTimeRef.current;
    workCycleStartRef.current = we;
    snoozeThresholdRef.current = null;
    setPhase("work");
  }

  function handleSnooze() {
    setPrompt(null);
    // Re-prompt in 5 minutes of work time
    const we = elapsed - totalBreakTimeRef.current;
    snoozeThresholdRef.current = we + SNOOZE_MS;
    // Revert the pomodoro count since we snoozed (it was incremented when prompt showed)
    setCompletedPomodoros((c) => Math.max(0, c - 1));
    setPhase("work");
  }

  function handleSkipBreak() {
    // End break early
    const breakElapsed = Date.now() - breakStartRef.current;
    totalBreakTimeRef.current += breakElapsed;
    const we = elapsed - totalBreakTimeRef.current;
    workCycleStartRef.current = we;
    setPhase("work");
    setBreakRemaining(0);
  }

  function getBreakSeconds(): number {
    return totalBreakTimeRef.current / 1000;
  }

  async function handleDone() {
    if (!focus) return;
    try {
      await stopTimeEntry(focus.timeEntryId, getBreakSeconds());
      await updateTaskStatus(focus.task.id, "done");
    } catch {
      // Best effort
    }
    stopFocus();
  }

  async function handleStop() {
    if (!focus) return;
    try {
      await stopTimeEntry(focus.timeEntryId, getBreakSeconds());
    } catch {
      // Best effort
    }
    stopFocus();
  }

  // Keep refs in sync with latest handlers
  handlePauseRef.current = handlePause;
  handleDoneRef.current = handleDone;
  handleStopRef.current = handleStop;
  handleTakeBreakRef.current = handleTakeBreak;
  handleSnoozeRef.current = handleSnooze;
  handleNoBreakRef.current = handleNoBreak;
  handleSkipBreakRef.current = handleSkipBreak;

  if (!focus) return null;
  if (!settingsLoaded) return null;

  const isOnBreak = phase === "break";
  const isPrompting = phase === "prompt";

  // Total work time on this task (prior sessions + current, minus breaks)
  const workElapsed = elapsed - totalBreakTimeRef.current;
  const totalWorkedMs = workElapsed + priorMs;
  const estimatedMs = (focus.task.estimated_minutes ?? 0) * 60 * 1000;

  // Arc progress: based on worked time vs estimate (0→1), or 0 if no estimate
  const progress = estimatedMs > 0 ? Math.min(1, totalWorkedMs / estimatedMs) : 0;
  const ARC_RADIUS = 90;
  const ARC_CIRCUMFERENCE = 2 * Math.PI * ARC_RADIUS;
  const arcOffset = ARC_CIRCUMFERENCE * (1 - progress);

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center z-50 focus-ambient-bg">
      {/* Top context bar — project name */}
      {project && (
        <div className="absolute top-6 left-0 right-0 flex items-center justify-center gap-1.5">
          <div
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: project.color }}
          />
          <span className="text-[11px] text-black/30">{project.name}</span>
        </div>
      )}

      {/* Center content */}
      <div className="text-center max-w-[560px] px-8 flex flex-col items-center mt-4">
        {/* Task name — hero */}
        <h1 className="text-[28px] font-semibold text-[#2c2a35] mb-3 leading-snug font-display">
          {focus.task.title}
        </h1>

        {/* Notes editor — always visible */}
        <RichTextEditor
          value={notes}
          onChange={(html) => {
            setNotes(html);
            saveNotes(html);
          }}
          placeholder="Add notes…"
          className="w-full min-h-[120px] mb-4 px-4 py-3.5 bg-transparent text-[14px] text-[#2c2a35] leading-relaxed"
        />

        {/* Break prompt */}
        {isPrompting && prompt && (
          <div className="mb-8 p-6 rounded-2xl bg-white border border-black/[0.08] shadow-sm w-full">
            <p className="text-[15px] font-medium text-[#2c2a35] mb-1">
              Pomodoro complete!
            </p>
            <p className="text-[13px] text-black/40 mb-5">
              {prompt.isLongBreak
                ? "You've completed 4 cycles. Time for a longer break?"
                : "Nice work. Take a break?"}
            </p>
            <div className="flex gap-2.5 justify-center">
              {prompt.isLongBreak ? (
                <>
                  <Button onClick={() => handleTakeBreak(LONG_BREAK_MS)}>15 min break</Button>
                  <Button variant="secondary" onClick={() => handleTakeBreak(SHORT_BREAK_MS)}>5 min</Button>
                  <Button variant="ghost" onClick={handleNoBreak}>No break</Button>
                </>
              ) : (
                <>
                  <Button onClick={() => handleTakeBreak(SHORT_BREAK_MS)}>5 min break</Button>
                  <Button variant="secondary" onClick={handleSnooze}>In 5 min</Button>
                  <Button variant="ghost" onClick={handleNoBreak}>No</Button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Timer arc */}
        {!isPrompting && (
          <div className="relative mb-6 overflow-visible" style={{ width: 220, height: 220 }}>
            {/* Glow layer — wrapper div handles the CSS animation (WebKit won't animate transforms on <svg>) */}
            {!paused && (
              <div className="absolute inset-0 focus-glow-layer">
                <svg
                  viewBox="0 0 220 220"
                  fill="none"
                  style={{ width: 220, height: 220 }}
                >
                  <circle
                    cx="110"
                    cy="110"
                    r={ARC_RADIUS}
                    stroke={isOnBreak ? "#4a9e6e" : "#7B9ED9"}
                    strokeWidth="14"
                    fill="none"
                    strokeLinecap="round"
                    strokeDasharray={ARC_CIRCUMFERENCE}
                    strokeDashoffset={isOnBreak ? ARC_CIRCUMFERENCE * (breakRemaining / breakDuration) : arcOffset}
                    transform="rotate(-90 110 110)"
                  />
                </svg>
              </div>
            )}

            {/* Main arc — wrapper div for pulse animation (WebKit can't animate transform on SVG elements) */}
            <div className={`absolute inset-0 timer-circle-ring${paused ? " paused" : ""}`}>
              <svg
                viewBox="0 0 220 220"
                fill="none"
                style={{ width: 220, height: 220 }}
              >
                {/* Track */}
                <circle
                  cx="110"
                  cy="110"
                  r={ARC_RADIUS}
                  stroke="rgba(0,0,0,0.05)"
                  strokeWidth="7"
                  fill="none"
                />
                {/* Progress stroke */}
                <circle
                  cx="110"
                  cy="110"
                  r={ARC_RADIUS}
                  stroke={isOnBreak ? "#4a9e6e" : (paused ? "rgba(0,0,0,0.12)" : "#7B9ED9")}
                  strokeWidth="7"
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={ARC_CIRCUMFERENCE}
                  strokeDashoffset={isOnBreak ? ARC_CIRCUMFERENCE * (breakRemaining / breakDuration) : arcOffset}
                  transform="rotate(-90 110 110)"
                  style={{ transition: "stroke-dashoffset 0.3s ease" }}
                />
              </svg>
            </div>

            {/* Timer text centered */}
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div
                className="text-[32px] font-medium tabular-nums leading-none"
                style={{
                  letterSpacing: "-1px",
                  color: isOnBreak
                    ? "#4a9e6e"
                    : paused
                      ? "rgba(0,0,0,0.25)"
                      : "#7B9ED9",
                }}
              >
                {isOnBreak
                  ? formatCountdown(breakRemaining)
                  : formatTime(totalWorkedMs)}
              </div>
              {isOnBreak ? (
                <p className="text-[11px] tracking-[0.06em] text-black/30 mt-1">
                  break
                </p>
              ) : paused ? (
                <p className="text-[11px] tracking-[0.06em] text-black/30 mt-1">
                  paused
                </p>
              ) : (
                <p className="text-[11px] tracking-[0.06em] text-black/30 mt-1">
                  {estimatedMs > 0 ? `of ${formatTime(estimatedMs)}` : "worked"}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Break: skip button */}
        {isOnBreak && (
          <button
            onClick={handleSkipBreak}
            className="text-[13px] text-black/30 cursor-pointer hover:text-black/50 transition-colors mb-6"
          >
            Skip break
          </button>
        )}

        {/* Controls — icon buttons */}
        {!isOnBreak && (
          <div className="flex items-center gap-3 mb-6">
            {/* Pause / Resume — secondary */}
            {!isPrompting && (
              <button
                onClick={handlePause}
                className="w-10 h-10 rounded-full flex items-center justify-center cursor-pointer text-black/25 hover:text-black/50 hover:bg-black/[0.05] transition-colors"
                title={paused ? "Resume" : "Pause"}
              >
                {paused ? (
                  <svg width="18" height="18" viewBox="0 0 14 14" fill="#7B9ED9">
                    <path d="M3 1v12l10-6z" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 14 14" fill="currentColor">
                    <rect x="2" y="1" width="3.5" height="12" rx="1" />
                    <rect x="8.5" y="1" width="3.5" height="12" rx="1" />
                  </svg>
                )}
              </button>
            )}

            {/* Mark Done — primary */}
            <button
              onClick={handleDone}
              className="w-12 h-12 rounded-full border-2 border-[#C0DD97] flex items-center justify-center cursor-pointer hover:bg-[#C0DD97]/10 transition-colors"
              title="Mark done"
            >
              <svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="#3B6D11" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 8.5l3.5 3.5 6.5-7" />
              </svg>
            </button>

            {/* Stop & Save — secondary */}
            <button
              onClick={handleStop}
              className="w-10 h-10 rounded-full flex items-center justify-center cursor-pointer text-black/25 hover:text-black/50 hover:bg-black/[0.05] transition-colors"
              title="Stop & save"
            >
              <svg width="16" height="16" viewBox="0 0 14 14" fill="currentColor">
                <rect x="2" y="2" width="10" height="10" rx="1.5" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
