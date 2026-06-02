import { useState, useEffect, useMemo } from "react";
import { onProjectChanged } from "../utils/projectEvents";
import Button from "./Button";
import ProjectGlyph from "./ProjectGlyph";
import { useCustomIcons } from "../hooks/useCustomIcons";
import { getProjects, getTasksForDate, getTasksForWeek } from "../db/queries";
import type { Task, Project } from "../types";

/** Group marker: the objective's emoji/custom icon when set, else its color dot
 *  (faded for the "No project" group). Keeps the dot small but renders emojis
 *  large enough to read, centered in a fixed box so rows stay aligned. */
function GroupMarker({
  project,
  iconsById,
  topOffset,
}: {
  project: Project | null;
  iconsById: Map<number, string>;
  topOffset: number;
}) {
  const hasGlyph = !!project && (!!project.icon || project.custom_icon_id != null);
  return (
    <span
      className="flex-shrink-0 inline-flex items-center justify-center w-[15px] h-[15px]"
      style={{ marginTop: topOffset }}
    >
      {project ? (
        <ProjectGlyph project={project} iconsById={iconsById} size={hasGlyph ? 15 : 8} />
      ) : (
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "var(--text-faded)" }} />
      )}
    </span>
  );
}

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

function DailySection({ groups, iconsById }: { groups: ProjectGroup[]; iconsById: Map<number, string> }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <span className="w-2 h-2 rounded-full bg-accent-blue flex-shrink-0" />
        <span className="text-[14px] font-semibold text-fg">Today</span>
      </div>
      {groups.length === 0 ? (
        <p className="text-[13px] italic text-fg-faded ml-4">Nothing here.</p>
      ) : (
        <div className="space-y-5 ml-4">
          {groups.map((g, i) => (
            <div key={g.project?.id ?? `none-${i}`}>
              <div className="flex items-start gap-2 mb-2">
                <GroupMarker project={g.project} iconsById={iconsById} topOffset={3} />
                <span className="text-[13px] font-medium text-fg line-clamp-2 leading-[1.4]">
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
                          stroke="var(--accent-green)"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="flex-shrink-0 mt-[3px]"
                        >
                          <path d="M2.5 6.7l2.5 2.5L10.5 3.5" />
                        </svg>
                      ) : (
                        <span className="text-fg-faded flex-shrink-0">·</span>
                      )}
                      <span
                        className={
                          done
                            ? "text-fg-muted line-through font-normal"
                            : "text-fg font-normal"
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
  iconsById,
  completed = false,
}: {
  label: string;
  groups: ProjectGroup[];
  iconsById: Map<number, string>;
  completed?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <span className="w-2 h-2 rounded-full bg-accent-blue flex-shrink-0" />
        <span className="text-[15px] font-semibold text-fg">{label}</span>
      </div>
      {groups.length === 0 ? (
        <p className="text-[13px] text-fg-faded italic ml-4">Nothing here.</p>
      ) : (
        <div className="space-y-5 ml-4">
          {groups.map((g, i) => (
            <div key={g.project?.id ?? `none-${i}`}>
              <div className="flex items-start gap-2 mb-1.5">
                <GroupMarker project={g.project} iconsById={iconsById} topOffset={2} />
                <span className="text-[12px] font-semibold text-fg line-clamp-2 leading-[1.4]">
                  {g.project?.name ?? "No project"}
                </span>
              </div>
              <ul className="ml-4 space-y-1">
                {g.tasks.map((t) => (
                  <li
                    key={t.id}
                    className="text-[13px] text-fg-secondary leading-[1.5] flex items-start gap-2"
                  >
                    {completed ? (
                      <span className="text-accent-green flex-shrink-0 mt-[1px]">✓</span>
                    ) : (
                      <span className="text-fg-faded flex-shrink-0">·</span>
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
  // Pre-M4 surfaces: SummaryOverlay's three task lists weren't
  // migrated to canonical store during M3.2 (the entity plan §M3.2
  // listed SummaryOverlay among the eleven files but it wasn't
  // touched in b.1-b.5). Read-only summary modal — daily uses the
  // selected date's tasks; weekly uses week ranges. Hybrid SQL →
  // IDs → tasksById migration would close these. Track for
  // follow-up cleanup.
  // eslint-disable-next-line no-restricted-syntax -- pre-M4 M3 gap
  const [dailyTasks, setDailyTasks] = useState<Task[]>([]);
  // eslint-disable-next-line no-restricted-syntax -- pre-M4 M3 gap
  const [weeklyDoneTasks, setWeeklyDoneTasks] = useState<Task[]>([]);
  // eslint-disable-next-line no-restricted-syntax -- pre-M4 M3 gap
  const [weeklyNextTasks, setWeeklyNextTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const { byId: iconsById } = useCustomIcons();
  // #3 — refresh project name/color on verseday:project-changed (the summary
  // groups tasks by project chrome; historical task data is untouched). Read-
  // only, mounted-guarded, balanced cleanup.
  useEffect(() => {
    let mounted = true;
    const off = onProjectChanged(() => {
      getProjects()
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
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

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
      <div className="absolute inset-0 bg-overlay-scrim" />
      <div
        className="relative bg-elevated rounded-xl w-[640px] max-w-[92vw] max-h-[85vh] flex flex-col overflow-hidden animate-scale-in"
        style={{ boxShadow: "var(--shadow-modal)" }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        {/* Header */}
        <div className="flex items-start gap-3 px-8 pt-7 pb-5 border-b border-divider">
          <div className="flex-1 min-w-0">
            <h2 className="text-[24px] font-semibold text-fg leading-tight">
              {title}
            </h2>
            <p className="text-[12px] text-fg-muted mt-1">{subtitle}</p>
          </div>
          <button
            onClick={onClose}
            className="text-fg-faded hover:text-fg-secondary cursor-pointer text-[16px] flex-shrink-0 w-7 h-7 flex items-center justify-center"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-8 py-8">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-5 h-5 border-2 border-accent-blue border-t-transparent rounded-full animate-spin" />
            </div>
          ) : type === "daily" ? (
            <DailySection groups={dailyGroups} iconsById={iconsById} />
          ) : (
            <div className="space-y-8">
              <WeeklySection label="This week" groups={weeklyDoneGroups} iconsById={iconsById} completed />
              <WeeklySection label="Next week" groups={weeklyNextGroups} iconsById={iconsById} />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-8 py-3.5 border-t border-line-hairline">
          <Button size="sm" onClick={handleCopy} className="min-w-[148px]">
            {copied ? "Copied!" : "Copy to clipboard"}
          </Button>
        </div>
      </div>
    </div>
  );
}
