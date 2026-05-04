import { useEffect, useState, useCallback, useMemo } from "react";
import { useAppStore } from "../stores/appStore";
import {
  getTasksForDate,
  getProjects,
  startTimeEntry,
  getWorkedMinutesForTask,
} from "../db/queries";
import type { Task, Project } from "../types";
import { formatHoursMinutes, getEmptyDayMessage } from "../utils/format";

export default function FocusLanding() {
  const { startFocus, setPage, setPendingDetailTask } = useAppStore();
  const today = useMemo(() => new Date().toISOString().split("T")[0], []);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const projectMap = new Map(projects.map((p) => [p.id, p]));

  const loadData = useCallback(async () => {
    const [t, p] = await Promise.all([
      getTasksForDate(today),
      getProjects(false),
    ]);
    setTasks(t);
    setProjects(p);
    setLoading(false);
  }, [today]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const remainingTasks = tasks.filter((t) => t.status !== "done");
  const completedTasks = tasks.filter((t) => t.status === "done");
  const currentTask = remainingTasks[selectedIndex] ?? null;

  // Clamp selected index when tasks change
  useEffect(() => {
    if (selectedIndex >= remainingTasks.length && remainingTasks.length > 0) {
      setSelectedIndex(remainingTasks.length - 1);
    }
  }, [remainingTasks.length, selectedIndex]);

  async function handleStartFocus(task: Task) {
    const priorMs = (await getWorkedMinutesForTask(task.id)) * 60 * 1000;
    const entryId = await startTimeEntry(task.id, "tracked");
    startFocus(task, entryId, "focus_landing", priorMs);
    // Focus Landing's whole purpose is the immersive view — caller opts
    // into navigation explicitly.
    setPage("focus");
  }

  // Keyboard: arrow keys for navigation, Space/Enter to start
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const el = document.activeElement;
      const isInput = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
      if (isInput) return;

      if (e.key === "ArrowLeft" && selectedIndex > 0) {
        e.preventDefault();
        setSelectedIndex((i) => i - 1);
      } else if (e.key === "ArrowRight" && selectedIndex < remainingTasks.length - 1) {
        e.preventDefault();
        setSelectedIndex((i) => i + 1);
      } else if ((e.key === " " || e.key === "Enter") && currentTask) {
        e.preventDefault();
        handleStartFocus(currentTask);
      } else if (e.key === "Escape" && currentTask) {
        e.preventDefault();
        setPendingDetailTask(currentTask);
        setPage("daily");
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedIndex, remainingTasks.length, currentTask, setPage, setPendingDetailTask]);

  if (loading) {
    return (
      <div className="flex flex-col h-full bg-base items-center justify-center">
        <span className="text-[14px] text-fg-faded">Loading...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-base overflow-hidden">
      {/* Content — vertically centered */}
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        {/* No tasks state */}
        {tasks.length === 0 && (() => {
          const msg = getEmptyDayMessage();
          return (
            <div className="text-center max-w-[300px]">
              <p className="text-[14px] text-fg-muted mb-1">{msg.title}</p>
              <p className="text-[12px] text-fg-faded leading-relaxed">{msg.subtitle}</p>
            </div>
          );
        })()}

        {/* All done state */}
        {tasks.length > 0 && remainingTasks.length === 0 && (
          <div className="text-center">
            <span className="text-[32px] mb-3 block">🎉</span>
            <p className="text-[16px] font-medium text-fg mb-1">All tasks complete</p>
            <p className="text-[12px] text-fg-faded">{completedTasks.length} tasks done today</p>
          </div>
        )}

        {/* Current task — centered hero */}
        {currentTask && (
          <div className="flex flex-col items-center text-center max-w-[680px]">
            {/* Screen identity — the same concentric-circle motif used by the
                Focus nav icon, scaled up. Sits above project + title so the
                page reads as "this is your focus space." */}
            <svg
              width="34" height="34" viewBox="0 0 15 15" fill="none"
              stroke="currentColor" strokeWidth="1.3"
              strokeLinecap="round" strokeLinejoin="round"
              className="text-fg-muted mb-8"
              aria-hidden
            >
              <circle cx="7.5" cy="7.5" r="5.5" />
              <circle cx="7.5" cy="7.5" r="2.5" />
              <circle cx="7.5" cy="7.5" r="0.5" fill="currentColor" stroke="none" />
            </svg>

            {/* Project label — pulled tight to the title so they read as one
                unit. Reserve a fixed height so the layout doesn't shift when
                a task has no project. */}
            <div className="flex items-center gap-1.5 mb-1 h-[18px]">
              {currentTask.project_id && projectMap.get(currentTask.project_id) && (
                <>
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: projectMap.get(currentTask.project_id)!.color }}
                  />
                  <span className="text-[11px] text-fg-faded truncate max-w-[280px]">
                    {projectMap.get(currentTask.project_id)!.name}
                  </span>
                </>
              )}
            </div>

            {/* Task title — fixed-height box keeps Start button + arrows
                anchored when navigating between tasks of varying line counts.
                Top-aligned (items-start) so the title sits flush below the
                project label instead of floating mid-box for short titles. */}
            <div className="min-h-[88px] flex items-start justify-center mb-9 pt-1">
              <h1 className="text-[20px] font-medium text-fg leading-snug font-display break-words">
                {currentTask.title}
              </h1>
            </div>

            {/* Start button — outlined to match the rest of the app's
                primary-accent action buttons (Daily Plan header, etc). */}
            <button
              onClick={() => handleStartFocus(currentTask)}
              className="flex items-center justify-center gap-2 rounded-lg border border-accent-blue/50 text-accent-blue-soft-fg px-4 py-1.5 text-[13px] font-medium cursor-pointer hover:border-accent-blue hover:bg-accent-blue-soft transition-colors"
            >
              <svg width="9" height="11" viewBox="0 0 8 10" fill="currentColor">
                <path d="M0 0v10l8-5z" />
              </svg>
              Start focusing
            </button>

            {/* Nav arrows — plain chevrons so they sit quietly below the
                primary action instead of competing with it. */}
            {remainingTasks.length > 1 && (
              <div className="flex items-center gap-2 mt-7">
                <button
                  onClick={() => setSelectedIndex((i) => i - 1)}
                  disabled={selectedIndex === 0}
                  className="w-7 h-7 flex items-center justify-center rounded-full text-fg-disabled hover:text-fg-faded hover:bg-overlay-hover cursor-pointer disabled:opacity-30 disabled:cursor-default transition-colors"
                >
                  <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 4l-4 3 4 3" />
                  </svg>
                </button>
                <button
                  onClick={() => setSelectedIndex((i) => i + 1)}
                  disabled={selectedIndex >= remainingTasks.length - 1}
                  className="w-7 h-7 flex items-center justify-center rounded-full text-fg-disabled hover:text-fg-faded hover:bg-overlay-hover cursor-pointer disabled:opacity-30 disabled:cursor-default transition-colors"
                >
                  <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 4l4 3-4 3" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
