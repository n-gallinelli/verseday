import { useState } from "react";
import type { Project, Task } from "../types";

interface ProjectCardProps {
  project: Project;
  taskCount: number;
  completedCount: number;
  lastActiveDate: string | null;
  previewTasks: Task[];
  completedPreviewTasks?: Task[];
  onViewAll: (project: Project) => void;
  onClick: () => void;
}

function MiniCheckIcon() {
  return (
    <svg
      width="7"
      height="7"
      viewBox="0 0 8 8"
      fill="none"
      stroke="white"
      strokeWidth="1.4"
      strokeLinecap="round"
    >
      <path d="M1.5 4l2 2 3-3" />
    </svg>
  );
}

export default function ProjectCard({
  project,
  taskCount,
  completedCount,
  lastActiveDate,
  previewTasks,
  completedPreviewTasks = [],
  onViewAll,
  onClick,
}: ProjectCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const progressPercent =
    taskCount > 0 ? Math.round((completedCount / taskCount) * 100) : 0;

  const formattedDate = lastActiveDate
    ? new Date(lastActiveDate + "T00:00:00").toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
    : null;

  return (
    <div
      className={`bg-white border border-black/[0.08] rounded-[10px] overflow-hidden cursor-pointer hover:border-black/[0.14] transition-colors ${
        project.archived ? "opacity-50" : ""
      } ${!!project.completed ? "ring-1 ring-[#3a9e6e]/30" : ""}`}
      onClick={onClick}
    >
      {/* Color bar */}
      <div className="h-[5px]" style={{ background: !!project.completed ? "#3a9e6e" : project.color }} />

      {/* Card body */}
      <div className="px-[14px] pt-3 pb-[10px]">
        {/* Header */}
        <div className="flex items-center justify-between mb-[10px]">
          {!!project.completed && (
            <span className="w-4 h-4 rounded-full bg-[#3a9e6e] flex items-center justify-center flex-shrink-0 mr-1.5">
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1.5 4l2 2 3-3" />
              </svg>
            </span>
          )}
          <span className={`flex-1 min-w-0 leading-snug truncate [font-size:var(--font-size-primary)] [font-weight:var(--font-weight-primary)] ${!!project.completed ? "text-[#3a9e6e]" : "text-[#2c2a35]"}`}>
            {project.name}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
            className="w-7 h-7 rounded-[5px] flex items-center justify-center text-[18px] leading-none text-black/25 flex-shrink-0 ml-1.5 border border-transparent hover:bg-black/[0.04] hover:border-black/[0.08] hover:text-black/40 transition-all cursor-pointer"
          >
            <span
              className="transition-transform duration-200 inline-block"
              style={{
                transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
              }}
            >
              ▾
            </span>
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-[3px] bg-black/[0.07] rounded-full overflow-hidden mb-[10px]">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{
              background: project.color,
              width: `${progressPercent}%`,
            }}
          />
        </div>

        {/* Meta row */}
        <div className="flex items-center justify-between">
          <span className="text-black/35 [font-size:var(--font-size-meta)] [font-weight:var(--font-weight-meta)] [opacity:var(--opacity-meta)]">
            <span className="font-medium text-black/55">
              {completedCount}
            </span>{" "}
            of {taskCount} done
          </span>
          <span className="text-black/[0.28] [font-size:var(--font-size-meta)] [opacity:var(--opacity-meta)]">
            {formattedDate ?? "—"}
          </span>
        </div>
      </div>

      {/* Expandable footer */}
      <div
        className={`border-t border-black/[0.05] overflow-hidden transition-all duration-200 ${
          isExpanded ? "max-h-[320px]" : "max-h-0 border-t-0"
        }`}
      >
        <div className="px-[14px] pt-2">
          {previewTasks.length === 0 ? (
            <p className="text-[11px] text-black/25 py-1">No open tasks</p>
          ) : (
            previewTasks.slice(0, 3).map((task, i) => {
              const isLast = i === Math.min(previewTasks.length, 3) - 1;
              const dayLabel = task.date_scheduled
                ? new Date(
                    task.date_scheduled + "T00:00:00"
                  ).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })
                : null;
              return (
                <div
                  key={task.id}
                  className={`flex items-center gap-1.5 py-1 ${
                    !isLast ? "border-b border-black/[0.04]" : ""
                  }`}
                >
                  <div
                    className={`w-[11px] h-[11px] rounded-[3px] border flex-shrink-0 flex items-center justify-center ${
                      task.status === "done"
                        ? "bg-[#e0873e] border-[#e0873e]"
                        : "border-black/[0.18]"
                    }`}
                  >
                    {task.status === "done" && <MiniCheckIcon />}
                  </div>
                  <span
                    className={`text-[11px] flex-1 truncate ${
                      task.status === "done"
                        ? "text-black/30 line-through"
                        : "text-[#2c2a35]"
                    }`}
                  >
                    {task.title}
                  </span>
                  {dayLabel && (
                    <span className="text-[10px] text-black/[0.28] flex-shrink-0">
                      {dayLabel}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
        {/* Completed tasks */}
        {completedPreviewTasks.length > 0 && (
          <div className="px-[14px] pt-1 pb-0.5">
            <div className="uppercase [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] text-black/20 mb-0.5">Completed</div>
            {completedPreviewTasks.slice(0, 3).map((task) => (
              <div key={task.id} className="flex items-center gap-1.5 py-0.5">
                <span className="w-[11px] h-[11px] rounded-[3px] bg-[#3a9e6e] border border-[#3a9e6e] flex-shrink-0 flex items-center justify-center">
                  <MiniCheckIcon />
                </span>
                <span className="text-[11px] text-black/30 line-through truncate flex-1">
                  {task.title}
                </span>
              </div>
            ))}
          </div>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onViewAll(project);
          }}
          className="block px-[14px] py-[6px] pb-2 text-[11px] text-[#e0873e] cursor-pointer hover:underline"
        >
          View all tasks →
        </button>
      </div>
    </div>
  );
}
