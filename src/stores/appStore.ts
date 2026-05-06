import { create } from "zustand";
import type { Page, Task } from "../types";
import { todayString, mondayOfWeek } from "../utils/dates";

const FOCUS_STORAGE_KEY = "verseday_focus";
const SIDEBAR_COLLAPSED_KEY = "verseday_sidebar_collapsed";

interface FocusState {
  task: Task;
  timeEntryId: number;
  startedAt: number; // Date.now() timestamp
  previousPage: Page;
  priorElapsedMs: number; // accumulated time from previous sessions
}

interface AppState {
  currentPage: Page;
  pageHistory: Page[];
  selectedDate: string;
  selectedWeek: string;
  selectedProjectId: number | null;
  focus: FocusState | null;
  pendingDetailTask: Task | null;
  /** Persisted user preference for collapsed sidebar (non-focus pages). */
  sidebarCollapsed: boolean;
  /** Ephemeral expand override on focus screens — resets on remount. */
  sidebarFocusExpanded: boolean;
  /** Last tab the user was on inside the Weekly Planner. Survives
   *  navigating away and back within a session so the user returns to
   *  whatever they had open (plan vs schedule). */
  weeklyPlannerTab: "plan" | "schedule";
  setWeeklyPlannerTab: (tab: "plan" | "schedule") => void;
  setPage: (page: Page) => void;
  goBack: () => void;
  setSelectedDate: (date: string) => void;
  setSelectedWeek: (date: string) => void;
  openProject: (id: number) => void;
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
    return JSON.parse(raw) as FocusState;
  } catch {
    localStorage.removeItem(FOCUS_STORAGE_KEY);
    return null;
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  currentPage: "daily",
  pageHistory: [],
  selectedDate: todayString(),
  selectedWeek: mondayOfWeek(),
  selectedProjectId: null,
  focus: null,
  pendingDetailTask: null,
  sidebarCollapsed: loadPersistedSidebarCollapsed(),
  sidebarFocusExpanded: false,
  weeklyPlannerTab: "plan",
  setPage: (page) => {
    const prev = get().currentPage;
    if (prev !== page) {
      set((s) => ({
        currentPage: page,
        pageHistory: [...s.pageHistory.slice(-19), prev],
      }));
    }
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
  startFocus: (task, timeEntryId, previousPage, priorElapsedMs = 0) => {
    // Sets focus state only — does NOT navigate to the immersive Focus page.
    // Callers that want the full-screen timer experience follow up with
    // setPage("focus") themselves (App.tsx F hotkey, ProjectDetail, and
    // FocusMode's own auto-start all do). DailyPlanner deliberately does
    // not, so the user can keep planning while the timer runs in the
    // background with a live counter on the focused task row.
    const focus = { task, timeEntryId, startedAt: Date.now(), previousPage, priorElapsedMs };
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
    set({ focus: null, currentPage: prev });
    return prev;
  },
  restoreFocus: () => {
    const persisted = loadPersistedFocus();
    if (persisted) {
      set({ currentPage: "focus", focus: persisted });
    }
  },
  setPendingDetailTask: (task) => set({ pendingDetailTask: task }),
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
