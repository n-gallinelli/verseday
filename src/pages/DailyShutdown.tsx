import { useEffect, useState, useCallback, useRef } from "react";
import { useAppStore } from "../stores/appStore";
import {
  getTasksForDate,
  getDailyPlan,
  getTotalWorkedMinutes,
  getTotalPlannedMinutes,
  getWorkedMinutesForTaskIds,
  updateTaskDateScheduled,
  upsertDailyShutdown,
  getProjects,
  toggleTaskHighlight,
} from "../db/queries";
import ErrorBanner from "../components/ErrorBanner";
import SunsetOverlay from "../components/SunsetOverlay";
import SummaryOverlay from "../components/SummaryOverlay";
import MoodSelector from "../components/MoodSelector";
import { formatHoursMinutes } from "../utils/format";
import type { Task, Project } from "../types";

const SHUTDOWN_KEY_PREFIX = "daily-shutdown-";

// Parse reflection: JSON with 3 fields, or plain text in field1
interface ReflectionFields {
  howDidItGo: string;
  whatDifferently: string;
  gratefulFor: string;
}

function parseReflection(raw: string): ReflectionFields {
  if (!raw) return { howDidItGo: "", whatDifferently: "", gratefulFor: "" };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "howDidItGo" in parsed) {
      return {
        howDidItGo: parsed.howDidItGo ?? "",
        whatDifferently: parsed.whatDifferently ?? "",
        gratefulFor: parsed.gratefulFor ?? "",
      };
    }
  } catch {
    // plain text — put in first field
  }
  return { howDidItGo: raw, whatDifferently: "", gratefulFor: "" };
}

function serializeReflection(fields: ReflectionFields): string {
  return JSON.stringify(fields);
}

