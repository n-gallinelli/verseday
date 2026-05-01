import { useState, useEffect, useRef, useMemo } from "react";
import Button from "./Button";
import { getProjects, getTasksForDate, getTasksForWeek } from "../db/queries";
import type { Task, Project } from "../types";

interface SummaryOverlayProps {
  type: "daily" | "weekly";
  /** For "daily": ISO date for the day being summarized. For "weekly": Monday of the week (ISO). */
  anchorDate: string;
  onClose: () => void;
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

function formatLongDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatWeekOf(monIso: string): string {
  const d = new Date(monIso + "T00:00:00");
  return `Week of ${d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })}`;
}

interface ProjectGroup {
  project: Project | null;
  tasks: Task[];
}

function groupByProject(tasks: Task[], projects: Project[]): ProjectGroup[] {
  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const groups = new Map<number | null, Task[]>();
  for (const t of tasks) {
    const key = t.project_id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  const result: ProjectGroup[] = [];
  for (const [pid, list] of groups) {
    if (pid != null) {
      const proj = projectMap.get(pid) ?? null;
      result.push({ project: proj, tasks: list });
    }
  }
  result.sort((a, b) => (a.project?.name ?? "").localeCompare(b.project?.name ?? ""));
  if (groups.has(null)) {
    result.push({ project: null, tasks: groups.get(null)! });
  }
  return result;
}

function DailySection({ groups }: { groups: ProjectGroup[] }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <span className="w-2 h-2 rounded-full bg-[#7B9ED9] flex-shrink-0" />
        <span className="text-[14px] font-semibold text-[#1a1a1a]">Today</span>
      </div>
      {groups.length === 0 ? (
        <p className="text-[13px] italic text-[#bbb] ml-4">Nothing here.</p>
      ) : (
        <div className="space-y-5 ml-4">
          {groups.map((g, i) => (
            <div key={g.project?.id ?? `none-${i}`}>
              <div className="flex items-start gap-2 mb-2">
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0 mt-[6px]"
                  style={{ backgroundColor: g.project?.color ?? "#999" }}
                />
                <span className="text-[13px] font-medium text-[#333] line-clamp-2 leading-[1.4]">
                  {g.project?.name ?? "No project"}
                </span>
              </div>
              <ul className="ml-4 space-y-2">
                {g.tasks.map((t) => {
                  const done = t.status === "done";
                  return (
                    <li
                      key={t.id}
                      className="text-[13px] leading-[1.5] flex items-start gap-2"
                    >
                      {done ? (
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 13 13"
                          fill="none"
                          stroke="#6A9E7F"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="flex-shrink-0 mt-[3px]"
                        >
                          <path d="M2.5 6.7l2.5 2.5L10.5 3.5" />
                        </svg>
                      ) : (
                        <span className="text-[#bbb] flex-shrink-0">·</span>
                      )}
                      <span
                        className={
                          done
                            ? "text-[#999] line-through font-normal"
                            : "text-[#333] font-normal"
                        }
                      >
                        {t.title}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WeeklySection({
  label,
  groups,
  completed = false,
}: {
  label: string;
  groups: ProjectGroup[];
  completed?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <span className="w-2 h-2 rounded-full bg-[#7B9ED9] flex-shrink-0" />
        <span className="text-[15px] font-semibold text-[#2c2a35]">{label}</span>
      </div>
      {groups.length === 0 ? (
        <p className="text-[13px] text-black/30 italic ml-4">Nothing here.</p>
      ) : (
        <div className="space-y-5 ml-4">
          {groups.map((g, i) => (
            <div key={g.project?.id ?? `none-${i}`}>
              <div className="flex items-start gap-2 mb-1.5">
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0 mt-[5px]"
                  style={{ backgroundColor: g.project?.color ?? "#999" }}
                />
                <span className="text-[12px] font-semibold text-[#2c2a35] line-clamp-2 leading-[1.4]">
                  {g.project?.name ?? "No project"}
                </span>
              </div>
              <ul className="ml-4 space-y-1">
                {g.tasks.map((t) => (
                  <li
                    key={t.id}
                    className="text-[13px] text-[#555] leading-[1.5] flex items-start gap-2"
                  >
                    {completed ? (
                      <span className="text-[#6A9E7F] flex-shrink-0 mt-[1px]">✓</span>
                    ) : (
                      <span className="text-black/30 flex-shrink-0">·</span>
                    )}
                    <span>{t.title}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function buildDailyPlainText(
  title: string,
  subtitle: string,
  groups: ProjectGroup[],
): string {
  const lines: string[] = [title, subtitle, "", "# Today"];
  if (groups.length === 0) {
    lines.push("Nothing here.");
  } else {
    for (const g of groups) {
      lines.push("");
      lines.push(`## ${g.project?.name ?? "No project"}`);
      for (const t of g.tasks) {
        lines.push(t.status === "done" ? `- ✓ ${t.title}` : `- ${t.title}`);
      }
    }
  }
  return lines.join("\n").trim();
}

function buildWeeklyPlainText(
  title: string,
  subtitle: string,
  currentLabel: string,
  currentGroups: ProjectGroup[],
  nextLabel: string,
  nextGroups: ProjectGroup[],
): string {
  const lines: string[] = [title, subtitle, ""];
  for (const [label, groups, completed] of [
    [currentLabel, currentGroups, true],
    [nextLabel, nextGroups, false],
  ] as const) {
    lines.push(`# ${label}`);
    if (groups.length === 0) {
      lines.push("Nothing here.");
    } else {
      for (const g of groups) {
        lines.push("");
        lines.push(`## ${g.project?.name ?? "No project"}`);
        for (const t of g.tasks) {
          lines.push(completed ? `- ✓ ${t.title}` : `- ${t.title}`);
        }
      }
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

export default function SummaryOverlay({ type, anchorDate, onClose }: SummaryOverlayProps) {
  const [dailyTasks, setDailyTasks] = useState<Task[]>([]);
  const [weeklyDoneTasks, setWeeklyDoneTasks] = useState<Task[]>([]);
  const [weeklyNextTasks, setWeeklyNextTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        if (type === "daily") {
          const [allProjects, today] = await Promise.all([
            getProjects(),
            getTasksForDate(anchorDate),
          ]);
          if (cancelled) return;
          setProjects(allProjects);
          setDailyTasks(today);
        } else {
          const [allProjects, thisWeek, nextWeek] = await Promise.all([
            getProjects(),
            getTasksForWeek(anchorDate, addDays(anchorDate, 4)),
            getTasksForWeek(addDays(anchorDate, 7), addDays(anchorDate, 11)),
          ]);
          if (cancelled) return;
          setProjects(allProjects);
          setWeeklyDoneTasks(thisWeek.filter((t) => t.status === "done"));
          setWeeklyNextTasks(nextWeek.filter((t) => t.status !== "done"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [type, anchorDate]);

  const title = type === "daily" ? "Daily Summary" : "Weekly Summary";
  const subtitle =
    type === "daily" ? formatLongDate(anchorDate) : formatWeekOf(anchorDate);

  const dailyGroups = useMemo(
    () => groupByProject(dailyTasks, projects),
    [dailyTasks, projects]
  );
  const weeklyDoneGroups = useMemo(
    () => groupByProject(weeklyDoneTasks, projects),
    [weeklyDoneTasks, projects]
  );
  const weeklyNextGroups = useMemo(
    () => groupByProject(weeklyNextTasks, projects),
    [weeklyNextTasks, projects]
  );

  function handleCopy() {
    const text =
      type === "daily"
        ? buildDailyPlainText(title, subtitle, dailyGroups)
        : buildWeeklyPlainText(
            title,
            subtitle,
            "This week",
            weeklyDoneGroups,
            "Next week",
            weeklyNextGroups
          );
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/30" />
      <div
        ref={modalRef}
        className="relative bg-white rounded-xl shadow-xl w-[640px] max-w-[92vw] max-h-[85vh] flex flex-col overflow-hidden animate-scale-in"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        {/* Header */}
        <div className="flex items-start gap-3 px-8 pt-7 pb-5 border-b border-black/[0.04]">
          <div className="flex-1 min-w-0">
            <h2 className="text-[24px] font-semibold text-[#1a1a1a] leading-tight">
              {title}
            </h2>
            <p className="text-[12px] text-[#999] mt-1">{subtitle}</p>
          </div>
          <button
            onClick={onClose}
            className="text-black/25 hover:text-black/50 cursor-pointer text-[16px] flex-shrink-0 w-7 h-7 flex items-center justify-center"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-8 py-8">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-5 h-5 border-2 border-[#7B9ED9] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : type === "daily" ? (
            <DailySection groups={dailyGroups} />
          ) : (
            <div className="space-y-8">
              <WeeklySection label="This week" groups={weeklyDoneGroups} completed />
              <WeeklySection label="Next week" groups={weeklyNextGroups} />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-8 py-3.5 border-t border-black/[0.06]">
          <Button size="sm" onClick={handleCopy} className="min-w-[148px]">
            {copied ? "Copied!" : "Copy to clipboard"}
          </Button>
        </div>
      </div>
    </div>
  );
}
