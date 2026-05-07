import { create } from "zustand";
import type { Page, Task } from "../types";
import { todayString, mondayOfWeek } from "../utils/dates";
import {
  getTaskById,
  getTimeEntryById,
  updateTimeEntryWorkedSeconds,
} from "../db/queries";

const FOCUS_STORAGE_KEY = "verseday_focus";
const SIDEBAR_COLLAPSED_KEY = "verseday_sidebar_collapsed";

// Discriminated union: a focus session is either *preview* (task picked,
// shown on the focus screen, but no time entry created — what the user
// sees when they click the Focus icon) or *active* (running session with
// a real time entry). The mode tag lets TypeScript narrow timeEntryId /
// startedAt accesses to the active branch and catch any code path that
// touches them in preview by mistake.
// M2.2 — `taskId: number` is the canonical reference. The transitional
// `task: Task` snapshot from M2.1 is retired; consumers read the live
// task via selectFocusedTask (cache-backed) so a rename made elsewhere
// in the app reflects on every focus surface within one render.
export type FocusState =
  | {
      mode: "preview";
      taskId: number;
      previousPage: Page;
      priorElapsedMs: number;
    }
  | {
      mode: "active";
      taskId: number;
      timeEntryId: number;
      startedAt: number; // Date.now() timestamp
      previousPage: Page;
      priorElapsedMs: number;
      // Pause is a first-class concept on the active branch. Preview has
      // no time entry, so pause is meaningless there. togglePauseFocus
      // guards mode === "active".
      paused: boolean;
      /** Wall-clock ms when current pause began; null when running.
       *  TRANSITIONAL — retired in S.5 of the worked-seconds simplification
       *  (docs/2026-05-07-worked-seconds-simplification.md). */
      pausedAtMs: number | null;
      /** Total paused time this session, excluding any open pause.
       *  TRANSITIONAL — retired in S.5. */
      pausedAccumMs: number;
      /** Worked time this session, in ms. Incremented by tickFocus while
       *  running. Becomes the source of truth for the displayed counter
       *  in S.3 and for the DB worked_seconds column in S.5. Added in
       *  S.2 alongside the wall-clock fields (dual-write seam). */
      workedMs: number;
    };

