import { useEffect, useState, useRef, useCallback } from "react";
import { WebviewWindow, getAllWebviewWindows } from "@tauri-apps/api/webviewWindow";
import { useAppStore, selectFocusedTask } from "../stores/appStore";
import {
  stopTimeEntry,
  checkpointTimeEntry,
  updateTaskStatus,
  updateTaskNotes,
  updateTaskTitle,
  updateTaskEstimate,
  updateTimeEntryWorkedSeconds,
  getSetting,
  getTasksForDate,
  getTaskStatusById,
  getWorkedMinutesForTask,
  startTimeEntry,
} from "../db/queries";
import RichTextEditor from "../components/RichTextEditor";
import VerseDayLogo from "../components/VerseDayLogo";
import { todayString } from "../utils/dates";
import { getEmptyDayMessage } from "../utils/format";
import { playBreakChime as playChime } from "../utils/sounds";
import type { Page } from "../types";

// If the user doesn't engage with the break prompt within this window,
// treat it as "No" — close the prompt, continue working. Stops the
// pip + main-window prompt from nagging indefinitely.
const PROMPT_AUTO_DISMISS_MS = 30_000;

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


type BootStatus = "loading" | "empty" | "error";

interface FocusModeProps {
  /** When false, JSX renders nothing but effects still run — used to
   *  keep the pip + IPC channel alive while the user is on another
   *  page mid-session. Defaults to true (full-screen focus page). */
  visible?: boolean;
}

