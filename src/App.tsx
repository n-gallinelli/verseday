import { useEffect, useRef, useState } from "react";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { WebviewWindow, getAllWebviewWindows } from "@tauri-apps/api/webviewWindow";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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
import PastShutdowns from "./pages/PastShutdowns";
import WrapUpReminder from "./components/WrapUpReminder";
import TaskDetailOverlayHost from "./components/TaskDetailOverlayHost";
import SummaryOverlayHost from "./components/SummaryOverlayHost";
import SunsetOverlayHost from "./components/SunsetOverlayHost";
import { useAppStore, markFocusResume } from "./stores/appStore";
import {
  closeOrphanedTimeEntries,
  getTasksForDate,
  startTimeEntry,
  getWorkedMinutesForTask,
} from "./db/queries";
import { startMeetingApproachNotifier } from "./calendar/meetingApproachNotifier";
import type { Page, Task } from "./types";

const PAGE_SHORTCUTS: Record<string, Page> = {
  "0": "focus",
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
      // Defensive: close any stray focus-pip window that survived
      // a previous app session (force-quit, crash, etc). Must run
      // BEFORE restoreFocus() — restoring a persisted focus state
      // immediately mounts FocusMode, which spawns a fresh pip; we
      // don't want a zombie left over to coexist with it.
      try {
        const all = await getAllWebviewWindows();
        await Promise.all(
          all
            .filter((w) => w.label === "focus-pip")
            .map((w) => w.close().catch(() => {}))
        );
      } catch {
        // Non-critical — sweep is a safety net, not load-bearing.
      }

      await restoreFocus();
      // M3.5 — always run orphan cleanup, but exclude the active
      // session's time entry so the persisted focus's open row
      // isn't capped to 4h on every launch. Pre-M3.5 the gate
      // skipped cleanup entirely whenever a focus restored, which
      // left older orphans (from prior crashes between sessions)
      // permanently open.
      const restored = useAppStore.getState().focus;
      const activeEntryId =
        restored?.mode === "active" ? restored.timeEntryId : null;
      await closeOrphanedTimeEntries(activeEntryId);

      // Global quick-add shortcut — toggles the quick-add window.
      // When showing: captures the frontmost app first so dismiss can
      // refocus it. When already visible: dismisses + refocuses.
      try {
        await register("CmdOrCtrl+Shift+A", async (event) => {
          // Plugin fires the handler on BOTH Pressed and Released — without
          // this gate the press shows the window and the release immediately
          // toggles it back off, so the bar disappears the moment the chord
          // is let go.
          if (event.state !== "Pressed") return;
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

    // #13 — unregister the global quick-add shortcut on teardown. Without this,
    // a remount (StrictMode dev double-invoke, or any future re-mount) would
    // re-register and could leave a stale handler / "already registered" error.
    return () => {
      unregister("CmdOrCtrl+Shift+A").catch(() => {});
    };
  }, [restoreFocus]);

  // P0-1 — OS resume signal. The native side observes
  // NSWorkspaceDidWakeNotification and emits `system-resumed` on a real wake
  // from sleep (never on App Nap / throttle). The focus tick consumes this
  // flag to drop the suspended span instead of counting it as worked time.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen("system-resumed", () => markFocusResume())
      .then((un) => {
        unlisten = un;
      })
      .catch((err) => console.error("system-resumed listen failed:", err));
    return () => unlisten?.();
  }, []);

  // QuickAdd lives in a separate webview with its own store, so a task it
  // inserts is invisible here until we re-read the DB. It emits
  // `verseday:task-created` with the scheduled date; re-read that date's
  // bucket from DB truth so the row appears immediately. Mounts in the main
  // webview only — the #quick-add branch returns before MainApp.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<{ date?: string }>("verseday:task-created", (e) => {
      const date = e.payload?.date;
      if (date) void useAppStore.getState().loadTasksForDate(date);
    })
      .then((un) => {
        unlisten = un;
      })
      .catch((err) => console.error("task-created listen failed:", err));
    return () => unlisten?.();
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      // ── Arrow-key sidebar toggle: handle (or skip) FIRST so no
      // downstream logic can intercept arrow keys on the focus screen
      // or inside modals. Inputs are handled by the global
      // isInputFocused guard below for the rest of the bare keys, but
      // arrow keys on focus must do nothing app-level regardless.
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const p = useAppStore.getState().currentPage;
        if (p === "focus" || p === "project_detail") {
          return;
        }
        if (isInputFocused() || meta || e.shiftKey || e.altKey) return;
        e.preventDefault();
        useAppStore
          .getState()
          .setSidebarCollapsed(e.key === "ArrowLeft");
        return;
      }

      // ── Meta-modifier shortcuts ────────────────────────────────────
      // Cmd+1-6: page navigation (preserved alongside the bare-key set)
      if (meta && !e.shiftKey && PAGE_SHORTCUTS[e.key]) {
        e.preventDefault();
        setPage(PAGE_SHORTCUTS[e.key]);
        return;
      }

      // Cmd+N: focus task input on current page. Most pages keep their
      // add-task affordance collapsed by default (button → expanded
      // input row), so the page-level listener for this event is what
      // actually opens it. The selector branch is a fallback for any
      // surface that already has an input on screen.
      if (meta && !e.shiftKey && key === "n") {
        e.preventDefault();
        const input = document.querySelector<HTMLInputElement>(
          'input[placeholder*="task"], input[placeholder*="Add"]'
        );
        if (input) {
          input.focus();
        } else {
          window.dispatchEvent(new CustomEvent("verseday:open-task-input"));
        }
        return;
      }

      // Cmd+Shift+S: enter shutdown mode (only meaningful on daily plan)
      if (meta && e.shiftKey && key === "s") {
        if (useAppStore.getState().currentPage === "daily") {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent("verseday:toggle-shutdown-mode"));
        }
        return;
      }

      // Escape: blur the active input/editor
      if (e.key === "Escape" && isInputFocused()) {
        (document.activeElement as HTMLElement)?.blur();
        return;
      }

      // ── Bare single-key shortcuts ──────────────────────────────────
      // Skip whenever the user is typing or holding any modifier — these
      // hotkeys are meant for the "navigation hands" state, not editing.
      if (isInputFocused() || meta || e.shiftKey || e.altKey) return;

      const page = useAppStore.getState().currentPage;


      // Space on focus mode: toggle pause.
      if (e.key === " " && page === "focus") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("verseday:toggle-pause"));
        return;
      }

      // F on a page with an active focus session: jump back to the
      // immersive screen instead of starting a new one.
      if (key === "f" && useAppStore.getState().focus) {
        e.preventDefault();
        setPage("focus");
        return;
      }

      // F (no active session): start a focus session on the task the
      // cursor is currently over, or fall back to the first incomplete
      // task today. Hover detection uses the live `:hover` selector
      // so it works regardless of whether a `mouseenter` ever fired
      // (cursor sitting still over a row that re-rendered didn't,
      // which was the source of the "always picks the top task" bug).
      if (key === "f") {
        e.preventDefault();
        (async () => {
          try {
            const today = new Date().toISOString().split("T")[0];
            const tasks = await getTasksForDate(today);
            const incomplete = tasks.filter((t) => t.status !== "done");
            if (incomplete.length === 0) {
              // Focus screen handles the empty-day case in its own boot UI.
              setPage("focus");
              return;
            }
            let target: Task | null = null;
            const hoveredEl = document.querySelector<HTMLElement>(
              "[data-task-row-id]:hover"
            );
            if (hoveredEl) {
              const id = parseInt(hoveredEl.dataset.taskRowId ?? "", 10);
              if (!isNaN(id)) {
                target = incomplete.find((t) => t.id === id) ?? null;
              }
            }
            if (!target) target = incomplete[0];
            const priorMin = await getWorkedMinutesForTask(target.id);
            const entryId = await startTimeEntry(target.id, "tracked");
            const prev = useAppStore.getState().currentPage;
            startFocus(target, entryId, prev, priorMin * 60 * 1000);
            useAppStore.getState().setPage("focus");
          } catch {
            // silent — fail closed on DB hiccups rather than half-start
          }
        })();
        return;
      }

      // Bare-key page nav
      switch (key) {
        case "t":
          e.preventDefault();
          setPage("daily");
          return;
        case "w":
          e.preventDefault();
          setPage("weekly");
          return;
        case "o":
          e.preventDefault();
          setPage("projects");
          return;
        case "d":
          e.preventDefault();
          setPage("dashboard");
          return;
        case "s":
          e.preventDefault();
          setPage("settings");
          return;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [setPage, startFocus]);

  // Meeting approach notifier — single global mount per Verse §6.4.
  // Owns its own 30s tick + dedup + permission probe; reads settings
  // fresh every tick so a Settings toggle takes effect immediately.
  useEffect(() => {
    const stop = startMeetingApproachNotifier();
    return stop;
  }, []);

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
      case "past_shutdowns":
        return <PastShutdowns />;
      default:
        return <DailyPlanner />;
    }
  }

  return (
    <ErrorBoundary>
      {/* Regular app shell — hidden while the focus page is active so it
          doesn't render under the fullscreen overlay. */}
      {currentPage !== "focus" && (
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
      )}

      {/* FocusMode — single persistent mount across both cases (visible
          on the focus page, hidden engine elsewhere). Toggling `visible`
          instead of swapping mounts keeps the pip window + IPC channel
          alive across navigation without a flicker. Mount lifetime
          spans "focus page open OR active session running"; unmount
          fires only when both are false, which is when the pip should
          actually close. */}
      {(currentPage === "focus" || focus?.mode === "active") && (
        <FocusMode visible={currentPage === "focus"} />
      )}

      {/* Singleton task detail overlay (Verse rule 2). One mount for the
          whole app; opened by setting selectedTaskDetailId in the store
          via openTaskDetail(id). M1.a — additive seam: the six per-screen
          mounts are still in place; this host stays inert until M1.b
          rewires their callers to openTaskDetail. */}
      <TaskDetailOverlayHost />
      {/* M3.1.a additive — singleton hosts for SummaryOverlay /
          SunsetOverlay. Both stay inert until M3.1.b retires per-screen
          showSummary / showSunset useState. Sunset mounts after Summary
          so a concurrent sunset layers on top in DOM order. */}
      <SummaryOverlayHost />
      <SunsetOverlayHost />
    </ErrorBoundary>
  );
}
