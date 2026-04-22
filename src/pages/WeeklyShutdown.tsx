import { useEffect, useState, useCallback, useRef } from "react";
import { useAppStore } from "../stores/appStore";
import {
  getWeeklyShutdown,
  upsertWeeklyShutdown,
  getTasksForWeek,
  getProjects,
  getPlannedMinutesPerDay,
  getWorkedMinutesForWeek,
  getWorkedMinutesForTaskIds,
  updateTaskDateScheduled,
  addWeeklyPlanProject,
  updateTask,
} from "../db/queries";
import ErrorBanner from "../components/ErrorBanner";
import SunsetOverlay from "../components/SunsetOverlay";
import TaskDetailOverlay from "../components/TaskDetailOverlay";
import SummaryOverlay from "../components/SummaryOverlay";
import MoodSelector from "../components/MoodSelector";
import { formatHoursMinutes } from "../utils/format";
import type { Task, Project } from "../types";
import type { WeeklySummaryData } from "../utils/summaryPrompts";

const WEEKLY_SHUTDOWN_PREFIX = "weekly-shutdown-";

interface WeeklyReflectionFields {
  wentWell: string;
  couldBeBetter: string;
  nextWeekPriority: string;
}

function parseWeeklyReflection(raw: string): WeeklyReflectionFields {
  if (!raw) return { wentWell: "", couldBeBetter: "", nextWeekPriority: "" };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "wentWell" in parsed) {
      return {
        wentWell: parsed.wentWell ?? "",
        couldBeBetter: parsed.couldBeBetter ?? "",
        nextWeekPriority: parsed.nextWeekPriority ?? "",
      };
    }
  } catch {
    // plain text
  }
  return { wentWell: raw, couldBeBetter: "", nextWeekPriority: "" };
}

function serializeWeeklyReflection(fields: WeeklyReflectionFields): string {
  return JSON.stringify(fields);
}

