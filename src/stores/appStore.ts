import { create } from "zustand";
import type { Page, Task } from "../types";
import { todayString, mondayOfWeek } from "../utils/dates";
import {
  deleteTask as dbDeleteTask,
  getTaskById,
  getTasksForDate,
  getTasksForProject,
  getTasksForWeek,
  getTimeEntryById,
  setManualWorkedMinutes as dbSetManualWorkedMinutes,
  setTaskStatusFromUI,
  updateTask as dbUpdateTask,
  updateTimeEntryWorkedSeconds,
} from "../db/queries";
import type { UpdateTaskInput } from "../db/queries";

/** Returns the local-tz Monday-ISO of the week containing `dateIso`.
 *  Anchors on T00:00:00 to keep DST transitions from shifting the bucket. */
function weekStartFromDate(dateIso: string): string {
  return mondayOfWeek(new Date(dateIso + "T00:00:00"));
}

/** Returns the Sunday-ISO closing the week starting at `mondayIso`. */
function weekEndFromMonday(mondayIso: string): string {
  const d = new Date(mondayIso + "T00:00:00");
  d.setDate(d.getDate() + 6);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Module-level stable empty list. Returning the same array reference for
 *  every "no entry" lookup keeps subscribers from re-rendering on
 *  unrelated store changes. */
const EMPTY_ID_LIST: number[] = [];

/** Append `id` to the index entry at `key` if not already present.
 *  Returns a NEW Map only when the entry actually changed, so unchanged
 *  loads don't churn subscriber identity. */
function indexAppend<K>(idx: Map<K, number[]>, key: K, id: number): Map<K, number[]> {
  const existing = idx.get(key);
  if (existing && existing.includes(id)) return idx;
  const next = new Map(idx);
  next.set(key, existing ? [...existing, id] : [id]);
  return next;
}

/** Remove `id` from the index entry at `key`. Returns a NEW Map only
 *  when the id was actually present. */
function indexRemove<K>(idx: Map<K, number[]>, key: K, id: number): Map<K, number[]> {
  const existing = idx.get(key);
  if (!existing || !existing.includes(id)) return idx;
  const filtered = existing.filter((x) => x !== id);
  const next = new Map(idx);
  if (filtered.length === 0) next.delete(key);
  else next.set(key, filtered);
  return next;
}

/** State patch: insert `task` into tasksById and the relevant secondary
 *  indices. Pure — caller passes to set((s) => ...). */
function withTaskInserted(s: AppState, task: Task): Partial<AppState> {
  const nextMap = new Map(s.tasksById);
  nextMap.set(task.id, task);
  let nextDateIdx = s.taskIdsByDate;
  let nextWeekIdx = s.taskIdsByWeek;
  let nextProjIdx = s.taskIdsByProject;
  if (task.date_scheduled !== null) {
    nextDateIdx = indexAppend(nextDateIdx, task.date_scheduled, task.id);
    nextWeekIdx = indexAppend(nextWeekIdx, weekStartFromDate(task.date_scheduled), task.id);
  }
  if (task.project_id !== null) {
    nextProjIdx = indexAppend(nextProjIdx, task.project_id, task.id);
  }
  return {
    tasksById: nextMap,
    taskIdsByDate: nextDateIdx,
    taskIdsByWeek: nextWeekIdx,
    taskIdsByProject: nextProjIdx,
  };
}

/** State patch: drop `task` from tasksById and any index it appears in. */
function withTaskRemoved(s: AppState, task: Task): Partial<AppState> {
  const nextMap = new Map(s.tasksById);
  nextMap.delete(task.id);
  let nextDateIdx = s.taskIdsByDate;
  let nextWeekIdx = s.taskIdsByWeek;
  let nextProjIdx = s.taskIdsByProject;
  if (task.date_scheduled !== null) {
    nextDateIdx = indexRemove(nextDateIdx, task.date_scheduled, task.id);
    nextWeekIdx = indexRemove(nextWeekIdx, weekStartFromDate(task.date_scheduled), task.id);
  }
  if (task.project_id !== null) {
    nextProjIdx = indexRemove(nextProjIdx, task.project_id, task.id);
  }
  return {
    tasksById: nextMap,
    taskIdsByDate: nextDateIdx,
    taskIdsByWeek: nextWeekIdx,
    taskIdsByProject: nextProjIdx,
  };
}

/** State patch: replace tasksById[id] with `after` and update any index
 *  whose membership changed (date_scheduled or project_id moved between
 *  buckets). The before/after framing is what makes this incremental
 *  rather than rebuild-from-scratch. */
function withTaskMutated(s: AppState, before: Task, after: Task): Partial<AppState> {
  const nextMap = new Map(s.tasksById);
  nextMap.set(after.id, after);
  let nextDateIdx = s.taskIdsByDate;
  let nextWeekIdx = s.taskIdsByWeek;
  let nextProjIdx = s.taskIdsByProject;
  if (before.date_scheduled !== after.date_scheduled) {
    if (before.date_scheduled !== null) {
      nextDateIdx = indexRemove(nextDateIdx, before.date_scheduled, after.id);
      nextWeekIdx = indexRemove(nextWeekIdx, weekStartFromDate(before.date_scheduled), after.id);
    }
    if (after.date_scheduled !== null) {
      nextDateIdx = indexAppend(nextDateIdx, after.date_scheduled, after.id);
      nextWeekIdx = indexAppend(nextWeekIdx, weekStartFromDate(after.date_scheduled), after.id);
    }
  }
  if (before.project_id !== after.project_id) {
    if (before.project_id !== null) {
      nextProjIdx = indexRemove(nextProjIdx, before.project_id, after.id);
    }
    if (after.project_id !== null) {
      nextProjIdx = indexAppend(nextProjIdx, after.project_id, after.id);
    }
  }
  return {
    tasksById: nextMap,
    taskIdsByDate: nextDateIdx,
    taskIdsByWeek: nextWeekIdx,
    taskIdsByProject: nextProjIdx,
  };
}

const FOCUS_STORAGE_KEY = "verseday_focus";
const SIDEBAR_COLLAPSED_KEY = "verseday_sidebar_collapsed";

// Discriminated union: a focus session is either *preview* (task picked,
// shown on the focus screen, but no time entry created — what the user
// sees when they click the Focus icon) or *active* (running session with
// a real time entry). The mode tag lets TypeScript narrow timeEntryId /
// startedAt accesses to the active branch and catch any code path that
// touches them in preview by mistake.
// S.6 — wall-clock fields (startedAt, pausedAtMs, pausedAccumMs)
// retired. workedMs is the sole source of truth for session-only
// elapsed; tickFocus increments it while running, togglePauseFocus
// flips a flag that gates the increment. taskId remains the canonical
// task reference (M2.2); selectFocusedTask resolves task data from the
// canonical tasksById map (M3.2.a).
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
      previousPage: Page;
      priorElapsedMs: number;
      /** Pause is a flag — tickFocus is gated on !paused, so workedMs
       *  freezes naturally during pauses. No wall-clock bookkeeping. */
      paused: boolean;
      /** Worked time this session, in ms. Incremented by tickFocus
       *  every ~1s while running. The live truth between start and
       *  stop; written to time_entries.worked_seconds on stop. */
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
  /** Canonical store-owned task map (M3.2.a). Single source of truth
   *  for task data in-memory; SQL is durable truth, this is the live
   *  mirror. Populated by load* actions (and transitionally by
   *  cacheTasks until M3.2.b.5 retires it). Per-row subscribers read
   *  via selectTaskById; the detail-overlay host and focus screen
   *  resolve their tasks from here via selectTaskDetailTask /
   *  selectFocusedTask. */
  tasksById: Map<number, Task>;
  /** Secondary index: task IDs grouped by date_scheduled (NULL-scheduled
   *  tasks are NOT in this index). Maintained on every load* / updateTask
   *  / deleteTask / insertTask call. Read via selectTaskIdsByDate. */
  taskIdsByDate: Map<string, number[]>;
  /** Secondary index: task IDs grouped by project_id (NULL-project tasks
   *  are NOT in this index — consumers that want them filter the canonical
   *  map directly). Read via selectTaskIdsByProject. */
  taskIdsByProject: Map<number, number[]>;
  /** Secondary index: task IDs grouped by Monday-ISO of the week the
   *  task is scheduled in. NULL-scheduled tasks are NOT in this index.
   *  Read via selectTaskIdsByWeek. */
  taskIdsByWeek: Map<string, number[]>;
  /** Open the singleton task detail overlay for `id`. Pass
   *  `{ autoFocusTitle: true }` to focus the title input on open
   *  (used by quick-add flows that create the task in draft state). */
  openTaskDetail: (id: number, opts?: { autoFocusTitle?: boolean }) => void;
  /** Close the singleton task detail overlay. */
  closeTaskDetail: () => void;
  /** Write-through primer for the canonical map. Screens that already
   *  hold a `Task[]` from a manual SQL fetch call this to make the
   *  detail-overlay host's resolution synchronous. M3.2.b.5 retires
   *  this in favor of the load* actions; until then, every `cacheTasks`
   *  call also rebuilds any affected secondary-index entries it can
   *  derive (M3.2.a — see implementation). */
  cacheTasks: (tasks: Task[]) => void;
  /** Load tasks for a specific date. Writes each task to tasksById
   *  and replaces taskIdsByDate[date] with the loaded ID list. Idempotent.
   *  On DB failure: leaves prior state intact and surfaces error via
   *  console.error (UI surfaces error banners through their own paths). */
  loadTasksForDate: (date: string) => Promise<void>;
  /** Load tasks for a project. Failure-path: prior state intact +
   *  console.error. Refilters `external_dismissal_reason IS NULL` per
   *  the underlying query. */
  loadTasksForProject: (projectId: number) => Promise<void>;
  /** Load tasks for a week (Monday-ISO key). Failure-path: prior state
   *  intact + console.error. */
  loadTasksForWeek: (weekStart: string) => Promise<void>;
  /** Optimistic patch + DB write. Updates tasksById and any affected
   *  secondary indices, then writes through to SQL.
   *
   *  Failure path (Verse req): on DB write rejection, the action
   *  refetches the task via getTaskById and writes truth back to the
   *  canonical map (and re-derives index membership). It also
   *  console.error's with the original patch and the error so the
   *  failure is debuggable. Callers should still surface user-visible
   *  errors via their own paths until banner/toast infra exists. */
  updateTask: (patch: UpdateTaskInput) => Promise<void>;
  /** Optimistic delete + DB write. Failure path: refetch the task; if
   *  it still exists, restore it to the map and indices; if not (race
   *  with another delete), leave deleted. console.error on any
   *  unexpected exception. */
  deleteTaskAction: (id: number) => Promise<void>;
  /** Status-change with the existing UI-broadcast side-effect (FocusMode
   *  listens to verseday:task-status-changed for cross-surface
   *  auto-stop). Optimistic map write; failure-path refetches truth and
   *  console.error's. */
  setTaskStatus: (id: number, status: Task["status"]) => Promise<void>;
  /** Set manual worked minutes on a task. The DB query inserts/updates
   *  a synthetic time_entries row; nothing about the task row itself
   *  changes, so the canonical map only needs a touch (refetch) on
   *  failure. console.error on failure. */
  setTaskWorkedMinutesAction: (id: number, minutes: number) => Promise<void>;
  /** Insert a freshly-created task into tasksById and the relevant
   *  secondary indices. Called by code paths that create tasks
   *  (quick-add, schedule-tab drag-create, etc.). Pure in-memory
   *  side-effect — caller has already DB-inserted. */
  insertTask: (task: Task) => void;
  /** Open-state for the singleton SummaryOverlay (day-summary modal).
   *  `null` = closed. Read by the singleton SummaryOverlayHost mounted at
   *  the App shell. Not persisted — overlay always closes on app restart
   *  (matches selectedTaskDetailId precedent). M3.1.a additive seam — no
   *  callers wire this yet; per-screen useState mounts retire in M3.1.b. */
  summaryOverlay:
    | { kind: "daily"; anchorDate: string }
    | { kind: "weekly"; anchorDate: string }
    | null;
  /** Open the singleton SummaryOverlay. */
  openSummaryOverlay: (kind: "daily" | "weekly", anchorDate: string) => void;
  /** Close the singleton SummaryOverlay. */
  closeSummaryOverlay: () => void;
  /** Open-state for the singleton SunsetOverlay (shutdown-completion
   *  animation). Read by SunsetOverlayHost mounted at the App shell. Not
   *  persisted. M3.1.a additive — wires up in M3.1.b. */
  sunsetOverlayOpen: boolean;
  /** Open the singleton SunsetOverlay. */
  openSunsetOverlay: () => void;
  /** Close the singleton SunsetOverlay. */
  closeSunsetOverlay: () => void;
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
    if (active.timeEntryId === undefined) {
      // Active sessions need a time entry id. Corrupt.
      localStorage.removeItem(FOCUS_STORAGE_KEY);
      return null;
    }
    // S.6 — defensive retention of the pre-S.2 in-flight migration shim.
    // Modern persisted state has workedMs and lacks startedAt/pausedAtMs/
    // pausedAccumMs (S.6 retired those). Legacy state (from a build
    // pre-dating S.2) has the wall-clock fields but no workedMs.
    // - workedMs present → use it directly. No-op shim.
    // - workedMs missing → derive from the legacy wall-clock formula
    //   one final time, then immediately persist the modern shape
    //   (restoreFocus calls persistFocus right after — R3) so this
    //   path runs exactly once per legacy persisted entry.
    //
    // If the previous session was running (paused === false), force-
    // pause on derive — the worked-seconds model treats quit time as
    // not-worked, but the wall-clock formula included quit-window
    // elapsed up to the moment of relaunch. Force-pause prevents
    // ticking from that inflated value when the user resumes.
    const paused = active.paused ?? false;
    const persistedWorkedMs = (active as Partial<Extract<FocusState, { mode: "active" }>>)
      .workedMs;
    let workedMs: number;
    let resolvedPaused = paused;
    if (persistedWorkedMs !== undefined) {
      workedMs = persistedWorkedMs;
    } else {
      // Legacy derive path. Read the (now-extinct) wall-clock fields
      // from `parsed` directly — they're not on the FocusState type
      // anymore, but JSON.parse returns them if present in storage.
      const legacy = parsed as Partial<{
        startedAt: number;
        pausedAtMs: number | null;
        pausedAccumMs: number;
      }>;
      const startedAt = legacy.startedAt;
      if (startedAt === undefined) {
        // No workedMs and no startedAt → can't derive. Drop.
        localStorage.removeItem(FOCUS_STORAGE_KEY);
        return null;
      }
      const legacyPausedAtMs = legacy.pausedAtMs ?? null;
      const legacyPausedAccumMs = legacy.pausedAccumMs ?? 0;
      const now = Date.now();
      const openPause = paused && legacyPausedAtMs !== null ? now - legacyPausedAtMs : 0;
      workedMs = Math.max(0, now - startedAt - legacyPausedAccumMs - openPause);
      // Force-pause if the legacy state was running.
      if (!paused) resolvedPaused = true;
    }
    return {
      focus: {
        mode: "active",
        taskId,
        timeEntryId: active.timeEntryId,
        previousPage: active.previousPage ?? "daily",
        priorElapsedMs: active.priorElapsedMs ?? 0,
        paused: resolvedPaused,
        workedMs,
      },
      legacyTaskSnapshot: legacyTask ?? null,
    };
  } catch {
    localStorage.removeItem(FOCUS_STORAGE_KEY);
    return null;
  }
}

