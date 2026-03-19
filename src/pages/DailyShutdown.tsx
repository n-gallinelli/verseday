import { useEffect, useState, useCallback, useRef } from "react";
import { useAppStore } from "../stores/appStore";
import {
  getTasksForDate,
  getDailyPlan,
  getTotalWorkedMinutes,
  getTotalPlannedMinutes,
  updateTaskDateScheduled,
  upsertDailyShutdown,
  getProjects,
} from "../db/queries";
import ErrorBanner from "../components/ErrorBanner";
import SunsetOverlay from "../components/SunsetOverlay";
import { formatHoursMinutes } from "../utils/format";
import type { Task, Project } from "../types";

const SHUTDOWN_KEY_PREFIX = "daily-shutdown-";

const MOODS = [
  { emoji: "🔥", label: "Great" },
  { emoji: "😊", label: "Good" },
  { emoji: "😐", label: "Okay" },
  { emoji: "😓", label: "Rough" },
  { emoji: "😞", label: "Bad" },
];

export default function DailyShutdown() {
  const { selectedDate, setSelectedDate } = useAppStore();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [plannedMinutes, setPlannedMinutes] = useState(0);
  const [workedMinutes, setWorkedMinutes] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [mood, setMood] = useState<string | null>(null);
  const [reflection, setReflection] = useState("");
  const [carriedIds, setCarriedIds] = useState<Set<number>>(new Set());
  const [isShutdown, setIsShutdown] = useState(false);
  const [showSunset, setShowSunset] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedDateRef = useRef(selectedDate);
  selectedDateRef.current = selectedDate;

  const projectMap = new Map(projects.map((p) => [p.id, p]));

  const loadData = useCallback(async () => {
    try {
      const [t, dp, pm, wm, p] = await Promise.all([
        getTasksForDate(selectedDate),
        getDailyPlan(selectedDate),
        getTotalPlannedMinutes(selectedDate),
        getTotalWorkedMinutes(selectedDate),
        getProjects(false),
      ]);
      setTasks(t);
      setProjects(p);
      setPlannedMinutes(pm);
      setWorkedMinutes(wm);
      setMood(dp?.mood ?? null);
      setReflection(dp?.reflection ?? "");
      setIsShutdown(
        localStorage.getItem(SHUTDOWN_KEY_PREFIX + selectedDate) === "true"
      );
      setCarriedIds(new Set());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
    }
  }, [selectedDate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Auto-save mood + reflection
  function debouncedSave(newMood: string | null, newReflection: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        await upsertDailyShutdown(
          selectedDateRef.current,
          newMood,
          newReflection.trim() || null
        );
      } catch {
        // silent
      }
    }, 600);
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function handleMoodChange(emoji: string) {
    const next = mood === emoji ? null : emoji;
    setMood(next);
    debouncedSave(next, reflection);
  }

  function handleReflectionChange(value: string) {
    setReflection(value);
    debouncedSave(mood, value);
  }

  function getTomorrowDate(): string {
    const d = new Date(selectedDate + "T00:00:00");
    d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0];
  }

  async function carryTaskToTomorrow(taskId: number) {
    try {
      await updateTaskDateScheduled(taskId, getTomorrowDate());
      setCarriedIds((prev) => new Set(prev).add(taskId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to move task");
    }
  }

  async function carryAllToTomorrow() {
    const tomorrow = getTomorrowDate();
    const toCarry = tasks.filter(
      (t) => t.status !== "done" && !carriedIds.has(t.id)
    );
    try {
      await Promise.all(
        toCarry.map((t) => updateTaskDateScheduled(t.id, tomorrow))
      );
      setCarriedIds(
        (prev) => new Set([...prev, ...toCarry.map((t) => t.id)])
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to move tasks");
    }
  }

  async function completeShutdown() {
    // Flush pending save
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    try {
      await upsertDailyShutdown(
        selectedDate,
        mood,
        reflection.trim() || null
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
      return;
    }
    localStorage.setItem(SHUTDOWN_KEY_PREFIX + selectedDate, "true");
    setIsShutdown(true);
    setShowSunset(true);
  }

  function changeDate(offset: number) {
    const d = new Date(selectedDate + "T00:00:00");
    d.setDate(d.getDate() + offset);
    setSelectedDate(d.toISOString().split("T")[0]);
  }

  const completedTasks = tasks.filter((t) => t.status === "done");
  const incompleteTasks = tasks.filter((t) => t.status !== "done");
  const isToday = selectedDate === new Date().toISOString().split("T")[0];

  return (
    <div className="flex flex-col h-full bg-[#f5f4f0] overflow-hidden">
      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {/* ── Header — tinted ─────────────────────────────────────────── */}
      <div className="bg-[#EEF3FB] px-6 py-4 flex-shrink-0" style={{ borderBottom: "0.5px solid rgba(0,0,0,0.06)" }}>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] uppercase tracking-[0.08em] text-[#3D6FCC]">
            Daily shutdown
          </span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => changeDate(-1)}
              className="w-6 h-6 rounded-md bg-white/60 border border-black/[0.06] flex items-center justify-center text-black/35 text-[12px] cursor-pointer hover:bg-white"
            >
              ‹
            </button>
            <button
              onClick={() => changeDate(1)}
              className="w-6 h-6 rounded-md bg-white/60 border border-black/[0.06] flex items-center justify-center text-black/35 text-[12px] cursor-pointer hover:bg-white"
            >
              ›
            </button>
          </div>
        </div>
        <h2 className="text-[14px] font-medium text-[#2c2a35]">
          {new Date(selectedDate + "T00:00:00").toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </h2>
      </div>

      {/* ── Body — two columns ──────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[860px] mx-auto px-6 py-5">
          <div className="flex gap-3">
            {/* ── Left column: mood + reflection ────────────────── */}
            <div className="flex-1 space-y-4">
              {/* Mood selector */}
              <section>
                <h3 className="text-[10px] uppercase tracking-[0.08em] text-black/30 mb-2">
                  How was your day?
                </h3>
                <div className="flex gap-1">
                  {MOODS.map((m) => (
                    <button
                      key={m.emoji}
                      onClick={() => handleMoodChange(m.emoji)}
                      className={`flex-1 flex flex-col items-center gap-0.5 py-2 rounded-[7px] cursor-pointer transition-colors ${
                        mood === m.emoji
                          ? "bg-[#EEF3FB] border-[#7B9ED9]"
                          : "bg-white border-black/[0.06] hover:border-black/[0.12]"
                      }`}
                      style={{ border: `0.5px solid ${mood === m.emoji ? "#7B9ED9" : "rgba(0,0,0,0.06)"}` }}
                    >
                      <span className="text-[16px]">{m.emoji}</span>
                      <span className={`text-[9px] ${mood === m.emoji ? "text-[#3D6FCC]" : "text-black/25"}`}>
                        {m.label}
                      </span>
                    </button>
                  ))}
                </div>
              </section>

              {/* Reflection */}
              <section>
                <h3 className="text-[10px] uppercase tracking-[0.08em] text-black/30 mb-2">
                  Reflection
                </h3>
                <textarea
                  value={reflection}
                  onChange={(e) => handleReflectionChange(e.target.value)}
                  placeholder="How did today go? What would you do differently? What are you grateful for?"
                  className="w-full bg-white rounded-lg px-3.5 py-2.5 text-[13px] text-black/55 placeholder-black/20 resize-none min-h-[100px] leading-relaxed font-sans focus:outline-none focus:border-[#7B9ED9]/40"
                  style={{ border: "0.5px solid rgba(0,0,0,0.06)" }}
                />
              </section>
            </div>

            {/* ── Right column: info cards (180px) ──────────────── */}
            <div className="w-[180px] flex-shrink-0 space-y-3">
              {/* Time card */}
              <div className="bg-white rounded-lg px-3 py-2.5" style={{ border: "0.5px solid rgba(0,0,0,0.06)" }}>
                <div className="text-[10px] uppercase tracking-[0.08em] text-black/25 mb-1">Time</div>
                <div className="text-[20px] font-medium text-[#7B9ED9] leading-none">
                  {formatHoursMinutes(workedMinutes)}
                </div>
                <div className="text-[11px] text-black/30 mt-1">
                  of {formatHoursMinutes(plannedMinutes)} planned
                </div>
              </div>

              {/* Done today card */}
              <div className="bg-white rounded-lg px-3 py-2.5" style={{ border: "0.5px solid rgba(0,0,0,0.06)" }}>
                <div className="text-[10px] uppercase tracking-[0.08em] text-black/25 mb-2">Done today</div>
                {completedTasks.length > 0 ? (
                  <div className="space-y-1">
                    {completedTasks.map((task) => (
                      <div key={task.id} className="flex items-center gap-1.5">
                        <span className="w-[11px] h-[11px] rounded-[2px] bg-[#3a9e6e] flex items-center justify-center flex-shrink-0">
                          <svg width="6" height="6" viewBox="0 0 8 8" fill="none" stroke="white" strokeWidth="1.4" strokeLinecap="round">
                            <path d="M1.5 4l2 2 3-3" />
                          </svg>
                        </span>
                        <span className="text-[11px] text-black/35 line-through truncate">{task.title}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-black/20">No tasks completed</p>
                )}
              </div>

              {/* Didn't get to card */}
              <div className="bg-white rounded-lg px-3 py-2.5" style={{ border: "0.5px solid rgba(0,0,0,0.06)" }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] uppercase tracking-[0.08em] text-black/25">Didn&rsquo;t get to</span>
                  {incompleteTasks.filter((t) => !carriedIds.has(t.id)).length > 0 && (
                    <button
                      onClick={carryAllToTomorrow}
                      className="text-[9px] text-[#7B9ED9] hover:text-[#6889c4] cursor-pointer"
                    >
                      Move all →
                    </button>
                  )}
                </div>
                {incompleteTasks.length > 0 ? (
                  <div className="space-y-1">
                    {incompleteTasks.map((task) => {
                      const isCarried = carriedIds.has(task.id);
                      return (
                        <div key={task.id} className="flex items-center gap-1.5">
                          {isCarried ? (
                            <span className="text-[11px] text-black/25 italic truncate flex-1">{task.title}</span>
                          ) : (
                            <button
                              onClick={() => carryTaskToTomorrow(task.id)}
                              className="text-[11px] text-[#2c2a35] truncate flex-1 text-left cursor-pointer hover:text-[#7B9ED9]"
                            >
                              {task.title}
                            </button>
                          )}
                          {isCarried && (
                            <span className="text-[9px] text-[#3a9e6e] flex-shrink-0">Moved</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[11px] text-black/20">Everything done!</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Footer — shutdown button ────────────────────────────────── */}
      <div className="px-6 py-4 flex-shrink-0">
        <div className="max-w-[860px] mx-auto">
          <button
            onClick={completeShutdown}
            className="w-full py-2.5 rounded-lg bg-[#7B9ED9] text-white text-[13px] font-medium cursor-pointer hover:bg-[#6889c4] transition-colors"
          >
            Save & shutdown
          </button>
        </div>
      </div>

      {showSunset && <SunsetOverlay onDismiss={() => setShowSunset(false)} />}
    </div>
  );
}