const OLD_CHECKLIST_PREFIX = "verseday_shutdown_checklist_";

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
  const { selectedWeek, setSelectedWeek, openProject } = useAppStore();

  const [weekTasks, setWeekTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [mood, setMood] = useState<string | null>(null);
  const [reflectionFields, setReflectionFields] = useState<WeeklyReflectionFields>({
    wentWell: "",
    couldBeBetter: "",
    nextWeekPriority: "",
  });
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
  const [showSummary, setShowSummary] = useState(false);
  const [workedPerTask, setWorkedPerTask] = useState<Map<number, number>>(new Map());

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
      const [sd, wt, p, wbd, pbd] = await Promise.all([
        getWeeklyShutdown(selectedWeek),
        getTasksForWeek(selectedWeek, fridayIso),
        getProjects(),
        getWorkedMinutesForWeek(selectedWeek, fridayIso),
        getPlannedMinutesPerDay(selectedWeek, fridayIso),
      ]);

      setWeekTasks(wt);
      setProjects(p);
      setWorkedByDay(wbd);
      setPlannedByDay(pbd);
      setMood(sd?.mood ?? null);
      setReflectionFields(parseWeeklyReflection(sd?.reflections ?? ""));
      setIncompleteItemsText(sd?.incomplete_items ?? "");
      setCarriedIds(new Set());
      setCarriedTasks([]);
      setIsWeekShutdown(
        localStorage.getItem(WEEKLY_SHUTDOWN_PREFIX + selectedWeek) === "true"
      );
      // Per-task worked minutes for summary
      const taskIds = wt.map((t) => t.id);
      if (taskIds.length > 0) {
        const wpt = await getWorkedMinutesForTaskIds(taskIds);
        setWorkedPerTask(wpt);
      } else {
        setWorkedPerTask(new Map());
      }
      setError(null);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to load shutdown data"
      );
    }
  }, [selectedWeek, fridayIso]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Debounced auto-save ───────────────────────────────────────────────

  function debouncedSave(newMood: string | null, newFields: WeeklyReflectionFields, newIncomplete: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const serialized = serializeWeeklyReflection(newFields);
        await upsertWeeklyShutdown(
          selectedWeekRef.current,
          serialized || null,
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

  function handleMoodChange(value: string | null) {
    setMood(value);
    debouncedSave(value, reflectionFields, incompleteItemsText);
  }

  function handleReflectionFieldChange(key: keyof WeeklyReflectionFields, value: string) {
    const next = { ...reflectionFields, [key]: value };
    setReflectionFields(next);
    debouncedSave(mood, next, incompleteItemsText);
  }

  function handleIncompleteTextChange(value: string) {
    setIncompleteItemsText(value);
    debouncedSave(mood, reflectionFields, value);
  }

  // ── Actions ───────────────────────────────────────────────────────────

  async function carryForward(task: Task) {
    try {
      const originalDate = task.date_scheduled;
      await updateTaskDateScheduled(task.id, nextMonday);
      setCarriedIds((prev) => new Set(prev).add(task.id));
      setCarriedTasks((prev) => [...prev, { task, originalDate }]);

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
      const serialized = serializeWeeklyReflection(reflectionFields);
      await upsertWeeklyShutdown(
        selectedWeekRef.current,
        serialized || null,
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


  // Week summary: projects with work this week
  const weekSummaryProjects = (() => {
    const byProject = new Map<number, { id: number; name: string; color: string }>();
    for (const task of weekTasks) {
      if (task.project_id == null) continue;
      if (!byProject.has(task.project_id)) {
        const p = projectMap.get(task.project_id);
        if (p) byProject.set(task.project_id, { id: p.id, name: p.name, color: p.color });
      }
    }
    return Array.from(byProject.values());
  })();

  function buildWeeklySummaryData(): WeeklySummaryData {
    // Group tasks by project and compute per-project stats
    const byProject = new Map<number | null, { completed: Task[]; incomplete: Task[]; workedMinutes: number }>();
    for (const task of weekTasks) {
      const key = task.project_id;
      const entry = byProject.get(key) ?? { completed: [], incomplete: [], workedMinutes: 0 };
      if (task.status === "done") entry.completed.push(task);
      else entry.incomplete.push(task);
      entry.workedMinutes += workedPerTask.get(task.id) ?? 0;
      byProject.set(key, entry);
    }

    const projectSummaries = Array.from(byProject.entries())
      .filter(([pid]) => pid !== null)
      .map(([pid, data]) => ({
        name: projectMap.get(pid!)?.name ?? "Unknown",
        completedCount: data.completed.length,
        incompleteCount: data.incomplete.length,
        workedMinutes: data.workedMinutes,
      }))
      .sort((a, b) => b.workedMinutes - a.workedMinutes);

    return {
      weekOf: formatWeekHeader(selectedWeek),
      totalWorkedMinutes: totalWorkedMinutes,
      totalPlannedMinutes: totalPlannedMinutes,
      projects: projectSummaries,
      completedCount: completedTasks.length,
      incompleteCount: incompleteTasks.length,
      mood,
      reflections: serializeWeeklyReflection(reflectionFields) || null,
      carryForward: incompleteItemsText.trim() || null,
    };
  }

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full shutdown-page overflow-hidden">
      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {/* ── Header — transparent, gradient shows through ──────────────── */}
      <div className="px-6 py-4 flex-shrink-0" style={{ borderBottom: "0.5px solid rgba(0,0,0,0.06)" }}>
        <div className="flex items-center justify-between mb-1">
          <span className="uppercase [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] text-[#0F6E56]">
            Weekly shutdown
          </span>
          {!isThisWeek && (
            <button
              onClick={() => setSelectedWeek(todayMonday)}
              className="text-[11px] text-[#5DCAA5] hover:text-[#0F6E56] cursor-pointer"
            >
              This week
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => changeWeek(-1)}
            className="w-6 h-6 rounded-md bg-white/60 border border-black/[0.06] flex items-center justify-center text-black/35 text-[12px] cursor-pointer hover:bg-white"
          >
            ‹
          </button>
          <h2 className="text-[14px] font-medium text-[#2c2a35]">
            {formatWeekHeader(selectedWeek)}
          </h2>
          <button
            onClick={() => changeWeek(1)}
            className="w-6 h-6 rounded-md bg-white/60 border border-black/[0.06] flex items-center justify-center text-black/35 text-[12px] cursor-pointer hover:bg-white"
          >
            ›
          </button>
        </div>
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
                <h3 className="uppercase [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] text-black/30 mb-2">
                  How was your week?
                </h3>
                <MoodSelector
                  value={mood}
                  onChange={handleMoodChange}
                  tintColor="#5DCAA5"
                />
              </section>

              {/* Reflection — three fields */}
              <section className="space-y-3">
                <div>
                  <label className="uppercase [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] text-black/30 mb-1 block">
                    What went well this week?
                  </label>
                  <textarea
                    value={reflectionFields.wentWell}
                    onChange={(e) => handleReflectionFieldChange("wentWell", e.target.value)}
                    rows={2}
                    className="w-full bg-white rounded-lg px-3.5 py-2.5 text-[13px] text-black/55 placeholder-black/20 resize-y leading-relaxed focus:outline-none focus:border-[#5DCAA5]/40"
                    style={{ border: "0.5px solid rgba(0,0,0,0.06)" }}
                  />
                </div>
                <div>
                  <label className="uppercase [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] text-black/30 mb-1 block">
                    What could have gone better?
                  </label>
                  <textarea
                    value={reflectionFields.couldBeBetter}
                    onChange={(e) => handleReflectionFieldChange("couldBeBetter", e.target.value)}
                    rows={2}
                    className="w-full bg-white rounded-lg px-3.5 py-2.5 text-[13px] text-black/55 placeholder-black/20 resize-y leading-relaxed focus:outline-none focus:border-[#5DCAA5]/40"
                    style={{ border: "0.5px solid rgba(0,0,0,0.06)" }}
                  />
                </div>
                <div>
                  <label className="uppercase [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] text-black/30 mb-1 block">
                    What's the priority going into next week?
                  </label>
                  <textarea
                    value={reflectionFields.nextWeekPriority}
                    onChange={(e) => handleReflectionFieldChange("nextWeekPriority", e.target.value)}
                    rows={2}
                    className="w-full bg-white rounded-lg px-3.5 py-2.5 text-[13px] text-black/55 placeholder-black/20 resize-y leading-relaxed focus:outline-none focus:border-[#5DCAA5]/40"
                    style={{ border: "0.5px solid rgba(0,0,0,0.06)" }}
                  />
                </div>
              </section>

              {/* Carry forward */}
              <section>
                <h3 className="uppercase [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] text-black/30 mb-2">
                  Carry forward
                </h3>
                <textarea
                  value={incompleteItemsText}
                  onChange={(e) => handleIncompleteTextChange(e.target.value)}
                  placeholder="Loose ends, things to remember for next week..."
                  className="w-full bg-white rounded-lg px-3.5 py-2.5 text-[13px] text-black/55 placeholder-black/20 resize-y min-h-[72px] leading-relaxed focus:outline-none focus:border-[#5DCAA5]/40"
                  style={{ border: "0.5px solid rgba(0,0,0,0.06)" }}
                />
              </section>

            </div>

            {/* ── Right column: info cards (180px) ──────────────── */}
            <div className="w-[180px] flex-shrink-0 space-y-3">
              {/* Time card */}
              <div className="bg-white/40 rounded-lg px-3 py-2.5" style={{ border: "1px solid rgba(0,0,0,0.08)" }}>
                <div className="uppercase [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] text-black/25 mb-1">Time</div>
                {totalWorkedMinutes === 0 && totalPlannedMinutes === 0 ? (
                  <p className="text-[13px] text-black/[0.3]">No time tracked this week</p>
                ) : (
                  <>
                    <div className="text-[18px] font-medium text-[#5DCAA5] leading-none">
                      {formatHoursMinutes(totalWorkedMinutes)}
                    </div>
                    <div className="text-[11px] text-black/30 mt-1">
                      of {formatHoursMinutes(totalPlannedMinutes)} planned
                    </div>
                  </>
                )}
              </div>

              {/* Projects this week card */}
              <div className="bg-white/40 rounded-lg px-3 py-2.5" style={{ border: "1px solid rgba(0,0,0,0.12)" }}>
                <div className="uppercase [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] text-black/25 mb-2">Projects this week</div>
                {weekSummaryProjects.length > 0 ? (
                  <div className="space-y-3">
                    {weekSummaryProjects.map((p) => (
                      <div key={p.id}>
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
                          <span
                            className="text-[13px] text-[#2c2a35] cursor-pointer hover:text-[#7B9ED9] transition-colors"
                            onClick={() => openProject(p.id)}
                          >
                            {p.name}
                          </span>
                        </div>
                        <label className="uppercase [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] text-black/25 mb-0.5 block">
                          How did this project go?
                        </label>
                        <textarea
                          placeholder="How did this project go?"
                          rows={2}
                          className="w-full text-[12px] text-black/50 placeholder-black/20 resize-y bg-white rounded-md px-2 py-1.5 leading-relaxed outline-none focus:border-[#5DCAA5]/40"
                          style={{ border: "0.5px solid rgba(0,0,0,0.08)" }}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[13px] text-black/20">No projects worked on this week</p>
                )}
              </div>

            </div>
          </div>
        </div>
      </div>

      {/* ── Footer — shutdown button ────────────────────────────────── */}
      <div className="px-6 py-4 flex-shrink-0">
        <div className="max-w-[860px] mx-auto flex gap-2">
          <button
            onClick={() => setShowSummary(true)}
            className="px-4 py-2.5 rounded-lg border border-[#5DCAA5] text-[#5DCAA5] text-[13px] font-medium cursor-pointer hover:bg-[#E1F5EE] transition-colors"
          >
            Generate summary
          </button>
          <button
            onClick={completeWeeklyShutdown}
            className="flex-1 py-2.5 rounded-lg bg-[#5DCAA5] text-white text-[13px] font-medium cursor-pointer hover:bg-[#4ab893] transition-colors"
          >
            Save & shutdown
          </button>
        </div>
      </div>

      {/* Task detail overlay */}
      {detailTask && (
        <TaskDetailOverlay
          key={detailTask.id}
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

      {/* Weekly summary overlay */}
      {showSummary && (
        <SummaryOverlay
          type="weekly"
          data={buildWeeklySummaryData()}
          onClose={() => setShowSummary(false)}
        />
      )}
    </div>
  );
}