/** Selector: resolves the open detail overlay's task from the canonical
 *  tasksById map (M3.2.a). Returns null when the overlay is closed or
 *  the canonical map hasn't been primed for this id yet — the host's
 *  cache-miss effect issues a one-shot getTaskById fetch in that case
 *  to populate the map. */
export function selectTaskDetailTask(state: AppState): Task | null {
  const id = state.selectedTaskDetailId;
  if (id === null) return null;
  return state.tasksById.get(id) ?? null;
}

/** Selector: resolves the focused task from canonical tasksById so a
 *  rename or edit made elsewhere in the app re-renders subscribers
 *  immediately (M3.2.a).
 *
 *  Returns null when there is no focus session, or briefly during the
 *  load window after restoreFocus when the modern persisted shape has
 *  only taskId (no embedded snapshot to prime from). FocusMode and the
 *  PiP broadcast handle the null case. */
export function selectFocusedTask(state: AppState): Task | null {
  const f = state.focus;
  if (!f) return null;
  return state.tasksById.get(f.taskId) ?? null;
}

/** Selector: per-row task lookup. Stable reference — the same `Task`
 *  identity flows out across renders unless the entry was rewritten.
 *  Used by TaskCard's per-row subscription (M3.2.b.4). */
export function selectTaskById(state: AppState, id: number): Task | undefined {
  return state.tasksById.get(id);
}