export default function DailyShutdown() {
  const { selectedDate, setSelectedDate } = useAppStore();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [plannedMinutes, setPlannedMinutes] = useState(0);
  const [workedMinutes, setWorkedMinutes] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [mood, setMood] = useState<string | null>(null);
  const [reflectionFields, setReflectionFields] = useState<ReflectionFields>({
    howDidItGo: "",
    whatDifferently: "",
    gratefulFor: "",
  });
  const [carriedIds, setCarriedIds] = useState<Set<number>>(new Set());
  const [isShutdown, setIsShutdown] = useState(false);
  const [showSunset, setShowSunset] = useState(false);
  const [highlightIds, setHighlightIds] = useState<Set<number>>(new Set());
  const [workedPerTask, setWorkedPerTask] = useState<Map<number, number>>(new Map());
  const [showSummary, setShowSummary] = useState(false);

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
      setReflectionFields(parseReflection(dp?.reflection ?? ""));
      setIsShutdown(
        localStorage.getItem(SHUTDOWN_KEY_PREFIX + selectedDate) === "true"
      );
      setCarriedIds(new Set());
      setHighlightIds(new Set(t.filter((x) => x.is_highlight).map((x) => x.id)));
      const taskIds = t.map((x) => x.id);
      if (taskIds.length > 0) {
        const wpt = await getWorkedMinutesForTaskIds(taskIds);
        setWorkedPerTask(wpt);
      } else {
        setWorkedPerTask(new Map());
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
    }
  }, [selectedDate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Auto-save mood + reflection
  function debouncedSave(newMood: string | null, newFields: ReflectionFields) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const serialized = serializeReflection(newFields);
        await upsertDailyShutdown(
          selectedDateRef.current,
          newMood,
          serialized || null
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

  function handleMoodChange(value: string | null) {
    setMood(value);
    debouncedSave(value, reflectionFields);
  }

  function handleReflectionFieldChange(key: keyof ReflectionFields, value: string) {
    const next = { ...reflectionFields, [key]: value };
    setReflectionFields(next);
    debouncedSave(mood, next);
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
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    try {
      const serialized = serializeReflection(reflectionFields);
      await upsertDailyShutdown(
        selectedDate,
        mood,
        serialized || null
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

  async function handleToggleHighlight(taskId: number) {
    const isCurrently = highlightIds.has(taskId);
    if (!isCurrently && highlightIds.size >= 3) return;
    try {
      await toggleTaskHighlight(taskId, !isCurrently);
      setHighlightIds((prev) => {
        const next = new Set(prev);
        if (isCurrently) next.delete(taskId);
        else next.add(taskId);
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to toggle highlight");
    }
  }


  const completedTasks = tasks.filter((t) => t.status === "done");
  const incompleteTasks = tasks.filter((t) => t.status !== "done");

  const REFLECTION_FIELDS: { key: keyof ReflectionFields; label: string; placeholder: string }[] = [
    {
      key: "howDidItGo",
      label: "How did today go?",
      placeholder: "What you accomplished, what went smoothly, progress made...",
    },
    {
      key: "whatDifferently",
      label: "What would you do differently?",
      placeholder: "Missteps, friction points, what you'd change next time...",
    },
    {
      key: "gratefulFor",
      label: "What are you grateful for?",
      placeholder: "People, moments, things that went well, small wins...",
    },
  ];

  return (
    <div className="flex flex-col h-full shutdown-page overflow-hidden">
      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {/* ── Header — transparent, gradient shows through ────────────── */}
      <div className="px-6 py-4 flex-shrink-0" style={{ borderBottom: "0.5px solid var(--border-hairline)" }}>
        <span className="uppercase [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] text-accent-blue-soft-fg block mb-1">
          Daily shutdown
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => changeDate(-1)}
            className="w-7 h-7 rounded-full flex items-center justify-center text-fg-muted cursor-pointer hover:bg-overlay-hover transition-colors duration-150 ease-out"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 4l-4 4 4 4" />
            </svg>
          </button>
          <h2 className="text-[14px] font-medium text-fg">
            {new Date(selectedDate + "T00:00:00").toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </h2>
          <button
            onClick={() => changeDate(1)}
            className="w-7 h-7 rounded-full flex items-center justify-center text-fg-muted cursor-pointer hover:bg-overlay-hover transition-colors duration-150 ease-out"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 4l4 4-4 4" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Body — two columns ──────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[860px] mx-auto px-6 py-5">
          <div className="flex gap-3">
            {/* ── Left column: mood + reflection ────────────────── */}
            <div className="flex-1">
              {/* Mood selector */}
              <section className="mb-6">
                <h3 className="text-[13px] font-medium text-fg-secondary mb-2">
                  How was your day?
                </h3>
                <MoodSelector
                  value={mood}
                  onChange={handleMoodChange}
                  tintColor="var(--mood-tint-daily)"
                />
              </section>

              {/* Reflection — three fields */}
              <section className="space-y-3">
                {REFLECTION_FIELDS.map((field) => (
                  <div key={field.key}>
                    <label className="text-[13px] font-medium text-fg-secondary mb-1.5 block">
                      {field.label}
                    </label>
                    <textarea
                      value={reflectionFields[field.key]}
                      onChange={(e) => handleReflectionFieldChange(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      rows={2}
                      className="w-full bg-elevated rounded-lg px-3.5 py-2.5 text-[13px] text-fg-secondary resize-y leading-relaxed focus:outline-none focus:border-accent-blue placeholder:text-[13px] placeholder:font-normal placeholder:text-fg-faded"
                      style={{ border: "0.5px solid var(--border-hairline)" }}
                    />
                  </div>
                ))}
              </section>
            </div>

            {/* ── Right column: info cards (180px) ──────────────── */}
            <div className="w-[180px] flex-shrink-0">
              {/* Mirror the left column's <section mb-6> + <h3 mb-2> wrapper
                  so the Time card top aligns with the mood selector top.
                  Heading is invisible — same height contributor only. */}
              <section className="mb-6">
                <h3 aria-hidden className="text-[13px] font-medium mb-2 invisible select-none">&nbsp;</h3>
                {/* Time card */}
                <div className="bg-elevated/40 rounded-lg px-3 py-2.5" style={{ border: "1px solid var(--border-soft)" }}>
                <div className="uppercase [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] text-fg-faded mb-1">Time</div>
                {workedMinutes === 0 && plannedMinutes === 0 ? (
                  <p className="text-[13px] text-fg-faded">No time tracked today</p>
                ) : (
                  <>
                    <div className="text-[18px] font-medium text-accent-blue leading-none">
                      {formatHoursMinutes(workedMinutes)}
                    </div>
                    <div className="text-[11px] text-fg-faded mt-1">
                      of {formatHoursMinutes(plannedMinutes)} planned
                    </div>
                  </>
                )}
                </div>
              </section>

              <section className="space-y-3">
              {/* Done today card */}
              <div className="bg-elevated/40 rounded-lg px-3 py-2.5" style={{ border: "1px solid var(--border-medium)" }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="uppercase [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] text-fg-faded">Done today</span>
                  {completedTasks.length > 0 && highlightIds.size < 3 && (
                    <span className="text-[9px] text-fg-disabled">Star highlights</span>
                  )}
                </div>
                {completedTasks.length > 0 ? (
                  <div className="space-y-1">
                    {completedTasks.map((task) => {
                      const isHighlight = highlightIds.has(task.id);
                      return (
                        <div key={task.id} className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleToggleHighlight(task.id)}
                            className="flex-shrink-0 cursor-pointer"
                            title={isHighlight ? "Remove highlight" : highlightIds.size >= 3 ? "Max 3 highlights" : "Mark as highlight"}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill={isHighlight ? "var(--accent-warning)" : "none"} stroke={isHighlight ? "var(--accent-warning)" : "var(--text-disabled)"} strokeWidth="2">
                              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                            </svg>
                          </button>
                          <span className="w-[11px] h-[11px] rounded-[2px] bg-accent-green flex items-center justify-center flex-shrink-0">
                            <svg width="6" height="6" viewBox="0 0 8 8" fill="none" stroke="var(--text-on-accent)" strokeWidth="1.4" strokeLinecap="round">
                              <path d="M1.5 4l2 2 3-3" />
                            </svg>
                          </span>
                          <span className="text-[13px] text-fg-faded line-through truncate">{task.title}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[13px] text-fg-disabled">No tasks completed</p>
                )}
              </div>

              {/* Didn't get to card */}
              <div className="bg-elevated/40 rounded-lg px-3 py-2.5" style={{ border: "1px solid var(--border-medium)" }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="uppercase [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] text-fg-faded">Didn&rsquo;t get to</span>
                  {incompleteTasks.filter((t) => !carriedIds.has(t.id)).length > 0 && (
                    <button
                      onClick={carryAllToTomorrow}
                      className="text-[9px] text-accent-blue-soft-fg hover:text-accent-blue cursor-pointer"
                    >
                      Move all &rarr;
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
                            <span className="text-[13px] text-fg-faded italic truncate flex-1">{task.title}</span>
                          ) : (
                            <button
                              onClick={() => carryTaskToTomorrow(task.id)}
                              className="text-[13px] text-fg truncate flex-1 text-left cursor-pointer hover:text-accent-blue"
                            >
                              {task.title}
                            </button>
                          )}
                          {isCarried && (
                            <span className="text-[9px] text-accent-green flex-shrink-0">Moved</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[13px] text-fg-disabled">Everything done!</p>
                )}
              </div>
              </section>
            </div>
          </div>
        </div>
      </div>

      {/* ── Footer — shutdown button ────────────────────────────────── */}
      <div className="px-6 py-4 flex-shrink-0">
        <div className="max-w-[860px] mx-auto flex gap-2">
          <button
            onClick={() => setShowSummary(true)}
            className="px-4 py-2.5 rounded-lg border border-accent-blue text-accent-blue-soft-fg text-[13px] font-medium cursor-pointer hover:bg-accent-blue-soft transition-colors"
          >
            Generate summary
          </button>
          <button
            onClick={completeShutdown}
            className="flex-1 py-2.5 rounded-lg bg-accent-blue text-fg-on-accent text-[13px] font-medium cursor-pointer hover:bg-accent-blue-hover transition-colors"
          >
            Save & shutdown
          </button>
        </div>
      </div>

      {showSunset && <SunsetOverlay onDismiss={() => setShowSunset(false)} />}
      {showSummary && (
        <SummaryOverlay
          type="daily"
          anchorDate={selectedDate}
          onClose={() => setShowSummary(false)}
        />
      )}
    </div>
  );
}