export default function FocusMode({ visible = true }: FocusModeProps) {
  const { focus, stopFocus, setPage, setPendingDetailTask, previewFocus, activateFocus, updateFocusTask, currentPage } = useAppStore();
  const togglePauseFocus = useAppStore((s) => s.togglePauseFocus);
  const adjustFocusElapsed = useAppStore((s) => s.adjustFocusElapsed);
  const tickFocus = useAppStore((s) => s.tickFocus);
  const focusedTask = useAppStore(selectFocusedTask);
  // M2.2 — derived pause flags. focus.paused only exists on the active
  // branch; `paused` reads here are widely-used legacy locals. Keeping
  // the same name minimizes the diff at every render-site.
  const paused = focus?.mode === "active" ? focus.paused : false;

  // Boot status — only describes the *no-focus* path: are we still
  // loading the next task, did we find no remaining tasks, or did the
  // load fail? Once `focus` is set (preview or active), the store is the
  // single source of truth and bootStatus is irrelevant.
  //
  // No bootStartedRef: the boot effect's only kick-off gate is `!focus`,
  // and once previewFocus runs, `focus` is set so the effect bails on
  // re-run. No need for a parallel ref that can drift on HMR.
  const [bootStatus, setBootStatus] = useState<BootStatus>("loading");
  const [bootError, setBootError] = useState<string | null>(null);
  const [bootRetry, setBootRetry] = useState(0);

  useEffect(() => {
    if (focus) return;
    let cancelled = false;
    setBootStatus("loading");
    setBootError(null);
    // Safety timeout — if a DB query stalls (e.g. a stuck writer
    // holding the SQLite lock), surface an error rather than rendering
    // blank forever. 5s is generous for the queries we're issuing.
    const timeoutId = setTimeout(() => {
      if (cancelled) return;
      setBootError("Loading the task is taking longer than expected.");
      setBootStatus("error");
    }, 5000);
    (async () => {
      try {
        const tasks = await getTasksForDate(todayString());
        if (cancelled) return;
        const remaining = tasks.filter((t) => t.status !== "done");
        if (remaining.length === 0) {
          clearTimeout(timeoutId);
          setBootStatus("empty");
          return;
        }
        const target = remaining[0];
        const priorMs = (await getWorkedMinutesForTask(target.id)) * 60 * 1000;
        if (cancelled) return;
        clearTimeout(timeoutId);
        const history = useAppStore.getState().pageHistory;
        const prev: Page = (history[history.length - 1] as Page) ?? "daily";
        previewFocus(target, prev, priorMs);
      } catch (e) {
        if (cancelled) return;
        clearTimeout(timeoutId);
        setBootError(e instanceof Error ? e.message : "Could not load task");
        setBootStatus("error");
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [focus, bootRetry, previewFocus]);

  // Start the session from preview state. Creates the time entry, then
  // activates the focus session. The play button calls this in preview
  // mode; in active mode it calls handlePause instead.
  const handleStartSession = useCallback(async () => {
    const f = useAppStore.getState().focus;
    if (!f || f.mode !== "preview") return;
    try {
      const entryId = await startTimeEntry(f.taskId, "tracked");
      activateFocus(entryId);
    } catch (e) {
      setBootError(e instanceof Error ? e.message : "Could not start session");
      setBootStatus("error");
    }
  }, [activateFocus]);

  // Notes state + debounced auto-save (the editor flushes pending saves on
  // its own unmount, so navigating away from focus mode is also covered).
  // Synced from selectFocusedTask whenever the task identity changes, so
  // notes typed in preview mode save against the right row and survive
  // the preview → active transition. Reading from the selector (cache-
  // backed) instead of the focus snapshot means a notes change made
  // elsewhere (TaskDetailOverlay) reflects here on the next render.
  const [notes, setNotes] = useState(focusedTask?.notes ?? "");
  const notesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Inline title edit. titleDraft === null means the h1 renders;
  // setting it to a string flips into the input.
  const [titleDraft, setTitleDraft] = useState<string | null>(null);

  // Planned + Actual time popovers — both use the same component
  // shape (input + presets + clear), differ only in what they
  // commit to.
  const [plannedOpen, setPlannedOpen] = useState(false);
  const [actualOpen, setActualOpen] = useState(false);

  // Bumped on Done → next-task transitions to replay the tunnel-in
  // zoom animation by remounting the wrapper that owns the keyframe.
  const [zoomKey, setZoomKey] = useState(0);

  useEffect(() => {
    if (focus && focusedTask) setNotes(focusedTask.notes ?? "");
  }, [focus?.taskId, focusedTask]);

  // Reset session-relative state whenever the focus task changes
  // (e.g. Done → next-task transition). Without this the new task
  // would inherit the previous session's elapsed counter, Pomodoro
  // phase, etc.
  //
  // M2.2 — pause-related resets (`setPaused(false)`, `pausedAtRef.current
  // = null`, `pausedAccumRef.current = 0`) are gone. Pause init now
  // lives in startFocus / activateFocus; the store owns those fields.
  useEffect(() => {
    // S.3 — elapsed is derived from focus.workedMs; no setElapsed(0)
    // needed (workedMs already starts at 0 on a new active session
    // via startFocus/activateFocus).
    totalBreakTimeRef.current = 0;
    workCycleStartRef.current = 0;
    setCompletedPomodoros(0);
    setPhase("work");
    setBreakRemaining(0);
    setBreakDuration(0);
    setPrompt(null);
    snoozeThresholdRef.current = null;
  }, [focus?.taskId]);

  function saveNotes(value: string) {
    const taskId = focus?.taskId;
    if (!taskId) return;
    if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
    notesTimerRef.current = setTimeout(() => {
      updateTaskNotes(taskId, value || null).catch(() => {});
      // Mirror into the store so the cache stays fresh — navigating
      // away and coming back will seed the editor from this updated
      // value instead of the original session-start snapshot. After
      // M2.2 retires focus.task, updateFocusTask is a thin cacheTasks
      // wrapper (still works for callers).
      updateFocusTask({ notes: value || null });
      // Broadcast so other surfaces displaying this task's notes
      // (TaskDetailOverlay) pick up the new value without a remount.
      window.dispatchEvent(
        new CustomEvent("verseday:task-notes-changed", {
          detail: { taskId, html: value },
        })
      );
    }, 600);
  }

  // Listen for notes changes coming from other surfaces editing the
  // same task — keeps focus's local notes state in lockstep with
  // TaskDetailOverlay even when both are open at once.
  useEffect(() => {
    function onNotesChanged(e: Event) {
      const ce = e as CustomEvent<{ taskId: number; html: string }>;
      const id = focus?.taskId;
      if (!id || ce.detail.taskId !== id) return;
      if (ce.detail.html === notes) return;
      setNotes(ce.detail.html);
    }
    window.addEventListener("verseday:task-notes-changed", onNotesChanged);
    return () =>
      window.removeEventListener("verseday:task-notes-changed", onNotesChanged);
  }, [focus?.taskId, notes]);

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
  // Set to true when the user clicks the hide-pip icon. Resets when
  // FocusMode unmounts, so a new focus session gets a fresh pip.
  const pipHiddenRef = useRef(false);

  useEffect(() => {
    // Pip belongs to active sessions only — preview has nothing to mirror.
    if (!focus || focus.mode !== "active") return;

    // Sweep-then-create. The previous adopt-existing pattern raced
    // against (a) HMR re-mounts where the old close() hadn't completed
    // before the new mount queried for an existing pip, (b) force-
    // quit zombies that survived between app sessions, and (c) silent
    // close failures via .catch(() => {}). All three could end up
    // with multiple pip windows. Sweeping every "focus-pip"-labeled
    // window before creating guarantees exactly one — at the cost of
    // losing the user's last drag position (acceptable; a separate
    // settings key for window position can come later if missed).
    let cancelled = false;
    (async () => {
      try {
        const all = await getAllWebviewWindows();
        await Promise.all(
          all
            .filter((w) => w.label === "focus-pip")
            .map((w) => w.close().catch(() => {}))
        );
        if (cancelled) return;
        const pip = new WebviewWindow("focus-pip", {
          url: "/#focus-pip",
          title: "Focus",
          width: 220,
          height: 68,
          resizable: false,
          alwaysOnTop: true,
          decorations: false,
          transparent: true,
          skipTaskbar: true,
          // Spawn without grabbing focus — the main VerseDay window
          // should keep keyboard/mouse focus when a session starts.
          // alwaysOnTop already keeps the pip visible without needing
          // window focus.
          focus: false,
          x: 20,
          y: 20,
        });
        // Per Verse F1: assign first, then re-check cancelled. The
        // window between `if (cancelled)` and the assignment is small
        // but non-zero (new WebviewWindow triggers IPC). Assigning
        // first guarantees the cleanup function (which reads
        // pipRef.current) can find the new window if unmount races
        // with creation.
        pipRef.current = pip;
        if (cancelled) {
          pip.close().catch(() => {});
          pipRef.current = null;
        }
      } catch {
        // PiP creation failed — not critical
      }
    })();

    return () => {
      cancelled = true;
      // Close PiP when leaving focus mode
      pipRef.current?.close().catch(() => {});
      pipRef.current = null;
    };
  }, [focus?.mode === "active"]);

  // Total elapsed (for time entry / display)
  const priorMs = focus?.priorElapsedMs ?? 0;
  // S.3 — session-only elapsed (excludes priorElapsedMs) is now derived
  // directly from focus.workedMs. The tick effect below increments
  // workedMs via tickFocus; subscribers re-render. No local elapsed
  // state, no setElapsed, no wall-clock derivation here.
  const elapsed = focus?.mode === "active" ? focus.workedMs : 0;

  // Pomodoro state
  const [phase, setPhase] = useState<FocusPhase>("work");
  const [completedPomodoros, setCompletedPomodoros] = useState(0);
  const [completionBurst, setCompletionBurst] = useState(false);
  const prevPhaseRef = useRef<FocusPhase>("work");
  useEffect(() => {
    if (phase === "prompt" && prevPhaseRef.current === "work") {
      setCompletionBurst(true);
      const t = setTimeout(() => setCompletionBurst(false), 1100);
      prevPhaseRef.current = phase;
      return () => clearTimeout(t);
    }
    prevPhaseRef.current = phase;
  }, [phase]);

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

  // S.3 — Timer tick. Runs only on active running sessions. The store
  // owns workedMs; this effect's job is to call tickFocus(deltaMs) at
  // 1Hz with wall-clock deltas (Date.now() - lastTickAt), and to drive
  // the Pomodoro phase transitions.
  //
  // Effect deps don't include `focus` directly — that would re-fire on
  // every workedMs mutation, killing the interval before it ticks.
  // We extract `focus.taskId`, `focus.mode`, `focus.paused` as
  // primitive deps; the effect re-fires only on identity / mode /
  // pause-flag change. Pomodoro logic reads the live focus.workedMs
  // via useAppStore.getState() inside the interval body.
  //
  // lastTickRef is reset on every effect re-fire. That handles the
  // Verse-flagged pause-resume reset case: if the user resumes after
  // a long pause, the focus reference changes (paused: true → false),
  // the effect re-fires, lastTickRef = Date.now(); the first running
  // tick measures from now, not from the pre-pause running tick.
  const focusTaskId = focus?.taskId ?? null;
  const focusMode = focus?.mode ?? null;
  const isPaused = focus?.mode === "active" ? focus.paused : true;
  const lastTickRef = useRef<number>(0);
  useEffect(() => {
    if (focusMode !== "active" || isPaused) return;
    lastTickRef.current = Date.now();

    const interval = setInterval(() => {
      const current = useAppStore.getState().focus;
      if (!current || current.mode !== "active" || current.paused) return;

      const now = Date.now();
      const delta = now - lastTickRef.current;
      lastTickRef.current = now;
      if (delta > 0) tickFocus(delta);

      // Read latest workedMs after the tick — `current` was sampled
      // before tickFocus; for Pomodoro thresholds we want the
      // post-tick value.
      const latest = useAppStore.getState().focus;
      if (!latest || latest.mode !== "active") return;
      const raw = latest.workedMs;

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
          // Break is over — return to work. workCycleStart resets to
          // current work elapsed (post-break-time deduction) so the
          // next pomodoro cycle starts counting from here.
          totalBreakTimeRef.current += breakDuration;
          workCycleStartRef.current = raw - totalBreakTimeRef.current;
          setPhase("work");
          setBreakRemaining(0);
          playChime();
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [focusTaskId, focusMode, isPaused, phase, completedPomodoros, breakDuration, tickFocus]);

  // Checkpoint — active sessions only.
  useEffect(() => {
    if (!focus || focus.mode !== "active") return;
    const timeEntryId = focus.timeEntryId;
    const checkpoint = setInterval(() => {
      if (!focus.paused) {
        checkpointTimeEntry(timeEntryId).catch(() => {});
      }
    }, CHECKPOINT_INTERVAL_MS);
    return () => clearInterval(checkpoint);
  }, [focus]);

  // Broadcast state to PiP window — active sessions only. Preview has
  // no live state to mirror; the pip stays closed.
  //
  // M2.2 (R2) — reads taskTitle / estimatedMinutes from selectFocusedTask
  // (cache-backed) instead of the focus snapshot. The resolved
  // `focusedTask` is in the dep array so a rename made elsewhere in the
  // app re-broadcasts and the PiP shows the new title within one tick.
  // Without this dep, the PiP would keep showing the stale title — the
  // exact regression the entity refactor exists to prevent.
  //
  // S.3 — `elapsed` here is derived from focus.workedMs (the new
  // tick-counter source of truth), not from wall-clock derivation.
  // pausedAtMs / pausedAccumMs are still in the payload through the
  // dual-write window (S.4) for any consumer that wants them; PiP
  // doesn't currently use them, just renders the precomputed elapsed.
  useEffect(() => {
    if (!focus || focus.mode !== "active" || !focusedTask) {
      localStorage.removeItem(PIP_STATE_KEY);
      return;
    }
    const state = {
      elapsed: elapsed + priorMs,
      paused: focus.paused,
      phase,
      breakRemaining,
      taskTitle: focusedTask.title,
      estimatedMinutes: focusedTask.estimated_minutes ?? null,
    };
    localStorage.setItem(PIP_STATE_KEY, JSON.stringify(state));
  }, [focus, focusedTask, elapsed, phase, breakRemaining, priorMs]);

  // Clean up PiP state on unmount
  useEffect(() => {
    return () => {
      localStorage.removeItem(PIP_STATE_KEY);
      localStorage.removeItem(PIP_CMD_KEY);
    };
  }, []);

  // Stable refs for handlers used in effects
  const handleTogglePauseRef = useRef<() => void>(() => {});
  const handleDoneRef = useRef<() => void>(() => {});
  const handleStopRef = useRef<() => void>(() => {});
  const handleTakeBreakRef = useRef<(ms: number) => void>(() => {});
  const handleSnoozeRef = useRef<() => void>(() => {});
  const handleNoBreakRef = useRef<() => void>(() => {});
  const handleSkipBreakRef = useRef<() => void>(() => {});

  // 30-second auto-dismiss for the break prompt. If the user neither
  // accepts nor snoozes, fall back to "No" — close the prompt and
  // continue the current work cycle. Calls through the ref so we
  // don't have to depend on (and re-bind) the handler reference.
  // Phase change clears the timer, so a manual response cancels it.
  useEffect(() => {
    if (phase !== "prompt") return;
    const t = setTimeout(() => {
      handleNoBreakRef.current();
    }, PROMPT_AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [phase]);

  // Listen for PiP commands
  useEffect(() => {
    const interval = setInterval(() => {
      const cmd = localStorage.getItem(PIP_CMD_KEY);
      if (!cmd) return;
      localStorage.removeItem(PIP_CMD_KEY);
      if (cmd === "pause") handleTogglePauseRef.current();
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
      else if (cmd === "noBreak") handleNoBreakRef.current();
      else if (cmd === "skipBreak") handleSkipBreakRef.current();
      else if (cmd === "hidePip") {
        // Close the pip and mark as hidden for the rest of this
        // focus session. The creation effect won't re-run unless the
        // user starts a new session, so the pip stays gone.
        pipHiddenRef.current = true;
        pipRef.current?.close().catch(() => {});
        pipRef.current = null;
      }
    }, 200);
    return () => clearInterval(interval);
  }, [elapsed, SHORT_BREAK_MS, CYCLES_BEFORE_LONG_BREAK]);

  // Listen for Space shortcut from App.tsx
  useEffect(() => {
    function onTogglePause() {
      handleTogglePauseRef.current();
    }
    window.addEventListener("verseday:toggle-pause", onTogglePause);
    return () =>
      window.removeEventListener("verseday:toggle-pause", onTogglePause);
  }, []);

  // Cross-screen safety net: if the focused task is marked done from
  // any other surface (Daily Plan toggle, detail overlay, project
  // page, etc.), run the same Done flow as the focus screen's check
  // button — close the time entry (if active) and advance to the
  // next remaining task. Pip stops broadcasting state for the
  // completed task as soon as focus moves off, so it can never sit
  // showing a done task. setTaskStatusFromUI broadcasts this event
  // after the DB write; FocusMode's own handleDone uses raw
  // updateTaskStatus (no broadcast) so this listener doesn't fire
  // recursively from its own advance.
  useEffect(() => {
    function onStatusChanged(e: Event) {
      const ce = e as CustomEvent<{ taskId: number; status: string }>;
      const f = useAppStore.getState().focus;
      if (!f) return;
      if (ce.detail.taskId !== f.taskId) return;
      if (ce.detail.status !== "done") return;
      handleDoneRef.current();
    }
    window.addEventListener("verseday:task-status-changed", onStatusChanged);
    return () =>
      window.removeEventListener("verseday:task-status-changed", onStatusChanged);
  }, []);

  // Defensive mount check: if persisted focus state points at a task
  // whose status is already "done" (e.g. status changed from older
  // code that didn't broadcast, or in another app session before
  // this build), advance off it. Without this guard, the pip would
  // continue rendering the done task — exactly the failure the user
  // saw post-deploy with a stale "ddd" pip.
  useEffect(() => {
    if (!focus) return;
    let cancelled = false;
    (async () => {
      try {
        const status = await getTaskStatusById(focus.taskId);
        if (cancelled) return;
        if (status === "done") {
          handleDoneRef.current();
        }
      } catch {
        // Best effort — if the lookup fails, leave focus alone.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [focus?.taskId]);

  // Escape: leave the focus screen without stopping the timer. The session
  // keeps running in the background — the user can pause/stop from the
  // daily plan's focused row, or come back via the focus landing. Skipped
  // while typing in the notes editor (Tiptap handles Escape for blur);
  // first Esc blurs the editor, second Esc fires this branch. Only attached
  // when the focus page is actually visible — otherwise the hidden mount
  // (kept alive for the pip) would hijack Escape on every other page.
  useEffect(() => {
    if (currentPage !== "focus") return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      const el = document.activeElement;
      const isInput =
        el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || (el as HTMLElement).isContentEditable);
      if (isInput) {
        (el as HTMLElement).blur();
        return;
      }
      const f = useAppStore.getState().focus;
      if (!f) return;
      e.preventDefault();
      setPage("daily");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPage, currentPage]);

  // Thin wrapper around togglePauseFocus. Pomodoro break-phase
  // adjustment (so a paused break doesn't "catch up" to wall-clock
  // time when resumed) is handled by the pause-tracking effect below
  // — it watches focus.paused transitions and slides breakStartRef
  // forward by the pause duration on resume during break phase.
  function handleTogglePause() {
    togglePauseFocus();
  }

  // S.6 — pause-start tracking for the Pomodoro break-phase adjustment.
  // The store action no longer carries pausedAtMs (worked-seconds
  // model retired wall-clock fields). Local ref records when the
  // user paused; on resume during break phase, advance breakStartRef
  // so the break countdown effectively pauses too.
  const pauseStartRef = useRef<number | null>(null);
  useEffect(() => {
    if (focus?.mode !== "active") {
      pauseStartRef.current = null;
      return;
    }
    if (focus.paused && pauseStartRef.current === null) {
      pauseStartRef.current = Date.now();
    } else if (!focus.paused && pauseStartRef.current !== null) {
      if (phase === "break") {
        breakStartRef.current += Date.now() - pauseStartRef.current;
      }
      pauseStartRef.current = null;
    }
  }, [focus?.mode === "active" && focus.paused, phase, focus?.mode]);

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

  // S.5 — Pomodoro break time only. The paused-time portion (M2.4) is
  // gone: paused time isn't tracked via break_seconds anymore (the
  // worked-seconds model freezes workedMs while paused, so paused
  // time is naturally excluded from the recorded work). break_seconds
  // remains an audit column populated from totalBreakTimeRef so a
  // session's Pomodoro break duration is preserved on disk for
  // reporting / debugging, but it's no longer read by the
  // worked-minutes queries.
  function getBreakSeconds(): number {
    return totalBreakTimeRef.current / 1000;
  }

  async function handleDone() {
    if (!focus) return;
    const completedTaskId = focus.taskId;
    try {
      // Active session: close the time entry first so the worked
      // minutes get baked in before the row flips to done. Preview
      // mode has no time entry — just mark the task done and roll
      // to the next one.
      //
      // S.5 — write worked_seconds before stopTimeEntry. The order
      // matters: capture focus.workedMs from the closure before
      // any stopFocus() can clear it.
      if (focus.mode === "active") {
        const workedSeconds = Math.round(focus.workedMs / 1000);
        await updateTimeEntryWorkedSeconds(focus.timeEntryId, workedSeconds);
        await stopTimeEntry(focus.timeEntryId, getBreakSeconds());
      }
      await updateTaskStatus(completedTaskId, "done");
    } catch {
      // Best effort
    }
    // Try to load the next remaining task so the user can keep
    // flowing through their list. New session lands as preview —
    // user explicitly hits Start (or the timer-box click) when
    // they're ready. Replay the tunnel-in zoom so the transition
    // feels like a fresh focus, not a soft remount.
    try {
      const tasks = await getTasksForDate(todayString());
      const remaining = tasks.filter(
        (t) => t.status !== "done" && t.id !== completedTaskId
      );
      if (remaining.length === 0) {
        stopFocus();
        return;
      }
      const next = remaining[0];
      const priorMs = (await getWorkedMinutesForTask(next.id)) * 60 * 1000;
      const history = useAppStore.getState().pageHistory;
      const prev: Page = (history[history.length - 1] as Page) ?? "daily";
      previewFocus(next, prev, priorMs);
      setZoomKey((k) => k + 1);
    } catch {
      stopFocus();
    }
  }

  async function handleStop() {
    if (!focus) return;
    // Preview has no time entry to close — just clear the focus state.
    // S.5 — write worked_seconds before stopTimeEntry; capture
    // focus.workedMs from closure before stopFocus().
    if (focus.mode === "active") {
      const workedSeconds = Math.round(focus.workedMs / 1000);
      try {
        await updateTimeEntryWorkedSeconds(focus.timeEntryId, workedSeconds);
        await stopTimeEntry(focus.timeEntryId, getBreakSeconds());
      } catch {
        // Best effort
      }
    }
    stopFocus();
  }

  // Keep refs in sync with latest handlers
  handleTogglePauseRef.current = handleTogglePause;
  handleDoneRef.current = handleDone;
  handleStopRef.current = handleStop;
  handleTakeBreakRef.current = handleTakeBreak;
  handleSnoozeRef.current = handleSnooze;
  handleNoBreakRef.current = handleNoBreak;
  handleSkipBreakRef.current = handleSkipBreak;

  // Commit the in-flight title edit. Trims, only writes if changed,
  // updates DB + store + local notes-channel listeners (none for
  // title, but mirrors the notes pattern for consistency).
  function commitTitle() {
    if (titleDraft === null) return;
    const trimmed = titleDraft.trim();
    const id = focus?.taskId;
    if (id && trimmed && trimmed !== focusedTask?.title) {
      updateTaskTitle(id, trimmed).catch(() => {});
      updateFocusTask({ title: trimmed });
    }
    setTitleDraft(null);
  }

  // Set the task's planned (estimated) duration. minutes === null
  // clears the planned value. Writes to DB + store, closes popover.
  function setPlannedMinutes(minutes: number | null) {
    const id = focus?.taskId;
    if (id) {
      updateTaskEstimate(id, minutes).catch(() => {});
      updateFocusTask({ estimated_minutes: minutes });
    }
    setPlannedOpen(false);
  }

  // Apply a target total-worked value to the in-flight session.
  // Floored at priorElapsedMs (the time logged in earlier sessions
  // for this task) so the focus screen never displays less than what
  // the DB knows about. Reducing below the prior total is a
  // destructive rewrite of historical time_entries — that lives in a
  // separate, future affordance, not in this popover.
  function applyActualMs(targetMs: number) {
    if (!focus || focus.mode !== "active") return;
    const newMs = Math.max(focus.priorElapsedMs, targetMs);
    const desiredElapsed = newMs - focus.priorElapsedMs;
    // S.3 — adjustFocusElapsed is now a dual-write: sets workedMs
    // directly (which the displayed counter reads) AND back-solves
    // pausedAccumMs (which wall-clock-derived queries still need
    // through S.4/S.5). No local elapsed state to update — the
    // store action's set() triggers the re-render via focus.workedMs.
    adjustFocusElapsed(desiredElapsed);
  }

  // Parsing for the popover inputs.
  function parseActualInput(raw: string): number | null {
    const parts = raw.trim().split(":").map((p) => parseInt(p, 10));
    if (parts.length === 0 || parts.some((n) => isNaN(n) || n < 0)) return null;
    if (parts.length === 1) return parts[0] * 60 * 1000; // bare number = minutes
    if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000; // M:SS
    if (parts.length === 3) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
    return null;
  }

  function parsePlannedInput(raw: string): number | null {
    const parts = raw.trim().split(":").map((p) => parseInt(p, 10));
    if (parts.length === 0 || parts.some((n) => isNaN(n) || n < 0)) return null;
    if (parts.length === 1) return parts[0]; // bare number = minutes
    if (parts.length === 2) return parts[0] * 60 + parts[1]; // H:MM
    return null;
  }

  if (!focus) {
    // No focus state in the store yet. Render based on the boot phase:
    // loading is invisible (a few ms of blank while the next task
    // loads); empty/error use the FocusBoot fallback. Once previewFocus
    // fires, focus is set and we fall through to the main render.
    if (bootStatus === "loading") return null;
    return (
      <FocusBoot
        status={bootStatus}
        error={bootError}
        onRetry={() => {
          setBootError(null);
          setBootStatus("loading");
          setBootRetry((n) => n + 1);
        }}
        onLeave={() => setPage("daily")}
        onShutdown={() => setPage("daily_shutdown")}
      />
    );
  }
  if (!settingsLoaded) return null;

  // From here on, focus is non-null. The discriminated union narrows
  // timeEntryId / startedAt to the active branch automatically.
  // M2.2 — task comes from selectFocusedTask (cache-backed) so a rename
  // made elsewhere reflects here on the next render. previewFocus /
  // startFocus / restoreFocus all prime the cache, so a null result
  // here means a brief race during a focus task swap; render nothing
  // for that frame rather than half-state, the next render resolves.
  const task = focusedTask;
  if (!task) return null;
  const isQueued = focus.mode === "preview";
  const baselineMs = focus.priorElapsedMs;

  const isOnBreak = !isQueued && phase === "break";
  const isPrompting = !isQueued && phase === "prompt";

  // Total work time on this task (prior sessions + current, minus breaks).
  // Preview mode: just the prior logged time — nothing's incrementing.
  const workElapsed = elapsed - totalBreakTimeRef.current;
  const totalWorkedMs = isQueued ? baselineMs : workElapsed + baselineMs;
  const estimatedMs = (task.estimated_minutes ?? 0) * 60 * 1000;

  // Hidden mount: effects above continue to run (pip lifecycle, state
  // broadcast, IPC listener) but the focus-page JSX doesn't render.
  if (!visible) return null;

  return (
    <div className="fixed inset-0 flex flex-col items-center z-50 overflow-hidden" style={{ background: "var(--focus-bg)" }}>
      {/* Tunnel-in scale + fade wrapper. Plays once on mount and
          again whenever zoomKey bumps (Done → next-task transition).
          Keyed remount re-fires the CSS keyframe. Top-anchored
          (pt-[24vh]) instead of center-aligned so the VerseDay logo
          and the first line of the task title sit at the same
          vertical position regardless of how many lines the title
          wraps to — long titles extend the composition downward
          instead of pushing the logo up. */}
      <div key={zoomKey} className="relative z-[1] w-full h-full flex flex-col items-center pt-[24vh] animate-focus-tunnel-in">

      {/* Pomodoro-complete celebration takes over the entire content
          area when the prompt fires — no modal-over-screen, just the
          screen *becoming* the celebration. Single centered column for
          this branch; the two-column work/break layout only applies
          when there's something to actually work on. */}
      {isPrompting && prompt ? (
        <div className="relative text-center max-w-[760px] px-8 flex flex-col items-center mt-4">
          <BreakCelebration
            isLongBreak={prompt.isLongBreak}
            taskTitle={task.title}
            workMinutes={Math.round(WORK_DURATION_MS / 60000)}
            onTakeShort={() => handleTakeBreak(SHORT_BREAK_MS)}
            onTakeLong={() => handleTakeBreak(LONG_BREAK_MS)}
            onSnooze={handleSnooze}
            onNo={handleNoBreak}
          />
        </div>
      ) : (
        /* Two-column layout: title + notes on the left (text grows
           downward freely), timer + controls on the right (anchored,
           never gets pushed by long notes). items-start so the title
           and the top of the ring share a common top edge; the parent
           wrapper handles vertical centering of the whole block.
           max-w-[860px] keeps the columns tight enough to read as one
           composed unit instead of two clusters on opposite sides.
           VerseDay logo sits centered above the row to frame the page.
          Layout is top-anchored by the parent (pt-[24vh]); the logo
          and first line of title hold their position regardless of
          title length, with longer titles wrapping downward.
          px-12 keeps the absolute-positioned check button
          breathing space from the screen's left edge. */
        <div className="relative w-full max-w-[900px] px-12 flex flex-col items-center">
          {/* VerseDay logo — quiet ornament centered above the row,
              framing the page. Lower opacity so it sits in the
              background of the composition. */}
          <div className="mb-7 opacity-70">
            <VerseDayLogo size={56} />
          </div>
          {/* Single flex row containing check, title, and times — all
              top-aligned against the title's first line via
              items-start. Each child gets a small mt offset to
              compensate for line-height + font-metric differences so
              their visible tops (icon top, text cap-top, button top)
              line up with the title's first-line cap-top. */}
          <div className="w-full flex items-start gap-10">
            {/* Check + title group. flex-1 so it claims the available
                width up to max-w-[540px]; gap-3 keeps the check and
                the title close. items-start so the check stays with
                the title's first line even when the title wraps. */}
            <div className="flex-1 min-w-0 max-w-[540px] flex items-start gap-3">
              <button
                onClick={handleDone}
                className="mt-[5px] w-7 h-7 flex-shrink-0 rounded-full border-2 flex items-center justify-center transition-colors group cursor-pointer border-fg-faded hover:border-accent-green-deep hover:bg-accent-green-deep"
                title="Mark done"
              >
                <svg
                  width="14" height="14" viewBox="0 0 16 16"
                  fill="none"
                  className="stroke-fg-secondary group-hover:stroke-white transition-colors"
                  strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"
                >
                  <path d="M3 8.5l3.5 3.5 6.5-7" />
                </svg>
              </button>
              <div className="flex-1 min-w-0">
                {titleDraft !== null ? (
                  <TitleEditor
                    value={titleDraft}
                    onChange={setTitleDraft}
                    onCommit={commitTitle}
                    onCancel={() => setTitleDraft(null)}
                  />
                ) : (
                  <h1
                    onClick={() => !isQueued && setTitleDraft(task.title)}
                    className="text-[32px] font-medium text-fg leading-tight cursor-text hover:text-fg-secondary transition-colors"
                    title="Click to edit"
                  >
                    {task.title}
                  </h1>
                )}
              </div>
            </div>

          {/* Times block — Actual + Planned + Start/Pause pill.
              mt-[3px] aligns the numerals' cap-top with the title's
              first-line cap-top. relative hosts the completion-burst
              overlay. */}
          <div className="relative flex-shrink-0 flex items-start gap-6 mt-[6px]">
              {completionBurst && (
                <div className="pointer-events-none absolute z-10 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ width: 240, height: 240 }}>
                  <svg
                    viewBox="0 0 240 240"
                    fill="none"
                    className="absolute inset-0 animate-focus-complete-burst"
                    style={{ transformOrigin: "center" }}
                  >
                    <circle cx="120" cy="120" r="92" stroke="var(--accent-green)" strokeWidth="6" />
                  </svg>
                  <svg
                    viewBox="0 0 240 240"
                    fill="none"
                    className="absolute inset-0 animate-focus-complete-core"
                    style={{ transformOrigin: "center" }}
                  >
                    <circle cx="120" cy="120" r="62" stroke="var(--accent-green)" strokeWidth="3" opacity="0.5" />
                  </svg>
                </div>
              )}

              {/* Actual — current elapsed (or break countdown).
                  Click numerals to open the editor popover (active
                  sessions only). When the timer is actively counting
                  the numerals turn green so the running state reads
                  at a glance. Label sits below the time so the
                  number is the anchor and the label is the gloss. */}
              <div className="flex flex-col items-center relative">
                <button
                  onClick={() => {
                    if (isQueued || isOnBreak || focus?.mode !== "active") return;
                    setActualOpen((v) => !v);
                  }}
                  disabled={isQueued || isOnBreak || focus?.mode !== "active"}
                  className={`text-[26px] font-medium tabular-nums leading-none bg-transparent border-0 p-0 ${
                    !isQueued && !isOnBreak && focus?.mode === "active"
                      ? "cursor-pointer hover:opacity-80"
                      : "cursor-default"
                  } transition-opacity`}
                  style={{
                    letterSpacing: "-1px",
                    color: isOnBreak
                      ? "var(--focus-ring-progress)"
                      : isQueued || paused
                        ? "var(--text-faded)"
                        : "var(--focus-glow-base)",
                  }}
                  title={!isQueued && !isOnBreak && focus?.mode === "active" ? "Click to adjust" : undefined}
                >
                  {isOnBreak
                    ? formatCountdown(breakRemaining)
                    : formatTime(totalWorkedMs)}
                </button>
                <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-fg-faded mt-1">
                  {isOnBreak ? "Break" : "Actual"}
                </span>

                {actualOpen && focus?.mode === "active" && (
                  <TimePopover
                    title="Actual"
                    initialInput={formatTime(totalWorkedMs)}
                    currentMinutes={Math.round(totalWorkedMs / 60000)}
                    minMinutes={Math.ceil(focus.priorElapsedMs / 60000)}
                    onCommitInput={(raw) => {
                      const ms = parseActualInput(raw);
                      if (ms !== null) applyActualMs(ms);
                      setActualOpen(false);
                    }}
                    onSelectPreset={(min) => {
                      applyActualMs(min * 60 * 1000);
                      setActualOpen(false);
                    }}
                    onClear={() => {
                      // "Clear actual" floors at the DB-known prior
                      // total — discards only the *current session's*
                      // contribution. Reducing below prior would
                      // require rewriting time_entries (separate
                      // future affordance).
                      applyActualMs(focus.priorElapsedMs);
                      setActualOpen(false);
                    }}
                    onClose={() => setActualOpen(false)}
                  />
                )}
              </div>

              {/* Planned — estimate. Click numerals to open preset
                  popover; "Clear planned" inside resets to none.
                  Label sits below the time, mirroring Actual. */}
              <div className="flex flex-col items-center relative">
                <button
                  onClick={() => setPlannedOpen((v) => !v)}
                  className="text-[26px] font-medium tabular-nums leading-none cursor-pointer hover:opacity-80 transition-opacity bg-transparent border-0 p-0"
                  style={{ letterSpacing: "-1px", color: estimatedMs > 0 ? "var(--fg)" : "var(--text-faded)" }}
                  title="Set planned time"
                >
                  {estimatedMs > 0 ? formatTime(estimatedMs) : "--:--"}
                </button>
                <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-fg-faded mt-1">
                  Planned
                </span>

                {plannedOpen && (
                  <TimePopover
                    title="Planned"
                    initialInput={
                      task.estimated_minutes
                        ? `${Math.floor(task.estimated_minutes / 60)}:${(task.estimated_minutes % 60).toString().padStart(2, "0")}`
                        : "0:00"
                    }
                    currentMinutes={task.estimated_minutes ?? null}
                    onCommitInput={(raw) => {
                      const min = parsePlannedInput(raw);
                      if (min !== null) setPlannedMinutes(min || null);
                      setPlannedOpen(false);
                    }}
                    onSelectPreset={(min) => setPlannedMinutes(min)}
                    onClear={() => setPlannedMinutes(null)}
                    onClose={() => setPlannedOpen(false)}
                  />
                )}
              </div>

              {/* Start / Pause / Resume pill — green vibrant primary
                  CTA. During break this becomes Skip, since pause
                  doesn't apply to break countdowns. */}
              {isOnBreak ? (
                <button
                  onClick={handleSkipBreak}
                  className="inline-flex items-center justify-center gap-2 px-5 min-w-[120px] h-11 rounded-full bg-overlay-hover text-fg-secondary text-[13px] font-medium uppercase tracking-[0.1em] cursor-pointer hover:bg-overlay-pressed transition-colors"
                >
                  Skip
                </button>
              ) : (
                <button
                  onClick={isQueued ? handleStartSession : handleTogglePause}
                  className={`inline-flex items-center justify-center gap-2 px-5 min-w-[120px] h-11 rounded-full text-[13px] font-medium uppercase tracking-[0.1em] cursor-pointer transition-colors ${
                    isQueued || paused
                      ? "bg-accent-green-bright text-white hover:opacity-90"
                      : "bg-overlay-hover text-fg-secondary hover:bg-overlay-pressed"
                  }`}
                >
                  {isQueued || paused ? (
                    <>
                      <svg width="11" height="11" viewBox="0 0 14 14" fill="currentColor">
                        <path d="M3 1v12l10-6z" />
                      </svg>
                      {isQueued ? "Start" : "Resume"}
                    </>
                  ) : (
                    <>
                      <svg width="10" height="10" viewBox="0 0 14 14" fill="currentColor">
                        <rect x="2" y="1" width="3.5" height="12" rx="1" />
                        <rect x="8.5" y="1" width="3.5" height="12" rx="1" />
                      </svg>
                      Pause
                    </>
                  )}
                </button>
              )}
          </div>
          </div>

          {/* Hairline + full-width notes. The hairline starts at the
              left edge of the title text so it visually anchors to
              the title row, and spans about half the wrapper. */}
          <hr
            className="border-0 border-t border-line-hairline ml-10 mt-5 self-start"
            style={{ width: "calc(50% - 40px)" }}
          />
          <RichTextEditor
            value={notes}
            onChange={(html) => {
              setNotes(html);
              saveNotes(html);
            }}
            placeholder="Add notes…"
            className="w-full mt-3 min-h-[240px] pl-10 pr-4 py-3.5 bg-transparent text-left text-[14px] text-fg leading-relaxed"
          />
        </div>
      )}
      </div>
    </div>
  );
}

// ── BreakCelebration ────────────────────────────────────────────────────────
// Pomodoro-complete takeover. Replaces the focus content (task title /
// notes / timer / controls) when phase = "prompt". Logo + warm
// headline + coffee-cup accent + three actions, hierarchy by weight:
// primary fill (Yes — take the break), outlined (snooze 5min),
// text-only (No). Long-break variant promotes the 15min option.
function BreakCelebration({
  isLongBreak,
  taskTitle,
  workMinutes,
  onTakeShort,
  onTakeLong,
  onSnooze,
  onNo,
}: {
  isLongBreak: boolean;
  taskTitle: string;
  workMinutes: number;
  onTakeShort: () => void;
  onTakeLong: () => void;
  onSnooze: () => void;
  onNo: () => void;
}) {
  return (
    <div className="w-full flex flex-col items-center animate-scale-in">
      {/* Logo — decorative anchor at the top, larger than before so it
          sits as a calm presence rather than an icon-sized accent. */}
      <div className="mb-8">
        <VerseDayLogo size={96} />
      </div>

      {/* Headline — calm + human, lowercase fact rather than a
          punctuated celebration. */}
      <h1 className="text-[40px] font-semibold text-fg leading-tight font-display mb-4 tracking-tight">
        Nice work.
      </h1>

      {/* Body — sentence form so the action ("Go take 5.") reads as a
          gentle suggestion. Duration adapts to the variant; long-break
          says 15 instead of 5. */}
      <p className="text-[17px] text-fg-secondary leading-relaxed max-w-[480px] mb-10">
        You focused for {workMinutes} minutes on{" "}
        <span className="text-fg">{taskTitle}</span>. Go take {isLongBreak ? 15 : 5}.
      </p>

      {/* Action row. "Rest now" leads with intent (not duration —
          that's in the copy above). "In 5 min" snoozes the prompt;
          "Skip it" declines the break entirely. */}
      <div className="flex gap-3 items-center justify-center">
        <button
          onClick={isLongBreak ? onTakeLong : onTakeShort}
          className="px-5 py-2.5 rounded-full text-[14px] font-medium text-white bg-accent-green-deep hover:opacity-90 cursor-pointer transition-opacity inline-flex items-center gap-2"
        >
          <CoffeeCupIcon />
          Rest now
        </button>
        <button
          onClick={onSnooze}
          className="px-4 py-2.5 rounded-full text-[14px] text-fg-secondary border border-line-soft hover:border-line-strong hover:bg-overlay-hover cursor-pointer transition-colors"
        >
          In 5 min
        </button>
        <button
          onClick={onNo}
          className="px-4 py-2.5 rounded-full text-[14px] text-fg-faded border border-line-hairline hover:text-fg-secondary hover:border-line-soft hover:bg-overlay-hover cursor-pointer transition-colors"
        >
          Skip it
        </button>
      </div>
    </div>
  );
}

// Coffee cup — sits inside the primary CTA. Inherits currentColor so
// the stroke matches whatever text color the parent button uses.
// ── TitleEditor ────────────────────────────────────────────────────────────
// Auto-resizing textarea so the title wraps visually as the user types
// (an <input> would force everything onto a single line until Enter).
// Enter commits; Esc cancels; the height grows with content via a
// scrollHeight measurement on each keystroke.
function TitleEditor({
  value,
  onChange,
  onCommit,
  onCancel,
}: {
  value: string;
  onChange: (next: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      autoFocus
      value={value}
      rows={1}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onCommit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      className="text-[32px] font-medium text-fg leading-tight px-4 bg-transparent outline-none w-full border-0 resize-none overflow-hidden block"
    />
  );
}

// ── TimePopover ────────────────────────────────────────────────────────────
// Shared popover for the Actual + Planned readouts. Header has a live
// editable input (Enter commits, Esc closes); body is a list of preset
// minutes; footer is a blue "Clear {title.toLowerCase()}" link. Each
// caller owns the parsing and commit logic so the same shape works for
// elapsed-ms (Actual) and integer-minute (Planned).
const TIME_PRESETS = [5, 10, 15, 20, 25, 30, 45, 60];

function TimePopover({
  title,
  initialInput,
  currentMinutes,
  minMinutes = 0,
  onCommitInput,
  onSelectPreset,
  onClear,
  onClose,
}: {
  title: string;
  initialInput: string;
  /** Used to render the check next to the matching preset. */
  currentMinutes: number | null;
  /** Presets below this floor render disabled — used by Actual to
   *  prevent reducing below the DB-known prior baseline. */
  minMinutes?: number;
  onCommitInput: (raw: string) => void;
  onSelectPreset: (minutes: number) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState(initialInput);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  function fmtPreset(min: number) {
    if (min < 60) return `${min} min`;
    if (min === 60) return "1 hr";
    return `${(min / 60).toFixed(1)} hr`;
  }

  return (
    <div
      ref={ref}
      className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-60 bg-elevated border border-line-soft rounded-lg z-30"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className="px-4 pt-3 pb-3 border-b border-line-hairline">
        <div className="text-[12px] text-fg-faded mb-1">{title}:</div>
        <input
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onCommitInput(input);
            }
          }}
          className="text-[20px] tabular-nums text-fg leading-none bg-transparent outline-none border-0 w-full"
          style={{ letterSpacing: "-0.5px" }}
        />
        {/* Return-to-save hint stays visible the whole time the popover
            is open — clicking a preset shouldn't make it flicker out
            momentarily before the popover closes. */}
        <div className="text-[11px] text-fg-faded mt-2 flex items-center gap-1">
          <span className="font-mono text-[10px] px-1 py-px border border-line-hairline rounded">↵</span>
          <span>
            <span className="text-fg-secondary">Return</span> to save
          </span>
        </div>
      </div>
      <div className="py-1">
        {TIME_PRESETS.map((min) => {
          const selected = currentMinutes === min;
          const disabled = min < minMinutes;
          return (
            <button
              key={min}
              onClick={() => !disabled && onSelectPreset(min)}
              disabled={disabled}
              title={disabled ? `Below the ${minMinutes}-min logged baseline` : undefined}
              className={`w-full px-4 py-2 flex items-center justify-between text-[14px] transition-colors ${
                disabled
                  ? "text-fg-disabled opacity-50 cursor-not-allowed"
                  : "text-fg cursor-pointer hover:bg-overlay-hover"
              }`}
            >
              <span>{fmtPreset(min)}</span>
              {selected && (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 8.5l3.5 3.5 6.5-7" />
                </svg>
              )}
            </button>
          );
        })}
      </div>
      <div className="border-t border-line-hairline">
        <button
          onClick={onClear}
          className="w-full px-4 py-2.5 text-[14px] text-accent-blue text-left cursor-pointer hover:bg-overlay-hover transition-colors"
        >
          Clear {title.toLowerCase()}
        </button>
      </div>
    </div>
  );
}

function CoffeeCupIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="flex-shrink-0"
      aria-hidden="true"
    >
      {/* Steam — three little curves rising from the cup */}
      <path d="M8 2c-.5 1 .5 1.5 0 2.5" opacity="0.8" />
      <path d="M12 2c-.5 1 .5 1.5 0 2.5" opacity="0.8" />
      <path d="M16 2c-.5 1 .5 1.5 0 2.5" opacity="0.8" />
      {/* Cup body */}
      <path d="M3 8h14v6a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V8z" />
      {/* Handle */}
      <path d="M17 10h2a2.5 2.5 0 0 1 0 5h-2" />
    </svg>
  );
}

// ── FocusBoot ──────────────────────────────────────────────────────────────
// What renders when there's no active session AND no queued task. Two
// states:
//   empty — no remaining tasks for today. Reuses the same time-of-day
//           message the (deleted) FocusLanding used to show.
//   error — DB failure during task load. Inline message + retry.
//
// The brief "loading" window between mount and queued task arriving
// renders nothing (return null at the call site) — showing a "Starting…"
// line was misleading, since the user reads it as "the session is
// starting" when really we're just picking which task to show.
function FocusBoot({
  status,
  error,
  onRetry,
  onLeave,
  onShutdown,
}: {
  status: "empty" | "error";
  error: string | null;
  onRetry: () => void;
  onLeave: () => void;
  onShutdown: () => void;
}) {
  // Escape exits to the daily plan from either the empty or error
  // state. The active-session Escape handler in the parent FocusMode
  // doesn't fire here because focus is null on this view.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onLeave();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onLeave]);

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center z-50 overflow-hidden" style={{ background: "var(--focus-bg)" }}>
      <div className="relative z-[1] flex flex-col items-center text-center max-w-[420px] px-8">
        {/* VerseDay logo — calm brand mark for the empty/error state.
            Matches the active focus screen so the page identity is
            consistent across all focus states. */}
        <div className="mb-6 opacity-70">
          <VerseDayLogo size={56} />
        </div>

        {status === "empty" && (() => {
          const msg = getEmptyDayMessage();
          return (
            <>
              <p className="text-[15px] text-fg-muted mb-1">{msg.title}</p>
              <p className="text-[12px] text-fg-faded leading-relaxed mb-7">{msg.subtitle}</p>
              {/* "Shut down" CTA — when there's nothing left to focus
                  on, the natural next move is to wrap the day. Calm
                  outlined treatment so it reads as an option, not a
                  prompt. */}
              <button
                onClick={onShutdown}
                className="px-4 py-2 rounded-full text-[13px] text-accent-orange-soft-fg border border-accent-orange/40 hover:bg-accent-orange-soft hover:border-accent-orange cursor-pointer transition-colors"
              >
                Shut down
              </button>
            </>
          );
        })()}

        {status === "error" && (
          <>
            <p className="text-[15px] text-fg mb-1">Couldn't load your task</p>
            <p className="text-[12px] text-fg-faded leading-relaxed mb-5">
              {error ?? "Something went wrong."}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={onRetry}
                className="px-3.5 py-1.5 rounded-full text-[13px] text-accent-blue-soft-fg border border-accent-blue/50 hover:bg-accent-blue-soft cursor-pointer transition-colors"
              >
                Try again
              </button>
              <button
                onClick={onLeave}
                className="px-3.5 py-1.5 rounded-full text-[13px] text-fg-faded hover:text-fg-secondary hover:bg-overlay-hover cursor-pointer transition-colors"
              >
                Back to plan
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
