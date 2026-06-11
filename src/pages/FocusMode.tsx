import { useEffect, useState, useRef, useCallback } from "react";
import { WebviewWindow, getAllWebviewWindows, getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import {
  PIP_STATE_EVENT,
  PIP_CMD_EVENT,
  PIP_READY_EVENT,
  PIP_SIZE,
  type PipState,
} from "../utils/pipEvents";
import { useAppStore, selectFocusedTask, consumeFocusResume, clearFocusResume, type SessionState, type FocusView } from "../stores/appStore";
import { clampWorkedDelta } from "../utils/workedTime";
import {
  stopTimeEntry,
  updateTaskStatus,
  updateTaskNotes,
  updateTaskTitle,
  updateTaskEstimate,
  updateTimeEntryWorkedSeconds,
  getSetting,
  getTaskById,
  getTasksForDate,
  getTaskStatusById,
  getWorkedMinutesForTask,
  startTimeEntry,
} from "../db/queries";
import RichTextEditor from "../components/RichTextEditor";
import VerseDayLogo from "../components/VerseDayLogo";
import { breakEndClock } from "../utils/breakClock";
import { todayString } from "../utils/dates";
import {
  getBreakContinuity,
  shouldContinueBreakCycle,
  BREAK_CONTINUITY_GAP_MS,
  type BreakContinuity,
} from "../utils/focusSettings";
import { getEmptyDayMessage } from "../utils/format";
import { playBreakChime as playChime } from "../utils/sounds";
import { workElapsedMs } from "../utils/pomodoro";
import type { Page } from "../types";

// If the user doesn't engage with the break prompt within this window,
// treat it as "No" — close the prompt, continue working. Stops the
// pip + main-window prompt from nagging indefinitely.
const PROMPT_AUTO_DISMISS_MS = 30_000;

// Stage 2 of the focus single-source refactor: the DB open-row worked_seconds
// checkpoint is the bounded-loss record. Tightened 30s → 15s; an immediate
// flush also fires on pause / window-blur / tab-hide / stop / app-close, so
// ~15s is only the WORST case on a hard crash with no clean exit signal.
const CHECKPOINT_INTERVAL_MS = 15_000;

// Stage 5 — the store split focus into session + focusView. FocusMode's internal
// logic is unchanged by deriving a read-only view that reproduces the old union
// shape exactly (session → active, else focusView → preview). Deterministic, so
// a preview can never be read as running. The STORE no longer holds a union.
//
// DRIFT GUARD: this is a DERIVED READ-ONLY view-model — it relies on
// session-precedence + the store's mutual exclusivity. NEVER store or persist it.
// A "is a session running?" check goes through `session` / selectRunningSession,
// NOT readFocus().mode === "active" (that's only for this component's display
// logic). Don't reintroduce a stored union.
type FocusCompat =
  | ({ mode: "active" } & SessionState)
  | ({ mode: "preview" } & FocusView)
  | null;
function readFocus(s: { session: SessionState | null; focusView: FocusView | null }): FocusCompat {
  if (s.session) return { mode: "active", ...s.session };
  if (s.focusView) return { mode: "preview", ...s.focusView };
  return null;
}

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



type BootStatus = "loading" | "empty" | "error";

interface FocusModeProps {
  /** When false, JSX renders nothing but effects still run — used to
   *  keep the pip + IPC channel alive while the user is on another
   *  page mid-session. Defaults to true (full-screen focus page). */
  visible?: boolean;
}

export default function FocusMode({ visible = true }: FocusModeProps) {
  const { stopFocus, setPage, previewFocus, activateFocus, primeTaskPatch, backfillEstimateForUntimedDone, setTaskWorkedMinutesAction, currentPage } = useAppStore();
  const session = useAppStore((s) => s.session);
  const focusView = useAppStore((s) => s.focusView);
  // Read-only view reproducing the old union for this component's internals.
  const focus = readFocus({ session, focusView });
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
    // Today-only policy: the focus screen surfaces today's open tasks
    // and nothing else. If the existing focus session is on a task
    // scheduled for a different date (e.g. a paused active session
    // that survived a date change, or a preview pinned to a future
    // task), close it and fall through to the boot logic below — which
    // either picks today's next open task or shows the empty state
    // ("nothing left, time to shut down"). Active sessions also write
    // their accumulated worked-seconds to the time entry before
    // clearing so no work is lost.
    //
    // The validation has to fetch from DB rather than relying on
    // tasksById alone — restoreFocus's async prime might still be in
    // flight, or no screen has loaded that date yet, in which case
    // the canonical map doesn't have the focused task. Falling through
    // when the map has no entry would let the existing session render
    // and defeat the policy.
    if (focus) {
      let cancelledValidate = false;
      (async () => {
        const fromMap = useAppStore.getState().tasksById.get(focus.taskId);
        let task = fromMap;
        if (!task) {
          try {
            const fetched = await getTaskById(focus.taskId);
            task = fetched ?? undefined;
          } catch {
            // DB fetch failed — leave the session alone; we'll re-
            // validate on the next render that has `focus` set.
            return;
          }
        }
        if (cancelledValidate) return;
        const today = todayString();
        // Task missing → orphaned focus reference. Clear it.
        // Task scheduled for a non-today date → policy violation. Clear it.
        if (!task || task.date_scheduled !== today) {
          if (focus.mode === "active") {
            try {
              await updateTimeEntryWorkedSeconds(
                focus.timeEntryId,
                Math.round(focus.workedMs / 1000),
              );
              await stopTimeEntry(focus.timeEntryId, 0);
            } catch {
              // orphan cleanup will catch
            }
          }
          if (cancelledValidate) return;
          useAppStore.setState({ session: null, focusView: null });
        }
      })();
      return () => {
        cancelledValidate = true;
      };
    }
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
    const f = readFocus(useAppStore.getState());
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

  // On task advance (Done → next), release the notes editor's
  // contentEditable focus. The ↑/↓ task-switch handler ignores arrows while
  // an editable is focused (so arrows move the cursor mid-edit); without
  // this, completing while the editor still holds focus left ↑/↓ dead until
  // the user clicked elsewhere. Keyed on taskId ONLY (not focusedTask) so it
  // never blurs mid-edit on the same task.
  useEffect(() => {
    const el = document.activeElement as HTMLElement | null;
    if (el && el.isContentEditable) el.blur();
  }, [focus?.taskId]);

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
    //
    // Session-local timing always resets on a new task (a stale break prompt
    // must never carry to the next task).
    totalBreakTimeRef.current = 0;
    workCycleStartRef.current = 0;
    setPhase("work");
    setBreakRemaining(0);
    setBreakDuration(0);
    setPrompt(null);
    snoozeThresholdRef.current = null;

    // Break-cycle accrual: in "continue" mode with a sub-threshold idle gap,
    // carry the prior task's accrued work into this cycle (so e.g. 23 min on
    // task A + 2 min on task B triggers the break); otherwise reset. Read the
    // mode via ref so toggling the setting doesn't itself reset the cycle.
    const gapMs = Date.now() - lastActiveTickAtRef.current;
    if (shouldContinueBreakCycle(breakContinuityRef.current, gapMs)) {
      breakCarryRef.current = lastWorkElapsedRef.current; // resume the cycle
      // keep completedPomodoros so the long-break cadence stays coherent
    } else {
      breakCarryRef.current = 0;
      setCompletedPomodoros(0);
    }
  }, [focus?.taskId]);

  function saveNotes(value: string) {
    const taskId = focus?.taskId;
    if (!taskId) return;
    if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
    notesTimerRef.current = setTimeout(() => {
      updateTaskNotes(taskId, value || null).catch(() => {});
      // Mirror into the store so the cache stays fresh — navigating away and
      // coming back seeds the editor from this updated value. Scoped to the
      // CAPTURED `taskId` (not "current focus"): this debounced save can fire
      // after the user completed + advanced, and an unscoped write would
      // stamp this task's notes onto the new focused task (the notes-bleed
      // bug). primeTaskPatch lands the edit on the task it belongs to.
      primeTaskPatch(taskId, { notes: value || null });
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
  // P-fix3: reactive (was a write-only ref, so unhide could never recreate the
  // pip). Hiding sets it true → the creation effect's cleanup closes the pip;
  // the "show mini timer" control sets it false → the effect recreates.
  const [pipHidden, setPipHidden] = useState(false);

  // The pip only shows once the timer has actually run at least once this
  // session — not on the initial preview (clicking Focus loads the next task
  // paused). Set true the first time focus goes active; reset on stop (focus
  // null). Stays true across roll-to-next-task previews so the pip survives.
  const [hasBeenActive, setHasBeenActive] = useState(false);
  useEffect(() => {
    if (!focus) {
      setHasBeenActive(false);
      setPipHidden(false); // fresh session starts with the pip un-hidden
    } else if (focus.mode === "active") {
      setHasBeenActive(true);
    }
  }, [focus]);

  useEffect(() => {
    // P-fix2: keep the pip alive for the whole session once it's been active —
    // so it survives the roll-to-next-task (active→preview) without a
    // teardown/recreate. Gate on focus (closes on stop), !pipHidden, and
    // hasBeenActive (so it doesn't show on the initial preview).
    if (!focus || pipHidden || !hasBeenActive) return;

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
          // Shared with FocusPip's pinned size (pipEvents.PIP_SIZE) so the window
          // and its content can't drift.
          width: PIP_SIZE.width,
          height: PIP_SIZE.height,
          resizable: false,
          alwaysOnTop: true,
          // macOS: join every Space so the pip rides along to whatever
          // desktop the user switches to, staying at the same screen
          // position — a constant reminder that a focus session is live,
          // no matter which desktop they're on. (Maps to NSWindow
          // collectionBehavior canJoinAllSpaces.) No-op on other platforms.
          // Known boundary: this covers standard desktops/Spaces, NOT a
          // single-app FULLSCREEN Space (its own Space) — the pip won't
          // float over a fullscreened app. Lifting that needs Rust-side
          // NSWindow collection-behavior flags tao doesn't expose; left as
          // a deliberate follow-up rather than bundled here.
          visibleOnAllWorkspaces: true,
          decorations: false,
          transparent: true,
          skipTaskbar: true,
          // Spawn without grabbing focus — the main VerseDay window
          // should keep keyboard/mouse focus when a session starts.
          // alwaysOnTop already keeps the pip visible without needing
          // window focus.
          focus: false,
          // macOS: engage on the first click rather than just
          // activating the pip's window. Without this, clicking the
          // pip from another app routes the click into "make me key"
          // and the button doesn't respond until a second click. With
          // it, hover-and-click lands in one motion.
          acceptFirstMouse: true,
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
          return;
        }

        // ── Hover-without-focus monitor (macOS) ─────────────────────
        // Start the NSEvent global mouse-moved monitor that detects
        // when the cursor is over the pip's screen rect. The Rust
        // side reads the pip's NSWindow.frame() inline on every fire
        // and emits "pip-hover" {over} edge transitions; FocusPip
        // listens and ORs the result with its CSS :hover state to
        // drive the icon fan-out. No-op on non-macOS.
        await pip.once("tauri://created", () => {
          void invoke("start_pip_hover_monitor", { label: "focus-pip" });
        });
      } catch {
        // PiP creation failed — not critical
      }
    })();

    return () => {
      cancelled = true;
      // Stop the hover monitor before closing the window. Order
      // doesn't strictly matter (the monitor is detached from the
      // window object) but stop-first leaves no race where a final
      // mouseMoved fires against a half-closed window.
      void invoke("stop_pip_hover_monitor", { label: "focus-pip" }).catch(() => {});
      // Close PiP when leaving focus mode
      pipRef.current?.close().catch(() => {});
      pipRef.current = null;
    };
    // Stable across active↔preview (focus != null), re-runs on stop (→null) and
    // on hide/unhide.
  }, [focus != null, pipHidden, hasBeenActive]);

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

  // Break-continuity (#pomodoro setting). "reset" = the break cycle resets on
  // every task switch (historical). "continue" = it carries across task
  // switches / short pauses, resetting only after a >= 2-min idle/paused gap.
  const [breakContinuity, setBreakContinuity] = useState<BreakContinuity>("reset");
  const breakContinuityRef = useRef(breakContinuity);
  breakContinuityRef.current = breakContinuity;
  // breakCarryRef — ms of prior-session work carried into the current cycle
  // (added to `we`). lastWorkElapsedRef — last computed `we`. lastActiveTickAtRef
  // — Date.now() of the last active tick, for the idle-gap test.
  const breakCarryRef = useRef(0);
  const lastWorkElapsedRef = useRef(0);
  const lastActiveTickAtRef = useRef(0);

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
  // Monotonic companion to lastTickRef. performance.now() freezes during machine
  // sleep and ignores wall-clock jumps, so comparing its delta against
  // lastTickRef's wall delta separates real awake work from suspend/jump gaps.
  const lastMonoRef = useRef<number>(0);
  const prevPausedRef = useRef(isPaused);
  // Read the break-continuity setting on mount and on each task start, so a
  // Settings toggle applies to the next focus session without a reload.
  useEffect(() => {
    getBreakContinuity().then(setBreakContinuity).catch(() => {});
  }, [focusTaskId]);

  // Resume-from-pause gap reset (continue mode only): if the session was
  // paused/idle for >= the threshold, restart the work cycle from the current
  // position when it resumes. In "reset" mode a pause never resets the cycle
  // (historical behavior).
  useEffect(() => {
    const wasPaused = prevPausedRef.current;
    prevPausedRef.current = isPaused;
    if (!wasPaused || isPaused) return; // only act on paused -> active
    if (focusMode !== "active") return;
    if (breakContinuityRef.current !== "continue") return;
    const gapMs = Date.now() - lastActiveTickAtRef.current;
    if (gapMs >= BREAK_CONTINUITY_GAP_MS) {
      workCycleStartRef.current = lastWorkElapsedRef.current; // currentCycleElapsed -> 0
      snoozeThresholdRef.current = null;
      setCompletedPomodoros(0);
    }
  }, [isPaused, focusMode]);
  useEffect(() => {
    if (focusMode !== "active" || isPaused) return;
    lastTickRef.current = Date.now();
    lastMonoRef.current = performance.now();
    // P0-1 — the effect (re)starts here on activate/unpause, and the tick
    // references are freshly reset, so any suspended span is already dropped.
    // Discard a resume flag that arrived while paused/inactive so it can't
    // later zero a legitimate first second once we resume counting.
    clearFocusResume();

    const interval = setInterval(() => {
      const current = readFocus(useAppStore.getState());
      if (!current || current.mode !== "active" || current.paused) return;

      const now = Date.now();
      const mono = performance.now();
      const wallDelta = now - lastTickRef.current;
      const monoDelta = mono - lastMonoRef.current;
      // Always advance BOTH references so the NEXT tick computes normal small
      // deltas even when this one is dropped (sleep / lid-close / clock jump).
      lastTickRef.current = now;
      lastMonoRef.current = mono;
      // #2 + #3 — synchronous wall-vs-monotonic cross-check decides how much of
      // this span was really worked: a sleep/clock-jump (clocks diverge) credits
      // only the awake monotonic delta; a continuously-awake span (incl.
      // throttled/occluded catch-up) is kept in full. The OS resume flag is a
      // redundant backstop.
      const worked = clampWorkedDelta(wallDelta, monoDelta, consumeFocusResume());
      if (worked > 0) tickFocus(worked);

      // Read latest workedMs after the tick — `current` was sampled
      // before tickFocus; for Pomodoro thresholds we want the
      // post-tick value.
      const latest = readFocus(useAppStore.getState());
      if (!latest || latest.mode !== "active") return;
      const raw = latest.workedMs;
      // Stamp the last active tick (for the break-continuity idle-gap test).
      lastActiveTickAtRef.current = now;

      if (phase === "work") {
        // breakCarryRef carries prior-session work in "continue" mode; 0 in
        // "reset" mode and after a >= 2-min idle gap.
        const we = workElapsedMs(raw, totalBreakTimeRef.current, breakCarryRef.current);
        lastWorkElapsedRef.current = we;

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
          workCycleStartRef.current = workElapsedMs(raw, totalBreakTimeRef.current, breakCarryRef.current);
          setPhase("work");
          setBreakRemaining(0);
          playChime();
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [focusTaskId, focusMode, isPaused, phase, completedPomodoros, breakDuration, tickFocus]);

  // #2 — worked_seconds checkpoint (crash/force-quit recovery).
  //
  // Depends on STABLE primitives, not the whole `focus` object: tickFocus
  // replaces `focus` every second, so a `[focus]` dep tore this interval down
  // and recreated it every tick — it never survived the 30s cadence to fire.
  // (That latent bug is why an abnormal exit lost the whole session.) We read
  // live state via getState() inside instead.
  //
  // Writes ONLY worked_seconds — NOT end_time. The row must stay open
  // (end_time IS NULL) while running so the #15-guarded aggregates exclude it
  // and the live focus.workedMs is counted exactly once at the app layer.
  // On a force-quit the row keeps this checkpointed worked_seconds; the next
  // boot's closeOrphanedTimeEntries sets end_time and it re-enters the totals.
  // Stage 2 — write the running session's CLAMPED workedMs to the open row's
  // worked_seconds. Absolute SET (idempotent across repeated flushes), end_time
  // untouched (stays NULL so the #15 aggregate guard keeps excluding it). Reads
  // live state via getState() so it's safe to call from any handler. Writes
  // regardless of paused — pause flushes the value AS-OF the pause.
  const flushCheckpoint = useCallback(() => {
    const f = readFocus(useAppStore.getState());
    if (!f || f.mode !== "active") return;
    updateTimeEntryWorkedSeconds(f.timeEntryId, Math.round(f.workedMs / 1000)).catch(() => {});
  }, []);

  useEffect(() => {
    if (focusMode !== "active") return;
    const checkpoint = setInterval(() => {
      const f = readFocus(useAppStore.getState());
      if (!f || f.mode !== "active" || f.paused) return; // no new time while paused
      flushCheckpoint();
    }, CHECKPOINT_INTERVAL_MS);
    return () => clearInterval(checkpoint);
  }, [focusTaskId, focusMode, flushCheckpoint]);

  // Immediate flush on the bounded-loss exit signals so worst-case loss is only
  // ~15s on a HARD crash. pause / window-blur / tab-hide while running, plus the
  // Tauri close-request (covers a clean quit, which may not fire blur first).
  // Stop already persists via stopFocusedSessionForTask (closes the row).
  useEffect(() => {
    if (focusMode !== "active") return;
    const onHidden = () => {
      if (document.visibilityState === "hidden") flushCheckpoint();
    };
    window.addEventListener("blur", flushCheckpoint);
    document.addEventListener("visibilitychange", onHidden);
    let unlistenClose: (() => void) | undefined;
    getCurrentWebviewWindow()
      .onCloseRequested(() => {
        flushCheckpoint();
      })
      .then((un) => {
        unlistenClose = un;
      })
      .catch(() => {});
    return () => {
      window.removeEventListener("blur", flushCheckpoint);
      document.removeEventListener("visibilitychange", onHidden);
      unlistenClose?.();
    };
  }, [focusMode, flushCheckpoint]);

  // Flush the instant a running session pauses (the value is final until resume).
  useEffect(() => {
    if (isPaused) flushCheckpoint();
  }, [isPaused, flushCheckpoint]);

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
  // `elapsed` is session.workedMs + priorMs (the precomputed display value);
  // the PiP just renders it.
  // Stage 4 — broadcast over a Tauri event (was the verseday_pip_state
  // localStorage channel). pipStateRef holds the latest payload for the
  // heartbeat + the pip's on-mount "ready" pull.
  const pipStateRef = useRef<PipState | null>(null);
  useEffect(() => {
    // P-fix2: mirror for preview too (only emit null when focus is null), so
    // the pip can render the queued task and offer a Start button. For preview,
    // `elapsed` is 0 → elapsed+priorMs = priorMs (the prior logged time); there
    // is no live session, so paused is false.
    if (!focus || !focusedTask) {
      pipStateRef.current = null;
      void emit(PIP_STATE_EVENT, null);
      return;
    }
    const queued = focus.mode === "preview";
    const state: PipState = {
      elapsed: elapsed + priorMs,
      paused: focus.mode === "active" ? focus.paused : false,
      phase,
      breakRemaining,
      taskTitle: focusedTask.title,
      estimatedMinutes: focusedTask.estimated_minutes ?? null,
      queued,
    };
    pipStateRef.current = state;
    void emit(PIP_STATE_EVENT, state);
  }, [focus, focusedTask, elapsed, phase, breakRemaining, priorMs]);

  // Heartbeat — re-emit the current state every 1s while a session exists. While
  // RUNNING the broadcast above already emits per tick; this matters while
  // PAUSED (workedMs frozen → the broadcast effect is idle), so the pip keeps
  // receiving liveness and doesn't self-close mid-pause. Gated on focusMode (not
  // `focus`, which churns each tick) so it isn't torn down every second.
  useEffect(() => {
    if (!focusMode) return;
    const hb = setInterval(() => {
      void emit(PIP_STATE_EVENT, pipStateRef.current);
    }, 1000);
    return () => clearInterval(hb);
  }, [focusMode]);

  // The pip asks for state on mount (it only gets future emits) — push the
  // current payload immediately so it's never blank for up to a heartbeat.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen(PIP_READY_EVENT, () => {
      void emit(PIP_STATE_EVENT, pipStateRef.current);
    })
      .then((un) => {
        unlisten = un;
      })
      .catch(() => {});
    return () => unlisten?.();
  }, []);

  // Tell the pip there's no session on unmount (clean teardown → it self-closes).
  useEffect(() => {
    return () => {
      void emit(PIP_STATE_EVENT, null);
    };
  }, []);

  // Stable refs for handlers used in effects
  const handleTogglePauseRef = useRef<() => void>(() => {});
  const handleDoneRef = useRef<() => void>(() => {});
  const handleStopRef = useRef<() => void>(() => {});
  const handleStartSessionRef = useRef<() => void>(() => {});
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

  // Listen for PiP commands (Stage 4 — Tauri event, was the verseday_pip_cmd
  // localStorage poll). All handlers go through *Ref.current so the listener is
  // registered once. Event delivery has no per-tick drop window.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<string>(PIP_CMD_EVENT, (e) => {
      const cmd = e.payload;
      if (cmd === "pause") handleTogglePauseRef.current();
      else if (cmd === "start") handleStartSessionRef.current();
      else if (cmd === "done") handleDoneRef.current();
      else if (cmd === "stop") handleStopRef.current();
      else if (cmd === "takeBreak") handleTakeBreakRef.current(SHORT_BREAK_MS);
      else if (cmd === "snooze5") handleSnoozeRef.current();
      else if (cmd === "noBreak") handleNoBreakRef.current();
      else if (cmd === "skipBreak") handleSkipBreakRef.current();
      else if (cmd === "hidePip") {
        // P-fix3: mark hidden — the creation effect (keyed on pipHidden) re-runs,
        // its cleanup closes the pip + stops the hover monitor, and the body
        // early-returns so it isn't recreated until the user unhides.
        setPipHidden(true);
      }
    })
      .then((un) => {
        unlisten = un;
      })
      .catch(() => {});
    return () => unlisten?.();
  }, [SHORT_BREAK_MS]);

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
      const f = readFocus(useAppStore.getState());
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
      const f = readFocus(useAppStore.getState());
      if (!f) return;
      e.preventDefault();
      setPage("daily");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPage, currentPage]);

  // ── ↑/↓ scroll through today's tasks while not in a live session ───────────
  // Scroll iff there's no active session: focus is null or `mode === "preview"`.
  // A running OR paused active session is INERT — switching tasks mid-session
  // goes through Done/Stop, so an arrow key never closes a time_entry as a side
  // effect (no fragmented sessions, no focus:null flash, no commit guard).
  // List source mirrors boot + complete-advance: getTasksForDate(today),
  // non-done, ordered by sort_order — NOT the store index, which isn't
  // guaranteed populated when you arrive via the F hotkey. previewFocus primes
  // tasksById for the target, so selectFocusedTask resolves on the next render.
  useEffect(() => {
    if (currentPage !== "focus") return;
    let navToken = 0;
    async function onKey(e: KeyboardEvent) {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      // Let arrows move the cursor when typing in the notes editor / a field.
      const el = document.activeElement;
      const isInput =
        el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || (el as HTMLElement).isContentEditable);
      if (isInput) return;
      const f = readFocus(useAppStore.getState());
      // A RUNNING session (active & not paused) stays inert — a stray arrow
      // shouldn't kill a live timer. Preview / no-session / a PAUSED session
      // can switch; a paused session's open time_entry is committed first
      // (below) so switching never orphans it.
      if (f && f.mode === "active" && !f.paused) return;
      e.preventDefault();
      const token = ++navToken; // ignore stale async results from older presses
      const tasks = await getTasksForDate(todayString()).catch(() => null);
      if (token !== navToken || !tasks) return;
      const remaining = tasks.filter((t) => t.status !== "done");
      if (remaining.length === 0) return;
      const curId = readFocus(useAppStore.getState())?.taskId;
      const idx = remaining.findIndex((t) => t.id === curId);
      const nextIdx =
        idx === -1
          ? e.key === "ArrowDown" ? 0 : remaining.length - 1
          : e.key === "ArrowDown" ? idx + 1 : idx - 1;
      if (nextIdx < 0 || nextIdx >= remaining.length) return; // clamp, no wrap
      const target = remaining[nextIdx];
      if (target.id === curId) return;
      // workedByTaskId/getWorkedMinutesForTask are MINUTES; priorElapsedMs is MS.
      const priorMs = (await getWorkedMinutesForTask(target.id).catch(() => 0)) * 60 * 1000;
      if (token !== navToken) return;
      // Capture the return-to page BEFORE committing — endActiveFocusSession
      // nulls `focus`, so reading previousPage after would miss it.
      const prev: Page =
        readFocus(useAppStore.getState())?.previousPage ??
        (useAppStore.getState().pageHistory.slice(-1)[0] as Page) ??
        "daily";
      // Commit a PAUSED active session before switching so its open time_entry
      // is closed, not orphaned — routes into the proven Done/Stop commit path
      // (stopFocusedSessionForTask), which guards + leaves focus null. Re-read
      // focus right before the commit (it may have changed during the awaits),
      // and re-check the nav token after the await before the synchronous
      // previewFocus so a newer keypress wins.
      const live = readFocus(useAppStore.getState());
      if (live && live.mode === "active") {
        await useAppStore.getState().endActiveFocusSession();
        if (token !== navToken) return;
      }
      previewFocus(target, prev, priorMs);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [currentPage, previewFocus]);

  // Thin wrapper around togglePauseFocus. Pomodoro break-phase
  // adjustment (so a paused break doesn't "catch up" to wall-clock
  // time when resumed) is handled by the pause-tracking effect below
  // — it watches focus.paused transitions and slides breakStartRef
  // forward by the pause duration on resume during break phase.
  function handleTogglePause() {
    togglePauseFocus();
  }

  // Pause-start tracking for the Pomodoro break-phase adjustment. Local ref
  // records when the user paused; on resume during break phase, advance
  // breakStartRef so the break countdown effectively pauses too.
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
    // If the work session is paused, resume it — the break countdown rides the
    // same per-second tick, which is gated on !paused, so a break taken while
    // paused would sit frozen at full. Clear pauseStartRef FIRST: this commit
    // batches paused=false with the setPhase("break") below, so the
    // pause-tracking effect runs seeing both and would otherwise slide
    // breakStartRef forward by the pause duration (opening the break above its
    // full time). With pauseStartRef null its resume-slide guard is false, so
    // the break starts at exactly `durationMs`.
    const f = readFocus(useAppStore.getState());
    if (f && f.mode === "active" && f.paused) {
      pauseStartRef.current = null;
      togglePauseFocus();
    }
    setPrompt(null);
    setBreakDuration(durationMs);
    breakStartRef.current = Date.now();
    setBreakRemaining(durationMs);
    setPhase("break");
  }

  function handleNoBreak() {
    setPrompt(null);
    // Start a new work cycle from current position. workElapsedMs includes
    // breakCarry — same formula the tick uses, so currentCycleElapsed resets to
    // ~0 (not ~breakCarry, which would re-fire the prompt instantly).
    workCycleStartRef.current = workElapsedMs(elapsed, totalBreakTimeRef.current, breakCarryRef.current);
    snoozeThresholdRef.current = null;
    setPhase("work");
  }

  function handleSnooze() {
    setPrompt(null);
    // Re-prompt in 5 minutes of work time (same work-elapsed formula as the tick).
    snoozeThresholdRef.current =
      workElapsedMs(elapsed, totalBreakTimeRef.current, breakCarryRef.current) + SNOOZE_MS;
    // Revert the pomodoro count since we snoozed (it was incremented when prompt showed)
    setCompletedPomodoros((c) => Math.max(0, c - 1));
    setPhase("work");
  }

  function handleSkipBreak() {
    // End break early. Account for the partial break taken FIRST, then anchor
    // the new cycle with the shared work-elapsed formula (incl. breakCarry).
    const breakElapsed = Date.now() - breakStartRef.current;
    totalBreakTimeRef.current += breakElapsed;
    workCycleStartRef.current = workElapsedMs(elapsed, totalBreakTimeRef.current, breakCarryRef.current);
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
    const breakSeconds = getBreakSeconds();

    // 1) Time-entry commit (ACTIVE only) — isolated and NON-BLOCKING. A
    //    failure here must never stop the task being marked done (separate
    //    done-ness from the time-commit). stopTimeEntry is idempotent, so a
    //    double-stop is a harmless no-op. Capture workedMs/timeEntryId from
    //    the closure snapshot before any store mutation.
    //    S.5 — write worked_seconds before stopTimeEntry.
    if (focus.mode === "active") {
      const workedSeconds = Math.round(focus.workedMs / 1000);
      const timeEntryId = focus.timeEntryId;
      try {
        await updateTimeEntryWorkedSeconds(timeEntryId, workedSeconds);
        await stopTimeEntry(timeEntryId, breakSeconds);
      } catch (err) {
        console.error("[focus] handleDone: time-entry commit failed (continuing to mark done)", err);
      }
    }

    // 2) Mark done — THE GATE. Only advance if this lands, so a failed write
    //    never produces a phantom completion (UI rolls on while the task stays
    //    open with no time, exactly the reported bug). Raw status write avoids
    //    the status-changed broadcast re-entry; backfillEstimateForUntimedDone
    //    is the SAME untimed-completion hook setTaskStatus uses, so completing
    //    a previewed/untimed task records worked = estimate (no-ops for the
    //    live session, which committed real time above).
    let doneCommitted = false;
    try {
      await updateTaskStatus(completedTaskId, "done");
      doneCommitted = true; // gate on the STATUS write alone
    } catch (err) {
      console.error("[focus] handleDone: mark-done failed — NOT advancing", err);
    }
    if (!doneCommitted) return;

    // Post-gate, best-effort: the task IS done in the DB, so a reconcile or
    // estimate-backfill hiccup must NOT block the advance — log and roll on.
    // (reconcileTaskFromDb already self-handles; the backfill can throw.)
    try {
      await useAppStore.getState().reconcileTaskFromDb(completedTaskId);
      await backfillEstimateForUntimedDone(completedTaskId);
    } catch (err) {
      console.error("[focus] handleDone: post-done reconcile/backfill failed (advancing anyway)", err);
    }

    // 3) Advance to the next remaining task (lands as preview — the user
    //    hits Start when ready). Separate failure mode: the completion has
    //    already persisted, so on error just clear focus. We keep focus on
    //    the completed task through the next-task lookup (path (c)) so its
    //    live worked-minutes never double-count, repoint to `next`, THEN
    //    refresh the completed task's committed minutes.
    try {
      const tasks = await getTasksForDate(todayString());
      const remaining = tasks.filter(
        (t) => t.status !== "done" && t.id !== completedTaskId
      );
      if (remaining.length === 0) {
        stopFocus();
        // Focus cleared → completed no longer the live task → refresh its
        // committed worked-minutes (no double-count).
        await useAppStore.getState().loadWorkedMinutes([completedTaskId]);
        return;
      }
      const next = remaining[0];
      const priorMs = (await getWorkedMinutesForTask(next.id)) * 60 * 1000;
      const history = useAppStore.getState().pageHistory;
      const prev: Page = (history[history.length - 1] as Page) ?? "daily";
      previewFocus(next, prev, priorMs); // repoint completed → next (no focus=null window)
      setZoomKey((k) => k + 1);
      // Focus now points at `next`, so refreshing the completed task's
      // committed minutes can't double-count it.
      await useAppStore.getState().loadWorkedMinutes([completedTaskId]);
    } catch (err) {
      console.error("[focus] handleDone: advance-to-next failed after completion", err);
      stopFocus();
    }
  }

  async function handleStop() {
    if (!focus) return;
    if (focus.mode === "active") {
      // P-fix4: commit (worked_seconds + break audit) + refresh workedByTaskId
      // + clear focus atomically (the canonical stop action; no double-commit).
      // It doesn't navigate, so replicate stopFocus's nav (with its
      // project_detail guard) back to where the session began.
      let prev: Page = focus.previousPage ?? "daily";
      await useAppStore.getState().stopFocusedSessionForTask(focus.taskId, getBreakSeconds());
      if (prev === "project_detail" && useAppStore.getState().selectedProjectId === null) {
        prev = "projects";
      }
      if (useAppStore.getState().currentPage === "focus") setPage(prev);
    } else {
      // Preview has no time entry — just clear + navigate.
      stopFocus();
    }
  }

  // Keep refs in sync with latest handlers
  handleTogglePauseRef.current = handleTogglePause;
  handleStartSessionRef.current = handleStartSession;
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
      primeTaskPatch(id, { title: trimmed });
    }
    setTitleDraft(null);
  }

  // Set the task's planned (estimated) duration. minutes === null
  // clears the planned value. Writes to DB + store, closes popover.
  function setPlannedMinutes(minutes: number | null) {
    const id = focus?.taskId;
    if (id) {
      updateTaskEstimate(id, minutes).catch(() => {});
      primeTaskPatch(id, { estimated_minutes: minutes });
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
    if (!focus) return;
    if (focus.mode === "active") {
      const newMs = Math.max(focus.priorElapsedMs, targetMs);
      const desiredElapsed = newMs - focus.priorElapsedMs;
      // adjustFocusElapsed sets session.workedMs directly; the store set()
      // triggers the re-render. No local elapsed state to update.
      adjustFocusElapsed(desiredElapsed);
      return;
    }
    // Preview mode: no live session to write workedMs into. Persist the
    // worked time directly through the canonical action — it writes the DB
    // (setManualWorkedMinutes), reconciles workedByTaskId, and patches
    // focusView.priorElapsedMs, which is the value preview's Actual renders.
    // setTaskWorkedMinutesAction takes MINUTES; targetMs is milliseconds.
    const minutes = Math.round(Math.max(0, targetMs) / 60000);
    setTaskWorkedMinutesAction(focus.taskId, minutes).catch(() => {});
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

  // From here on, focus (the readFocus view) is non-null.
  // Task comes from selectFocusedTask (cache-backed) so a rename made elsewhere
  // reflects here on the next render. previewFocus / startFocus /
  // reconcileFocusOnBoot all prime the cache, so a null result here means a
  // brief race during a focus task swap; render nothing for that frame rather
  // than half-state, the next render resolves.
  const task = focusedTask;
  if (!task) return null;
  const isQueued = focus.mode === "preview";
  const baselineMs = focus.priorElapsedMs;

  const isOnBreak = !isQueued && phase === "break";
  const isPrompting = !isQueued && phase === "prompt";

  // Actual is editable in both preview (no session yet — writes worked
  // minutes to the DB) and active (running OR paused — writes session
  // workedMs). The only blocks are the break/prompt sub-states, which are
  // active-only and where the numeral shows a countdown, not worked time.
  const canEditActual = !isOnBreak && !isPrompting;

  // Total work time on this task (prior sessions + current, minus breaks).
  // Preview mode: just the prior logged time — nothing's incrementing.
  const workElapsed = elapsed - totalBreakTimeRef.current;
  const totalWorkedMs = isQueued ? baselineMs : workElapsed + baselineMs;
  const estimatedMs = (task.estimated_minutes ?? 0) * 60 * 1000;

  // Hidden mount: effects above continue to run (pip lifecycle, state
  // broadcast, IPC listener) but the focus-page JSX doesn't render.
  if (!visible) return null;

  return (
    <div
      className={`fixed inset-0 flex flex-col items-center z-50 overflow-hidden${isOnBreak ? " focus-break-bg" : ""}`}
      style={isOnBreak ? undefined : { background: "var(--focus-bg)" }}
    >
      {/* P-fix3: re-show the mini timer (pip) after it's been hidden. Setting
          pipHidden false re-runs the creation effect, which recreates the pip. */}
      {pipHidden && (
        <button
          type="button"
          onClick={() => setPipHidden(false)}
          className="absolute top-4 right-4 z-10 text-[12px] text-fg-faded hover:text-fg-secondary cursor-pointer px-2.5 py-1.5 rounded-md hover:bg-overlay-hover transition-colors"
          title="Re-open the floating mini timer"
        >
          Show mini timer
        </button>
      )}
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
      ) : isOnBreak ? (
        /* Break takes over the whole surface (ambient wash on the container
           above + this centered composition). The two-column work layout is
           never rendered during a break — single break surface, no split
           logic. Presentation-only: Skip reuses handleSkipBreak and the tick's
           countdown→0 ends the break; no state-machine changes here. */
        <div className="relative flex flex-col items-center mt-4">
          <BreakScreen
            taskTitle={task.title}
            remainingMs={breakRemaining}
            onSkip={handleSkipBreak}
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
                    if (!canEditActual) return;
                    setActualOpen((v) => !v);
                  }}
                  disabled={!canEditActual}
                  className={`text-[26px] font-medium tabular-nums leading-none bg-transparent border-0 p-0 ${
                    canEditActual
                      ? "cursor-pointer hover:opacity-80"
                      : "cursor-default"
                  } transition-opacity`}
                  style={{
                    letterSpacing: "-1px",
                    color: isQueued || paused ? "var(--text-faded)" : "var(--focus-glow-base)",
                  }}
                  title={canEditActual ? "Click to adjust" : undefined}
                >
                  {formatTime(totalWorkedMs)}
                </button>
                <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-fg-faded mt-1">
                  Actual
                </span>

                {/* RUNNING-INDICATOR EXPERIMENT (revertible — see index.css block).
                    A line that sweeps back and forth under the Actual timer
                    while the session is actively counting — a running cue
                    beyond the numerals ticking. Remove this block + the
                    index.css experiment block (and the pip block) to revert. */}
                {!isQueued && focus?.mode === "active" && !paused && (
                  <div className="run-sweep-track mt-2 w-16 h-[2px]">
                    <div className="run-sweep-bar" style={{ background: "#A8CFE5" }} />
                  </div>
                )}

                {actualOpen && canEditActual && (
                  <TimePopover
                    title="Actual"
                    initialInput={formatTime(totalWorkedMs)}
                    currentMinutes={Math.round(totalWorkedMs / 60000)}
                    // Active floors at earlier sessions' logged time (can't
                    // reduce below prior via this popover). Preview's
                    // priorElapsedMs IS the whole editable total, so 0.
                    minMinutes={isQueued ? 0 : Math.ceil(focus.priorElapsedMs / 60000)}
                    onCommitInput={(raw) => {
                      const ms = parseActualInput(raw);
                      if (ms !== null) applyActualMs(ms);
                      setActualOpen(false);
                    }}
                    onSelectPreset={(min) => {
                      applyActualMs(min * 60 * 1000);
                      setActualOpen(false);
                    }}
                    // "Clear actual" in active mode floors at the DB-known
                    // prior total — discards only the *current session's*
                    // contribution. In preview, clearing would zero the
                    // task's historical logged time; that destructive
                    // rewrite is deliberately not a one-tap default here, so
                    // Clear is hidden in preview (typing a lower value is
                    // still an explicit, intentional path).
                    onClear={
                      isQueued
                        ? undefined
                        : () => {
                            applyActualMs(focus.priorElapsedMs);
                            setActualOpen(false);
                          }
                    }
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

              {/* Start / Pause / Resume pill — green vibrant primary CTA.
                  (Break has its own full-screen surface now, so no Skip
                  variant here.) */}
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

// ── BreakScreen ─────────────────────────────────────────────────────────────
// Active-break takeover (phase === "break"). The whole focus surface becomes a
// calm rest screen: breathing logo, a hero countdown, the "ends at" clock, the
// task title dimmed for context (task.title only — focus surfaces are
// task-only, never the objective), and Skip. Presentation-only — the parent
// owns the timing (countdown→0 ends the break; Skip = handleSkipBreak).
function BreakScreen({
  taskTitle,
  remainingMs,
  onSkip,
}: {
  taskTitle: string;
  remainingMs: number;
  onSkip: () => void;
}) {
  // now is read at render; the parent re-renders every second as the countdown
  // ticks, so the "ends" label stays correct. breakEndClock is pure + tested.
  const endsAt = breakEndClock(Date.now(), remainingMs);
  return (
    <div className="relative flex flex-col items-center text-center max-w-[560px] px-8 animate-scale-in">
      <div className="mb-8 break-logo-pulse">
        <VerseDayLogo size={72} />
      </div>
      <div
        className="text-[72px] font-semibold leading-none tabular-nums tracking-tight font-display"
        style={{ letterSpacing: "-2px", color: "var(--accent-green-deep)" }}
      >
        {formatCountdown(remainingMs)}
      </div>
      <p className="text-[15px] text-fg-secondary mt-4">
        On a break · ends {endsAt}
      </p>
      <p
        className="text-[14px] text-fg-secondary mt-10 max-w-[420px] line-clamp-2"
        style={{ opacity: 0.5 }}
      >
        {taskTitle}
      </p>
      <button
        onClick={onSkip}
        className="mt-8 inline-flex items-center justify-center px-5 min-w-[120px] h-11 rounded-full bg-overlay-hover text-fg-secondary text-[13px] font-medium cursor-pointer hover:bg-overlay-pressed transition-colors"
      >
        End early
      </button>
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
  /** Omit to hide the Clear footer (e.g. preview Actual, where clearing
   *  would destructively zero the task's logged time). */
  onClear?: () => void;
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
      {onClear && (
        <div className="border-t border-line-hairline">
          <button
            onClick={onClear}
            className="w-full px-4 py-2.5 text-[14px] text-accent-blue text-left cursor-pointer hover:bg-overlay-hover transition-colors"
          >
            Clear {title.toLowerCase()}
          </button>
        </div>
      )}
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
