import { useEffect, useState, useCallback, useMemo } from "react";
import Button from "../components/Button";
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
  const { startFocus } = useAppStore();
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
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedIndex, remainingTasks.length, currentTask]);

  if (loading) {
    return (
      <div className="flex flex-col h-full bg-base items-center justify-center">
        <span className="text-[14px] text-fg-faded">Loading...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-base overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 flex-shrink-0 text-center" style={{ borderBottom: "0.5px solid var(--border-hairline)" }}>
        <h2 className="text-[18px] font-medium text-fg font-display">Focus</h2>
      </div>

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
            {/* Project label — always reserve space */}
            <div className="flex items-center gap-1.5 mb-2 h-[18px]">
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

            {/* Task title — full text, wraps to as many lines as needed */}
            <h1 className="text-[20px] font-medium text-fg leading-snug mb-6 font-display break-words">
              {currentTask.title}
            </h1>

            {/* Start button */}
            <Button size="sm" className="flex items-center justify-center gap-2 transition-all duration-200 ease-out hover:shadow-[0_0_0_6px_color-mix(in_srgb,var(--accent-blue)_18%,transparent)]" onClick={() => handleStartFocus(currentTask)}>
              <svg width="10" height="12" viewBox="0 0 8 10" fill="currentColor">
                <path d="M0 0v10l8-5z" />
              </svg>
              Start focusing
            </Button>

            {/* Nav arrows */}
            {remainingTasks.length > 1 && (
              <div className="flex items-center gap-3 mt-4">
                <button
                  onClick={() => setSelectedIndex((i) => i - 1)}
                  disabled={selectedIndex === 0}
                  className="w-8 h-8 flex items-center justify-center rounded-full text-fg-faded hover:text-fg-secondary hover:bg-overlay-hover cursor-pointer disabled:opacity-20 disabled:cursor-default transition-colors"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M8.5 2.5L4 7l4.5 4.5" />
                  </svg>
                </button>
                <button
                  onClick={() => setSelectedIndex((i) => i + 1)}
                  disabled={selectedIndex >= remainingTasks.length - 1}
                  className="w-8 h-8 flex items-center justify-center rounded-full text-fg-faded hover:text-fg-secondary hover:bg-overlay-hover cursor-pointer disabled:opacity-20 disabled:cursor-default transition-colors"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M5.5 2.5L10 7l-4.5 4.5" />
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
