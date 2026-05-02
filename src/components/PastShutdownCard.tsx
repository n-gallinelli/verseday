import { useState } from "react";
import { getCompletedTasksForDate } from "../db/queries";
import type { Task, Project } from "../types";
import { formatHoursMinutes } from "../utils/format";

interface ReflectionFields {
  howDidItGo: string;
  whatDifferently: string;
  gratefulFor: string;
}

function parseReflection(raw: string | null): ReflectionFields {
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

const MOOD_TINTS: Record<string, string> = {
  Bad: "var(--mood-bad)",
  Rough: "var(--mood-bad)",
  Okay: "var(--mood-okay)",
  Good: "var(--mood-tint-shutdown)",
  Great: "var(--mood-tint-shutdown)",
};

function MoodFace({ mood, size = 18 }: { mood: string; size?: number }) {
  const tint = MOOD_TINTS[mood] ?? "var(--accent-blue)";
  const sw = 1.6;
  const common = { width: size, height: size, viewBox: "0 0 28 28", fill: "none" };

  switch (mood) {
    case "Bad":
      return (
        <svg {...common}>
          <circle cx="14" cy="14" r="11" stroke={tint} strokeWidth={sw} fill={`color-mix(in srgb, ${tint} 8%, transparent)`} />
          <circle cx="10" cy="11.5" r="1.2" fill={tint} />
          <circle cx="18" cy="11.5" r="1.2" fill={tint} />
          <path d="M9.5 19.5c1.5-2.5 7.5-2.5 9 0" stroke={tint} strokeWidth={sw} strokeLinecap="round" fill="none" />
        </svg>
      );
    case "Rough":
      return (
        <svg {...common}>
          <circle cx="14" cy="14" r="11" stroke={tint} strokeWidth={sw} fill={`color-mix(in srgb, ${tint} 8%, transparent)`} />
          <circle cx="10" cy="12" r="1.2" fill={tint} />
          <circle cx="18" cy="12" r="1.2" fill={tint} />
          <path d="M10 18.5c1.2-1.5 6.8-1.5 8 0" stroke={tint} strokeWidth={sw} strokeLinecap="round" fill="none" />
        </svg>
      );
    case "Okay":
      return (
        <svg {...common}>
          <circle cx="14" cy="14" r="11" stroke={tint} strokeWidth={sw} fill={`color-mix(in srgb, ${tint} 8%, transparent)`} />
          <circle cx="10" cy="12" r="1.2" fill={tint} />
          <circle cx="18" cy="12" r="1.2" fill={tint} />
          <line x1="10" y1="18" x2="18" y2="18" stroke={tint} strokeWidth={sw} strokeLinecap="round" />
        </svg>
      );
    case "Good":
      return (
        <svg {...common}>
          <circle cx="14" cy="14" r="11" stroke={tint} strokeWidth={sw} fill={`color-mix(in srgb, ${tint} 8%, transparent)`} />
          <circle cx="10" cy="12" r="1.2" fill={tint} />
          <circle cx="18" cy="12" r="1.2" fill={tint} />
          <path d="M10 17c1.2 1.5 6.8 1.5 8 0" stroke={tint} strokeWidth={sw} strokeLinecap="round" fill="none" />
        </svg>
      );
    case "Great":
      return (
        <svg {...common}>
          <circle cx="14" cy="14" r="11" stroke={tint} strokeWidth={sw} fill={`color-mix(in srgb, ${tint} 8%, transparent)`} />
          <circle cx="10" cy="11.5" r="1.2" fill={tint} />
          <circle cx="18" cy="11.5" r="1.2" fill={tint} />
          <path d="M9 16.5c1.5 3 8.5 3 10 0" stroke={tint} strokeWidth={sw} strokeLinecap="round" fill="none" />
        </svg>
      );
    default:
      return null;
  }
}

function formatDateLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";

  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

interface PastShutdownCardProps {
  date: string;
  mood: string | null;
  reflection: string | null;
  tasksDone: number;
  workedMinutes: number;
  projects: Project[];
}

export default function PastShutdownCard({
  date,
  mood,
  reflection,
  tasksDone,
  workedMinutes,
  projects,
}: PastShutdownCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [completedTasks, setCompletedTasks] = useState<Task[] | null>(null);
  const [loadingTasks, setLoadingTasks] = useState(false);

  const fields = parseReflection(reflection);
  const preview = fields.howDidItGo || fields.whatDifferently || fields.gratefulFor;
  const projectMap = new Map(projects.map((p) => [p.id, p]));

  async function toggleExpanded() {
    const next = !expanded;
    setExpanded(next);
    if (next && completedTasks === null && tasksDone > 0) {
      setLoadingTasks(true);
      try {
        const t = await getCompletedTasksForDate(date);
        setCompletedTasks(t);
      } catch {
        setCompletedTasks([]);
      } finally {
        setLoadingTasks(false);
      }
    }
  }

  return (
    <div className="bg-elevated border border-line-soft rounded-[10px] overflow-hidden">
      <button
        onClick={toggleExpanded}
        className="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer hover:bg-overlay-hover transition-colors"
      >
        {mood && <MoodFace mood={mood} />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-fg">{formatDateLabel(date)}</span>
            {tasksDone > 0 && (
              <span className="text-[11px] text-fg-faded">
                {tasksDone} {tasksDone === 1 ? "task" : "tasks"}
                {workedMinutes > 0 && ` · ${formatHoursMinutes(workedMinutes)}`}
              </span>
            )}
          </div>
          {preview && !expanded && (
            <p className="text-[12px] text-fg-secondary truncate mt-0.5">{preview}</p>
          )}
        </div>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-fg-faded flex-shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
        >
          <path d="M3 4.5l3 3 3-3" />
        </svg>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-line-hairline pt-3">
          {(fields.howDidItGo || fields.whatDifferently || fields.gratefulFor) && (
            <div className="space-y-3">
              {fields.howDidItGo && (
                <div>
                  <div className="text-[10px] uppercase tracking-[0.06em] font-medium text-fg-faded mb-1">
                    How did it go?
                  </div>
                  <p className="text-[13px] text-fg-secondary leading-relaxed whitespace-pre-wrap">
                    {fields.howDidItGo}
                  </p>
                </div>
              )}
              {fields.whatDifferently && (
                <div>
                  <div className="text-[10px] uppercase tracking-[0.06em] font-medium text-fg-faded mb-1">
                    What would I do differently?
                  </div>
                  <p className="text-[13px] text-fg-secondary leading-relaxed whitespace-pre-wrap">
                    {fields.whatDifferently}
                  </p>
                </div>
              )}
              {fields.gratefulFor && (
                <div>
                  <div className="text-[10px] uppercase tracking-[0.06em] font-medium text-fg-faded mb-1">
                    Grateful for
                  </div>
                  <p className="text-[13px] text-fg-secondary leading-relaxed whitespace-pre-wrap">
                    {fields.gratefulFor}
                  </p>
                </div>
              )}
            </div>
          )}

          {tasksDone > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-[0.06em] font-medium text-fg-faded mb-1.5">
                Completed
              </div>
              {loadingTasks && (
                <p className="text-[12px] text-fg-faded">Loading…</p>
              )}
              {completedTasks && completedTasks.length > 0 && (
                <ul className="space-y-1">
                  {completedTasks.map((task) => {
                    const project = task.project_id != null ? projectMap.get(task.project_id) : null;
                    return (
                      <li key={task.id} className="flex items-center gap-2">
                        <span className="text-[11px] text-accent-green flex-shrink-0">✓</span>
                        {project && (
                          <span
                            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: project.color }}
                          />
                        )}
                        <span className="text-[12px] text-fg truncate">{task.title}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
