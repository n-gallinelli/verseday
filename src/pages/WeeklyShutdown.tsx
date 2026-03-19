import { useEffect, useState, useCallback, useRef } from "react";
import { useAppStore } from "../stores/appStore";
import {
  getWeeklyShutdown,
  upsertWeeklyShutdown,
  getTasksForWeek,
  getProjects,
  getPlannedMinutesPerDay,
  getWorkedMinutesForWeek,
  updateTaskDateScheduled,
  addWeeklyPlanProject,
  updateTask,
} from "../db/queries";
import ErrorBanner from "../components/ErrorBanner";
import SunsetOverlay from "../components/SunsetOverlay";
import TaskDetailOverlay from "../components/TaskDetailOverlay";
import { formatHoursMinutes } from "../utils/format";
import type { Task, Project } from "../types";

const WEEKLY_SHUTDOWN_PREFIX = "weekly-shutdown-";

const OLD_CHECKLIST_PREFIX = "verseday_shutdown_checklist_";

function getWeekdayDates(mondayIso: string): string[] {
  const dates: string[] = [];
  const d = new Date(mondayIso + "T00:00:00");
  for (let i = 0; i < 5; i++) {
    const dd = new Date(d);
    dd.setDate(d.getDate() + i);
    dates.push(dd.toISOString().split("T")[0]);
  }
  return dates;
}

function getFridayIso(mondayIso: string): string {
  const d = new Date(mondayIso + "T00:00:00");
  d.setDate(d.getDate() + 4);
  return d.toISOString().split("T")[0];
}

function formatWeekHeader(mondayIso: string): string {
  const d = new Date(mondayIso + "T00:00:00");
  return `Week of ${d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })}`;
}

function getMondayOfWeek(date: Date = new Date()): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split("T")[0];
}

function getNextMonday(mondayIso: string): string {
  const d = new Date(mondayIso + "T00:00:00");
  d.setDate(d.getDate() + 7);
  return d.toISOString().split("T")[0];
}

function formatMinutesToHours(minutes: number): string {
  return (Math.round(minutes / 6) / 10).toFixed(1).replace(/\.0$/, "");
}

const DAY_NAMES_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri"];

