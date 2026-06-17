import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  selectProjectsByStatus,
  selectTaskIdsByDate,
  useAppStore,
} from "../stores/appStore";
import {
  getDailyPlan,
  getWorkedMinutesForTaskIds,
  getProjects,
  updateTaskDateScheduled,
  upsertDailyShutdown,
} from "../db/queries";
import ErrorBanner from "../components/ErrorBanner";
import { errorMessage } from "../utils/errors";
import { todayString, localDateIso, formatDayHeader } from "../utils/dates";
import { formatHoursMinutes } from "../utils/format";
import {
  PRIMARY_ACTION_CLASS,
  NEUTRAL_ACTION_CLASS,
  SHUTDOWN_BUTTON_CLASS,
} from "../utils/actionStyles";
import {
  buildSummaryDigest,
  buildSummaryPrompt,
  AUDIENCE_LABELS,
  type SummaryAudience,
} from "../utils/summary";
import MoodSelector from "../components/MoodSelector";
import CalendarChip from "../components/CalendarChip";
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
  const openTaskDetail = useAppStore((s) => s.openTaskDetail);
  const openSummaryOverlay = useAppStore((s) => s.openSummaryOverlay);
  const openSunsetOverlay = useAppStore((s) => s.openSunsetOverlay);
  // M3.2.b.3 — task list flows through the canonical store. Includes
  // both done and not-done tasks for the day; render code already
  // partitions by status, no top-level filter needed here.
  const dayTaskIds = useAppStore((s) => selectTaskIdsByDate(s, selectedDate));
  const tasksById = useAppStore((s) => s.tasksById);
  const loadTasksForDate = useAppStore((s) => s.loadTasksForDate);
  const setTaskHighlightAction = useAppStore((s) => s.setTaskHighlight);
  const tasks = useMemo(() => {
    const out: Task[] = [];
    for (const id of dayTaskIds) {
      const t = tasksById.get(id);
      if (t) out.push(t);
    }
    return out;
  }, [dayTaskIds, tasksById]);

  const projects = useAppStore(useShallow((s) => selectProjectsByStatus(s, "active")));
  const [error, setError] = useState<string | null>(null);

  const [mood, setMood] = useState<string | null>(null);
  const [reflectionFields, setReflectionFields] = useState<ReflectionFields>({
    howDidItGo: "",
    whatDifferently: "",
    gratefulFor: "",
  });
  const [carriedIds, setCarriedIds] = useState<Set<number>>(new Set());
  const [highlightIds, setHighlightIds] = useState<Set<number>>(new Set());
  const [workedPerTask, setWorkedPerTask] = useState<Map<number, number>>(new Map());
  const [step, setStep] = useState<1 | 2>(1);

  // ── Daily rundown → Claude-prompt export (one-click copy) ──────────────
  // The digest is PRE-COMPUTED into a memo (not built inside the click): an
  // `await getProjects()` between the click and clipboard.writeText would lose
  // the user-gesture in WKWebView and the copy would silently fail. So projects
  // (incl. archived) load on mount and the copy handler is fully synchronous.
  const [summaryAudience, setSummaryAudience] = useState<SummaryAudience>("dan");
  const [summaryCopied, setSummaryCopied] = useState(false);
  const [allProjects, setAllProjects] = useState<Project[]>([]);

  // Collapsed top-right rundown dropdown. The window Esc handler (deps
  // [setPage], so it never re-binds on open-change) reads dropdownOpenRef —
  // NOT the open state — to avoid a stale closure leaving the page while the
  // dropdown is open. triggerRef/panelRef let the outside-click handler exclude
  // its own elements so the opening click doesn't immediately close it.
  const [rundownOpen, setRundownOpen] = useState(false);
  const dropdownOpenRef = useRef(false);
  dropdownOpenRef.current = rundownOpen;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedDateRef = useRef(selectedDate);
  selectedDateRef.current = selectedDate;

  const projectMap = new Map(projects.map((p) => [p.id, p]));

  const loadData = useCallback(async () => {
    try {
      const [_, dp, allProj] = await Promise.all([
        loadTasksForDate(selectedDate),
        getDailyPlan(selectedDate),
        // ALL projects incl. archived, so a completed task on an archived
        // objective still groups under it in the rundown digest.
        getProjects(true),
      ]);
      void _;
      setAllProjects(allProj);
      setMood(dp?.mood ?? null);
      setReflectionFields(parseReflection(dp?.reflection ?? ""));
      setCarriedIds(new Set());
      // Read fresh task data from the canonical map after loadTasksForDate
      // resolved — taskIds in the React closure may still point at the
      // prior render.
      const freshIds =
        useAppStore.getState().taskIdsByDate.get(selectedDate) ?? [];
      const freshTasks: Task[] = [];
      for (const id of freshIds) {
        const t = useAppStore.getState().tasksById.get(id);
        if (t) freshTasks.push(t);
      }
      setHighlightIds(
        new Set(freshTasks.filter((x) => x.is_highlight).map((x) => x.id)),
      );
      if (freshIds.length > 0) {
        const wpt = await getWorkedMinutesForTaskIds(freshIds);
        setWorkedPerTask(wpt);
      } else {
        setWorkedPerTask(new Map());
      }
      setError(null);
    } catch (e) {
      setError(errorMessage(e, "Failed to load data"));
    }
  }, [selectedDate, loadTasksForDate]);

  // Shutdown is always for today — if the user got here with selectedDate
  // pointing at another day (e.g., they were paging through a past Daily
  // Plan), snap it to today on mount.
  useEffect(() => {
    const today = todayString(); // #5 — local-tz, not UTC
    if (selectedDate !== today) setSelectedDate(today);
    // intentionally only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadData();
    setStep(1);
  }, [loadData]);

  // M3.2.b.5.b — verseday:task-updated/-deleted listener retired.
  // Task-data flows through selectTaskIdsByDate + tasksById. Worked-
  // minute aggregates accept stale-until-mount in this window per
  // the M3.2.b.5 audit (M3.3 territory).

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

  // Escape: close the rundown dropdown first (if open), else leave shutdown
  // back to the daily plan. Skip leaving while typing in any textarea/input so
  // the user can hit Escape to blur first. Reads dropdownOpenRef — not the
  // state — because this effect's deps are [setPage] and never re-bind on
  // open-change (the state would be a stale closure).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (dropdownOpenRef.current) {
        e.preventDefault();
        setRundownOpen(false);
        return;
      }
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

  // Outside-click closes the rundown dropdown. Exclude the trigger AND the panel
  // so the click that opens it (or a click inside it) doesn't immediately close
  // it. Only bound while open.
  useEffect(() => {
    if (!rundownOpen) return;
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setRundownOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [rundownOpen]);

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
    // #5 — local-tz format; toISOString() would shift the carry-forward target
    // day by ±1 near midnight in non-UTC zones.
    const d = new Date(selectedDate + "T00:00:00");
    d.setDate(d.getDate() + 1);
    return localDateIso(d);
  }

  async function carryTaskToTomorrow(taskId: number) {
    try {
      await updateTaskDateScheduled(taskId, getTomorrowDate());
      setCarriedIds((prev) => new Set(prev).add(taskId));
    } catch (e) {
      setError(errorMessage(e, "Failed to move task"));
    }
  }

  async function carryAllToTomorrow() {
    const tomorrow = getTomorrowDate();
    // Calendar-imported tasks are pinned to their event date — never carry
    // them forward (the data layer also rejects it as a backstop).
    const toCarry = tasks.filter(
      (t) => t.status !== "done" && !carriedIds.has(t.id) && t.external_source == null
    );
    try {
      await Promise.all(
        toCarry.map((t) => updateTaskDateScheduled(t.id, tomorrow))
      );
      setCarriedIds(
        (prev) => new Set([...prev, ...toCarry.map((t) => t.id)])
      );
    } catch (e) {
      setError(errorMessage(e, "Failed to move tasks"));
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
      setError(errorMessage(e, "Failed to save"));
      return;
    }
    localStorage.setItem(SHUTDOWN_KEY_PREFIX + selectedDate, "true");
    openSunsetOverlay();
  }

  async function handleToggleHighlight(taskId: number) {
    const isCurrently = highlightIds.has(taskId);
    try {
      // M3.5 — store action handles canonical-map patch + DB. The
      // local highlightIds Set still drives the rendered checkmark
      // (it's UI-derived from the loaded tasks' is_highlight flags);
      // keep mirroring the toggle so the visual flips immediately.
      await setTaskHighlightAction(taskId, !isCurrently);
      setHighlightIds((prev) => {
        const next = new Set(prev);
        if (isCurrently) next.delete(taskId);
        else next.add(taskId);
        return next;
      });
    } catch (e) {
      setError(errorMessage(e, "Failed to toggle highlight"));
    }
  }



  const completedTasks = tasks.filter((t) => t.status === "done");
  const incompleteTasks = tasks.filter((t) => t.status !== "done");

  // ── Daily rundown → Claude prompt ─────────────────────────────────────
  // Pre-computed so the copy handler stays synchronous (see state note above).
  // Recomputes on day/data change, so there's no stale digest to reset.
  const summaryDigest = useMemo(
    () =>
      buildSummaryDigest({
        startIso: selectedDate,
        endIso: selectedDate, // single day
        tasks: tasks.filter((t) => t.status === "done"),
        projects: allProjects,
        workedByTaskId: workedPerTask,
      }),
    [selectedDate, tasks, allProjects, workedPerTask],
  );

  function handleCopyRundown() {
    // writeText is invoked directly in the click gesture (digest already built),
    // with no await before it → the user-gesture isn't lost in WKWebView.
    navigator.clipboard
      .writeText(buildSummaryPrompt(summaryAudience, summaryDigest, "day"))
      .then(() => {
        setSummaryCopied(true);
        setTimeout(() => setSummaryCopied(false), 2000);
      })
      .catch((e) => setError(errorMessage(e, "Failed to copy to clipboard")));
  }

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
      <div className="px-6 py-5 flex-shrink-0 flex items-center gap-3" style={{ borderBottom: "0.5px solid var(--border-hairline)" }}>
        <span className="inline-flex items-center [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] bg-accent-orange-soft text-accent-orange-soft-fg px-2.5 py-1 rounded-full">
          Daily shutdown
        </span>
        <h2 className="text-[14px] font-medium text-fg">
          {new Date(selectedDate + "T00:00:00").toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </h2>
      </div>

      {/* ── Body — two-step flow ────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[760px] mx-auto px-6 pt-5 pb-8 space-y-8">
          {/* Step indicator (left) + the rundown dropdown (top-right, step 1). */}
          <div className="flex items-center justify-between gap-2 text-[12px] text-fg-secondary">
            <div className="flex items-center gap-2">
              {step === 2 ? (
                <button
                  onClick={() => setStep(1)}
                  className="cursor-pointer hover:text-fg transition-colors"
                >
                  Review
                </button>
              ) : (
                <span className="text-fg font-medium">Review</span>
              )}
              <span className="text-fg-faded">→</span>
              <span className={step === 2 ? "text-fg font-medium" : ""}>Reflect</span>
            </div>

            {/* Daily rundown — collapsed trigger; drops a Dan/Cam picker +
                Copy for Claude. Copy stays synchronous in its own click
                (digest is the pre-memoized summaryDigest), so it lands in
                WKWebView. The trigger only toggles open — no async. */}
            {step === 1 && (
              <div className="relative">
                <button
                  ref={triggerRef}
                  onClick={() => setRundownOpen((o) => !o)}
                  aria-expanded={rundownOpen}
                  className="px-3 py-1.5 rounded-md text-[12px] border border-line-soft text-fg-secondary hover:bg-overlay-hover cursor-pointer transition-colors flex items-center gap-1.5"
                >
                  Daily rundown
                  <span className={`text-[9px] transition-transform ${rundownOpen ? "rotate-180" : ""}`}>▾</span>
                </button>

                {rundownOpen && (
                  <div
                    ref={panelRef}
                    className="absolute right-0 top-full mt-1.5 z-20 w-[200px] rounded-lg bg-elevated px-3 py-3 animate-fade-in"
                    style={{ border: "0.5px solid var(--border-soft)", boxShadow: "var(--shadow-card)" }}
                  >
                    <p className="text-[11px] text-fg-faded mb-2 leading-snug">
                      Today&rsquo;s completed work, framed for your audience.
                    </p>
                    {/* Audience toggle — full-width segmented */}
                    <div
                      className="flex rounded-md overflow-hidden mb-2"
                      style={{ border: "0.5px solid var(--border-hairline)" }}
                    >
                      {(["dan", "cam"] as SummaryAudience[]).map((a) => (
                        <button
                          key={a}
                          onClick={() => setSummaryAudience(a)}
                          className={`flex-1 px-2 py-1.5 text-[12px] cursor-pointer transition-colors ${
                            summaryAudience === a
                              ? "bg-accent-blue-soft text-accent-blue-soft-fg font-medium"
                              : "text-fg-secondary hover:bg-overlay-hover"
                          }`}
                        >
                          {AUDIENCE_LABELS[a]}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={handleCopyRundown}
                      className="w-full px-3 py-1.5 rounded-md text-[12px] border border-accent-blue/50 text-accent-blue-soft-fg hover:bg-accent-blue-soft cursor-pointer transition-colors"
                    >
                      {summaryCopied ? "Copied!" : "Copy for Claude"}
                    </button>
                  </div>
                )}
              </div>
            )}
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
                      {highlightIds.size} {highlightIds.size === 1 ? "highlight" : "highlights"}
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
                          onClick={() => openTaskDetail(task.id)}
                          className="px-3 py-3 rounded-md border border-line-soft bg-elevated/60 flex items-center gap-3 transition-colors hover:bg-overlay-hover cursor-pointer"
                        >
                          {/* Leading group — star + project dot + title
                              read as one tight unit (gap-2) anchored to
                              the row's left edge. Outer gap-3 keeps the
                              right-side slots (project name, time)
                              clearly separated. */}
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleHighlight(task.id);
                              }}
                              className="flex-shrink-0 ml-2 cursor-pointer"
                              title={isHighlight ? "Remove highlight" : "Mark as highlight"}
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill={isHighlight ? "var(--accent-highlight)" : "none"} stroke={isHighlight ? "var(--accent-highlight)" : "var(--text-disabled)"} strokeWidth="2">
                                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                              </svg>
                            </button>
                            {project ? (
                              <span
                                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                style={{ backgroundColor: project.color }}
                                title={project.name}
                              />
                            ) : (
                              <span className="w-1.5 h-1.5 flex-shrink-0" aria-hidden />
                            )}
                            <span className="flex-1 min-w-0 text-[12px] text-fg-secondary truncate">
                              {task.external_source === "calendar" && <CalendarChip className="mr-1.5 align-[-1px]" />}
                              {task.title}
                            </span>
                          </div>
                          <span className="text-[10px] text-fg-faded shrink-0 w-[120px] truncate">
                            {project?.name ?? ""}
                          </span>
                          <span className="text-[10px] text-fg-faded tabular-nums shrink-0 w-[44px] text-right">
                            {worked > 0 ? formatHoursMinutes(worked) : ""}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[12px] text-fg-disabled px-2.5">Nothing marked done today.</p>
                )}
              </section>

              {/* Didn't get to — task cards */}
              <section>
                <div className="flex items-baseline justify-between mb-2">
                  <h3 className="text-[13px] font-medium text-fg-secondary">
                    Didn&rsquo;t get to
                  </h3>
                  {incompleteTasks.filter((t) => !carriedIds.has(t.id) && t.external_source == null).length > 0 && (
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
                          onClick={() => openTaskDetail(task.id)}
                          className="group/row px-3 py-3 rounded-md border border-line-soft bg-elevated/60 flex items-center gap-3 transition-colors hover:bg-overlay-hover cursor-pointer"
                        >
                          {/* Leading group — priority indicator + dot
                              + title read tight (gap-2). Outer gap-3
                              keeps right-side slots clearly separated. */}
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            {task.priority === "high" ? (
                              <span className="w-[14px] h-[14px] rounded-full border-2 border-accent-danger flex-shrink-0 ml-2" title="High priority" />
                            ) : (
                              <span className="w-[14px] h-[14px] flex-shrink-0 ml-2" aria-hidden />
                            )}
                            {project ? (
                              <span
                                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                style={{ backgroundColor: project.color }}
                                title={project.name}
                              />
                            ) : (
                              <span className="w-1.5 h-1.5 flex-shrink-0" aria-hidden />
                            )}
                            <span className={`flex-1 min-w-0 text-[12px] truncate ${isCarried ? "text-fg-faded italic" : "text-fg"}`}>
                              {task.external_source === "calendar" && <CalendarChip className="mr-1.5 align-[-1px]" />}
                              {task.title}
                            </span>
                          </div>
                          <span className="text-[10px] text-fg-faded shrink-0 w-[120px] truncate">
                            {!isCarried ? (project?.name ?? "") : ""}
                          </span>
                          <span className="text-[10px] tabular-nums shrink-0 w-[68px] text-right relative">
                            {isCarried ? (
                              <span className="text-accent-green">Moved →</span>
                            ) : task.external_source === "calendar" ? (
                              // Calendar events are pinned to their date — no
                              // carry control; just show the estimate if any.
                              <span className="text-fg-faded">
                                {est > 0 ? formatHoursMinutes(est) : ""}
                              </span>
                            ) : (
                              <>
                                <span className={`text-fg-faded transition-opacity ${est > 0 ? "group-hover/row:opacity-0" : "opacity-0"}`}>
                                  {est > 0 ? formatHoursMinutes(est) : ""}
                                </span>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    carryTaskToTomorrow(task.id);
                                  }}
                                  className="absolute inset-0 text-right text-accent-blue-soft-fg hover:text-accent-blue cursor-pointer opacity-0 group-hover/row:opacity-100 transition-opacity"
                                  title="Move to tomorrow"
                                >
                                  Move →
                                </button>
                              </>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[12px] text-fg-disabled">The path is clear.</p>
                )}
              </section>

            </>
          )}

          {step === 2 && (
            <>
              {/* Mood */}
              <section>
                <h3 className="text-[13px] font-medium text-fg-secondary mb-2">
                  How was your day?
                </h3>
                <MoodSelector
                  value={mood}
                  onChange={handleMoodChange}
                  tintColor="var(--mood-tint-daily)"
                  size={22}
                />
              </section>

              {/* Reflection — three fields. Borderless, transparent
                  background so prompts read as text on the page rather
                  than as nested cards. Subtle focus indicator only. */}
              <section className="space-y-5">
                {REFLECTION_FIELDS.map((field) => (
                  <div key={field.key}>
                    <label className="text-[13px] font-medium text-fg-secondary mb-1 block">
                      {field.label}
                    </label>
                    <textarea
                      value={reflectionFields[field.key]}
                      onChange={(e) => handleReflectionFieldChange(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      rows={2}
                      className="w-full bg-transparent rounded-none px-0 py-1 text-[13px] text-fg-secondary resize-none leading-relaxed border-0 outline-none placeholder:text-[13px] placeholder:font-normal placeholder:text-fg-disabled focus:placeholder:text-fg-faded transition-colors"
                    />
                  </div>
                ))}
              </section>

              {/* Highlights summary — read-only carry from step 1, anchored at bottom */}
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
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="var(--accent-highlight)" stroke="var(--accent-highlight)" strokeWidth="2" className="flex-shrink-0">
                              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                            </svg>
                            <span className="text-[13px] text-fg font-medium truncate flex-1">{task.title}</span>
                          </div>
                        ))}
                    </div>
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
              className={`flex-1 ${SHUTDOWN_BUTTON_CLASS} ${PRIMARY_ACTION_CLASS}`}
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
                onClick={completeShutdown}
                className={`flex-1 ${SHUTDOWN_BUTTON_CLASS} ${PRIMARY_ACTION_CLASS}`}
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
                onClick={() => openSummaryOverlay("daily", selectedDate)}
                className="px-5 py-2.5 rounded-lg border border-line-soft text-fg-secondary text-[13px] font-medium cursor-pointer hover:bg-overlay-hover transition-colors"
              >
                Summary
              </button>
            </>
          )}
        </div>
      </div>

      {/* Task detail overlay — opened by clicking any row in step 1.
          Mirrors DailyPlanner's invocation so the detail view is
          identical regardless of where it was opened from (trash icon,
          start-focus button, pre-filled worked-minutes). */}
      {/* TaskDetailOverlay is mounted as a singleton at App.tsx
          (M1 — see TaskDetailOverlayHost). After M3.2.b.5.b, host
          mutations route through store actions — task-list rows
          re-render via canonical-map subscriptions automatically. */}
    </div>
  );
}
