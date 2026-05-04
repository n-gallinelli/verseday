import { create } from "zustand";
import type { Page, Task } from "../types";

const FOCUS_STORAGE_KEY = "verseday_focus";

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
  setPage: (page: Page) => void;
  goBack: () => void;
  setSelectedDate: (date: string) => void;
  setSelectedWeek: (date: string) => void;
  openProject: (id: number) => void;
  startFocus: (task: Task, timeEntryId: number, previousPage: Page, priorElapsedMs?: number) => void;
  stopFocus: () => Page;
  restoreFocus: () => void;
  setPendingDetailTask: (task: Task | null) => void;
}

function todayString(): string {
  return new Date().toISOString().split("T")[0];
}

function mondayOfWeek(date: Date = new Date()): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday = 1
  d.setDate(d.getDate() + diff);
  return d.toISOString().split("T")[0];
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
    // FocusLanding all do). DailyPlanner deliberately does not, so the
    // user can keep planning while the timer runs in the background with
    // a live counter on the focused task row.
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
}));
