import { useEffect, useRef, useState } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import FocusPip from "./components/FocusPip";
import Sidebar from "./components/Sidebar";
import DailyPlanner from "./pages/DailyPlanner";
import Projects from "./pages/Projects";
import ProjectDetail from "./pages/ProjectDetail";
import FocusMode from "./pages/FocusMode";
import DailyShutdown from "./pages/DailyShutdown";
import WeeklyPlanner from "./pages/WeeklyPlanner";
import WeeklyShutdown from "./pages/WeeklyShutdown";
import Dashboard from "./pages/Dashboard";
import WrapUpReminder from "./components/WrapUpReminder";
import { useAppStore } from "./stores/appStore";
import {
  closeOrphanedTimeEntries,
  getTasksForDate,
  startTimeEntry,
  getWorkedMinutesForTask,
} from "./db/queries";
import type { Page } from "./types";

const PAGE_SHORTCUTS: Record<string, Page> = {
  "1": "daily",
  "2": "daily_shutdown",
  "3": "weekly",
  "4": "shutdown",
  "5": "projects",
  "6": "dashboard",
};

function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    (el as HTMLElement).isContentEditable
  );
}

export default function App() {
  // PiP mini window mode
  if (window.location.hash === "#focus-pip") {
    return (
      <ErrorBoundary>
        <FocusPip />
      </ErrorBoundary>
    );
  }

  return <MainApp />;
}

function MainApp() {
  const { currentPage, focus, restoreFocus, setPage, startFocus, pageHistory, goBack } = useAppStore();
  const startupDone = useRef(false);
  const [pageKey, setPageKey] = useState(0);
  const prevPageRef = useRef(currentPage);

  // Trigger fade-in on page change
  useEffect(() => {
    if (prevPageRef.current !== currentPage) {
      prevPageRef.current = currentPage;
      setPageKey((k) => k + 1);
    }
  }, [currentPage]);

  useEffect(() => {
    if (startupDone.current) return;
    startupDone.current = true;

    async function startup() {
      restoreFocus();
      const restored = useAppStore.getState().focus;
      if (!restored) {
        await closeOrphanedTimeEntries();
      }
    }
    startup();
  }, [restoreFocus]);

  // Global keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;

      // Cmd+1-5: page navigation
      if (meta && !e.shiftKey && PAGE_SHORTCUTS[e.key]) {
        e.preventDefault();
        setPage(PAGE_SHORTCUTS[e.key]);
        return;
      }

      // Cmd+N: focus task input on current page
      if (meta && e.key === "n") {
        e.preventDefault();
        const input = document.querySelector<HTMLInputElement>(
          'input[placeholder*="task"], input[placeholder*="Add"]'
        );
        if (input) input.focus();
        return;
      }

      // Escape: close overlays/pickers (blur active element)
      if (e.key === "Escape" && isInputFocused()) {
        (document.activeElement as HTMLElement)?.blur();
        return;
      }

      // Global shortcuts (only when not typing)
      if (!isInputFocused()) {
        // F: start focus on next task today
        if (e.key === "f" && !meta) {
          e.preventDefault();
          if (useAppStore.getState().focus) return; // already in focus
          (async () => {
            try {
              const today = new Date().toISOString().split("T")[0];
              const tasks = await getTasksForDate(today);
              const next = tasks.find((t) => t.status !== "done");
              if (!next) return;
              const priorMinutes = await getWorkedMinutesForTask(next.id);
              const priorMs = priorMinutes * 60 * 1000;
              const entryId = await startTimeEntry(next.id, "tracked");
              const prevPage = useAppStore.getState().currentPage;
              startFocus(next, entryId, prevPage, priorMs);
            } catch {
              // silent
            }
          })();
          return;
        }

        const page = useAppStore.getState().currentPage;

        // Focus Mode: Space to pause/resume
        if (page === "focus" && e.key === " ") {
          e.preventDefault();
          // Dispatch a custom event that FocusMode listens for
          window.dispatchEvent(new CustomEvent("verseday:toggle-pause"));
          return;
        }

        // Daily: Cmd+Shift+S shutdown mode
        if (page === "daily" && meta && e.key === "s" && e.shiftKey) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent("verseday:toggle-shutdown-mode"));
          return;
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [setPage]);

  // Focus mode is a full-screen overlay
  if (currentPage === "focus" && focus) {
    return (
      <ErrorBoundary>
        <FocusMode />
      </ErrorBoundary>
    );
  }

  function renderPage() {
    switch (currentPage) {
      case "daily":
        return <DailyPlanner />;
      case "daily_shutdown":
        return <DailyShutdown />;
      case "weekly":
        return <WeeklyPlanner />;
      case "shutdown":
        return <WeeklyShutdown />;
      case "projects":
        return <Projects />;
      case "project_detail":
        return <ProjectDetail />;
      case "dashboard":
        return <Dashboard />;
      default:
        return <DailyPlanner />;
    }
  }

  return (
    <ErrorBoundary>
      <div className="flex h-screen overflow-hidden bg-[#f5f4f0]">
        <Sidebar />
        <WrapUpReminder />
        <main
          key={pageKey}
          className="flex-1 overflow-hidden flex flex-col animate-fade-in"
        >
          {pageHistory.length > 0 && (
            <div className="flex-shrink-0 px-4 py-1.5 border-b border-black/[0.05]">
              <button
                onClick={goBack}
                className="flex items-center gap-1 text-[11px] text-black/30 cursor-pointer hover:text-black/50 transition-colors"
                title="Go back"
              >
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 1L3 6l5 5" />
                </svg>
                Back
              </button>
            </div>
          )}
          {renderPage()}
        </main>
      </div>
    </ErrorBoundary>
  );
}