interface AppState {
  currentPage: Page;
  pageHistory: Page[];
  selectedDate: string;
  selectedWeek: string;
  selectedProjectId: number | null;
  focus: FocusState | null;
  pendingDetailTask: Task | null;
  /** ID of the task whose detail overlay is currently open. `null` = closed.
   *  Read by the singleton TaskDetailOverlayHost mounted at the App shell.
   *  Not persisted — overlay always closes on app restart (see plan §5.2). */
  selectedTaskDetailId: number | null;
  /** Set by openTaskDetail when the caller wants the overlay to auto-focus
   *  the title input on open (e.g., ScheduleTab's quick-add draft flow).
   *  Cleared by closeTaskDetail. */
  taskDetailAutoFocusTitle: boolean;
  /** TRANSITIONAL — superseded by canonical tasksById in M3.2.
   *  Populated opportunistically via cacheTasks() by screens that already
   *  load tasks. The detail-overlay host reads from here with a getTaskById
   *  fallback for cache misses. Search for `tasksByIdCache` to find the
   *  bridge sites that M3.2 retires. */
  tasksByIdCache: Map<number, Task>;
  /** Open the singleton task detail overlay for `id`. Pass
   *  `{ autoFocusTitle: true }` to focus the title input on open
   *  (used by quick-add flows that create the task in draft state). */
  openTaskDetail: (id: number, opts?: { autoFocusTitle?: boolean }) => void;
  /** Close the singleton task detail overlay. */
  closeTaskDetail: () => void;
  /** Write-through cache update. Screens that load tasks call this so the
   *  singleton overlay can resolve `selectedTaskDetailId` synchronously
   *  without re-querying the DB. M3.2 retires this in favor of canonical
   *  store-owned task loading actions. */
  cacheTasks: (tasks: Task[]) => void;
  /** Persisted user preference for collapsed sidebar (non-focus pages). */
  sidebarCollapsed: boolean;
  /** Ephemeral expand override on focus screens — resets on remount. */
  sidebarFocusExpanded: boolean;
  /** Last tab the user was on inside the Weekly Planner. Survives
   *  navigating away and back within a session so the user returns to
   *  whatever they had open (plan vs schedule). */
  weeklyPlannerTab: "plan" | "schedule";
  setWeeklyPlannerTab: (tab: "plan" | "schedule") => void;
  /** Schedule-tab planned-hours total surfaced into the WeeklyPlanner
   *  header. Written by ScheduleTab whenever its weekTasks change;
   *  read by WeeklyPlanner so the readout sits inline next to the
   *  Plan/Schedule toggle instead of taking a row of its own. */
  schedulePlannedMinutes: number;
  setSchedulePlannedMinutes: (minutes: number) => void;
  setPage: (page: Page) => void;
  goBack: () => void;
  setSelectedDate: (date: string) => void;
  setSelectedWeek: (date: string) => void;
  openProject: (id: number) => void;
  /** Stage a task on the focus screen without starting a time entry. */
  previewFocus: (task: Task, previousPage: Page, priorElapsedMs?: number) => void;
  /** Promote a preview session to active. Caller has already created the
   *  time entry — pass the resulting id. */
  activateFocus: (timeEntryId: number) => void;
  /** Patch the task on the current focus session in-place. Used so edits
   *  made on the focus screen (notes, title) survive navigating away and
   *  back without requiring a fresh DB fetch. */
  updateFocusTask: (patch: Partial<Task>) => void;
  /** Sync the focus session's prior-elapsed baseline when the user
   *  changes the task's worked-minutes elsewhere (e.g. TaskDetailOverlay).
   *  Only fires if the current focus is on the given task. */
  setFocusPriorElapsedMs: (taskId: number, priorMs: number) => void;
  startFocus: (task: Task, timeEntryId: number, previousPage: Page, priorElapsedMs?: number) => void;
  stopFocus: () => Page;
  restoreFocus: () => Promise<void>;
  /** Toggle pause on the active focus session. Manages pausedAtMs /
   *  pausedAccumMs internally. No-op if focus is null or in preview mode.
   *  M2.1 — wired from FocusMode/PiP/DailyPlan in M2.2/M2.3. */
  togglePauseFocus: () => void;
  /** Override the focus session's *displayed* elapsed by back-solving
   *  pausedAccumMs against the current reference (pausedAtMs if paused,
   *  now otherwise). Replaces the direct `pausedAccumRef.current = ...`
   *  mutation in FocusMode.applyActualMs. The desiredElapsedMs argument
   *  is the on-screen elapsed *excluding* priorElapsedMs (i.e. what the
   *  helper at src/utils/focusElapsed.ts returns minus priorElapsedMs).
   *  No-op if focus is null or in preview mode. */
  adjustFocusElapsed: (desiredElapsedMs: number) => void;
  /** Increment the running session's workedMs by deltaMs. No-op if
   *  focus is null, in preview mode, or paused. Caller passes
   *  `Date.now() - lastTickAt` (not a fixed 1000ms) so JS event-loop
   *  stalls don't drift the counter. Persists on every call —
   *  per-second localStorage write is cheap; the persisted value is
   *  the answer if the app crashes between writes. Added in S.2 of
   *  the worked-seconds simplification. */
  tickFocus: (deltaMs: number) => void;
  setPendingDetailTask: (task: Task | null) => void;
  /** Toggle the sidebar (smart: focus pages flip the ephemeral override; other pages flip the persisted preference). */
  toggleSidebar: () => void;
  /** Set collapsed=true/false explicitly (used by arrow-key shortcuts and chevron). */
  setSidebarCollapsed: (collapsed: boolean) => void;
}

// todayString and mondayOfWeek used to live here as private helpers
// using UTC ISO formatting; both moved to src/utils/dates.ts as part of
// the local-date sweep (commit 450d761 + this work) so every consumer
// reads the same fixed implementation. Imported above.

function loadPersistedSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function persistSidebarCollapsed(v: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(v));
  } catch {
    // ignore quota / private mode
  }
}

function persistFocus(focus: FocusState | null): void {
  if (focus) {
    localStorage.setItem(FOCUS_STORAGE_KEY, JSON.stringify(focus));
  } else {
    localStorage.removeItem(FOCUS_STORAGE_KEY);
  }
}

/** Loader shape includes the legacy `task: Task` snapshot so restoreFocus
 *  can prime the cache from it on relaunch. The returned FocusState has
 *  no `task` field (M2.2 retired it); the caller picks the snapshot off
 *  this struct, primes the cache, then sets focus. */
type LoadedFocus = { focus: FocusState; legacyTaskSnapshot: Task | null };

