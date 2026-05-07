import { create } from "zustand";
import type { Page, Task } from "../types";
import { todayString, mondayOfWeek } from "../utils/dates";

const FOCUS_STORAGE_KEY = "verseday_focus";
const SIDEBAR_COLLAPSED_KEY = "verseday_sidebar_collapsed";

// Discriminated union: a focus session is either *preview* (task picked,
// shown on the focus screen, but no time entry created — what the user
// sees when they click the Focus icon) or *active* (running session with
// a real time entry). The mode tag lets TypeScript narrow timeEntryId /
// startedAt accesses to the active branch and catch any code path that
// touches them in preview by mistake.
export type FocusState =
  | {
      mode: "preview";
      task: Task;
      previousPage: Page;
      priorElapsedMs: number;
    }
  | {
      mode: "active";
      task: Task;
      timeEntryId: number;
      startedAt: number; // Date.now() timestamp
      previousPage: Page;
      priorElapsedMs: number;
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
  restoreFocus: () => void;
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

function loadPersistedFocus(): FocusState | null {
  try {
    const raw = localStorage.getItem(FOCUS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FocusState> & { mode?: "preview" | "active" };
    // Back-compat: pre-mode entries default to "active" so users with a
    // live session at upgrade time keep it.
    if (!parsed.mode) {
      return { ...parsed, mode: "active" } as FocusState;
    }
    return parsed as FocusState;
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
    const focus: FocusState = {
      mode: "preview",
      task,
      previousPage,
      priorElapsedMs,
    };
    persistFocus(focus);
    set({ focus });
  },
  activateFocus: (timeEntryId) => {
    const f = get().focus;
    if (!f || f.mode !== "preview") return;
    const next: FocusState = {
      mode: "active",
      task: f.task,
      timeEntryId,
      startedAt: Date.now(),
      previousPage: f.previousPage,
      priorElapsedMs: f.priorElapsedMs,
    };
    persistFocus(next);
    set({ focus: next });
  },
  updateFocusTask: (patch) => {
    const f = get().focus;
    if (!f) return;
    const next = { ...f, task: { ...f.task, ...patch } } as FocusState;
    persistFocus(next);
    set({ focus: next });
  },
  setFocusPriorElapsedMs: (taskId, priorMs) => {
    const f = get().focus;
    if (!f || f.task.id !== taskId) return;
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
    const focus: FocusState = {
      mode: "active",
      task,
      timeEntryId,
      startedAt: Date.now(),
      previousPage,
      priorElapsedMs,
    };
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
  restoreFocus: () => {
    const persisted = loadPersistedFocus();
    if (persisted) {
      set({ currentPage: "focus", focus: persisted });
    }
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
