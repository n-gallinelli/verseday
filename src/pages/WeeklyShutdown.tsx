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
  const { selectedWeek, setSelectedWeek } = useAppStore();

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


  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full shutdown-page overflow-hidden">
      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {/* ── Header — transparent, gradient shows through ──────────────── */}
      <div className="px-6 py-4 flex-shrink-0" style={{ borderBottom: "0.5px solid var(--border-hairline)" }}>
        <div className="flex items-center justify-between mb-1">
          <span className="uppercase [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] text-accent-green-deep">
            Weekly shutdown
          </span>
          {!isThisWeek && (
            <button
              onClick={() => setSelectedWeek(todayMonday)}
              className="text-[11px] text-accent-green-bright hover:text-accent-green-deep cursor-pointer"
            >
              This week
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => changeWeek(-1)}
            className="w-7 h-7 rounded-full flex items-center justify-center text-fg-muted cursor-pointer hover:bg-overlay-hover transition-colors duration-150 ease-out"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 4l-4 4 4 4" />
            </svg>
          </button>
          <h2 className="text-[14px] font-medium text-fg">
            {formatWeekHeader(selectedWeek)}
          </h2>
          <button
            onClick={() => changeWeek(1)}
            className="w-7 h-7 rounded-full flex items-center justify-center text-fg-muted cursor-pointer hover:bg-overlay-hover transition-colors duration-150 ease-out"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 4l4 4-4 4" />
            </svg>
          </button>
        </div>
      </div>

      {/* Undo banner */}
      {carriedTasks.length > 0 && (
        <div className="px-6 py-2 bg-banner flex-shrink-0" style={{ color: "var(--text-banner)" }}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[12px] opacity-70">
              Moved to next week
            </span>
            <div className="flex gap-1.5 flex-wrap flex-1">
              {carriedTasks.map((ct) => (
                <button
                  key={ct.task.id}
                  onClick={() => undoCarry(ct.task.id)}
                  className="text-[11px] text-accent-green-bright cursor-pointer transition-colors"
                  onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-banner)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = ""; }}
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
            <div className="flex-1">
              {/* Mood selector */}
              <section className="mb-6">
                <h3 className="text-[13px] font-medium text-fg-secondary mb-2">
                  How was your week?
                </h3>
                <MoodSelector
                  value={mood}
                  onChange={handleMoodChange}
                  tintColor="var(--mood-tint-shutdown)"
                />
              </section>

              {/* Reflection — three fields */}
              <section className="space-y-3">
                <div>
                  <label className="text-[13px] font-medium text-fg-secondary mb-1.5 block">
                    What went well this week?
                  </label>
                  <textarea
                    value={reflectionFields.wentWell}
                    onChange={(e) => handleReflectionFieldChange("wentWell", e.target.value)}
                    placeholder="Projects completed, wins achieved, moments that felt good..."
                    rows={2}
                    className="w-full bg-elevated rounded-lg px-3.5 py-2.5 text-[13px] text-fg-secondary resize-y leading-relaxed focus:outline-none focus:border-accent-green-bright placeholder:text-[13px] placeholder:font-normal placeholder:text-fg-faded"
                    style={{ border: "0.5px solid var(--border-hairline)" }}
                  />
                </div>
                <div>
                  <label className="text-[13px] font-medium text-fg-secondary mb-1.5 block">
                    What could have gone better?
                  </label>
                  <textarea
                    value={reflectionFields.couldBeBetter}
                    onChange={(e) => handleReflectionFieldChange("couldBeBetter", e.target.value)}
                    placeholder="Bottlenecks, missteps, things you'd approach differently..."
                    rows={2}
                    className="w-full bg-elevated rounded-lg px-3.5 py-2.5 text-[13px] text-fg-secondary resize-y leading-relaxed focus:outline-none focus:border-accent-green-bright placeholder:text-[13px] placeholder:font-normal placeholder:text-fg-faded"
                    style={{ border: "0.5px solid var(--border-hairline)" }}
                  />
                </div>
                <div>
                  <label className="text-[13px] font-medium text-fg-secondary mb-1.5 block">
                    What's the priority going into next week?
                  </label>
                  <textarea
                    value={reflectionFields.nextWeekPriority}
                    onChange={(e) => handleReflectionFieldChange("nextWeekPriority", e.target.value)}
                    placeholder="The one or two things that matter most, your main focus..."
                    rows={2}
                    className="w-full bg-elevated rounded-lg px-3.5 py-2.5 text-[13px] text-fg-secondary resize-y leading-relaxed focus:outline-none focus:border-accent-green-bright placeholder:text-[13px] placeholder:font-normal placeholder:text-fg-faded"
                    style={{ border: "0.5px solid var(--border-hairline)" }}
                  />
                </div>
              </section>

              {/* Carry forward */}
              <section className="mt-6">
                <h3 className="text-[13px] font-medium text-fg-secondary mb-1.5">
                  Carry forward
                </h3>
                <textarea
                  value={incompleteItemsText}
                  onChange={(e) => handleIncompleteTextChange(e.target.value)}
                  placeholder="Loose ends, things to remember for next week..."
                  className="w-full bg-elevated rounded-lg px-3.5 py-2.5 text-[13px] text-fg-secondary resize-y min-h-[72px] leading-relaxed focus:outline-none focus:border-accent-green-bright placeholder:text-[13px] placeholder:font-normal placeholder:text-fg-faded"
                  style={{ border: "0.5px solid var(--border-hairline)" }}
                />
              </section>

            </div>

            {/* ── Right column: time summary ────────────────────── */}
            <div className="w-[180px] flex-shrink-0">
              <h3 className="uppercase [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] text-fg-faded mb-2">
                Time
              </h3>
              <div className="bg-elevated/40 rounded-lg px-3 py-2.5" style={{ border: "1px solid var(--border-soft)" }}>
                {totalWorkedMinutes === 0 && totalPlannedMinutes === 0 ? (
                  <p className="text-[13px] text-fg-faded">No time tracked this week</p>
                ) : (
                  <>
                    <div className="text-[18px] font-medium text-accent-green-bright leading-none">
                      {formatHoursMinutes(totalWorkedMinutes)}
                    </div>
                    <div className="text-[11px] text-fg-faded mt-1">
                      of {formatHoursMinutes(totalPlannedMinutes)} planned
                    </div>
                  </>
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
            className="px-4 py-2.5 rounded-lg border border-accent-green-bright text-accent-green-bright text-[13px] font-medium cursor-pointer hover:bg-accent-green-soft transition-colors"
          >
            Generate summary
          </button>
          <button
            onClick={completeWeeklyShutdown}
            className="flex-1 py-2.5 rounded-lg bg-accent-green-bright text-fg-on-accent text-[13px] font-medium cursor-pointer hover:bg-accent-green-bright-hover transition-colors"
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
          anchorDate={selectedWeek}
          onClose={() => setShowSummary(false)}
        />
      )}
    </div>
  );
}