/** Selector: ordered task IDs scheduled on `date`. Returns the stable
 *  module-level empty list when no entry has been loaded for that date,
 *  so subscribers don't churn on unrelated mutations. */
export function selectTaskIdsByDate(state: AppState, date: string): number[] {
  return state.taskIdsByDate.get(date) ?? EMPTY_ID_LIST;
}

/** Selector: ordered task IDs for `projectId`. */
export function selectTaskIdsByProject(state: AppState, projectId: number): number[] {
  return state.taskIdsByProject.get(projectId) ?? EMPTY_ID_LIST;
}

/** Selector: ordered task IDs scheduled in the week starting at
 *  `weekStart` (Monday-ISO). */
export function selectTaskIdsByWeek(state: AppState, weekStart: string): number[] {
  return state.taskIdsByWeek.get(weekStart) ?? EMPTY_ID_LIST;
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
  tasksById: new Map(),
  taskIdsByDate: new Map(),
  taskIdsByProject: new Map(),
  taskIdsByWeek: new Map(),
  summaryOverlay: null,
  sunsetOverlayOpen: false,
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
    // M2.2 — primes the canonical tasksById map so selectFocusedTask
    // resolves synchronously. The store no longer carries a task
    // snapshot; consumers read live task data through the selector.
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
      previousPage: f.previousPage,
      priorElapsedMs: f.priorElapsedMs,
      paused: false,
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
    const current = get().tasksById.get(f.taskId);
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
      previousPage,
      priorElapsedMs,
      paused: false,
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
  openSummaryOverlay: (kind, anchorDate) =>
    set({ summaryOverlay: { kind, anchorDate } }),
  closeSummaryOverlay: () => set({ summaryOverlay: null }),
  openSunsetOverlay: () => set({ sunsetOverlayOpen: true }),
  closeSunsetOverlay: () => set({ sunsetOverlayOpen: false }),
  cacheTasks: (tasks) => {
    if (tasks.length === 0) return;
    set((s) => {
      // M3.2.a — writes to the canonical tasksById map. Until M3.2.b.5
      // retires this action entirely, callers can keep priming the map
      // opportunistically. Index entries are NOT touched here — load*
      // and update* are the canonical maintainers; cacheTasks is just
      // a fast path that lets the detail-overlay host resolve tasks
      // before screens migrate to selectors.
      const nextMap = new Map(s.tasksById);
      for (const t of tasks) nextMap.set(t.id, t);
      return { tasksById: nextMap };
    });
  },
  loadTasksForDate: async (date) => {
    try {
      const list = await getTasksForDate(date);
      set((s) => {
        const nextMap = new Map(s.tasksById);
        const ids: number[] = [];
        for (const t of list) {
          nextMap.set(t.id, t);
          ids.push(t.id);
        }
        const nextDateIdx = new Map(s.taskIdsByDate);
        nextDateIdx.set(date, ids);
        return { tasksById: nextMap, taskIdsByDate: nextDateIdx };
      });
    } catch (err) {
      console.error("[appStore] loadTasksForDate failed", { date, err });
    }
  },
  loadTasksForProject: async (projectId) => {
    try {
      const list = await getTasksForProject(projectId);
      set((s) => {
        const nextMap = new Map(s.tasksById);
        const ids: number[] = [];
        for (const t of list) {
          nextMap.set(t.id, t);
          ids.push(t.id);
        }
        const nextProjIdx = new Map(s.taskIdsByProject);
        nextProjIdx.set(projectId, ids);
        return { tasksById: nextMap, taskIdsByProject: nextProjIdx };
      });
    } catch (err) {
      console.error("[appStore] loadTasksForProject failed", { projectId, err });
    }
  },
  loadTasksForWeek: async (weekStart) => {
    try {
      const list = await getTasksForWeek(weekStart, weekEndFromMonday(weekStart));
      set((s) => {
        const nextMap = new Map(s.tasksById);
        const ids: number[] = [];
        for (const t of list) {
          nextMap.set(t.id, t);
          ids.push(t.id);
        }
        const nextWeekIdx = new Map(s.taskIdsByWeek);
        nextWeekIdx.set(weekStart, ids);
        return { tasksById: nextMap, taskIdsByWeek: nextWeekIdx };
      });
    } catch (err) {
      console.error("[appStore] loadTasksForWeek failed", { weekStart, err });
    }
  },
  updateTask: async (patch) => {
    const current = get().tasksById.get(patch.id);
    // No current entry → caller is racing a delete. Run the DB write
    // anyway (caller's intent stands) but don't mutate the map; on
    // success we leave the map empty for this id, which is correct
    // (the task isn't currently visible anywhere).
    try {
      if (current) {
        const next: Task = {
          ...current,
          title: patch.title,
          project_id: patch.projectId,
          estimated_minutes: patch.estimatedMinutes,
          priority: patch.priority,
          notes: patch.notes,
          date_scheduled: patch.dateScheduled,
          due_date: patch.dueDate === undefined ? current.due_date : patch.dueDate,
        };
        // Optimistic in-memory write before the DB call so the UI updates
        // before the await completes.
        set((s) => withTaskMutated(s, current, next));
      }
      await dbUpdateTask(patch);
    } catch (err) {
      console.error("[appStore] updateTask failed — refetching truth", {
        patch,
        err,
      });
      // Failure path (Verse req): refetch and write truth back.
      try {
        const fresh = await getTaskById(patch.id);
        const before = get().tasksById.get(patch.id);
        if (fresh) {
          if (before) set((s) => withTaskMutated(s, before, fresh));
          else set((s) => withTaskInserted(s, fresh));
        } else if (before) {
          set((s) => withTaskRemoved(s, before));
        }
      } catch (refetchErr) {
        console.error("[appStore] updateTask refetch also failed", refetchErr);
      }
    }
  },
  deleteTaskAction: async (id) => {
    const current = get().tasksById.get(id);
    if (current) set((s) => withTaskRemoved(s, current));
    try {
      await dbDeleteTask(id);
    } catch (err) {
      console.error("[appStore] deleteTask failed — refetching truth", { id, err });
      try {
        const fresh = await getTaskById(id);
        if (fresh) set((s) => withTaskInserted(s, fresh));
      } catch (refetchErr) {
        console.error("[appStore] deleteTask refetch also failed", refetchErr);
      }
    }
  },
  setTaskStatus: async (id, status) => {
    const current = get().tasksById.get(id);
    if (current) {
      const next: Task = { ...current, status };
      set((s) => withTaskMutated(s, current, next));
    }
    try {
      // Delegates to the existing UI-broadcast helper so FocusMode's
      // verseday:task-status-changed listener keeps firing — that
      // event is OUT OF SCOPE for M3.2 retirement (only -updated and
      // -deleted are retired in M3.2.b.5).
      await setTaskStatusFromUI(id, status);
    } catch (err) {
      console.error("[appStore] setTaskStatus failed — refetching truth", {
        id,
        status,
        err,
      });
      try {
        const fresh = await getTaskById(id);
        const before = get().tasksById.get(id);
        if (fresh && before) set((s) => withTaskMutated(s, before, fresh));
      } catch (refetchErr) {
        console.error("[appStore] setTaskStatus refetch also failed", refetchErr);
      }
    }
  },
  setTaskWorkedMinutesAction: async (id, minutes) => {
    try {
      await dbSetManualWorkedMinutes(id, minutes);
      // The query mutates time_entries, not the tasks row — the canonical
      // Task entry doesn't change. workedMinutes-by-task is M3.3 territory.
    } catch (err) {
      console.error("[appStore] setTaskWorkedMinutes failed", { id, minutes, err });
    }
  },
  insertTask: (task) => {
    set((s) => withTaskInserted(s, task));
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
