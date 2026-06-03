import { useEffect, useState, useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  selectProjectsByStatus,
  selectTaskIdsByWeek,
  useAppStore,
} from "../stores/appStore";
import {
  getPlannedMinutesPerDay,
  getWorkedMinutesForWeek,
  getCompletedShutdowns,
  type CompletedShutdown,
} from "../db/queries";
import ErrorBanner from "../components/ErrorBanner";
import { errorMessage } from "../utils/errors";
import PastShutdownCard from "../components/PastShutdownCard";
import { localDateIso, todayString, mondayOfWeek as getMondayOfWeek, weekdayDates as getWeekdayDates } from "../utils/dates";
import { formatHoursMinutes } from "../utils/format";
import type { Project, Task } from "../types";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri"];

function getFridayIso(mondayIso: string): string {
  const d = new Date(mondayIso + "T00:00:00");
  d.setDate(d.getDate() + 4);
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

function formatMinutesToHours(minutes: number): string {
  return (Math.round(minutes / 6) / 10).toFixed(1).replace(/\.0$/, "");
}

// ─── Bar chart ──────────────────────────────────────────────────────────────

function BarChart({
  weekDates,
  plannedByDay,
  workedByDay,
}: {
  weekDates: string[];
  plannedByDay: Map<string, number>;
  workedByDay: Map<string, number>;
}) {
  // Fixed 8h y-axis — a standard working day. Days that exceed it cap at the
  // top (Math.min below); rare and acceptable. Step 4 keeps the labels (8/4/0)
  // evenly spaced AND at their true heights (a step that doesn't divide the
  // max would put e.g. "6" at the wrong fraction of the column).
  const yAxisMax = 8;

  // Generous bar area so a day reads at its true fraction of the 8h scale
  // (2h → 25% is a substantial bar, not a stub) — matches the weekly-shutdown
  // "Effort by day" chart.
  const chartHeight = 260;

  const yLabels: number[] = [];
  const step = 4;
  for (let i = 0; i <= yAxisMax; i += step) {
    yLabels.push(i);
  }
  if (yLabels[yLabels.length - 1] !== yAxisMax) yLabels.push(yAxisMax);
  yLabels.reverse();

  return (
    <div className="flex gap-2">
      {/* Y-axis labels — pinned to the bar-area height so 8h/4h/0h line up
          with the bars (not stretched to include the day-label row below). */}
      <div
        className="flex flex-col justify-between pr-1 w-8 flex-shrink-0"
        style={{ height: chartHeight }}
      >
        {yLabels.map((h) => (
          <span
            key={h}
            className="text-[10px] text-fg-faded tabular-nums text-right"
          >
            {h}h
          </span>
        ))}
      </div>

      {/* Bars */}
      <div className="flex-1 flex items-end gap-3">
        {weekDates.map((date, i) => {
          const planned = plannedByDay.get(date) ?? 0;
          const worked = workedByDay.get(date) ?? 0;
          const plannedPct =
            yAxisMax > 0
              ? Math.min((planned / 60 / yAxisMax) * 100, 100)
              : 0;
          const workedPct =
            yAxisMax > 0
              ? Math.min((worked / 60 / yAxisMax) * 100, 100)
              : 0;

          return (
            <div key={date} className="flex-1 flex flex-col items-center">
              {/* Bar pair */}
              <div
                className="w-full flex items-end justify-center gap-[3px]"
                style={{ height: chartHeight }}
              >
                {/* Worked (actual) bar — cool slate, "done" — on the left */}
                <div
                  className="w-[22px] rounded-t-[3px] bg-chart-bar-worked transition-all duration-300"
                  style={{
                    height: `${(workedPct / 100) * chartHeight}px`,
                  }}
                  title={`Worked: ${formatMinutesToHours(worked)}h`}
                />
                {/* Planned bar — warm tan, "intent" — on the right */}
                <div
                  className="w-[22px] rounded-t-[3px] bg-chart-bar-planned transition-all duration-300"
                  style={{
                    height: `${(plannedPct / 100) * chartHeight}px`,
                  }}
                  title={`Planned: ${formatMinutesToHours(planned)}h`}
                />
              </div>
              {/* Day label */}
              <span className="text-[10px] text-fg-faded mt-1.5">
                {DAY_NAMES[i]}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Project progress row ───────────────────────────────────────────────────

function ProjectProgressRow({ project }: { project: Project }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div
        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
        style={{ background: project.color }}
      />
      <span className="text-[13px] text-fg flex-1 truncate">
        {project.name}
      </span>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export default function Dashboard() {
  const { selectedWeek, setSelectedWeek } = useAppStore();

  const [plannedByDay, setPlannedByDay] = useState<Map<string, number>>(
    new Map()
  );
  const [workedByDay, setWorkedByDay] = useState<Map<string, number>>(
    new Map()
  );
  // Recent-activity days the user has expanded to see every finished task
  // (otherwise capped at 3 with a "+N more" toggle).
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const toggleExpandedDate = (date: string) =>
    setExpandedDates((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  const projects = useAppStore(useShallow((s) => selectProjectsByStatus(s, "active")));
  const [pastShutdowns, setPastShutdowns] = useState<CompletedShutdown[]>([]);
  const [error, setError] = useState<string | null>(null);

  const weekDates = getWeekdayDates(selectedWeek);
  const fridayIso = getFridayIso(selectedWeek);
  const isThisWeek = selectedWeek === getMondayOfWeek();

  // Canonical week tasks. The store's taskIdsByWeek index spans Mon..Sun
  // (loadTasksForWeek uses weekEndFromMonday), so filter to the Mon..Fri
  // window (date_scheduled <= fridayIso) to preserve the exact set the old
  // getTasksForWeek(selectedWeek, fridayIso) returned. Order (date_scheduled,
  // sort_order) is preserved from the SQL the loader ran.
  const weekIds = useAppStore(
    useShallow((s) => selectTaskIdsByWeek(s, selectedWeek))
  );
  const tasksById = useAppStore((s) => s.tasksById);
  const weekTasks = useMemo(
    () =>
      weekIds
        .map((id) => tasksById.get(id))
        .filter(
          (t): t is Task =>
            !!t && t.date_scheduled != null && t.date_scheduled <= fridayIso
        ),
    [weekIds, tasksById, fridayIso]
  );

  // recentCompleted: matches getRecentCompletedTasks' SQL —
  //   date_scheduled in [selectedWeek, fridayIso] AND status='done'
  //   AND external_dismissal_reason IS NULL
  //   ORDER BY date_scheduled DESC, sort_order  LIMIT 10
  // The week index already excludes external_dismissal_reason rows (the loader
  // ran the same filter), so done + the Mon..Fri bound + the DESC/limit
  // reproduce the original list exactly.
  const recentCompleted = useMemo(() => {
    const done = weekIds
      .map((id) => tasksById.get(id))
      .filter(
        (t): t is Task =>
          !!t &&
          t.status === "done" &&
          t.date_scheduled != null &&
          t.date_scheduled <= fridayIso
      );
    done.sort((a, b) => {
      if (a.date_scheduled !== b.date_scheduled) {
        // DESC by date_scheduled
        return a.date_scheduled! < b.date_scheduled! ? 1 : -1;
      }
      return a.sort_order - b.sort_order;
    });
    return done.slice(0, 10);
  }, [weekIds, tasksById, fridayIso]);

  const loadData = useCallback(async () => {
    try {
      // Prime the canonical week index/map; weekTasks + recentCompleted derive
      // from it via the selectors above.
      await useAppStore.getState().loadTasksForWeek(selectedWeek);
      const [pbd, wbd, sd] = await Promise.all([
        getPlannedMinutesPerDay(selectedWeek, fridayIso),
        getWorkedMinutesForWeek(selectedWeek, fridayIso),
        getCompletedShutdowns(4),
      ]);
      setPlannedByDay(pbd);
      setWorkedByDay(wbd);
      setPastShutdowns(sd);
      setError(null);
    } catch (e) {
      setError(errorMessage(e, "Failed to load dashboard"));
    }
  }, [selectedWeek, fridayIso]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function changeWeek(offset: number) {
    const d = new Date(selectedWeek + "T00:00:00");
    d.setDate(d.getDate() + offset * 7);
    setSelectedWeek(localDateIso(d));
  }

  // ── Derived stats ─────────────────────────────────────────────────────

  const totalPlannedMinutes = Array.from(plannedByDay.values()).reduce(
    (s, m) => s + m,
    0
  );
  const totalWorkedMinutes = Array.from(workedByDay.values()).reduce(
    (s, m) => s + m,
    0
  );
  const totalTasks = weekTasks.length;
  const completedTasks = weekTasks.filter((t) => t.status === "done").length;

  // Projects with tasks this week
  const projectIdsThisWeek = new Set<number>();
  for (const t of weekTasks) {
    if (t.project_id != null) projectIdsThisWeek.add(t.project_id);
  }
  const activeProjects = projects.filter((p) => projectIdsThisWeek.has(p.id));

  // Group recent completed by date
  const recentByDate = new Map<string, Task[]>();
  for (const task of recentCompleted) {
    const date = task.date_scheduled ?? "unknown";
    const existing = recentByDate.get(date) ?? [];
    existing.push(task);
    recentByDate.set(date, existing);
  }
  const recentDates = Array.from(recentByDate.keys()).sort().reverse();

  const todayStr = todayString();
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayStr = localDateIso(yesterdayDate);

  function formatDateLabel(date: string): string {
    if (date === todayStr) return "Today";
    if (date === yesterdayStr) return "Yesterday";
    return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
  }

  // ── Render ────────────────────────────────────────────────────────────

  const hasAnyData =
    totalTasks > 0 ||
    totalPlannedMinutes > 0 ||
    totalWorkedMinutes > 0;

  return (
    <div className="flex flex-col h-full bg-base overflow-hidden">
      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-line-soft flex-shrink-0">
        <h2 className="flex-1 text-[18px] font-medium text-fg font-display">
          Dashboard
        </h2>
        <button
          onClick={() => changeWeek(-1)}
          className="w-7 h-7 rounded-full flex items-center justify-center text-fg-muted cursor-pointer hover:bg-overlay-hover transition-colors duration-150 ease-out"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 4l-4 4 4 4" />
          </svg>
        </button>
        <span className="text-[13px] text-fg-secondary">
          {formatWeekHeader(selectedWeek)}
        </span>
        {isThisWeek && (
          <span className="text-[11px] bg-accent-orange-soft text-accent-orange-soft-fg px-2 py-0.5 rounded-full">
            This week
          </span>
        )}
        {!isThisWeek && (
          <button
            onClick={() => setSelectedWeek(getMondayOfWeek())}
            className="text-[11px] text-accent-orange-soft-fg hover:text-accent-orange cursor-pointer"
          >
            This week
          </button>
        )}
        <button
          onClick={() => changeWeek(1)}
          className="w-7 h-7 rounded-full flex items-center justify-center text-fg-muted cursor-pointer hover:bg-overlay-hover transition-colors duration-150 ease-out"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 4l4 4-4 4" />
          </svg>
        </button>
      </div>

      {/* ── Scrollable body ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {!hasAnyData && pastShutdowns.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <p className="text-[14px] text-fg-faded mb-1">
              Nothing tracked yet this week
            </p>
            <p className="text-[12px] text-fg-faded">
              Plan your day, start a focus session, and your week will take shape here.
            </p>
          </div>
        ) : (
          <div className="max-w-[680px] mx-auto px-6 py-6">
            {!hasAnyData && (
              <div className="mb-8 animate-slide-up animate-stagger">
                <p className="text-[13px] text-fg-faded">Nothing tracked yet this week.</p>
              </div>
            )}
            {hasAnyData && (
              <>
            {/* ── Week summary ────────────────────────────────────────── */}
            <div className="mb-8 animate-slide-up animate-stagger">
              <div className="text-[36px] font-semibold leading-none font-display text-fg">
                {formatMinutesToHours(totalWorkedMinutes)}h
                <span className="text-[14px] font-normal text-fg-faded ml-2">worked</span>
              </div>
              <div className="flex items-center gap-4 mt-2">
                <span className="text-[13px] text-fg-muted">
                  {formatMinutesToHours(totalPlannedMinutes)}h planned
                </span>
                <span className="text-[13px] text-fg-muted">
                  {completedTasks}/{totalTasks} tasks done
                </span>
              </div>
            </div>

            {/* ── Daily breakdown ────────────────────────────────────── */}
            <section className="mb-6 animate-slide-up animate-stagger">
              <h3 className="uppercase [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] text-fg-faded mb-3">
                Daily breakdown
              </h3>
              <div className="bg-elevated border border-line-soft rounded-[10px] px-5 py-4">
                <BarChart
                  weekDates={weekDates}
                  plannedByDay={plannedByDay}
                  workedByDay={workedByDay}
                />
                {/* Legend */}
                <div className="flex items-center gap-4 mt-3 justify-center">
                  <div className="flex items-center gap-1.5">
                    <div className="w-[10px] h-[10px] rounded-[2px] bg-chart-bar-worked" />
                    <span className="text-[10px] text-fg-faded">Worked</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-[10px] h-[10px] rounded-[2px] bg-chart-bar-planned" />
                    <span className="text-[10px] text-fg-faded">Planned</span>
                  </div>
                </div>
              </div>
            </section>

            {/* ── Recent activity ────────────────────────────────────── */}
            {recentCompleted.length > 0 && (
              <section className="mb-6 animate-slide-up animate-stagger">
                <h3 className="uppercase [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] text-fg-faded mb-2">
                  Recent activity
                </h3>
                <div className="bg-elevated border border-line-soft rounded-[10px] px-5 py-3">
                  {recentDates.slice(0, 3).map((date) => {
                    const tasks = recentByDate.get(date) ?? [];
                    const isExpanded = expandedDates.has(date);
                    const visibleTasks = isExpanded ? tasks : tasks.slice(0, 3);
                    return (
                      <div
                        key={date}
                        className="py-2 border-b border-divider last:border-b-0"
                      >
                        <div className="text-[11px] font-medium text-fg-secondary mb-1">
                          {formatDateLabel(date)}
                        </div>
                        {visibleTasks.map((task) => (
                          <div
                            key={task.id}
                            className="flex items-center gap-2 py-0.5"
                          >
                            <span className="text-[11px] text-accent-green">
                              ✓
                            </span>
                            <span className="text-[12px] text-fg truncate">
                              {task.title}
                            </span>
                            {task.estimated_minutes != null &&
                              task.estimated_minutes > 0 && (
                                <span className="text-[10px] text-fg-faded flex-shrink-0">
                                  {formatHoursMinutes(task.estimated_minutes)}
                                </span>
                              )}
                          </div>
                        ))}
                        {tasks.length > 3 && (
                          <button
                            onClick={() => toggleExpandedDate(date)}
                            className="text-[10px] text-fg-faded hover:text-fg-secondary mt-0.5 block cursor-pointer transition-colors"
                          >
                            {isExpanded
                              ? "Show less"
                              : `+${tasks.length - 3} more`}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* ── Project progress ───────────────────────────────────── */}
            {activeProjects.length > 0 && (
              <section className="mb-6 animate-slide-up animate-stagger">
                <h3 className="uppercase [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] text-fg-faded mb-2">
                  Project progress
                </h3>
                <div className="bg-elevated border border-line-soft rounded-[10px] px-5 py-3">
                  {activeProjects.map((p) => (
                    <ProjectProgressRow key={p.id} project={p} />
                  ))}
                </div>
              </section>
            )}
              </>
            )}

            {/* ── Past shutdowns ─────────────────────────────────────── */}
            {pastShutdowns.length > 0 && (
              <section className="animate-slide-up animate-stagger mt-8">
                <div className="flex items-baseline justify-between mb-2">
                  <h3 className="uppercase [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] text-fg-faded">
                    Past shutdowns
                  </h3>
                  {pastShutdowns.length > 3 && (
                    <button
                      onClick={() => useAppStore.getState().setPage("past_shutdowns")}
                      className="text-[11px] text-accent-blue-soft-fg hover:text-accent-blue cursor-pointer"
                    >
                      View all →
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {pastShutdowns.slice(0, 3).map((s) => (
                    <PastShutdownCard
                      key={s.date}
                      date={s.date}
                      mood={s.mood}
                      reflection={s.reflection}
                      tasksDone={s.tasksDone}
                      workedMinutes={s.workedMinutes}
                      projects={projects}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
