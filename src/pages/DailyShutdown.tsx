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
  const { selectedDate, setSelectedDate, setPage } = useAppStore();

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
  const [step, setStep] = useState<1 | 2>(1);

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
    setStep(1);
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

  // Escape: leave shutdown back to the daily plan. Skip while typing in any
  // textarea/input so the user can hit Escape to blur first.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      const el = document.activeElement;
      const isInput =
        el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || (el as HTMLElement).isContentEditable);
      if (isInput) {
        (el as HTMLElement).blur();
        return;
      }
      e.preventDefault();
      setPage("daily");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPage]);

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

      {/* ── Body — two-step flow ────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[640px] mx-auto px-6 py-5 space-y-6">
          {/* Step indicator */}
          <div className="flex items-center gap-2 text-[11px] text-fg-faded">
            <span className={step === 1 ? "text-fg-secondary font-medium" : ""}>Review</span>
            <span>→</span>
            <span className={step === 2 ? "text-fg-secondary font-medium" : ""}>Reflect</span>
          </div>

          {step === 1 && (
            <>
              {/* Done today — task cards */}
              <section>
                <div className="flex items-baseline justify-between mb-2">
                  <h3 className="text-[13px] font-medium text-fg-secondary">
                    Done today
                  </h3>
                  {highlightIds.size > 0 && (
                    <span className="text-[11px] text-fg-faded">
                      {highlightIds.size} {highlightIds.size === 1 ? "highlight" : "highlights"} starred
                    </span>
                  )}
                </div>
                {completedTasks.length > 0 ? (
                  <div className="space-y-1">
                    {completedTasks.map((task) => {
                      const isHighlight = highlightIds.has(task.id);
                      const project = task.project_id != null ? projectMap.get(task.project_id) : null;
                      const worked = workedPerTask.get(task.id) ?? 0;
                      return (
                        <div
                          key={task.id}
                          className="px-2.5 py-[6px] rounded-md border border-line-soft bg-elevated/60 flex items-center gap-2.5 transition-colors hover:bg-overlay-hover"
                        >
                          <button
                            onClick={() => handleToggleHighlight(task.id)}
                            className="flex-shrink-0 cursor-pointer"
                            title={isHighlight ? "Remove highlight" : "Mark as highlight"}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill={isHighlight ? "var(--accent-warning)" : "none"} stroke={isHighlight ? "var(--accent-warning)" : "var(--text-disabled)"} strokeWidth="2">
                              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                            </svg>
                          </button>
                          {project && (
                            <span
                              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                              style={{ backgroundColor: project.color }}
                              title={project.name}
                            />
                          )}
                          <span className="flex-1 text-[12px] text-fg-faded line-through truncate">{task.title}</span>
                          {project && (
                            <span className="text-[10px] text-fg-faded shrink-0 max-w-[120px] truncate">{project.name}</span>
                          )}
                          {worked > 0 && (
                            <span className="text-[10px] text-fg-faded tabular-nums shrink-0">{worked}m</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[12px] text-fg-disabled px-2.5">No tasks completed</p>
                )}
              </section>

              {/* Didn't get to — task cards */}
              <section>
                <div className="flex items-baseline justify-between mb-2">
                  <h3 className="text-[13px] font-medium text-fg-secondary">
                    Didn&rsquo;t get to
                  </h3>
                  {incompleteTasks.filter((t) => !carriedIds.has(t.id)).length > 0 && (
                    <button
                      onClick={carryAllToTomorrow}
                      className="text-[11px] text-accent-blue-soft-fg hover:text-accent-blue cursor-pointer"
                    >
                      Move all to tomorrow &rarr;
                    </button>
                  )}
                </div>
                {incompleteTasks.length > 0 ? (
                  <div className="space-y-1">
                    {incompleteTasks.map((task) => {
                      const isCarried = carriedIds.has(task.id);
                      const project = task.project_id != null ? projectMap.get(task.project_id) : null;
                      const est = task.estimated_minutes ?? 0;
                      return (
                        <div
                          key={task.id}
                          className="group/row px-2.5 py-[6px] rounded-md border border-line-soft bg-elevated/60 flex items-center gap-2.5 transition-colors hover:bg-overlay-hover"
                        >
                          {task.priority === "high" && (
                            <span className="w-[14px] h-[14px] rounded-full border-2 border-accent-danger flex-shrink-0" title="High priority" />
                          )}
                          {project && (
                            <span
                              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                              style={{ backgroundColor: project.color }}
                              title={project.name}
                            />
                          )}
                          <span className={`flex-1 text-[12px] truncate ${isCarried ? "text-fg-faded italic" : "text-fg"}`}>{task.title}</span>
                          {project && !isCarried && (
                            <span className="text-[10px] text-fg-faded shrink-0 max-w-[120px] truncate">{project.name}</span>
                          )}
                          {est > 0 && !isCarried && (
                            <span className="text-[10px] text-fg-faded tabular-nums shrink-0">{est}m</span>
                          )}
                          {isCarried ? (
                            <span className="text-[10px] text-accent-green flex-shrink-0">Moved →</span>
                          ) : (
                            <button
                              onClick={() => carryTaskToTomorrow(task.id)}
                              className="text-[10px] text-accent-blue-soft-fg hover:text-accent-blue cursor-pointer flex-shrink-0 opacity-0 group-hover/row:opacity-100 transition-opacity"
                              title="Move to tomorrow"
                            >
                              Move →
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[12px] text-fg-disabled px-2.5">Everything done!</p>
                )}
              </section>

              {/* Time tracked — small footer summary */}
              {(workedMinutes > 0 || plannedMinutes > 0) && (
                <p className="text-[11px] text-fg-faded">
                  {formatHoursMinutes(workedMinutes)} worked
                  {plannedMinutes > 0 && ` of ${formatHoursMinutes(plannedMinutes)} planned`}
                </p>
              )}
            </>
          )}

          {step === 2 && (
            <>
              {/* Highlights summary — read-only carry from step 1 */}
              {highlightIds.size > 0 && (
                <section>
                  <h3 className="text-[13px] font-medium text-fg-secondary mb-2">
                    Today&rsquo;s highlights
                  </h3>
                  <div className="bg-elevated/60 rounded-md px-3 py-2.5 border border-transparent">
                    <div className="space-y-1.5">
                      {completedTasks
                        .filter((t) => highlightIds.has(t.id))
                        .map((task) => (
                          <div key={task.id} className="flex items-center gap-2">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="var(--accent-warning)" stroke="var(--accent-warning)" strokeWidth="2" className="flex-shrink-0">
                              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                            </svg>
                            <span className="text-[13px] text-fg font-medium truncate flex-1">{task.title}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                </section>
              )}

              {/* Mood */}
              <section>
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
                      className="w-full bg-elevated/60 rounded-md px-3 py-2 text-[13px] text-fg-secondary resize-y leading-relaxed border border-transparent focus:outline-none focus:border-accent-blue placeholder:text-[13px] placeholder:font-normal placeholder:text-fg-faded transition-colors"
                    />
                  </div>
                ))}
              </section>
            </>
          )}
        </div>
      </div>

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <div className="px-6 py-4 flex-shrink-0">
        <div className="max-w-[640px] mx-auto flex items-center gap-2">
          {step === 1 ? (
            <button
              onClick={() => setStep(2)}
              className="flex-1 py-2.5 rounded-lg border border-accent-blue/50 text-accent-blue-soft-fg text-[13px] font-medium cursor-pointer hover:border-accent-blue hover:bg-accent-blue-soft transition-colors flex items-center justify-center gap-1.5"
            >
              <svg width="14" height="12" viewBox="0 0 14 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                {/* Heart — reflection/gratitude */}
                <path d="M7 11 C2 7.5 1 4.5 3 2.5 C4.5 1 6.5 2 7 3.5 C7.5 2 9.5 1 11 2.5 C13 4.5 12 7.5 7 11 Z" />
              </svg>
              Reflect
            </button>
          ) : (
            <>
              <button
                onClick={() => setStep(1)}
                className="px-3.5 py-2.5 rounded-lg border border-line-soft text-fg-secondary text-[13px] font-medium cursor-pointer hover:bg-overlay-hover transition-colors"
              >
                &larr; Back
              </button>
              <button
                onClick={completeShutdown}
                className="flex-1 py-2.5 rounded-lg border border-accent-blue/50 text-accent-blue-soft-fg text-[13px] font-medium cursor-pointer hover:border-accent-blue hover:bg-accent-blue-soft transition-colors flex items-center justify-center gap-1.5"
              >
                <svg width="14" height="10" viewBox="0 0 14 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  {/* Closed eye — eyelid arc + lashes */}
                  <path d="M1.5 4 Q7 9 12.5 4" />
                  <path d="M3 6.5 l-0.5 1.5" />
                  <path d="M7 7.5 l0 1.5" />
                  <path d="M11 6.5 l0.5 1.5" />
                </svg>
                Shutdown
              </button>
              <button
                onClick={() => setShowSummary(true)}
                className="px-5 py-2.5 rounded-lg border border-line-soft text-fg-secondary text-[13px] font-medium cursor-pointer hover:bg-overlay-hover transition-colors"
              >
                Summary
              </button>
            </>
          )}
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
