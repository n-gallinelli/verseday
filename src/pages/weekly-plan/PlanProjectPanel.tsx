import type { Project, Task } from "../../types";
import type { WeeklyPlanProjectStatus } from "../../db/queries";
import PlanDayStrip from "./PlanDayStrip";
import PlanTaskList from "./PlanTaskList";
import PlanWeekSummary from "./PlanWeekSummary";

interface Props {
  project: Project | null;
  status: WeeklyPlanProjectStatus | null;
  selectedCommitments: Map<number, number>; // dayOffset → minutes (selected project)
  allCommitments: Map<number, Map<number, number>>; // for the week summary
  allProjects: Project[];                  // for the week summary
  allStatuses: Map<number, WeeklyPlanProjectStatus>;
  weekDates: string[];                     // 5 ISO strings (Mon..Fri)
  tasks: Task[];                            // unscheduled (week-level intent)
  scheduledTasksByDate: Map<string, Task[]>; // tasks scheduled to a day this week
  allReviewed: boolean;
  hasProjects: boolean;
  loading: boolean;
  toggleSignal: { dayOffset: number; nonce: number } | null;

  onSelectProject: (id: number) => void;
  onDeselect: () => void;
  onMarkPlanned: (id: number) => void;
  onMarkSkipped: (id: number) => void;
  onMarkUnplanned: (id: number) => void;
  onMarkAllRemaining: () => void;
  onSetCommitment: (projectId: number, dayOffset: number, minutes: number) => void;
  onClearCommitment: (projectId: number, dayOffset: number) => void;
  onCreateTask: (title: string) => Promise<void>;
  onUpdateTaskTitle: (id: number, title: string) => Promise<void>;
  onDeleteTask: (id: number) => Promise<void>;
  onOpenTaskDetail: (task: Task) => void;
}

