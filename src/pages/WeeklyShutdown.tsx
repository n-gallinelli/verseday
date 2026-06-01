import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { onProjectChanged } from "../utils/projectEvents";
import { useAppStore } from "../stores/appStore";
import {
  getWeeklyShutdown,
  upsertWeeklyShutdown,
  getTasksCompletedInWeek,
  getProjects,
  getWorkedMinutesPerProjectPerDay,
  getWorkedMinutesForTaskIds,
  hasWeekBeenPlanned,
} from "../db/queries";
import ErrorBanner from "../components/ErrorBanner";
import { errorMessage } from "../utils/errors";
import { localDateIso, mondayOfWeek as getMondayOfWeek, weekdayDates as getWeekdayDates } from "../utils/dates";
import { formatHoursMinutes } from "../utils/format";
import type { Task, Project } from "../types";

const WEEKLY_SHUTDOWN_PREFIX = "weekly-shutdown-";
const DAY_NAMES_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const UNASSIGNED_PROJECT_ID = -1;

function getFridayIso(mondayIso: string): string {
  const d = new Date(mondayIso + "T00:00:00");
  d.setDate(d.getDate() + 4);
  return localDateIso(d);
}

function getNextMondayIso(mondayIso: string): string {
  const d = new Date(mondayIso + "T00:00:00");
  d.setDate(d.getDate() + 7);
  return localDateIso(d);
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

// ─── Stacked bar chart ──────────────────────────────────────────────────────
// One column per day Mon–Fri. Each column is a stacked bar: project
// segments scaled to time spent. Y-axis is auto-scaled to the busiest
// day (so the eye reads relative effort, not absolute hours).

function StackedBarChart({
  weekDates,
  workedByDay,
  projects,
}: {
  weekDates: string[];
  workedByDay: Map<string, Map<number, number>>;
  projects: Project[];
}) {
  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const dayTotals = weekDates.map((date) => {
    const inner = workedByDay.get(date);
    if (!inner) return 0;
    return Array.from(inner.values()).reduce((s, n) => s + n, 0);
  });
  // Pinned y-axis max — 9h gives a stable scale across weeks so a
  // light week doesn't read as full bars and a heavy week doesn't
  // shrink last week's bars to nothing. Days that exceed 9h clamp
  // to a full bar (overflow is rare and the day label still shows
  // the actual total below).
  const Y_AXIS_MAX_MINUTES = 9 * 60;

  // Hover state for the custom tooltip. Native `title` is slow and
  // inconsistent across platforms; a proper tooltip reads instantly
  // and matches the rest of the app's design language.
  const [hover, setHover] = useState<{
    projectName: string;
    color: string;
    minutes: number;
    dayLabel: string;
  } | null>(null);

  return (
    <div className="flex items-end gap-3 h-[180px] w-full relative">
      {weekDates.map((date, idx) => {
        const inner = workedByDay.get(date);
        const total = dayTotals[idx];
        const heightPct = Math.min(100, (total / Y_AXIS_MAX_MINUTES) * 100);

        // Sort segments by minutes desc so the largest project sits at
        // the bottom of the stack (visually anchors the bar).
        const segments = inner
          ? Array.from(inner.entries())
              .filter(([, mins]) => mins > 0)
              .sort((a, b) => b[1] - a[1])
          : [];

        return (
          <div key={date} className="flex-1 flex flex-col items-center min-w-0">
            <div className="flex-1 w-full flex flex-col justify-end relative">
              {total > 0 ? (
                <div
                  className="w-full rounded-t-md overflow-hidden flex flex-col-reverse transition-all"
                  style={{ height: `${heightPct}%`, minHeight: "4px" }}
                >
                  {segments.map(([projectId, minutes]) => {
                    const project =
                      projectId === UNASSIGNED_PROJECT_ID
                        ? null
                        : projectMap.get(projectId);
                    const segPct = (minutes / total) * 100;
                    const segColor = project?.color ?? "var(--text-disabled)";
                    const segName = project?.name ?? "Unassigned";
                    return (
                      <div
                        key={projectId}
                        className="w-full cursor-default transition-opacity hover:opacity-100"
                        style={{
                          height: `${segPct}%`,
                          minHeight: "2px",
                          backgroundColor: segColor,
                          opacity: 0.85,
                        }}
                        onMouseEnter={() =>
                          setHover({
                            projectName: segName,
                            color: segColor,
                            minutes,
                            dayLabel: DAY_NAMES_SHORT[idx],
                          })
                        }
                        onMouseLeave={() => setHover(null)}
                      />
                    );
                  })}
                </div>
              ) : (
                <div className="w-full h-[4px] rounded-full bg-overlay-hover" />
              )}
            </div>
            <div className="mt-2 text-center">
              <div className="text-[11px] font-medium text-fg-secondary">
                {DAY_NAMES_SHORT[idx]}
              </div>
              <div className="text-[10px] text-fg-faded tabular-nums">
                {total > 0 ? formatHoursMinutes(Math.round(total)) : "—"}
              </div>
            </div>
          </div>
        );
      })}

      {/* Custom tooltip — anchored to the top-right INSIDE the chart
          area so wrapping long project names grows the tooltip
          downward (into the chart's empty top region) instead of
          upward, where it would be clipped by the section above.
          Pointer-events-none so hover events on the bars below
          aren't blocked. Capped at 280px so it never escapes. */}
      {hover && (
        <div
          className="absolute top-0 right-0 flex items-start gap-2 px-3 py-1.5 rounded-md bg-elevated pointer-events-none animate-fade-in max-w-[280px] z-10"
          style={{
            border: "0.5px solid var(--border-soft)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <span
            className="w-2 h-2 rounded-full flex-shrink-0 mt-[5px]"
            style={{ backgroundColor: hover.color }}
          />
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-medium text-fg leading-snug break-words">
              {hover.projectName}
            </div>
            <div className="text-[11px] text-fg-faded tabular-nums leading-tight mt-0.5">
              {hover.dayLabel} · {formatHoursMinutes(Math.round(hover.minutes))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Plan-next-week prompt ──────────────────────────────────────────────────
// Shown when the user clicks Complete Shutdown but next week has no
// commitments or project statuses yet.

function PlanNextWeekPrompt({
  onPlan,
  onSkip,
  onCancel,
}: {
  onPlan: () => void;
  onSkip: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-6"
      style={{ background: "color-mix(in srgb, var(--bg-base) 70%, transparent)" }}
      onClick={onCancel}
    >
      <div
        className="bg-elevated rounded-xl px-7 py-7 max-w-[420px] w-full text-center animate-scale-in"
        style={{
          border: "0.5px solid var(--border-soft)",
          boxShadow: "var(--shadow-card)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Calendar icon */}
        <div className="flex justify-center mb-4">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center"
            style={{
              backgroundColor: "color-mix(in srgb, var(--accent-blue) 12%, transparent)",
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent-blue)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <line x1="3" y1="10" x2="21" y2="10" />
              <line x1="8" y1="3" x2="8" y2="7" />
              <line x1="16" y1="3" x2="16" y2="7" />
            </svg>
          </div>
        </div>

        <h2 className="text-[18px] font-medium text-fg mb-2 font-display">
          Start next week with a plan
        </h2>
        <p className="text-[13px] text-fg-secondary leading-relaxed mb-6 max-w-[340px] mx-auto">
          You haven&rsquo;t planned next week yet. Taking a few minutes now
          means you can hit Monday without the friction of figuring out
          where to start.
        </p>

        <button
          onClick={onPlan}
          className="w-full py-2.5 rounded-lg border border-accent-blue/60 text-accent-blue-soft-fg text-[13px] font-medium cursor-pointer hover:border-accent-blue hover:bg-accent-blue-soft transition-colors mb-3"
        >
          Plan next week
        </button>
        <button
          onClick={onSkip}
          className="text-[12px] text-fg-faded hover:text-fg-secondary cursor-pointer transition-colors"
        >
          Just shut down
        </button>
      </div>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export default function WeeklyShutdown() {
  const { selectedWeek, setSelectedWeek, setPage } = useAppStore();
  const openSunsetOverlay = useAppStore((s) => s.openSunsetOverlay);
  const primeTasks = useAppStore((s) => s.primeTasks);
  const tasksById = useAppStore((s) => s.tasksById);
  // M3.2.b.3 — completedThisWeek is hybrid: query is completed_at-based
  // (a task scheduled in week X but completed in week Y belongs to Y).
  // No secondary index covers that, so the SQL stays authoritative for
  // membership; canonical map drives the rendered Task data so renames
  // flow through without a re-query. The bucket filter (status === "done")
  // re-validates membership at the memo so a flip done→todo drops the
  // row immediately.
  const [completedTaskIds, setCompletedTaskIds] = useState<number[]>([]);
  const completedThisWeek = useMemo(() => {
    const out: Task[] = [];
    for (const id of completedTaskIds) {
      const t = tasksById.get(id);
      if (t && t.status === "done") out.push(t);
    }
    return out;
  }, [completedTaskIds, tasksById]);
  const [projects, setProjects] = useState<Project[]>([]);
  // #3 — refresh on verseday:project-changed (include archived; tasks may
  // belong to archived projects). Read-only → no loop; mounted-guarded.
  useEffect(() => {
    let mounted = true;
    const off = onProjectChanged(() => {
      getProjects(true)
        .then((p) => {
          if (mounted) setProjects(p);
        })
        .catch(() => {});
    });
    return () => {
      mounted = false;
      off();
    };
  }, []);
  const [workedByDay, setWorkedByDay] = useState<Map<string, Map<number, number>>>(new Map());
  const [workedPerTask, setWorkedPerTask] = useState<Map<number, number>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [showPlanPrompt, setShowPlanPrompt] = useState(false);

  const selectedWeekRef = useRef(selectedWeek);
  selectedWeekRef.current = selectedWeek;

  const fridayIso = getFridayIso(selectedWeek);
  const todayMonday = getMondayOfWeek();
  const weekDates = getWeekdayDates(selectedWeek);

  const projectMap = new Map(projects.map((p) => [p.id, p]));

  // Snap to current week if the user landed here while browsing another.
  useEffect(() => {
    if (selectedWeek !== todayMonday) setSelectedWeek(todayMonday);
    // intentionally only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Data loading ──────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    try {
      const [completed, p, perDay] = await Promise.all([
        getTasksCompletedInWeek(selectedWeek, fridayIso),
        getProjects(true), // include archived; tasks may belong to archived projects
        getWorkedMinutesPerProjectPerDay(selectedWeek, fridayIso),
      ]);
      // Prime canonical map first so the render below resolves each
      // id without a flash of empty rows.
      primeTasks(completed);
      setCompletedTaskIds(completed.map((t) => t.id));
      setProjects(p);
      setWorkedByDay(perDay);
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

  // ── Actions ───────────────────────────────────────────────────────────

  async function handleCompleteShutdown() {
    // Persist a barebones shutdown row so historical screens (Past
    // Shutdowns) still show the week as completed. Reflection fields
    // and mood removed per the daily-reflection consolidation.
    try {
      await upsertWeeklyShutdown(selectedWeekRef.current, null, null, null);
    } catch (e) {
      setError(errorMessage(e, "Failed to save shutdown"));
      return;
    }

    // Plan-next-week gate: if next Monday has no commitments and no
    // project statuses, prompt the user to plan before sunset.
    try {
      const nextMonday = getNextMondayIso(selectedWeek);
      const planned = await hasWeekBeenPlanned(nextMonday);
      if (!planned) {
        setShowPlanPrompt(true);
        return;
      }
    } catch {
      // If the planning check fails, don't block shutdown.
    }
    finalizeShutdown();
  }

  function finalizeShutdown() {
    localStorage.setItem(WEEKLY_SHUTDOWN_PREFIX + selectedWeek, "true");
    openSunsetOverlay();
  }

  function handlePlanNextWeek() {
    setShowPlanPrompt(false);
    // Mark this week's shutdown as complete first so the user doesn't
    // see the prompt again when they return.
    finalizeShutdown();
    // Advance to next week and switch to the weekly plan screen.
    setSelectedWeek(getNextMondayIso(selectedWeek));
    setPage("weekly");
  }

  function handleSkipPlan() {
    setShowPlanPrompt(false);
    finalizeShutdown();
  }

  // ── Derived ───────────────────────────────────────────────────────────

  // Total worked across all days/projects.
  const totalWorkedMinutes = Array.from(workedByDay.values()).reduce(
    (sum, inner) => sum + Array.from(inner.values()).reduce((s, n) => s + n, 0),
    0
  );

  // Per-day objectives summary: for each day, list { project, minutes },
  // sorted by minutes desc.
  const objectivesByDay = new Map<string, { project: Project | null; minutes: number }[]>();
  for (const date of weekDates) {
    const inner = workedByDay.get(date);
    if (!inner) {
      objectivesByDay.set(date, []);
      continue;
    }
    const list = Array.from(inner.entries())
      .filter(([, mins]) => mins > 0)
      .map(([projectId, minutes]) => ({
        project:
          projectId === UNASSIGNED_PROJECT_ID
            ? null
            : projectMap.get(projectId) ?? null,
        minutes,
      }))
      .sort((a, b) => b.minutes - a.minutes);
    objectivesByDay.set(date, list);
  }

  // Per-day completed tasks (below the fold).
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
        className="px-6 py-5 flex-shrink-0 flex items-center gap-3"
        style={{ borderBottom: "0.5px solid var(--border-hairline)" }}
      >
        <span className="inline-flex items-center [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] bg-accent-pink-soft text-accent-pink-deep px-2.5 py-1 rounded-full">
          Weekly shutdown
        </span>
        <h2 className="text-[14px] font-medium text-fg">
          {formatWeekHeader(selectedWeek)}
        </h2>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[900px] mx-auto px-7 py-7 space-y-9">

          {/* Top: bar chart (center) + total stat (right). The chart
              gives an instant read of where effort went each day; the
              stat is the bottom-line "how much" at a glance. */}
          <section className="flex gap-6 items-stretch">
            <div className="flex-1 min-w-0 rounded-lg bg-elevated/40 p-5" style={{ border: "0.5px solid var(--border-hairline)" }}>
              <div className="text-[11px] uppercase tracking-[0.06em] text-fg-faded mb-3">
                Effort by day
              </div>
              <StackedBarChart
                weekDates={weekDates}
                workedByDay={workedByDay}
                projects={projects}
              />
            </div>
            <div
              className="w-[180px] flex-shrink-0 rounded-lg bg-elevated/40 px-5 py-5 flex flex-col justify-center items-start"
              style={{ border: "0.5px solid var(--border-hairline)" }}
            >
              <div className="text-[11px] uppercase tracking-[0.06em] text-fg-faded mb-2">
                Total this week
              </div>
              <div className="text-[28px] font-medium text-accent-pink-bright tabular-nums leading-none mb-1 font-display">
                {totalWorkedMinutes > 0 ? formatHoursMinutes(Math.round(totalWorkedMinutes)) : "—"}
              </div>
              <div className="text-[12px] text-fg-faded">worked</div>
              {completedThisWeek.length > 0 && (
                <div className="mt-4 pt-4 w-full" style={{ borderTop: "0.5px solid var(--border-hairline)" }}>
                  <div className="text-[20px] font-medium text-fg tabular-nums leading-none mb-1">
                    {completedThisWeek.length}
                  </div>
                  <div className="text-[11px] text-fg-faded">
                    {completedThisWeek.length === 1 ? "task done" : "tasks done"}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Per-day objectives summary — quick read of what each day
              actually went into. */}
          <section>
            <h3 className="text-[14px] font-medium text-fg mb-4 font-display">
              By day
            </h3>
            <div className="space-y-4">
              {weekDates.map((date, idx) => {
                const items = objectivesByDay.get(date) ?? [];
                const dayTotal = items.reduce((s, x) => s + x.minutes, 0);
                return (
                  <div key={date} className="flex gap-4">
                    <div className="w-[88px] flex-shrink-0 pt-0.5">
                      <div className="text-[12px] font-medium text-fg-secondary">
                        {DAY_NAMES_SHORT[idx]}
                      </div>
                      <div className="text-[10px] text-fg-faded tabular-nums">
                        {dayTotal > 0 ? formatHoursMinutes(Math.round(dayTotal)) : "—"}
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      {items.length === 0 ? (
                        <p className="text-[12px] text-fg-disabled italic">
                          No tracked time
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {items.map(({ project, minutes }) => (
                            <div
                              key={project?.id ?? "unassigned"}
                              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-elevated"
                              style={{
                                border: "0.5px solid var(--border-hairline)",
                              }}
                            >
                              <span
                                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                style={{
                                  backgroundColor: project?.color ?? "var(--text-disabled)",
                                }}
                              />
                              <span className="text-[12px] text-fg-secondary truncate max-w-[200px]">
                                {project?.name ?? "Unassigned"}
                              </span>
                              <span className="text-[11px] text-fg-faded tabular-nums">
                                {formatHoursMinutes(Math.round(minutes))}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Below the fold: per-day tasks completed. The detail layer
              for "what specifically got done" — collapsed into a thin
              section so it doesn't compete with the headline stats. */}
          <section className="pt-2" style={{ borderTop: "0.5px solid var(--border-hairline)" }}>
            <h3 className="text-[14px] font-medium text-fg mt-6 mb-4 font-display">
              Tasks completed
            </h3>
            <div className="space-y-5">
              {weekDates.map((date, idx) => {
                const dayTasks = tasksByDay.get(date) ?? [];
                if (dayTasks.length === 0) return null;
                return (
                  <div key={date}>
                    <h4 className="text-[12px] font-medium text-fg-secondary mb-2">
                      {DAY_NAMES_SHORT[idx]} — {formatDayHeading(date)}
                    </h4>
                    <div className="space-y-1">
                      {dayTasks.map((task) => {
                        const project =
                          task.project_id != null
                            ? projectMap.get(task.project_id)
                            : null;
                        const worked = workedPerTask.get(task.id) ?? 0;
                        const isHighlight = !!task.is_highlight;
                        return (
                          <div
                            key={task.id}
                            className="px-2.5 py-[6px] rounded-md flex items-center gap-2.5 bg-elevated/60"
                            style={{ border: "0.5px solid var(--border-hairline)" }}
                          >
                            {isHighlight ? (
                              <svg
                                width="13" height="13" viewBox="0 0 24 24"
                                fill="var(--accent-highlight)"
                                stroke="var(--accent-highlight)" strokeWidth="2" strokeLinejoin="round"
                                className="flex-shrink-0"
                              >
                                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                              </svg>
                            ) : (
                              <svg
                                width="13" height="13" viewBox="0 0 16 16"
                                fill="none" stroke="var(--accent-pink)" strokeWidth="2"
                                strokeLinecap="round" strokeLinejoin="round"
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
                                {formatHoursMinutes(Math.round(worked))}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {completedThisWeek.length === 0 && (
                <p className="text-[12px] text-fg-disabled italic">
                  No completed tasks this week.
                </p>
              )}
            </div>
          </section>
        </div>
      </div>

      {/* ── Footer — anchored complete-shutdown action ───────────────── */}
      <div
        className="px-6 py-4 flex-shrink-0"
        style={{ borderTop: "0.5px solid var(--border-hairline)" }}
      >
        <div className="max-w-[900px] mx-auto">
          <button
            onClick={handleCompleteShutdown}
            className="w-full py-3 rounded-lg border border-accent-pink-bright/60 text-accent-pink-bright text-[14px] font-medium cursor-pointer hover:border-accent-pink hover:bg-accent-pink-soft transition-colors flex items-center justify-center gap-2"
          >
            <svg width="14" height="10" viewBox="0 0 14 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1.5 4 Q7 9 12.5 4" />
              <path d="M3 6.5 l-0.5 1.5" />
              <path d="M7 7.5 l0 1.5" />
              <path d="M11 6.5 l0.5 1.5" />
            </svg>
            Complete shutdown
          </button>
        </div>
      </div>

      {showPlanPrompt && (
        <PlanNextWeekPrompt
          onPlan={handlePlanNextWeek}
          onSkip={handleSkipPlan}
          onCancel={() => setShowPlanPrompt(false)}
        />
      )}
    </div>
  );
}
