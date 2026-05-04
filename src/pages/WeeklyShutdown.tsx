import { useEffect, useState, useCallback, useRef } from "react";
import { useAppStore } from "../stores/appStore";
import {
  getWeeklyShutdown,
  upsertWeeklyShutdown,
  getTasksCompletedInWeek,
  getProjects,
  getWorkedMinutesForWeek,
  getWorkedMinutesForTaskIds,
} from "../db/queries";
import ErrorBanner from "../components/ErrorBanner";
import { errorMessage } from "../utils/errors";
import SunsetOverlay from "../components/SunsetOverlay";
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

function formatWeekHeader(mondayIso: string): string {
  const d = new Date(mondayIso + "T00:00:00");
  return `Week of ${d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })}`;
}

function formatDayHeading(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function getMondayOfWeek(date: Date = new Date()): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split("T")[0];
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

  const [completedThisWeek, setCompletedThisWeek] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [mood, setMood] = useState<string | null>(null);
  const [reflectionFields, setReflectionFields] = useState<WeeklyReflectionFields>({
    wentWell: "",
    couldBeBetter: "",
    nextWeekPriority: "",
  });
  const [incompleteItemsText, setIncompleteItemsText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showSunset, setShowSunset] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [workedPerTask, setWorkedPerTask] = useState<Map<number, number>>(new Map());
  const [totalWorkedMinutes, setTotalWorkedMinutes] = useState(0);
  const [step, setStep] = useState<1 | 2>(1);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedWeekRef = useRef(selectedWeek);
  selectedWeekRef.current = selectedWeek;
  const cleanedUp = useRef(false);

  const fridayIso = getFridayIso(selectedWeek);
  const todayMonday = getMondayOfWeek();
  const weekDates = getWeekdayDates(selectedWeek);

  const projectMap = new Map(projects.map((p) => [p.id, p]));

  // One-time cleanup
  useEffect(() => {
    if (!cleanedUp.current) {
      cleanedUp.current = true;
      cleanupOldChecklistKeys();
    }
  }, []);

  // Shutdown is always for the current week — if the user got here while
  // browsing a different week (e.g., on the weekly plan), snap to this
  // week on mount. Mirrors the daily shutdown's behavior.
  useEffect(() => {
    if (selectedWeek !== todayMonday) setSelectedWeek(todayMonday);
    // intentionally only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset to step 1 whenever the week changes
  useEffect(() => {
    setStep(1);
  }, [selectedWeek]);

  // ── Data loading ──────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    try {
      const [sd, completed, p, wbd] = await Promise.all([
        getWeeklyShutdown(selectedWeek),
        getTasksCompletedInWeek(selectedWeek, fridayIso),
        getProjects(),
        getWorkedMinutesForWeek(selectedWeek, fridayIso),
      ]);
      setCompletedThisWeek(completed);
      setProjects(p);
      setMood(sd?.mood ?? null);
      setReflectionFields(parseWeeklyReflection(sd?.reflections ?? ""));
      setIncompleteItemsText(sd?.incomplete_items ?? "");
      setTotalWorkedMinutes(
        Array.from(wbd.values()).reduce((s, m) => s + m, 0)
      );
      if (completed.length > 0) {
        const wpt = await getWorkedMinutesForTaskIds(completed.map((t) => t.id));
        setWorkedPerTask(wpt);
      } else {
        setWorkedPerTask(new Map());
      }
      setError(null);
    } catch (e) {
      setError(errorMessage(e, "Failed to load shutdown data"));
    }
  }, [selectedWeek, fridayIso]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Debounced auto-save ───────────────────────────────────────────────

  function debouncedSave(
    newMood: string | null,
    newFields: WeeklyReflectionFields,
    newIncomplete: string
  ) {
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
        setError(errorMessage(e, "Failed to save"));
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

  function handleReflectionFieldChange(
    key: keyof WeeklyReflectionFields,
    value: string
  ) {
    const next = { ...reflectionFields, [key]: value };
    setReflectionFields(next);
    debouncedSave(mood, next, incompleteItemsText);
  }

  function handleIncompleteTextChange(value: string) {
    setIncompleteItemsText(value);
    debouncedSave(mood, reflectionFields, value);
  }

  // ── Actions ───────────────────────────────────────────────────────────

  async function completeWeeklyShutdown() {
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
      setError(errorMessage(e, "Failed to save"));
      return;
    }
    localStorage.setItem(WEEKLY_SHUTDOWN_PREFIX + selectedWeek, "true");
    setShowSunset(true);
  }

  // ── Derived ───────────────────────────────────────────────────────────

  // Group completed tasks by the day they were checked off (completed_at),
  // falling back to date_scheduled for legacy rows that have no timestamp.
  const tasksByDay = new Map<string, Task[]>();
  for (const date of weekDates) tasksByDay.set(date, []);
  for (const t of completedThisWeek) {
    const stamp = (t.completed_at ?? t.date_scheduled ?? "").slice(0, 10);
    if (tasksByDay.has(stamp)) {
      tasksByDay.get(stamp)!.push(t);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full shutdown-page overflow-hidden">
      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div
        className="px-6 py-4 flex-shrink-0"
        style={{ borderBottom: "0.5px solid var(--border-hairline)" }}
      >
        <span className="uppercase [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] text-accent-pink-bright block mb-1">
          Weekly shutdown
        </span>
        <h2 className="text-[14px] font-medium text-fg">
          {formatWeekHeader(selectedWeek)}
        </h2>
      </div>

      {/* ── Body — two-step flow ────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[760px] mx-auto px-6 py-5 space-y-6">
          {/* Step indicator */}
          <div className="flex items-center gap-2 text-[11px] text-fg-faded">
            {step === 2 ? (
              <button
                onClick={() => setStep(1)}
                className="cursor-pointer hover:text-fg-secondary transition-colors"
              >
                Review
              </button>
            ) : (
              <span className="text-fg-secondary font-medium">Review</span>
            )}
            <span>→</span>
            <span className={step === 2 ? "text-fg-secondary font-medium" : ""}>
              Reflect
            </span>
          </div>

          {step === 1 && (
            <>
              {/* Top stat banner — only when there's worked time worth showing */}
              {totalWorkedMinutes > 0 && (
                <div className="rounded-lg px-4 py-3 bg-elevated/40" style={{ border: "0.5px solid var(--border-hairline)" }}>
                  <div className="flex items-baseline gap-3">
                    <span className="text-[20px] font-medium text-accent-pink-bright tabular-nums leading-none">
                      {formatHoursMinutes(totalWorkedMinutes)}
                    </span>
                    <span className="text-[12px] text-fg-secondary leading-none">
                      worked
                    </span>
                  </div>
                </div>
              )}

              {/* Per-day wins */}
              <div className="space-y-5">
                {weekDates.map((date) => {
                  const dayTasks = tasksByDay.get(date) ?? [];
                  // Highlights first, then fill with other completed tasks up
                  // to a 5-task ceiling so the day reads as a curated digest
                  // rather than a full log.
                  const highlights = dayTasks.filter((t) => t.is_highlight);
                  const others = dayTasks.filter((t) => !t.is_highlight);
                  const visibleTasks = [...highlights, ...others].slice(0, 5);
                  return (
                    <section key={date}>
                      <h3 className="text-[13px] font-medium text-fg-secondary mb-2">
                        {formatDayHeading(date)}
                      </h3>
                      {visibleTasks.length === 0 ? (
                        <p className="text-[12px] text-fg-disabled px-2.5">
                          Nothing this day
                        </p>
                      ) : (
                        <div className="space-y-1">
                          {visibleTasks.map((task) => {
                            const project =
                              task.project_id != null
                                ? projectMap.get(task.project_id)
                                : null;
                            const worked = workedPerTask.get(task.id) ?? 0;
                            const isHighlight = !!task.is_highlight;
                            return (
                              <div
                                key={task.id}
                                className="px-2.5 py-[6px] rounded-md border border-line-soft bg-elevated/60 flex items-center gap-2.5 transition-colors hover:bg-overlay-hover"
                              >
                                {isHighlight ? (
                                  <svg
                                    width="13"
                                    height="13"
                                    viewBox="0 0 24 24"
                                    fill="var(--accent-highlight)"
                                    stroke="var(--accent-highlight)"
                                    strokeWidth="2"
                                    strokeLinejoin="round"
                                    className="flex-shrink-0"
                                  >
                                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                                  </svg>
                                ) : (
                                  <svg
                                    width="13"
                                    height="13"
                                    viewBox="0 0 16 16"
                                    fill="none"
                                    stroke="var(--accent-pink)"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    className="flex-shrink-0"
                                  >
                                    <path d="M3 8.5l3.5 3.5 6.5-7" />
                                  </svg>
                                )}
                                {project && (
                                  <span
                                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                    style={{ backgroundColor: project.color }}
                                    title={project.name}
                                  />
                                )}
                                <span
                                  className={`flex-1 text-[12px] truncate ${
                                    isHighlight
                                      ? "text-fg font-medium line-through decoration-fg-faded/50"
                                      : "text-fg-faded line-through"
                                  }`}
                                >
                                  {task.title}
                                </span>
                                {project && (
                                  <span className="text-[10px] text-fg-faded shrink-0 max-w-[120px] truncate">
                                    {project.name}
                                  </span>
                                )}
                                {worked > 0 && (
                                  <span className="text-[10px] text-fg-faded tabular-nums shrink-0">
                                    {worked}m
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            </>
          )}

          {step === 2 && (
            <>
              {/* Mood */}
              <section>
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
                    onChange={(e) =>
                      handleReflectionFieldChange("wentWell", e.target.value)
                    }
                    placeholder="Projects completed, wins achieved, moments that felt good..."
                    rows={2}
                    className="w-full bg-elevated/60 rounded-md px-3 py-2 text-[13px] text-fg-secondary resize-none leading-relaxed border border-transparent focus:outline-none focus:border-accent-pink-bright placeholder:text-[13px] placeholder:font-normal placeholder:text-fg-faded transition-colors"
                  />
                </div>
                <div>
                  <label className="text-[13px] font-medium text-fg-secondary mb-1.5 block">
                    What could have gone better?
                  </label>
                  <textarea
                    value={reflectionFields.couldBeBetter}
                    onChange={(e) =>
                      handleReflectionFieldChange("couldBeBetter", e.target.value)
                    }
                    placeholder="Bottlenecks, missteps, things you'd approach differently..."
                    rows={2}
                    className="w-full bg-elevated/60 rounded-md px-3 py-2 text-[13px] text-fg-secondary resize-none leading-relaxed border border-transparent focus:outline-none focus:border-accent-pink-bright placeholder:text-[13px] placeholder:font-normal placeholder:text-fg-faded transition-colors"
                  />
                </div>
                <div>
                  <label className="text-[13px] font-medium text-fg-secondary mb-1.5 block">
                    What's the priority going into next week?
                  </label>
                  <textarea
                    value={reflectionFields.nextWeekPriority}
                    onChange={(e) =>
                      handleReflectionFieldChange("nextWeekPriority", e.target.value)
                    }
                    placeholder="The one or two things that matter most, your main focus..."
                    rows={2}
                    className="w-full bg-elevated/60 rounded-md px-3 py-2 text-[13px] text-fg-secondary resize-none leading-relaxed border border-transparent focus:outline-none focus:border-accent-pink-bright placeholder:text-[13px] placeholder:font-normal placeholder:text-fg-faded transition-colors"
                  />
                </div>
              </section>

              {/* Carry forward */}
              <section>
                <h3 className="text-[13px] font-medium text-fg-secondary mb-1.5">
                  Carry forward
                </h3>
                <textarea
                  value={incompleteItemsText}
                  onChange={(e) => handleIncompleteTextChange(e.target.value)}
                  placeholder="Loose ends, things to remember for next week..."
                  rows={3}
                  className="w-full bg-elevated/60 rounded-md px-3 py-2 text-[13px] text-fg-secondary resize-none leading-relaxed border border-transparent focus:outline-none focus:border-accent-pink-bright placeholder:text-[13px] placeholder:font-normal placeholder:text-fg-faded transition-colors"
                />
              </section>

              {/* Recap nudge — sits just above the footer */}
              <section className="pt-2">
                <button
                  onClick={() => setShowSummary(true)}
                  className="text-[12px] text-accent-pink-bright hover:text-accent-pink cursor-pointer transition-colors"
                >
                  Want a recap of the week? Generate one →
                </button>
              </section>

              {/* Read-only worked-time line — mirrors daily's bottom strip */}
              {totalWorkedMinutes > 0 && (
                <section className="pt-1">
                  <div className="text-[11px] text-fg-faded">
                    <span className="tabular-nums">
                      {formatHoursMinutes(totalWorkedMinutes)} worked
                    </span>
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <div className="px-6 py-4 flex-shrink-0">
        <div className="max-w-[760px] mx-auto flex items-center gap-2">
          {step === 1 ? (
            <button
              onClick={() => setStep(2)}
              className="flex-1 py-2.5 rounded-lg border border-accent-pink-bright/60 text-accent-pink-bright text-[13px] font-medium cursor-pointer hover:border-accent-pink hover:bg-accent-pink-soft transition-colors flex items-center justify-center gap-1.5"
            >
              <svg width="14" height="12" viewBox="0 0 14 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 11 C2 7.5 1 4.5 3 2.5 C4.5 1 6.5 2 7 3.5 C7.5 2 9.5 1 11 2.5 C13 4.5 12 7.5 7 11 Z" />
              </svg>
              Reflect
            </button>
          ) : (
            <>
              <button
                onClick={completeWeeklyShutdown}
                className="flex-1 py-2.5 rounded-lg border border-accent-pink-bright/60 text-accent-pink-bright text-[13px] font-medium cursor-pointer hover:border-accent-pink hover:bg-accent-pink-soft transition-colors flex items-center justify-center gap-1.5"
              >
                <svg width="14" height="10" viewBox="0 0 14 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
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