function loadPersistedFocus(): LoadedFocus | null {
  try {
    const raw = localStorage.getItem(FOCUS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FocusState> & {
      mode?: "preview" | "active";
      task?: Task;
      taskId?: number;
    };
    // Back-compat: pre-mode entries default to "active" so users with a
    // live session at upgrade time keep it.
    const mode = parsed.mode ?? "active";

    // Migration: legacy shape only had `task: Task`. Backfill taskId
    // from the snapshot, hand the snapshot to restoreFocus to prime
    // the cache, then drop it from the returned focus state.
    const legacyTask = parsed.task as Task | undefined;
    const taskId = parsed.taskId ?? legacyTask?.id;
    if (taskId === undefined) {
      // Corrupt or pre-task-shape entry — drop it.
      localStorage.removeItem(FOCUS_STORAGE_KEY);
      return null;
    }

    if (mode === "preview") {
      return {
        focus: {
          mode: "preview",
          taskId,
          previousPage: parsed.previousPage ?? "daily",
          priorElapsedMs: parsed.priorElapsedMs ?? 0,
        },
        legacyTaskSnapshot: legacyTask ?? null,
      };
    }

    // mode === "active" — pause field defaults for pre-rev-2 entries.
    const active = parsed as Partial<Extract<FocusState, { mode: "active" }>>;
    if (active.timeEntryId === undefined || active.startedAt === undefined) {
      // Active sessions need both — corrupt entry.
      localStorage.removeItem(FOCUS_STORAGE_KEY);
      return null;
    }
    // S.2 — workedMs derivation for in-flight state migration.
    // Pre-S.2 persisted state has wall-clock fields but no workedMs.
    // Derive once from the legacy formula. After this load,
    // restoreFocus immediately persists the new shape (R3) so the
    // shim is one-shot.
    //
    // If the previous session was running (paused === false), force
    // it paused. We don't want to start ticking workedMs into a
    // session whose user mental model says "I quit, I wasn't working
    // during the quit." User clicks Resume to continue.
    const paused = active.paused ?? false;
    const startedAt = active.startedAt;
    const pausedAccumMs = active.pausedAccumMs ?? 0;
    const persistedPausedAtMs = active.pausedAtMs ?? null;
    let workedMs = (active as Partial<Extract<FocusState, { mode: "active" }>>).workedMs;
    let derivedAndForcedPaused = false;
    const now = Date.now();
    if (workedMs === undefined) {
      const openPause = paused && persistedPausedAtMs !== null ? now - persistedPausedAtMs : 0;
      workedMs = Math.max(0, now - startedAt - pausedAccumMs - openPause);
      derivedAndForcedPaused = !paused; // only force if was running
    }
    // R4 — when force-pausing a previously-running session, set
    // pausedAtMs = now so the wall-clock-derived display freezes
    // correctly during the dual-write window (S.2-S.4). Without this,
    // paused === true with pausedAtMs === null leaves openPause = 0
    // in computeFocusElapsedMs, and the displayed counter keeps
    // ticking up wall-clock-style despite the paused flag. S.5 retires
    // the wall-clock derivation entirely; until then this invariant
    // matters.
    const finalPausedAtMs = derivedAndForcedPaused ? now : persistedPausedAtMs;
    return {
      focus: {
        mode: "active",
        taskId,
        timeEntryId: active.timeEntryId,
        startedAt,
        previousPage: active.previousPage ?? "daily",
        priorElapsedMs: active.priorElapsedMs ?? 0,
        paused: derivedAndForcedPaused ? true : paused,
        pausedAtMs: finalPausedAtMs,
        pausedAccumMs,
        workedMs,
      },
      legacyTaskSnapshot: legacyTask ?? null,
    };
  } catch {
    localStorage.removeItem(FOCUS_STORAGE_KEY);
    return null;
  }
}

/** Selector: resolves the open detail overlay's task from the transitional
 *  cache. Returns null when the overlay is closed or the cache hasn't been
 *  primed yet (the host falls back to a getTaskById fetch in that case).
 *  M3.2 reroutes this to read from canonical tasksById. */
export function selectTaskDetailTask(state: AppState): Task | null {
  const id = state.selectedTaskDetailId;
  if (id === null) return null;
  return state.tasksByIdCache.get(id) ?? null;
}

/** Selector: resolves the focused task from tasksByIdCache so a rename
 *  or edit made elsewhere in the app re-renders subscribers
 *  immediately. M3.2 reroutes the lookup to canonical tasksById.
 *
 *  Returns null when there is no focus session, or briefly during the
 *  cache-miss window after restoreFocus when the modern persisted shape
 *  has only taskId (no embedded snapshot to prime from). FocusMode and
 *  the PiP broadcast handle the null case. */
export function selectFocusedTask(state: AppState): Task | null {
  const f = state.focus;
  if (!f) return null;
  return state.tasksByIdCache.get(f.taskId) ?? null;
}

export const useAppStore = create<AppState>((set, get) => ({
  currentPage: "daily",
  pageHistory: [],
  selectedDate: todayString(),
  selectedWeek: mondayOfWeek(),
  selectedProjectId: null,
  focus: null,
  pendingDetailTask: null,
  selectedTaskDetailId: null,
  taskDetailAutoFocusTitle: false,
  tasksByIdCache: new Map(),
  sidebarCollapsed: loadPersistedSidebarCollapsed(),
  sidebarFocusExpanded: false,
  weeklyPlannerTab: "plan",
  schedulePlannedMinutes: 0,
  setSchedulePlannedMinutes: (minutes) => set({ schedulePlannedMinutes: minutes }),
  setPage: (page) => {
    const prev = get().currentPage;
    if (prev === page) return;
    // Preview focus is scoped to the focus screen visit. Leaving focus
    // discards the preview so a fresh "next task" loads on next entry —
    // otherwise a queued task could go stale across navigation, or a
    // persisted preview could pin yesterday's pick.
    const f = get().focus;
    if (prev === "focus" && page !== "focus" && f?.mode === "preview") {
      persistFocus(null);
      set((s) => ({
        focus: null,
        currentPage: page,
        pageHistory: [...s.pageHistory.slice(-19), prev],
      }));
      return;
    }
    set((s) => ({
      currentPage: page,
      pageHistory: [...s.pageHistory.slice(-19), prev],
    }));
  },
  goBack: () => {
    const history = get().pageHistory;
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    set({ currentPage: prev, pageHistory: history.slice(0, -1) });
  },
  setSelectedDate: (date) => set({ selectedDate: date }),
  setSelectedWeek: (date) => set({ selectedWeek: date }),
  openProject: (id) => {
    const prev = get().currentPage;
    set((s) => ({
      currentPage: "project_detail",
      selectedProjectId: id,
      pageHistory: [...s.pageHistory.slice(-19), prev],
    }));
  },
  previewFocus: (task, previousPage, priorElapsedMs = 0) => {
    // Stages a task on the focus screen — no time entry, no startedAt.
    // The user transitions to active by hitting Play (FocusMode calls
    // activateFocus after creating the time entry).
    //
    // M2.2 — primes tasksByIdCache so selectFocusedTask resolves
    // synchronously. The store no longer carries a task snapshot;
    // consumers read live task data through the selector.
    const focus: FocusState = {
      mode: "preview",
      taskId: task.id,
      previousPage,
      priorElapsedMs,
    };
    get().cacheTasks([task]);
    persistFocus(focus);
    set({ focus });
  },
  activateFocus: (timeEntryId) => {
    const f = get().focus;
    if (!f || f.mode !== "preview") return;
    // Pause fields init to false / null / 0 on every active-mode
    // transition (here from preview, and in startFocus below). Replaces
    // FocusMode's reset-on-task-change effect at :177-181.
    const next: FocusState = {
      mode: "active",
      taskId: f.taskId,
      timeEntryId,
      startedAt: Date.now(),
      previousPage: f.previousPage,
      priorElapsedMs: f.priorElapsedMs,
      paused: false,
      pausedAtMs: null,
      pausedAccumMs: 0,
      // S.2 — worked-seconds counter starts at 0. Tick effect bumps it
      // via tickFocus. Wall-clock fields above stay populated for the
      // dual-write seam (S.4 keeps them; S.5 retires).
      workedMs: 0,
    };
    persistFocus(next);
    set({ focus: next });
  },
  updateFocusTask: (patch) => {
    // M2.2 — `task` is no longer on FocusState; this action is a thin
    // cacheTasks wrapper that preserves the existing API for callers
    // that want to splice an in-memory change to the focused task
    // (FocusMode's notes/title/estimate auto-saves; TaskDetailOverlay's
    // mirror writes). M3.2 may collapse this into the canonical
    // `updateTask` action depending on whether the wrapper still earns
    // its keep.
    const f = get().focus;
    if (!f) return;
    const current = get().tasksByIdCache.get(f.taskId);
    if (!current) return;
    const nextTask = { ...current, ...patch };
    get().cacheTasks([nextTask]);
  },
  setFocusPriorElapsedMs: (taskId, priorMs) => {
    const f = get().focus;
    if (!f || f.taskId !== taskId) return;
    const next = { ...f, priorElapsedMs: priorMs } as FocusState;
    persistFocus(next);
    set({ focus: next });
  },
  startFocus: (task, timeEntryId, previousPage, priorElapsedMs = 0) => {
    // Sets focus state only — does NOT navigate to the immersive Focus page.
    // Callers that want the full-screen timer experience follow up with
    // setPage("focus") themselves (App.tsx F hotkey and ProjectDetail do).
    // DailyPlanner deliberately does not, so the user can keep planning
    // while the timer runs in the background with a live counter on the
    // focused task row.
    //
    // FocusMode no longer calls startFocus directly — it goes through
    // previewFocus → activateFocus so the screen can render the task
    // before the time entry is created.
    //
    // M2.2 — primes the cache so selectFocusedTask resolves
    // synchronously. Initializes pause fields.
    const focus: FocusState = {
      mode: "active",
      taskId: task.id,
      timeEntryId,
      startedAt: Date.now(),
      previousPage,
      priorElapsedMs,
      paused: false,
      pausedAtMs: null,
      pausedAccumMs: 0,
      // S.2 — see activateFocus comment.
      workedMs: 0,
    };
    get().cacheTasks([task]);
    persistFocus(focus);
    set({ focus });
  },
  stopFocus: () => {
    const state = get();
    let prev = state.focus?.previousPage ?? "daily";
    // Guard against stale project_detail (#7)
    if (prev === "project_detail" && state.selectedProjectId === null) {
      prev = "projects";
    }
    persistFocus(null);
    // Only navigate when stopping from the immersive Focus screen.
    // Inline pauses (DailyPlanner row, etc.) must not whisk the user
    // back to wherever the timer was originally started.
    if (state.currentPage === "focus") {
      set({ focus: null, currentPage: prev });
    } else {
      set({ focus: null });
    }
    return prev;
  },
  restoreFocus: async () => {
    const persisted = loadPersistedFocus();
    if (!persisted) return;
    // Prime the cache so selectFocusedTask resolves on first render.
    // Legacy persisted shape carries a Task snapshot — use it directly.
    // Modern shape (post-M2.2) has only taskId; fall back to a one-shot
    // getTaskById fetch and prime asynchronously. Until that resolves,
    // FocusMode renders null (the cache-miss branch returns null), which
    // is invisible — millisecond order. M3.2 replaces this with the
    // canonical store-owned tasksById rehydration, removing the fetch.
    if (persisted.legacyTaskSnapshot) {
      get().cacheTasks([persisted.legacyTaskSnapshot]);
    } else {
      const { taskId } = persisted.focus;
      void getTaskById(taskId)
        .then((t) => {
          if (t) get().cacheTasks([t]);
        })
        .catch(() => {
          // Best effort — the host will refetch on first overlay open
          // or list refresh anyway.
        });
    }

    // S.2 R1 — orphan-entry-referenced-by-focus check. If the time
    // entry the focus points at is already closed (e.g.
    // closeOrphanedTimeEntries closed it during a prior run), don't
    // restore the focus; that would let a future Resume → Stop write
    // to a closed row. Land any locally-tracked workedMs on the
    // closed row first (only if its worked_seconds is currently 0 —
    // don't clobber a real backfill or prior write), then clear focus.
    if (persisted.focus.mode === "active") {
      try {
        const entry = await getTimeEntryById(persisted.focus.timeEntryId);
        if (entry && entry.end_time !== null) {
          if ((entry.worked_seconds ?? 0) === 0 && persisted.focus.workedMs > 0) {
            await updateTimeEntryWorkedSeconds(
              persisted.focus.timeEntryId,
              Math.round(persisted.focus.workedMs / 1000),
            );
          }
          persistFocus(null);
          return;
        }
      } catch {
        // DB read failed. Fall through and restore focus normally —
        // worse to crash on boot than to dangle a focus reference;
        // closeOrphanedTimeEntries (called after restoreFocus in
        // App.tsx) plus the existing stop path are the next safety net.
      }
    }

    // S.3 — auto-pause on relaunch (user mental model: "quit = paused").
    // Under the worked-seconds model this is a free flag flip:
    // workedMs was preserved correctly across the quit, so on
    // relaunch we just force-pause and the user clicks Resume to
    // continue. Already-paused sessions stay paused (the test below
    // is idempotent). Unlike the wall-clock-era pause-on-relaunch
    // milestone, no math is needed — no checkpoint lookup, no
    // pausedAtMs computation, no orphan-cap clamp. Just the flag.
    let restored = persisted.focus;
    if (restored.mode === "active" && !restored.paused) {
      restored = { ...restored, paused: true };
    }

    // S.2 R3 — flush the (possibly migrated, possibly auto-paused)
    // shape to localStorage immediately so the next launch sees the
    // new shape and the migration shim becomes a no-op. Without
    // this, every boot re-runs the shim against unchanged old-shape
    // JSON.
    persistFocus(restored);

    set({ currentPage: "focus", focus: restored });
  },
  togglePauseFocus: () => {
    // S.5 — flag flip only. Under the worked-seconds model, pause is
    // a flag; tickFocus is gated on !paused, so workedMs naturally
    // freezes during pauses. The legacy pausedAtMs/pausedAccumMs
    // accounting (M2.1) is no longer needed — wall-clock-derived
    // queries are gone (this commit), the displayed counter reads
    // focus.workedMs directly (S.3), and break_seconds no longer
    // captures pause time (the paused-time portion of getBreakSeconds
    // dropped this commit).
    const f = get().focus;
    if (!f || f.mode !== "active") return;
    const next: FocusState = { ...f, paused: !f.paused };
    persistFocus(next);
    set({ focus: next });
  },
  adjustFocusElapsed: (desiredElapsedMs) => {
    // S.5 — workedMs write only. The legacy back-solve against
    // pausedAccumMs is gone; wall-clock-derived queries are gone too.
    // The displayed counter reads focus.workedMs.
    const f = get().focus;
    if (!f || f.mode !== "active") return;
    const next: FocusState = { ...f, workedMs: Math.max(0, desiredElapsedMs) };
    persistFocus(next);
    set({ focus: next });
  },
  tickFocus: (deltaMs) => {
    // S.2 — increments workedMs while the session is running. No-op if
    // focus is null, in preview mode, or paused. Caller passes the
    // wall-clock delta since the last tick (Date.now() - lastTickAt),
    // not a fixed cadence — JS event-loop stalls or background-tab
    // throttling don't drift the counter; a stalled tick catches up
    // on the next iteration.
    //
    // Persists on every call. localStorage write-per-second is cheap;
    // the persisted value IS the answer if the app crashes.
    //
    // Wall-clock fields (startedAt/pausedAtMs/pausedAccumMs) are NOT
    // touched here — the dual-write seam in S.4 keeps them maintained
    // separately so wall-clock-derived queries continue to work
    // until the S.5 atomic cutover.
    const f = get().focus;
    if (!f || f.mode !== "active" || f.paused) return;
    if (deltaMs <= 0) return;
    const next: FocusState = { ...f, workedMs: f.workedMs + deltaMs };
    persistFocus(next);
    set({ focus: next });
  },
  setPendingDetailTask: (task) => set({ pendingDetailTask: task }),
  openTaskDetail: (id, opts) =>
    set({
      selectedTaskDetailId: id,
      taskDetailAutoFocusTitle: opts?.autoFocusTitle === true,
    }),
  closeTaskDetail: () =>
    set({ selectedTaskDetailId: null, taskDetailAutoFocusTitle: false }),
  cacheTasks: (tasks) => {
    if (tasks.length === 0) return;
    set((s) => {
      // Build a fresh Map so Zustand subscribers see a new reference and
      // re-evaluate. Mutating the existing Map would be invisible.
      const next = new Map(s.tasksByIdCache);
      for (const t of tasks) next.set(t.id, t);
      return { tasksByIdCache: next };
    });
  },
  setWeeklyPlannerTab: (tab) => set({ weeklyPlannerTab: tab }),
  toggleSidebar: () => {
    const s = get();
    const isFocusScreen = s.currentPage === "focus";
    if (isFocusScreen) {
      set({ sidebarFocusExpanded: !s.sidebarFocusExpanded });
    } else {
      const next = !s.sidebarCollapsed;
      persistSidebarCollapsed(next);
      set({ sidebarCollapsed: next });
    }
  },
  setSidebarCollapsed: (collapsed) => {
    const s = get();
    const isFocusScreen = s.currentPage === "focus";
    if (isFocusScreen) {
      // On focus screens, "expanded" maps to focusExpanded=true.
      set({ sidebarFocusExpanded: !collapsed });
    } else {
      persistSidebarCollapsed(collapsed);
      set({ sidebarCollapsed: collapsed });
    }
  },
}));