// Right panel of the Plan tab. Header → tasks → day strip → footer
// (Done/Skip). M5 will turn the all-reviewed empty state into the
// read-only week summary.
export default function PlanProjectPanel({
  project,
  status,
  selectedCommitments,
  allCommitments,
  allProjects,
  allStatuses,
  weekDates,
  tasks,
  scheduledTasksByDate,
  allReviewed,
  hasProjects,
  loading,
  toggleSignal,
  onSelectProject,
  onDeselect,
  onMarkPlanned,
  onMarkSkipped,
  onMarkUnplanned,
  onMarkAllRemaining,
  onSetCommitment,
  onClearCommitment,
  onCreateTask,
  onUpdateTaskTitle,
  onDeleteTask,
  onOpenTaskDetail,
}: Props) {
  if (loading) {
    return <CenteredHint>Loading…</CenteredHint>;
  }
  if (!hasProjects) {
    return (
      <CenteredHint>
        <p className="text-[14px] text-fg-muted mb-1">No active projects</p>
        <p className="text-[12px] text-fg-faded">
          Create one from Objectives to start planning a week.
        </p>
      </CenteredHint>
    );
  }
  if (!project) {
    if (allReviewed) {
      return (
        <PlanWeekSummary
          weekDates={weekDates}
          projects={allProjects}
          commitments={allCommitments}
          statuses={allStatuses}
          onSelectProject={onSelectProject}
        />
      );
    }
    return <CenteredHint>Select a project to plan it.</CenteredHint>;
  }

  // Done is gated on at least one day being activated. Skip is the
  // escape hatch for "no time committed this week" (matches the plan).
  const dayCount = selectedCommitments.size;
  const canMarkDone = dayCount > 0;

  return (
    // key={project.id} re-mounts the section on each project switch so
    // animate-tab-fade plays — gives the user a visible "advanced to next
    // project" cue after Done/Skip auto-advance, rather than an
    // instantaneous content swap.
    <section
      key={project.id}
      className="flex-1 flex flex-col min-w-0 overflow-hidden animate-tab-fade"
    >
      {/* Back-to-summary link — only when the user is revisiting an
          already-reviewed project. Otherwise the user has nothing to go
          "back" to (they're still working through the list). */}
      {allReviewed && (
        <div className="px-8 pt-5 flex-shrink-0">
          <button
            onClick={onDeselect}
            className="text-[12px] text-fg-faded hover:text-fg-secondary cursor-pointer flex items-center gap-1"
          >
            <svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 4l-4 3 4 3" />
            </svg>
            Week summary
          </button>
        </div>
      )}

      {/* Header */}
      <header className={`px-8 ${allReviewed ? "pt-3" : "pt-8"} pb-4 flex items-center gap-3 flex-shrink-0`}>
        <span
          className="w-3 h-3 rounded-full flex-shrink-0"
          style={{ backgroundColor: project.color }}
        />
        <h2 className="text-[22px] font-medium text-fg leading-tight font-display truncate">
          {project.name}
        </h2>
        {status === "planned" && (
          <span className="text-[11px] bg-accent-green-soft text-accent-green-deep px-2 py-0.5 rounded-full flex-shrink-0">
            Planned
          </span>
        )}
        {status === "skipped" && (
          <span className="text-[11px] bg-overlay-hover text-fg-faded px-2 py-0.5 rounded-full flex-shrink-0 italic">
            Skipped
          </span>
        )}
      </header>

      {/* Body — task list at the top (capped at 40% with its own
          scrollbar; PlanTaskList has no internal overflow so this is
          the only scroll container in this region — no nesting), day
          strip below fills all remaining vertical space so each day
          column reaches the bottom of the panel. The full-height
          columns double as generous drop targets for tasks dragged
          from the list. */}
      <div className="flex-1 min-h-0 flex flex-col px-8 pb-6">
        <div className="flex-shrink-0 max-h-[40%] overflow-y-auto pb-5">
          <span className="uppercase text-fg-faded mb-2 block [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)]">
            Open tasks
          </span>
          <PlanTaskList
            tasks={tasks}
            onCreate={onCreateTask}
            onUpdateTitle={onUpdateTaskTitle}
            onDelete={onDeleteTask}
          />
        </div>

        <div className="flex-1 min-h-0 flex flex-col">
          <span className="uppercase text-fg-faded mb-2 block flex-shrink-0 [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)]">
            Time per day
          </span>
          <div className="flex-1 min-h-0">
            <PlanDayStrip
              weekDates={weekDates}
              commitments={selectedCommitments}
              projectColor={project.color}
              tasksByDate={scheduledTasksByDate}
              toggleSignal={toggleSignal}
              onSet={(dayOffset, minutes) =>
                onSetCommitment(project.id, dayOffset, minutes)
              }
              onClear={(dayOffset) => onClearCommitment(project.id, dayOffset)}
              onOpenTaskDetail={onOpenTaskDetail}
            />
          </div>
        </div>
      </div>

      {/* Footer — Next project (left) / Done planning the week (right).
          The bulk action sweeps every still-unreviewed project in one
          click; PlanTab decides planned vs skipped per project based
          on whether days are committed. */}
      <footer className="px-8 py-5 border-t border-line-soft flex items-center gap-4 flex-shrink-0">
        {status == null ? (
          <>
            <button
              onClick={() => onMarkPlanned(project.id)}
              disabled={!canMarkDone}
              title={
                canMarkDone
                  ? "Mark this project planned and advance"
                  : "Activate at least one day, or use Skip this week"
              }
              className={`px-4 py-1.5 rounded-lg border text-[13px] font-medium transition-colors ${
                canMarkDone
                  ? "border-accent-blue/50 text-accent-blue-soft-fg cursor-pointer hover:border-accent-blue hover:bg-accent-blue-soft"
                  : "border-line-soft text-fg-disabled cursor-not-allowed"
              }`}
            >
              Next project
            </button>
            <button
              onClick={() => onMarkSkipped(project.id)}
              className="text-[12px] text-fg-faded hover:text-fg-secondary cursor-pointer"
            >
              Skip this week
            </button>
            {!canMarkDone && (
              <span className="text-[11px] text-fg-faded">
                Pick at least one day, or skip.
              </span>
            )}
            <button
              onClick={onMarkAllRemaining}
              title="Mark every remaining project planned (or skipped if no days)"
              className="ml-auto px-4 py-1.5 rounded-lg border border-accent-pink-bright/50 text-accent-pink-bright text-[13px] font-medium cursor-pointer hover:border-accent-pink-bright hover:bg-accent-pink-soft transition-colors"
            >
              Done planning the week
            </button>
          </>
        ) : (
          <button
            onClick={() => onMarkUnplanned(project.id)}
            className="text-[12px] text-fg-faded hover:text-fg-secondary cursor-pointer"
          >
            {status === "planned" ? "Un-mark" : "Un-skip"}
          </button>
        )}
      </footer>
    </section>
  );
}

function CenteredHint({ children }: { children: React.ReactNode }) {
  return (
    <section className="flex-1 flex flex-col items-center justify-center min-w-0 px-8 text-center">
      {children}
    </section>
  );
}
