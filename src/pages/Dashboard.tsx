import { useEffect, useState, useCallback } from "react";
import { useAppStore } from "../stores/appStore";
import {
  getTasksForWeek,
  getPlannedMinutesPerDay,
  getWorkedMinutesForWeek,
  getProjectStats,
  getProjects,
  getRecentCompletedTasks,
} from "../db/queries";
import ErrorBanner from "../components/ErrorBanner";
import type { Project, Task } from "../types";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri"];

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
  // Derive y-axis max from data
  const allValues = weekDates.flatMap((d) => [
    plannedByDay.get(d) ?? 0,
    workedByDay.get(d) ?? 0,
  ]);
  const maxMinutes = Math.max(...allValues, 60); // min 60 so empty weeks don't break
  const yAxisMax = Math.ceil(maxMinutes / 60); // round up to nearest hour

  const yLabels: number[] = [];
  const step = Math.max(1, Math.ceil(yAxisMax / 4));
  for (let i = 0; i <= yAxisMax; i += step) {
    yLabels.push(i);
  }
  yLabels.reverse();

  return (
    <div className="flex gap-2">
      {/* Y-axis labels */}
      <div className="flex flex-col justify-between py-1 pr-1 w-8 flex-shrink-0">
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
          const chartHeight = 140;

          return (
            <div key={date} className="flex-1 flex flex-col items-center">
              {/* Bar pair */}
              <div
                className="w-full flex items-end justify-center gap-[3px]"
                style={{ height: chartHeight }}
              >
                {/* Planned bar */}
                <div
                  className="w-[14px] rounded-t-[3px] bg-chart-bar-neutral/25 transition-all duration-300"
                  style={{
                    height: `${(plannedPct / 100) * chartHeight}px`,
                  }}
                  title={`Planned: ${formatMinutesToHours(planned)}h`}
                />
                {/* Worked bar */}
                <div
                  className="w-[14px] rounded-t-[3px] bg-chart-bar-neutral transition-all duration-300"
                  style={{
                    height: `${(workedPct / 100) * chartHeight}px`,
                  }}
                  title={`Worked: ${formatMinutesToHours(worked)}h`}
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

function ProjectProgressRow({
  project,
  total,
  done,
}: {
  project: Project;
  total: number;
  done: number;
}) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

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

  const [weekTasks, setWeekTasks] = useState<Task[]>([]);
  const [plannedByDay, setPlannedByDay] = useState<Map<string, number>>(
    new Map()
  );
  const [workedByDay, setWorkedByDay] = useState<Map<string, number>>(
    new Map()
  );
  const [projectStatsMap, setProjectStatsMap] = useState<
    Map<number, { total: number; done: number; lastDate: string | null }>
  >(new Map());
  const [projects, setProjects] = useState<Project[]>([]);
  const [recentCompleted, setRecentCompleted] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);

  const weekDates = getWeekdayDates(selectedWeek);
  const fridayIso = getFridayIso(selectedWeek);
  const isThisWeek = selectedWeek === getMondayOfWeek();

  const loadData = useCallback(async () => {
    try {
      const [wt, pbd, wbd, ps, p, rc] = await Promise.all([
        getTasksForWeek(selectedWeek, fridayIso),
        getPlannedMinutesPerDay(selectedWeek, fridayIso),
        getWorkedMinutesForWeek(selectedWeek, fridayIso),
        getProjectStats(),
        getProjects(),
        getRecentCompletedTasks(selectedWeek, fridayIso),
      ]);
      setWeekTasks(wt);
      setPlannedByDay(pbd);
      setWorkedByDay(wbd);
      setProjectStatsMap(ps);
      setProjects(p);
      setRecentCompleted(rc);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard");
    }
  }, [selectedWeek, fridayIso]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function changeWeek(offset: number) {
    const d = new Date(selectedWeek + "T00:00:00");
    d.setDate(d.getDate() + offset * 7);
    setSelectedWeek(d.toISOString().split("T")[0]);
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

  const todayStr = new Date().toISOString().split("T")[0];
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayStr = yesterdayDate.toISOString().split("T")[0];

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
          <span className="text-[11px] bg-accent-orange-soft text-accent-orange px-2 py-0.5 rounded-full">
            This week
          </span>
        )}
        {!isThisWeek && (
          <button
            onClick={() => setSelectedWeek(getMondayOfWeek())}
            className="text-[11px] text-accent-orange hover:text-accent-orange-hover cursor-pointer"
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
        {!hasAnyData ? (
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
                    <div className="w-[10px] h-[10px] rounded-[2px] bg-chart-bar-neutral/25" />
                    <span className="text-[10px] text-fg-faded">Planned</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-[10px] h-[10px] rounded-[2px] bg-chart-bar-neutral" />
                    <span className="text-[10px] text-fg-faded">Worked</span>
                  </div>
                </div>
              </div>
            </section>

            {/* ── Project progress ───────────────────────────────────── */}
            {activeProjects.length > 0 && (
              <section className="mb-6 animate-slide-up animate-stagger">
                <h3 className="uppercase [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] text-fg-faded mb-2">
                  Project progress
                </h3>
                <div className="bg-elevated border border-line-soft rounded-[10px] px-5 py-3">
                  {activeProjects.map((p) => {
                    const stats = projectStatsMap.get(p.id) ?? {
                      total: 0,
                      done: 0,
                      lastDate: null,
                    };
                    return (
                      <ProjectProgressRow
                        key={p.id}
                        project={p}
                        total={stats.total}
                        done={stats.done}
                      />
                    );
                  })}
                </div>
              </section>
            )}

            {/* ── Recent activity ────────────────────────────────────── */}
            {recentCompleted.length > 0 && (
              <section className="animate-slide-up animate-stagger">
                <h3 className="uppercase [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] text-fg-faded mb-2">
                  Recent activity
                </h3>
                <div className="bg-elevated border border-line-soft rounded-[10px] px-5 py-3">
                  {recentDates.slice(0, 3).map((date) => {
                    const tasks = recentByDate.get(date) ?? [];
                    return (
                      <div
                        key={date}
                        className="py-2 border-b border-divider last:border-b-0"
                      >
                        <div className="text-[11px] font-medium text-fg-secondary mb-1">
                          {formatDateLabel(date)}
                        </div>
                        {tasks.slice(0, 3).map((task) => (
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
                                  {task.estimated_minutes}m
                                </span>
                              )}
                          </div>
                        ))}
                        {tasks.length > 3 && (
                          <span className="text-[10px] text-fg-faded mt-0.5 block">
                            +{tasks.length - 3} more
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
