import { useEffect, useRef } from "react";
import type { Project } from "../../types";
import type { WeeklyPlanProjectStatus } from "../../db/queries";

interface Props {
  projects: Project[];
  statuses: Map<number, WeeklyPlanProjectStatus>;
  selectedId: number | null;
  onSelect: (id: number) => void;
  loading: boolean;
}

// Left rail of the Plan tab — lists active projects with their planning
// status and lets the user jump between them. Status indicator:
//   unplanned → no badge
//   planned   → small green checkmark
//   skipped   → italic + "Skipped" label
export default function PlanProjectRail({
  projects,
  statuses,
  selectedId,
  onSelect,
  loading,
}: Props) {
  return (
    <aside
      className="w-[240px] flex-shrink-0 flex flex-col overflow-hidden"
      style={{ borderRight: "1px solid var(--border-medium)" }}
    >
      <div className="px-5 pt-5 pb-2.5">
        <span className="uppercase text-fg-faded [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)]">
          Projects
        </span>
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-5">
        {loading ? null : projects.length === 0 ? (
          <p className="px-2 text-[12px] text-fg-faded">No active projects.</p>
        ) : (
          projects.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              status={statuses.get(p.id) ?? null}
              selected={selectedId === p.id}
              onSelect={() => onSelect(p.id)}
            />
          ))
        )}
      </div>
    </aside>
  );
}

function ProjectCard({
  project,
  status,
  selected,
  onSelect,
}: {
  project: Project;
  status: WeeklyPlanProjectStatus | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const isSkipped = status === "skipped";
  const isPlanned = status === "planned";

  // Pulse the green check when the project transitions into 'planned'
  // (mirrors TaskCard's justCompleted pattern at TaskCard.tsx:101-103).
  // Gives the user a "yes, got it" cue on the rail card alongside the
  // panel's fade-to-next-project transition.
  const prevStatusRef = useRef(status);
  const justPlanned = status === "planned" && prevStatusRef.current !== "planned";
  useEffect(() => {
    prevStatusRef.current = status;
  }, [status]);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full flex items-center gap-2.5 px-3 py-2 mb-0.5 rounded-md text-left cursor-pointer transition-colors ${
        selected
          ? "bg-accent-blue-soft text-accent-blue-soft-fg"
          : "hover:bg-overlay-hover"
      }`}
    >
      <span
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{ backgroundColor: project.color }}
      />
      <span
        className={`flex-1 text-[13px] truncate ${
          isSkipped ? "italic" : ""
        } ${
          selected
            ? "text-accent-blue-soft-fg"
            : isSkipped
              ? "text-fg-faded"
              : "text-fg"
        }`}
      >
        {project.name}
      </span>
      {isPlanned && (
        <span
          className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: "var(--accent-green)" }}
          title="Planned"
        >
          <svg
            width="9"
            height="9"
            viewBox="0 0 12 12"
            fill="none"
            stroke="var(--text-on-accent)"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path
              d="M2.5 6.2l2.5 2.3L9.5 3.7"
              className={justPlanned ? "animate-check-draw" : ""}
            />
          </svg>
        </span>
      )}
      {isSkipped && (
        <span className="text-[10px] text-fg-faded flex-shrink-0">Skipped</span>
      )}
    </button>
  );
}
