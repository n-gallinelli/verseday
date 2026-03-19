import { useEffect, useState, useRef, useCallback } from "react";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useAppStore } from "../stores/appStore";
import {
  stopTimeEntry,
  checkpointTimeEntry,
  updateTaskStatus,
  getProjectById,
} from "../db/queries";
import type { Project } from "../types";

const CHECKPOINT_INTERVAL_MS = 30_000;
const WORK_DURATION_MS = 25 * 60 * 1000;
const SHORT_BREAK_MS = 5 * 60 * 1000;
const LONG_BREAK_MS = 15 * 60 * 1000;
const SNOOZE_MS = 5 * 60 * 1000;
const CYCLES_BEFORE_LONG_BREAK = 4;

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

  // Listen for PiP commands
  useEffect(() => {
    const interval = setInterval(() => {
      const cmd = localStorage.getItem(PIP_CMD_KEY);
      if (!cmd) return;
      localStorage.removeItem(PIP_CMD_KEY);
      if (cmd === "pause") handlePause();
      else if (cmd === "done") handleDone();
      else if (cmd === "stop") handleStop();
      else if (cmd === "requestBreak") {
        // Manually trigger break prompt
        const cycleNum = completedPomodoros + 1;
        const isLong = cycleNum % CYCLES_BEFORE_LONG_BREAK === 0;
        setCompletedPomodoros(cycleNum);
        setPrompt({ isLongBreak: isLong });
        setPhase("prompt");
        playChime();
      }
      else if (cmd === "takeBreak") handleTakeBreak(SHORT_BREAK_MS);
      else if (cmd === "snooze5") handleSnooze();
      else if (cmd === "snooze10") {
        // Custom 10-min snooze
        setPrompt(null);
        const we = elapsed - totalBreakTimeRef.current;
        snoozeThresholdRef.current = we + 10 * 60 * 1000;
        setCompletedPomodoros((c) => Math.max(0, c - 1));
        setPhase("work");
      }
      else if (cmd === "noBreak") handleNoBreak();
      else if (cmd === "skipBreak") handleSkipBreak();
    }, 200);
    return () => clearInterval(interval);
  });

  // Listen for Space shortcut from App.tsx
  useEffect(() => {
    function onTogglePause() {
      handlePause();
    }
    window.addEventListener("verseday:toggle-pause", onTogglePause);
    return () =>
      window.removeEventListener("verseday:toggle-pause", onTogglePause);
  });

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

  if (!focus) return null;

  const isOnBreak = phase === "break";
  const isPrompting = phase === "prompt";
  const sessionNum = (completedPomodoros % CYCLES_BEFORE_LONG_BREAK) + 1;

  return (
    <div className="fixed inset-0 bg-[#f5f4f0] flex flex-col items-center justify-center z-50">
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
      <div className="text-center max-w-[560px] px-8">
        {/* Task name — hero */}
        <h1 className="text-[28px] font-semibold text-[#2c2a35] mb-3 leading-snug">
          {focus.task.title}
        </h1>

        {/* Break prompt */}
        {isPrompting && prompt && (
          <div className="mb-10 p-6 rounded-2xl bg-white border border-black/[0.08] shadow-sm">
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
                  <button
                    onClick={() => handleTakeBreak(LONG_BREAK_MS)}
                    className="px-5 py-2.5 rounded-xl bg-[#7B9ED9] text-white text-[14px] font-medium cursor-pointer hover:bg-[#6889c4] transition-colors"
                  >
                    15 min break
                  </button>
                  <button
                    onClick={() => handleTakeBreak(SHORT_BREAK_MS)}
                    className="px-5 py-2.5 rounded-xl bg-black/[0.05] text-[#2c2a35] text-[14px] cursor-pointer hover:bg-black/[0.08] transition-colors"
                  >
                    5 min
                  </button>
                  <button
                    onClick={handleNoBreak}
                    className="px-5 py-2.5 rounded-xl bg-black/[0.05] text-black/40 text-[14px] cursor-pointer hover:bg-black/[0.08] transition-colors"
                  >
                    No break
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => handleTakeBreak(SHORT_BREAK_MS)}
                    className="px-5 py-2.5 rounded-xl bg-[#7B9ED9] text-white text-[14px] font-medium cursor-pointer hover:bg-[#6889c4] transition-colors"
                  >
                    5 min break
                  </button>
                  <button
                    onClick={handleSnooze}
                    className="px-5 py-2.5 rounded-xl bg-black/[0.05] text-[#2c2a35] text-[14px] cursor-pointer hover:bg-black/[0.08] transition-colors"
                  >
                    In 5 min
                  </button>
                  <button
                    onClick={handleNoBreak}
                    className="px-5 py-2.5 rounded-xl bg-black/[0.05] text-black/40 text-[14px] cursor-pointer hover:bg-black/[0.08] transition-colors"
                  >
                    No
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Timer display — secondary to task name */}
        {isOnBreak ? (
          <>
            <div className="text-[36px] font-medium tabular-nums leading-none mb-1 text-[#4a9e6e]" style={{ letterSpacing: "-1px" }}>
              {formatCountdown(breakRemaining)}
            </div>
            <p className="text-[11px] uppercase tracking-[0.06em] text-black/30 mb-6">
              Break
            </p>
            <button
              onClick={handleSkipBreak}
              className="px-5 py-2 rounded-xl bg-black/[0.05] text-black/40 text-[13px] cursor-pointer hover:bg-black/[0.08] transition-colors mb-8"
            >
              Skip break
            </button>
          </>
        ) : !isPrompting ? (
          <>
            <div
              className="text-[36px] font-medium tabular-nums leading-none mb-1"
              style={{ letterSpacing: "-1px", color: paused ? "rgba(0,0,0,0.25)" : "#7B9ED9" }}
            >
              {formatTime(elapsed + priorMs)}
            </div>
            <p className="text-[11px] uppercase tracking-[0.06em] text-black/30 mb-8">
              {paused ? "Paused" : "Running"}
            </p>
          </>
        ) : null}

        {/* Controls */}
        {isOnBreak ? null : (
          <div className="flex gap-2.5 justify-center mb-10">
            <button
              onClick={handleStop}
              className="px-6 py-2.5 rounded-xl bg-black/[0.04] border border-black/[0.08] text-black/40 text-[14px] cursor-pointer hover:bg-black/[0.07] transition-colors"
            >
              Stop &amp; save
            </button>
            {!isPrompting && (
              <button
                onClick={handlePause}
                className={`px-6 py-2.5 rounded-xl text-[14px] font-medium cursor-pointer transition-colors ${
                  paused
                    ? "bg-[#7B9ED9] text-white hover:bg-[#6889c4]"
                    : "bg-black/[0.04] border border-black/[0.08] text-black/50 hover:bg-black/[0.07]"
                }`}
              >
                {paused ? "Resume" : "Pause"}
              </button>
            )}
            <button
              onClick={handleDone}
              className="px-6 py-2.5 rounded-xl border border-[#C0DD97] text-[#3B6D11] text-[14px] cursor-pointer hover:bg-[#C0DD97]/10 transition-colors"
            >
              Mark done
            </button>
          </div>
        )}

        {/* Time meta */}
        <div className="flex items-start justify-center gap-8">
          <div className="text-center">
            <div className="text-[10px] uppercase tracking-[0.08em] text-black/25 mb-1">Total time on task</div>
            <div className="text-[16px] font-medium text-black/50 tabular-nums">{formatTime(elapsed + priorMs)}</div>
          </div>
          <div className="text-center">
            <div className="text-[10px] uppercase tracking-[0.08em] text-black/25 mb-1">This session</div>
            <div className="text-[16px] font-medium text-black/50 tabular-nums">{formatTime(elapsed)}</div>
          </div>
        </div>
      </div>

      {/* Session count — bottom */}
      <div className="absolute bottom-6 left-0 right-0 text-center">
        <span className="text-[11px] text-black/20 tabular-nums">
          Session {sessionNum} of {CYCLES_BEFORE_LONG_BREAK}
        </span>
      </div>
    </div>
  );
}