// One-time cleanup of old checklist localStorage keys
function cleanupOldChecklistKeys() {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(OLD_CHECKLIST_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
}

// ─── Main component ─────────────────────────────────────────────────────────

export default function WeeklyShutdown() {
  const { selectedWeek, setSelectedWeek } = useAppStore();

  const [weekTasks, setWeekTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [mood, setMood] = useState<string | null>(null);
  const [reflections, setReflections] = useState("");
  const [incompleteItemsText, setIncompleteItemsText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [carriedIds, setCarriedIds] = useState<Set<number>>(new Set());
  const [carriedTasks, setCarriedTasks] = useState<
    { task: Task; originalDate: string | null }[]
  >([]);
  const [showSunset, setShowSunset] = useState(false);
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [isWeekShutdown, setIsWeekShutdown] = useState(false);
  const [isShutdownMode, setIsShutdownMode] = useState(false);

  // Next week preview data
  const [nextWeekTasks, setNextWeekTasks] = useState<Task[]>([]);
  const [nextWeekPlanned, setNextWeekPlanned] = useState<Map<string, number>>(
    new Map()
  );

  // This week stats
  const [workedByDay, setWorkedByDay] = useState<Map<string, number>>(
    new Map()
  );
  const [plannedByDay, setPlannedByDay] = useState<Map<string, number>>(
    new Map()
  );

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedWeekRef = useRef(selectedWeek);
  selectedWeekRef.current = selectedWeek;
  const cleanedUp = useRef(false);

  const fridayIso = getFridayIso(selectedWeek);
  const todayMonday = getMondayOfWeek();
  const isThisWeek = selectedWeek === todayMonday;
  const nextMonday = getNextMonday(selectedWeek);
  const nextFriday = getFridayIso(nextMonday);
  const nextWeekDates = getWeekdayDates(nextMonday);

  const projectMap = new Map(projects.map((p) => [p.id, p]));

  // One-time cleanup
  useEffect(() => {
    if (!cleanedUp.current) {
      cleanedUp.current = true;
      cleanupOldChecklistKeys();
    }
  }, []);

  // ── Data loading ──────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    try {
      const [sd, wt, p, wbd, pbd, nwt, nwp] = await Promise.all([
        getWeeklyShutdown(selectedWeek),
        getTasksForWeek(selectedWeek, fridayIso),
        getProjects(),
        getWorkedMinutesForWeek(selectedWeek, fridayIso),
        getPlannedMinutesPerDay(selectedWeek, fridayIso),
        getTasksForWeek(nextMonday, nextFriday),
        getPlannedMinutesPerDay(nextMonday, nextFriday),
      ]);

      setWeekTasks(wt);
      setProjects(p);
      setWorkedByDay(wbd);
      setPlannedByDay(pbd);
      setNextWeekTasks(nwt);
      setNextWeekPlanned(nwp);
      setMood(sd?.mood ?? null);
      setReflections(sd?.reflections ?? "");
      setIncompleteItemsText(sd?.incomplete_items ?? "");
      setCarriedIds(new Set());
      setCarriedTasks([]);
      setIsWeekShutdown(
        localStorage.getItem(WEEKLY_SHUTDOWN_PREFIX + selectedWeek) === "true"
      );
      setError(null);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to load shutdown data"
      );
    }
  }, [selectedWeek, fridayIso, nextMonday, nextFriday]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Debounced auto-save ───────────────────────────────────────────────

  function debouncedSave(newMood: string | null, newReflections: string, newIncomplete: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        await upsertWeeklyShutdown(
          selectedWeekRef.current,
          newReflections.trim() || null,
          newIncomplete.trim() || null,
          newMood
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save");
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
    debouncedSave(next, reflections, incompleteItemsText);
  }

  function handleReflectionsChange(value: string) {
    setReflections(value);
    debouncedSave(mood, value, incompleteItemsText);
  }

  function handleIncompleteTextChange(value: string) {
    setIncompleteItemsText(value);
    debouncedSave(mood, reflections, value);
  }

  // ── Actions ───────────────────────────────────────────────────────────

  async function reloadNextWeek() {
    const [nwt, nwp] = await Promise.all([
      getTasksForWeek(nextMonday, nextFriday),
      getPlannedMinutesPerDay(nextMonday, nextFriday),
    ]);
    setNextWeekTasks(nwt);
    setNextWeekPlanned(nwp);
  }

  async function carryForward(task: Task) {
    try {
      const originalDate = task.date_scheduled;
      await updateTaskDateScheduled(task.id, nextMonday);
      setCarriedIds((prev) => new Set(prev).add(task.id));
      setCarriedTasks((prev) => [...prev, { task, originalDate }]);
      await reloadNextWeek();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to carry forward");
    }
  }

  async function carryProjectForward(
    projectId: number | null,
    tasks: Task[]
  ) {
    const toCarry = tasks.filter((t) => !carriedIds.has(t.id));
    try {
      // Pin project to next week (if it's a real project)
      if (projectId != null) {
        await addWeeklyPlanProject(nextMonday, projectId);
      }
      // Move incomplete tasks
      if (toCarry.length > 0) {
        await Promise.all(
          toCarry.map((t) => updateTaskDateScheduled(t.id, nextMonday))
        );
        setCarriedIds(
          (prev) => new Set([...prev, ...toCarry.map((t) => t.id)])
        );
        setCarriedTasks((prev) => [
          ...prev,
          ...toCarry.map((t) => ({
            task: t,
            originalDate: t.date_scheduled,
          })),
        ]);
      }
      await reloadNextWeek();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to carry forward");
    }
  }

  async function undoCarry(taskId: number) {
    const entry = carriedTasks.find((ct) => ct.task.id === taskId);
    if (!entry) return;
    try {
      await updateTaskDateScheduled(taskId, entry.originalDate);
      setCarriedIds((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
      setCarriedTasks((prev) => prev.filter((ct) => ct.task.id !== taskId));
      await reloadNextWeek();
      loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to undo");
    }
  }

  async function completeWeeklyShutdown() {
    // Flush debounce
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    try {
      await upsertWeeklyShutdown(
        selectedWeekRef.current,
        reflections.trim() || null,
        incompleteItemsText.trim() || null,
        mood
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
      return;
    }
    localStorage.setItem(WEEKLY_SHUTDOWN_PREFIX + selectedWeek, "true");
    setIsWeekShutdown(true);
    setShowSunset(true);
  }

  function changeWeek(offset: number) {
    const d = new Date(selectedWeek + "T00:00:00");
    d.setDate(d.getDate() + offset * 7);
    setSelectedWeek(d.toISOString().split("T")[0]);
  }

  // ── Derived data ──────────────────────────────────────────────────────

  const completedTasks = weekTasks.filter((t) => t.status === "done");
  const incompleteTasks = weekTasks.filter((t) => t.status !== "done");

  const totalPlannedMinutes = Array.from(plannedByDay.values()).reduce(
    (s, m) => s + m,
    0
  );
  const totalWorkedMinutes = Array.from(workedByDay.values()).reduce(
    (s, m) => s + m,
    0
  );
  const progressPercent =
    weekTasks.length > 0
      ? Math.round((completedTasks.length / weekTasks.length) * 100)
      : 0;

  // Group incomplete tasks by project
  const projectGroups: { project: Project | null; tasks: Task[] }[] = [];
  const incompleteByProject = new Map<number | null, Task[]>();
  for (const task of incompleteTasks) {
    const key = task.project_id;
    const existing = incompleteByProject.get(key) ?? [];
    existing.push(task);
    incompleteByProject.set(key, existing);
  }

  // Sort by project name, exclude tasks without a project
  const projectIds = Array.from(incompleteByProject.keys())
    .filter((id): id is number => id !== null)
    .sort((a, b) =>
      (projectMap.get(a)?.name ?? "").localeCompare(projectMap.get(b)?.name ?? "")
    );

  for (const pid of projectIds) {
    const tasks = incompleteByProject.get(pid) ?? [];
    const project = projectMap.get(pid) ?? null;
    projectGroups.push({ project, tasks });
  }

  // Next week preview: count tasks + planned per day
  const nextWeekTasksByDate = new Map<string, Task[]>();
  for (const date of nextWeekDates) {
    nextWeekTasksByDate.set(date, []);
  }
  for (const task of nextWeekTasks) {
    if (task.date_scheduled && nextWeekTasksByDate.has(task.date_scheduled)) {
      nextWeekTasksByDate.get(task.date_scheduled)!.push(task);
    }
  }

  const MOODS = [
    { emoji: "🔥", label: "Great" },
    { emoji: "😊", label: "Good" },
    { emoji: "😐", label: "Okay" },
    { emoji: "😓", label: "Rough" },
    { emoji: "😞", label: "Bad" },
  ];

  // Week summary: projects with work this week
  const weekSummaryProjects = (() => {
    const byProject = new Map<number, { name: string; color: string }>();
    for (const task of weekTasks) {
      if (task.project_id == null) continue;
      if (!byProject.has(task.project_id)) {
        const p = projectMap.get(task.project_id);
        if (p) byProject.set(task.project_id, { name: p.name, color: p.color });
      }
    }
    return Array.from(byProject.values());
  })();

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-[#f5f4f0] overflow-hidden">
      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {/* ── Header — tinted teal ────────────────────────────────────────── */}
      <div className="bg-[#F0F9F5] px-6 py-4 flex-shrink-0" style={{ borderBottom: "0.5px solid rgba(0,0,0,0.06)" }}>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] uppercase tracking-[0.08em] text-[#0F6E56]">
            Weekly shutdown
          </span>
          <div className="flex items-center gap-1.5">
            {!isThisWeek && (
              <button
                onClick={() => setSelectedWeek(todayMonday)}
                className="text-[11px] text-[#5DCAA5] hover:text-[#0F6E56] cursor-pointer mr-2"
              >
                This week
              </button>
            )}
            <button
              onClick={() => changeWeek(-1)}
              className="w-6 h-6 rounded-md bg-white/60 border border-black/[0.06] flex items-center justify-center text-black/35 text-[12px] cursor-pointer hover:bg-white"
            >
              ‹
            </button>
            <button
              onClick={() => changeWeek(1)}
              className="w-6 h-6 rounded-md bg-white/60 border border-black/[0.06] flex items-center justify-center text-black/35 text-[12px] cursor-pointer hover:bg-white"
            >
              ›
            </button>
          </div>
        </div>
        <h2 className="text-[14px] font-medium text-[#2c2a35]">
          {formatWeekHeader(selectedWeek)}
        </h2>
      </div>

      {/* Undo banner */}
      {carriedTasks.length > 0 && (
        <div className="px-6 py-2 bg-[#2c2a35] flex-shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[12px] text-white/70">
              Moved to next week
            </span>
            <div className="flex gap-1.5 flex-wrap flex-1">
              {carriedTasks.map((ct) => (
                <button
                  key={ct.task.id}
                  onClick={() => undoCarry(ct.task.id)}
                  className="text-[11px] text-[#5DCAA5] hover:text-white cursor-pointer"
                >
                  Undo &ldquo;{ct.task.title.slice(0, 20)}
                  {ct.task.title.length > 20 ? "..." : ""}&rdquo;
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Body — two columns ──────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[860px] mx-auto px-6 py-5">
          <div className="flex gap-3">
            {/* ── Left column: mood + reflection + carry forward ─── */}
            <div className="flex-1 space-y-4">
              {/* Mood selector */}
              <section>
                <h3 className="text-[10px] uppercase tracking-[0.08em] text-black/30 mb-2">
                  How was your week?
                </h3>
                <div className="flex gap-1">
                  {MOODS.map((m) => (
                    <button
                      key={m.emoji}
                      onClick={() => handleMoodChange(m.emoji)}
                      className={`flex-1 flex flex-col items-center gap-0.5 py-2 rounded-[7px] cursor-pointer transition-colors ${
                        mood === m.emoji
                          ? "bg-[#E1F5EE]"
                          : "bg-white hover:border-black/[0.12]"
                      }`}
                      style={{ border: `0.5px solid ${mood === m.emoji ? "#5DCAA5" : "rgba(0,0,0,0.06)"}` }}
                    >
                      <span className="text-[16px]">{m.emoji}</span>
                      <span className={`text-[9px] ${mood === m.emoji ? "text-[#0F6E56]" : "text-black/25"}`}>
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
                  value={reflections}
                  onChange={(e) => handleReflectionsChange(e.target.value)}
                  placeholder="What went well? What could be better?"
                  className="w-full bg-white rounded-lg px-3.5 py-2.5 text-[13px] text-black/55 placeholder-black/20 resize-none min-h-[72px] leading-relaxed font-sans focus:outline-none focus:border-[#5DCAA5]/40"
                  style={{ border: "0.5px solid rgba(0,0,0,0.06)" }}
                />
              </section>

              {/* Carry forward */}
              <section>
                <h3 className="text-[10px] uppercase tracking-[0.08em] text-black/30 mb-2">
                  Carry forward
                </h3>
                <textarea
                  value={incompleteItemsText}
                  onChange={(e) => handleIncompleteTextChange(e.target.value)}
                  placeholder="Loose ends, things to remember for next week..."
                  className="w-full bg-white rounded-lg px-3.5 py-2.5 text-[13px] text-black/55 placeholder-black/20 resize-none min-h-[72px] leading-relaxed font-sans focus:outline-none focus:border-[#5DCAA5]/40"
                  style={{ border: "0.5px solid rgba(0,0,0,0.06)" }}
                />
              </section>

            </div>

            {/* ── Right column: info cards (180px) ──────────────── */}
            <div className="w-[180px] flex-shrink-0 space-y-3">
              {/* Time card */}
              <div className="bg-white rounded-lg px-3 py-2.5" style={{ border: "0.5px solid rgba(0,0,0,0.06)" }}>
                <div className="text-[10px] uppercase tracking-[0.08em] text-black/25 mb-1">Time</div>
                <div className="text-[20px] font-medium text-[#5DCAA5] leading-none">
                  {formatHoursMinutes(totalWorkedMinutes)}
                </div>
                <div className="text-[11px] text-black/30 mt-1">
                  of {formatHoursMinutes(totalPlannedMinutes)} planned
                </div>
              </div>

              {/* Projects this week card */}
              <div className="bg-white rounded-lg px-3 py-2.5" style={{ border: "0.5px solid rgba(0,0,0,0.06)" }}>
                <div className="text-[10px] uppercase tracking-[0.08em] text-black/25 mb-2">Projects this week</div>
                {weekSummaryProjects.length > 0 ? (
                  <div className="space-y-2.5">
                    {weekSummaryProjects.map((p) => (
                      <div key={p.name}>
                        <div className="flex items-center gap-1.5 mb-1">
                          <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
                          <span className="text-[13px] text-[#2c2a35]">{p.name}</span>
                        </div>
                        <textarea
                          placeholder="How did this project go this week?"
                          rows={2}
                          className="w-full text-[12px] text-black/50 placeholder-black/15 resize-none bg-transparent outline-none leading-relaxed"
                          style={{ minHeight: 40 }}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[12px] text-black/20">No projects worked on this week</p>
                )}
              </div>

              {/* Next week card */}
              <div className="bg-white rounded-lg px-3 py-2.5" style={{ border: "0.5px solid rgba(0,0,0,0.06)" }}>
                <div className="text-[10px] uppercase tracking-[0.08em] text-black/25 mb-2">Next week</div>
                <div className="grid grid-cols-5 gap-1">
                  {nextWeekDates.map((date, i) => {
                    const tasks = nextWeekTasksByDate.get(date) ?? [];
                    return (
                      <div key={date} className="text-center">
                        <div className="text-[9px] uppercase text-black/25 mb-1">{DAY_NAMES_SHORT[i]}</div>
                        <div className={`w-2 h-2 rounded-full mx-auto ${tasks.length > 0 ? "bg-[#5DCAA5]" : "bg-black/[0.06]"}`} />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Footer — shutdown button ────────────────────────────────── */}
      <div className="px-6 py-4 flex-shrink-0">
        <div className="max-w-[860px] mx-auto">
          <button
            onClick={completeWeeklyShutdown}
            className="w-full py-2.5 rounded-lg bg-[#5DCAA5] text-white text-[13px] font-medium cursor-pointer hover:bg-[#4ab893] transition-colors"
          >
            Save & shutdown
          </button>
        </div>
      </div>

      {/* Task detail overlay */}
      {detailTask && (
        <TaskDetailOverlay
          task={detailTask}
          projects={projects}
          onClose={() => { setDetailTask(null); loadData(); }}
          onSave={(updates) => updateTask(updates).then(() => loadData()).catch(() => {})}
          onToggle={undefined}
          onDelete={undefined}
        />
      )}

      {/* Sunset overlay */}
      {showSunset && <SunsetOverlay onDismiss={() => setShowSunset(false)} />}
    </div>
  );
}
