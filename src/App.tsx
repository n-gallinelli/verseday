import { useEffect, useRef, useState } from "react";
import { register } from "@tauri-apps/plugin-global-shortcut";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { invoke } from "@tauri-apps/api/core";
import ErrorBoundary from "./components/ErrorBoundary";
import FocusPip from "./components/FocusPip";
import QuickAdd from "./pages/QuickAdd";
import Sidebar from "./components/Sidebar";
import DailyPlanner from "./pages/DailyPlanner";
import Projects from "./pages/Projects";
import ProjectDetail from "./pages/ProjectDetail";
import FocusMode from "./pages/FocusMode";
import DailyShutdown from "./pages/DailyShutdown";
import WeeklyPlanner from "./pages/WeeklyPlanner";
import WeeklyShutdown from "./pages/WeeklyShutdown";
import Dashboard from "./pages/Dashboard";
import Settings from "./pages/Settings";
import FocusLanding from "./pages/FocusLanding";
import PastShutdowns from "./pages/PastShutdowns";
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
  "0": "focus_landing",
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

  // Quick-add overlay window — small frameless bar for global task capture.
  if (window.location.hash === "#quick-add") {
    return (
      <ErrorBoundary>
        <QuickAdd />
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

      // Global quick-add shortcut — toggles the quick-add window.
      // When showing: captures the frontmost app first so dismiss can
      // refocus it. When already visible: dismisses + refocuses.
      try {
        await register("CmdOrCtrl+Shift+A", async () => {
          try {
            const win = await WebviewWindow.getByLabel("quick-add");
            if (!win) {
              console.warn("quick-add window not found");
              return;
            }
            const visible = await win.isVisible();
            if (visible) {
              await invoke("dismiss_quick_add");
            } else {
              await invoke("capture_previous_app");
              await win.center();
              await win.show();
              await win.setFocus();
            }
          } catch (err) {
            console.error("quick-add toggle failed:", err);
          }
        });
      } catch (err) {
        // Most common cause: shortcut already registered by another app or
        // missing macOS Accessibility permission. Log so we don't ship blind.
        console.error("Failed to register Cmd+Shift+A shortcut:", err);
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

  // Resolve which page to show in the background
  // When project_detail is open, show the previous page behind the modal
  const backgroundPage = currentPage === "project_detail"
    ? (pageHistory[pageHistory.length - 1] ?? "projects")
    : currentPage;

  function renderPage(page: Page = backgroundPage) {
    switch (page) {
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
        return <Projects />;
      case "dashboard":
        return <Dashboard />;
      case "settings":
        return <Settings />;
      case "focus_landing":
        return <FocusLanding />;
      case "past_shutdowns":
        return <PastShutdowns />;
      default:
        return <DailyPlanner />;
    }
  }

  return (
    <ErrorBoundary>
      <div className="flex h-screen overflow-hidden bg-base">
        <Sidebar />
        <WrapUpReminder />
        <main
          key={pageKey}
          className="flex-1 overflow-hidden flex flex-col animate-fade-in"
        >
          {renderPage()}
        </main>

        {/* Project Detail Modal Overlay */}
        {currentPage === "project_detail" && (
          <div
            className="fixed inset-0 z-40 flex items-center justify-center"
            onClick={goBack}
          >
            <div className="absolute inset-0 bg-overlay-scrim" />
            <div
              className="relative w-[1080px] max-w-[95vw] max-h-[85vh] bg-base rounded-xl animate-scale-in flex flex-col"
              style={{ boxShadow: "var(--shadow-modal)" }}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Escape") goBack();
              }}
            >
              <ProjectDetail />
            </div>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}
