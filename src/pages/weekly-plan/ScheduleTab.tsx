import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { selectTaskIdsByWeek, useAppStore } from "../../stores/appStore";
import {
  getProjects,
  createTask,
  updateTaskDateScheduled,
  getAllTasksForProjectIds,
  getUnscheduledTasks,
  getWeeklyShutdown,
} from "../../db/queries";
import ErrorBanner from "../../components/ErrorBanner";
import { errorMessage } from "../../utils/errors";
import DisclosureCaret from "../../components/DisclosureCaret";
import {
  localDateIso,
  todayString,
  weekdayDates as getWeekdayDates,
} from "../../utils/dates";
import { formatHoursMinutes } from "../../utils/format";
import type { Task, Project } from "../../types";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const MAX_TITLE_LENGTH = 200;

function getFridayIso(mondayIso: string): string {
  const d = new Date(mondayIso + "T00:00:00");
  d.setDate(d.getDate() + 4);
  return localDateIso(d);
}

function dateToDayAbbrev(
  dateScheduled: string | null,
  weekDates: string[]
): string | null {
  if (!dateScheduled) return null;
  const idx = weekDates.indexOf(dateScheduled);
  if (idx === -1) return null;
  return DAY_NAMES[idx];
}

// ─── Left panel: Draggable task row ─────────────────────────────────────────

function DraggableTaskRow({
  task,
  weekDates,
  onToggleTask,
  onOpenDetail,
  isLast,
}: {
  task: Task;
  weekDates: string[];
  onToggleTask: (task: Task) => void;
  onOpenDetail?: (task: Task) => void;
  isLast: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `task-${task.id}`,
    data: { task },
  });

  const prevStatusRef = useRef(task.status);
  const justCompleted = task.status === "done" && prevStatusRef.current !== "done";
  useEffect(() => { prevStatusRef.current = task.status; }, [task.status]);

  const dayAbbrev = dateToDayAbbrev(task.date_scheduled, weekDates);

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => onOpenDetail?.(task)}
      className={`flex items-center gap-2 px-2.5 py-2 mb-0.5 touch-none hover:bg-overlay-hover ${
        isDragging ? "cursor-grabbing opacity-30" : "cursor-pointer"
      } ${!isLast ? "border-b border-divider" : ""}`}
    >
      {/* Checkbox */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleTask(task);
        }}
        title={task.status === "done" ? "Mark as not done" : "Mark complete"}
        className={`w-[18px] h-[18px] rounded-full border-2 flex-shrink-0 cursor-pointer flex items-center justify-center transition-colors ${
          task.status === "done"
            ? "bg-accent-green border-accent-green hover:bg-accent-green-hover hover:border-accent-green-hover"
            : "border-line-strong hover:border-accent-green"
        }`}
      >
        <svg
          width="9"
          height="9"
          viewBox="0 0 12 12"
          fill="none"
          stroke={task.status === "done" ? "var(--text-on-accent)" : "var(--text-faded)"}
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path
            d="M2.5 6.2l2.5 2.3L9.5 3.7"
            className={justCompleted ? "animate-check-draw" : ""}
          />
        </svg>
      </button>

      {/* Title */}
      <span
        className={`text-[12px] flex-1 truncate ${
          task.status === "done"
            ? "text-fg-faded line-through"
            : "text-fg"
        }`}
      >
        {task.title}
      </span>

      {/* Duration */}
      {task.estimated_minutes != null && task.estimated_minutes > 0 && (
        <span className="text-[11px] text-fg-faded">
          {formatHoursMinutes(task.estimated_minutes)}
        </span>
      )}

      {/* Day pill — same gray treatment whether scheduled or not; the dash
          stands in for "no day yet" without the loud orange call-out. */}
      <span className="text-[10px] bg-overlay-hover text-fg-muted px-1.5 py-0.5 rounded">
        {dayAbbrev ?? "—"}
      </span>
    </div>
  );
}

// ─── Left panel: Project card (collapsible) ─────────────────────────────────

function ProjectCard({
  project,
  tasks,
  weekDates,
  onToggleTask,
  onOpenDetail,
  onNavigateProject,
}: {
  project: { id: number | null; name: string; color: string };
  tasks: Task[];
  weekDates: string[];
  onToggleTask: (task: Task) => void;
  onOpenDetail: (task: Task) => void;
  onNavigateProject: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-elevated border border-line-soft rounded-[9px] mb-2.5 overflow-hidden group/proj-card">
      {/* Header — clicking anywhere on the row expands tasks. The "Open project"
          icon on the right is a separate, smaller affordance. */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left cursor-pointer hover:bg-overlay-hover transition-colors"
      >
        <span className="w-3 flex items-center justify-center text-accent-orange-soft-fg/70 flex-shrink-0">
          <DisclosureCaret expanded={expanded} />
        </span>
        <div
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: project.color }}
        />
        <span className="text-[13px] font-medium text-fg flex-1 truncate">
          {project.name}
        </span>
        {project.id !== null && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onNavigateProject(project.id as number);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onNavigateProject(project.id as number);
              }
            }}
            title="Open project"
            className="w-5 h-5 rounded flex items-center justify-center text-fg-faded hover:text-accent-orange hover:bg-overlay-hover cursor-pointer transition-colors opacity-0 group-hover/proj-card:opacity-100 flex-shrink-0"
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 2h5v5" />
              <path d="M10 2L5.5 6.5" />
              <path d="M9 7v3H2V3h3" />
            </svg>
          </span>
        )}
      </button>

      {/* Tasks — collapsible */}
      {expanded && tasks.length > 0 && (
            <div className="border-t border-line-hairline">
              {tasks.map((task, i) => (
                <DraggableTaskRow
                  key={task.id}
                  task={task}
                  weekDates={weekDates}
                  onToggleTask={onToggleTask}
                  onOpenDetail={onOpenDetail}
                  isLast={i === tasks.length - 1}
                />
              ))}
            </div>
          )}
    </div>
  );
}

// ─── Right panel: Calendar task pill (one-line) ─────────────────────────────

function CalendarTaskPill({
  task,
  project,
  onOpenDetail,
}: {
  task: Task;
  project: Project | undefined;
  onOpenDetail: (task: Task) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `cal-task-${task.id}`,
    data: { task },
  });

  const isDone = task.status === "done";

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => onOpenDetail(task)}
      className={`flex items-start gap-1.5 px-1.5 py-1 rounded-[4px] bg-elevated border border-line-hairline hover:bg-overlay-hover touch-none ${isDragging ? "cursor-grabbing opacity-30" : ""}`}
      title={task.title}
    >
      <span
        className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-[5px]"
        style={{ backgroundColor: project?.color ?? "var(--text-faded)" }}
      />
      <span
        className={`text-[10.5px] leading-tight flex-1 line-clamp-3 break-words ${
          isDone ? "text-fg-faded line-through" : "text-fg-secondary"
        }`}
      >
        {task.title}
      </span>
    </div>
  );
}

// ─── Right panel: Day column ────────────────────────────────────────────────

function DayColumn({
  date,
  tasks,
  projectMap,
  isToday,
  onCreateForDate,
  onOpenDetail,
}: {
  date: string;
  tasks: Task[];
  projectMap: Map<number, Project>;
  isToday: boolean;
  onCreateForDate: (date: string) => void;
  onOpenDetail: (task: Task) => void;
}) {
  const { isOver, setNodeRef: setDropRef } = useDroppable({
    id: `day-${date}`,
    data: { date },
  });

  return (
    <div
      ref={setDropRef}
      className={`p-2 flex flex-col gap-[3px] flex-1 min-h-full transition-colors duration-150 ${
        isOver ? "bg-accent-orange/[0.08]" : isToday ? "bg-accent-orange/[0.02]" : ""
      }`}
    >
      {tasks.map((task) => (
        <CalendarTaskPill
          key={task.id}
          task={task}
          project={projectMap.get(task.project_id ?? -1)}
          onOpenDetail={onOpenDetail}
        />
      ))}

      {/* Add — opens the task detail overlay for a fresh task scheduled
          to this day. Dashed-outline treatment is the design system's
          "drop / add new here" affordance. */}
      <button
        type="button"
        onClick={() => onCreateForDate(date)}
        className="mt-auto w-full flex items-center justify-center gap-1 py-1.5 rounded-md border border-dashed border-line-hairline text-[11px] text-fg-faded hover:text-fg-secondary hover:border-line-soft hover:bg-overlay-hover cursor-pointer transition-colors"
      >
        <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
          <path d="M5 1.5v7" />
          <path d="M1.5 5h7" />
        </svg>
        Add
      </button>
    </div>
  );
}

// ─── Day modal — full task list for a single day ────────────────────────────

function DayTasksModal({
  date,
  tasks,
  projectMap,
  onClose,
  onToggle,
  onOpenDetail,
}: {
  date: string;
  tasks: Task[];
  projectMap: Map<number, Project>;
  onClose: () => void;
  onToggle: (task: Task) => void;
  onOpenDetail: (task: Task) => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const d = new Date(date + "T00:00:00");
  const heading = d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const totalMinutes = tasks.reduce((s, t) => s + (t.estimated_minutes ?? 0), 0);

  return (
    <div
      className="fixed inset-0 z-40 bg-black/30 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="bg-base rounded-xl w-full max-w-[520px] max-h-[80vh] flex flex-col overflow-hidden"
        style={{ boxShadow: "var(--shadow-overlay)", border: "1px solid var(--border-soft)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-line-soft">
          <div>
            <h2 className="text-[16px] font-medium text-fg">{heading}</h2>
            <div className="text-[11px] text-fg-faded mt-0.5">
              {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
              {totalMinutes > 0 && (
                <>
                  {" · "}
                  <span className="tabular-nums">{totalMinutes}m planned</span>
                </>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center text-fg-faded hover:text-fg hover:bg-overlay-hover cursor-pointer"
            title="Close"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3">
          {tasks.length === 0 ? (
            <p className="text-[12px] text-fg-faded text-center py-8">No tasks scheduled</p>
          ) : (
            <div className="space-y-1">
              {tasks.map((task) => {
                const project = projectMap.get(task.project_id ?? -1);
                const isDone = task.status === "done";
                return (
                  <div
                    key={task.id}
                    onClick={() => onOpenDetail(task)}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-md hover:bg-overlay-hover cursor-pointer"
                  >
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggle(task);
                      }}
                      title={isDone ? "Mark as not done" : "Mark complete"}
                      className={`w-[18px] h-[18px] rounded-full border-2 flex-shrink-0 cursor-pointer flex items-center justify-center transition-colors ${
                        isDone
                          ? "bg-accent-green border-accent-green hover:bg-accent-green-hover hover:border-accent-green-hover"
                          : "border-line-strong hover:border-accent-green"
                      }`}
                    >
                      <svg
                        width="9"
                        height="9"
                        viewBox="0 0 12 12"
                        fill="none"
                        stroke={isDone ? "var(--text-on-accent)" : "var(--text-faded)"}
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M2.5 6.2l2.5 2.3L9.5 3.7" />
                      </svg>
                    </button>
                    {project && (
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: project.color }}
                        title={project.name}
                      />
                    )}
                    <span
                      className={`flex-1 text-[13px] truncate ${
                        isDone ? "text-fg-faded line-through" : "text-fg"
                      }`}
                    >
                      {task.title}
                    </span>
                    {project && (
                      <span className="text-[11px] text-fg-faded shrink-0 max-w-[120px] truncate">
                        {project.name}
                      </span>
                    )}
                    {task.estimated_minutes != null && task.estimated_minutes > 0 && (
                      <span className="text-[11px] text-fg-faded tabular-nums shrink-0">
                        {formatHoursMinutes(task.estimated_minutes)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export default function ScheduleTab() {
  const { selectedWeek, openProject, setSchedulePlannedMinutes } = useAppStore();
  const openTaskDetail = useAppStore((s) => s.openTaskDetail);
  const cacheTasks = useAppStore((s) => s.cacheTasks);
  const selectedTaskDetailId = useAppStore((s) => s.selectedTaskDetailId);
  const loadTasksForWeek = useAppStore((s) => s.loadTasksForWeek);
  const setTaskStatusAction = useAppStore((s) => s.setTaskStatus);
  const deleteTaskAction = useAppStore((s) => s.deleteTaskAction);
  const tasksById = useAppStore((s) => s.tasksById);

  // M3.2.b.3 — weekTasks flow through the canonical store via the
  // selector subscription. The day-grid groups tasks by date_scheduled
  // at render time below.
  const weekTaskIds = useAppStore((s) => selectTaskIdsByWeek(s, selectedWeek));
  const weekTasks = useMemo(() => {
    const out: Task[] = [];
    for (const id of weekTaskIds) {
      const t = tasksById.get(id);
      if (t) out.push(t);
    }
    return out;
  }, [weekTaskIds, tasksById]);

  const [projects, setProjects] = useState<Project[]>([]);
  // Hybrid lists — SQL stays authoritative for membership (cross-cutting
  // queries don't fit any secondary index); IDs are stored locally;
  // canonical map drives the rendered Task data so renames flow back
  // without a re-query. Bucket filters (Verse-required) re-validate
  // membership at the memo so a status/date/project flip drops the row
  // immediately.
  const [allProjectTaskIds, setAllProjectTaskIds] = useState<number[]>([]);
  const [activeProjectIds, setActiveProjectIds] = useState<number[]>([]);
  const [unscheduledUnassignedIds, setUnscheduledUnassignedIds] = useState<number[]>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [activeDragTask, setActiveDragTask] = useState<Task | null>(null);

  const activeProjectIdSet = useMemo(
    () => new Set(activeProjectIds),
    [activeProjectIds],
  );
  // Bucket filter: project_id must be in the active set (and non-null).
  const allProjectTasks = useMemo(() => {
    const out: Task[] = [];
    for (const id of allProjectTaskIds) {
      const t = tasksById.get(id);
      if (t && t.project_id !== null && activeProjectIdSet.has(t.project_id)) {
        out.push(t);
      }
    }
    return out;
  }, [allProjectTaskIds, tasksById, activeProjectIdSet]);
  // Bucket filter: NULL date AND NULL project AND not done.
  const unscheduledUnassigned = useMemo(() => {
    const out: Task[] = [];
    for (const id of unscheduledUnassignedIds) {
      const t = tasksById.get(id);
      if (
        t &&
        t.date_scheduled === null &&
        t.project_id === null &&
        t.status !== "done"
      ) {
        out.push(t);
      }
    }
    return out;
  }, [unscheduledUnassignedIds, tasksById]);

  // Undo banner for date moves (drag-drop between days)
  const [pendingMove, setPendingMove] = useState<{
    taskId: number;
    taskTitle: string;
    fromDate: string | null;
    toDate: string;
    timeoutId: ReturnType<typeof setTimeout>;
  } | null>(null);

  // Task detail overlay

  // Tasks created via the "+ Add" button on a day column — held until the
  // overlay closes. If the user closes without naming, we delete the empty
  // draft so the calendar doesn't fill with blank rows.
  const draftTaskIds = useRef<Set<number>>(new Set());

  // Day modal — full task list for a single day
  const [dayModalDate, setDayModalDate] = useState<string | null>(null);

  // Carry forward from last week
  const [carryForwardNotes, setCarryForwardNotes] = useState<string | null>(null);
  const [carryForwardDismissed, setCarryForwardDismissed] = useState(false);

  const selectedWeekRef = useRef(selectedWeek);
  selectedWeekRef.current = selectedWeek;

  const weekDates = getWeekdayDates(selectedWeek);
  const fridayIso = getFridayIso(selectedWeek);
  const todayStr = todayString();

  const projectMap = new Map(projects.map((p) => [p.id, p]));

  // ── Data loading ──────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    try {
      // loadTasksForWeek populates the canonical map for the week
      // selector. Sibling queries stay direct DB; their results prime
      // the canonical map via cacheTasks before IDs are stored.
      const [_, p, unscheduled] = await Promise.all([
        loadTasksForWeek(selectedWeek),
        getProjects(),
        getUnscheduledTasks(),
      ]);
      void _;
      const unscheduledOnlyOrphans = unscheduled.filter((t) => t.project_id === null);
      cacheTasks(unscheduledOnlyOrphans);
      setUnscheduledUnassignedIds(unscheduledOnlyOrphans.map((t) => t.id));

      // Auto-show all active, non-completed projects
      const activeProjects = p.filter((proj) => !proj.archived && !proj.completed);
      const activeIds = activeProjects.map((proj) => proj.id);

      // Also include any project IDs from this week's tasks (even if
      // archived/completed). Read fresh from canonical after loadTasksForWeek
      // resolved so we don't miss a task whose project is currently
      // archived but is scheduled this week.
      const freshWeekIds =
        useAppStore.getState().taskIdsByWeek.get(selectedWeek) ?? [];
      for (const id of freshWeekIds) {
        const t = useAppStore.getState().tasksById.get(id);
        if (t && t.project_id != null && !activeIds.includes(t.project_id)) {
          activeIds.push(t.project_id);
        }
      }

      const projectTasks = await getAllTasksForProjectIds(activeIds);
      cacheTasks(projectTasks);
      setAllProjectTaskIds(projectTasks.map((t) => t.id));
      setActiveProjectIds(activeIds);
      setProjects(p);

      // Load carry forward from previous week's shutdown
      const prevMonday = new Date(selectedWeek + "T00:00:00");
      prevMonday.setDate(prevMonday.getDate() - 7);
      const prevMondayIso = localDateIso(prevMonday);
      const prevShutdown = await getWeeklyShutdown(prevMondayIso);
      setCarryForwardNotes(prevShutdown?.incomplete_items ?? null);
      setCarryForwardDismissed(false);

      setError(null);
    } catch (e) {
      setError(errorMessage(e, "Failed to load weekly data"));
    }
  }, [selectedWeek, loadTasksForWeek, cacheTasks]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // M1.b — refetch when the singleton overlay commits a mutation.
  // M3.2 retires this listener in favor of canonical store
  // subscriptions; until then, the broadcast bridges the seam.
  useEffect(() => {
    function refresh() {
      loadData();
    }
    window.addEventListener("verseday:task-updated", refresh);
    window.addEventListener("verseday:task-deleted", refresh);
    return () => {
      window.removeEventListener("verseday:task-updated", refresh);
      window.removeEventListener("verseday:task-deleted", refresh);
    };
  }, [loadData]);

  // ── Actions ───────────────────────────────────────────────────────────

  async function toggleTask(task: Task) {
    try {
      await setTaskStatusAction(task.id, task.status === "done" ? "todo" : "done");
    } catch (e) {
      setError(errorMessage(e, "Failed to update task"));
    }
  }

  async function handleCreateForDate(date: string) {
    try {
      const id = await createTask({
        title: "",
        projectId: null,
        dateScheduled: date,
        estimatedMinutes: null,
      });
      draftTaskIds.current.add(id);
      // Refresh canonical map so the new row resolves through tasksById.
      await loadTasksForWeek(selectedWeek);
      openTaskDetail(id, { autoFocusTitle: true });
    } catch (e) {
      setError(errorMessage(e, "Failed to add task"));
    }
  }

  // Draft-task close cleanup. The singleton overlay is owned by
  // TaskDetailOverlayHost; when it closes (selectedTaskDetailId →
  // null), if the previously-open id was a draft created by
  // handleCreateForDate above and its title is still empty, delete the
  // row. M1.b — ScheduleTab keeps draft-tracking local because it's
  // genuinely scoped to this screen's quick-add flow; the singleton
  // doesn't need to know.
  const prevDetailIdRef = useRef<number | null>(null);
  useEffect(() => {
    const prev = prevDetailIdRef.current;
    prevDetailIdRef.current = selectedTaskDetailId;
    if (prev !== null && selectedTaskDetailId === null) {
      // Overlay just closed — run draft cleanup for `prev` if applicable.
      const closingId = prev;
      if (draftTaskIds.current.has(closingId)) {
        draftTaskIds.current.delete(closingId);
        (async () => {
          // Read from the canonical map — overlay save flowed through
          // updateTask/setTaskStatus actions which already wrote there.
          const updated = useAppStore.getState().tasksById.get(closingId);
          if (updated && !updated.title.trim()) {
            try {
              await deleteTaskAction(closingId);
            } catch {
              // best effort — leave the row if the cleanup query fails
            }
          }
          loadData();
        })();
      } else {
        loadData();
      }
    }
  }, [selectedTaskDetailId, selectedWeek, fridayIso, loadData, deleteTaskAction]);


  function navigateToProject(id: number) {
    openProject(id);
  }

  // ── Drag and drop ──────────────────────────────────────────────────────

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  function handleDragStart(event: DragStartEvent) {
    const task = event.active.data.current?.task as Task | undefined;
    setActiveDragTask(task ?? null);
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveDragTask(null);
    const { active, over } = event;
    if (!over) return;

    const droppedDate = over.data.current?.date as string | undefined;
    if (!droppedDate) return;

    const task = active.data.current?.task as Task | undefined;
    if (!task) return;

    // Skip if already scheduled for that day
    if (task.date_scheduled === droppedDate) return;

    try {
      await updateTaskDateScheduled(task.id, droppedDate);
      const fromDate = task.date_scheduled;
      loadData();
      // Clear any prior pending undo and queue a new one
      if (pendingMove) clearTimeout(pendingMove.timeoutId);
      const timeoutId = setTimeout(() => setPendingMove(null), 6000);
      setPendingMove({
        taskId: task.id,
        taskTitle: task.title,
        fromDate,
        toDate: droppedDate,
        timeoutId,
      });
    } catch (e) {
      setError(errorMessage(e, "Failed to schedule task"));
    }
  }

  async function undoMove() {
    if (!pendingMove) return;
    const { taskId, fromDate, timeoutId } = pendingMove;
    clearTimeout(timeoutId);
    setPendingMove(null);
    try {
      await updateTaskDateScheduled(taskId, fromDate);
      loadData();
    } catch (e) {
      setError(errorMessage(e, "Failed to undo move"));
    }
  }

  // ── Derived data ──────────────────────────────────────────────────────

  // All active non-completed projects, sorted by name
  const activeProjects = projects
    .filter((p) => !p.archived && !p.completed)
    .sort((a, b) => a.name.localeCompare(b.name));

  const projectGroups: {
    project: { id: number | null; name: string; color: string };
    tasks: Task[];
  }[] = [];

  for (const p of activeProjects) {
    // Hide completed tasks from the expanded project list — weekly planning is
    // about deciding what's still ahead, not reviewing what's done.
    const tasks = allProjectTasks.filter(
      (t) => t.project_id === p.id && t.status !== "done"
    );
    projectGroups.push({
      project: { id: p.id, name: p.name, color: p.color },
      tasks,
    });
  }

  // Unassigned tasks for the rail — only truly floating ones (no project
  // AND not scheduled to a day). Tasks already placed on the calendar
  // render in their day column; surfacing them again here would just
  // duplicate. Loaded directly from `unscheduledUnassigned` state.
  const unassignedTasks = unscheduledUnassigned;

  // Group week tasks by date for calendar
  const tasksByDate = new Map<string, Task[]>();
  for (const date of weekDates) {
    tasksByDate.set(date, []);
  }
  for (const task of weekTasks) {
    if (task.date_scheduled && tasksByDate.has(task.date_scheduled)) {
      tasksByDate.get(task.date_scheduled)!.push(task);
    }
  }

  // Total planned hours — surfaced into the WeeklyPlanner header via
  // the appStore so the readout sits inline next to the Plan/Schedule
  // toggle instead of taking a row of its own.
  const totalPlannedMinutes = weekTasks.reduce(
    (sum, t) => sum + (t.estimated_minutes ?? 0),
    0
  );
  useEffect(() => {
    setSchedulePlannedMinutes(totalPlannedMinutes);
    return () => setSchedulePlannedMinutes(0);
  }, [totalPlannedMinutes, setSchedulePlannedMinutes]);

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="relative flex flex-col h-full bg-base overflow-hidden">
      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {pendingMove && (
        <div
          className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 px-4 py-2 rounded-full bg-banner text-[12px] max-w-[480px] min-w-[280px]"
          style={{ color: "var(--text-banner)", boxShadow: "var(--shadow-card)" }}
        >
          <span className="flex-1 truncate">
            Moved &ldquo;{pendingMove.taskTitle}&rdquo;
            {pendingMove.fromDate ? "" : " to scheduled"}
          </span>
          <button
            onClick={undoMove}
            className="font-semibold cursor-pointer transition-opacity flex-shrink-0 underline underline-offset-[3px] hover:opacity-80"
            style={{ color: "var(--text-banner)" }}
          >
            Undo
          </button>
        </div>
      )}

      {/* ── Body: left rail (projects + notes) + calendar (main) ─────── */}
      <DndContext
        sensors={dndSensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
      <div className="flex flex-1 min-h-0">
        {/* ── Left rail: projects + weekly notes ────────────────────────── */}
        <div
          className="w-[300px] flex-shrink-0 flex flex-col overflow-hidden"
          style={{ borderRight: "1px solid var(--border-medium)" }}
        >
          {/* Top: scrollable — carry forward + projects */}
          <div className="flex-1 overflow-y-auto px-5 py-5 min-h-0">
            {carryForwardNotes && !carryForwardDismissed && (
              <div
                className="bg-accent-green-soft rounded-lg px-3 py-2.5 mb-4 relative"
                style={{ border: "0.5px solid color-mix(in srgb, var(--accent-green) 50%, transparent)" }}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="uppercase [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] text-accent-green-deep">
                    From last week
                  </span>
                  <button
                    onClick={() => setCarryForwardDismissed(true)}
                    className="text-[11px] text-accent-green-deep/40 hover:text-accent-green-deep cursor-pointer"
                  >
                    ✕
                  </button>
                </div>
                <p className="text-[12px] text-fg-secondary leading-[1.6] whitespace-pre-wrap">
                  {carryForwardNotes}
                </p>
              </div>
            )}

            <span className="uppercase text-fg-faded mb-2.5 block [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)]">
              Objectives
            </span>

            {projectGroups.length === 0 && unassignedTasks.length === 0 ? (
              <p className="text-[12px] text-fg-faded py-4 text-center">
                No active objectives
              </p>
            ) : (
              <>
                {projectGroups.map((group) => (
                  <ProjectCard
                    key={group.project.id ?? "none"}
                    project={group.project}
                    tasks={group.tasks}
                    weekDates={weekDates}
                    onToggleTask={toggleTask}
                    onOpenDetail={(t) => openTaskDetail(t.id)}
                    onNavigateProject={navigateToProject}
                  />
                ))}

                {unassignedTasks.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-line-hairline">
                    <span className="uppercase text-fg-faded mb-1.5 block [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)]">
                      Unassigned
                    </span>
                    <div className="bg-overlay-hover border border-line-hairline rounded-[8px] overflow-hidden">
                      {unassignedTasks.map((task, i) => (
                        <DraggableTaskRow
                          key={task.id}
                          task={task}
                          weekDates={weekDates}
                          onToggleTask={toggleTask}
                          onOpenDetail={(t) => openTaskDetail(t.id)}
                          isLast={i === unassignedTasks.length - 1}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Main: Calendar — horizontal scroll, ~320px per column so
            2-3 days are visible at typical widths and the rest scroll
            into view. Each column has its own vertical scroll for
            tasks, so a busy day doesn't stretch its neighbors. ─── */}
        <div className="flex-1 flex overflow-x-auto overflow-y-hidden min-w-0">
          {weekDates.map((date, i) => {
            const dayNum = new Date(date + "T00:00:00").getDate();
            const isToday = date === todayStr;
            return (
              <div
                key={date}
                className="w-[320px] flex-shrink-0 flex flex-col border-r border-line-hairline last:border-r-0"
              >
                {/* Column header — sticky-ish; flex-shrink-0 keeps it
                    visible above the per-column scroll. */}
                <button
                  onClick={() => setDayModalDate(date)}
                  className="px-2.5 pt-3 pb-3 text-center cursor-pointer hover:bg-overlay-hover transition-colors border-b border-line-soft flex-shrink-0"
                  title="View tasks for this day"
                >
                  <div className="text-[11px] font-medium tracking-[0.06em] text-fg-secondary mb-1">
                    {DAY_NAMES[i]}
                  </div>
                  {isToday ? (
                    <div className="w-[30px] h-[30px] rounded-full bg-accent-orange text-fg-on-accent flex items-center justify-center text-[16px] font-medium mx-auto leading-none">
                      {dayNum}
                    </div>
                  ) : (
                    <div className="text-[17px] font-medium text-fg leading-none">
                      {dayNum}
                    </div>
                  )}
                </button>

                {/* Column body — vertical scroll per column */}
                <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
                  <DayColumn
                    date={date}
                    tasks={tasksByDate.get(date) ?? []}
                    projectMap={projectMap}
                    isToday={isToday}
                    onCreateForDate={handleCreateForDate}
                    onOpenDetail={(t) => openTaskDetail(t.id)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Drag overlay — floating task chip while dragging */}
      <DragOverlay dropAnimation={null}>
        {activeDragTask && (
          <div className="bg-elevated border border-accent-orange/30 rounded-md px-3 py-1.5 text-[12px] text-fg max-w-[200px] truncate opacity-90" style={{ boxShadow: "var(--shadow-card)" }}>
            {activeDragTask.title}
          </div>
        )}
      </DragOverlay>
      </DndContext>

      {/* TaskDetailOverlay is mounted as a singleton at App.tsx
          (M1 — see TaskDetailOverlayHost). Draft-task cleanup on close
          is handled by the prevDetailIdRef effect above. */}

      {/* Day modal — shows tasks scheduled for a single day */}
      {dayModalDate && (
        <DayTasksModal
          date={dayModalDate}
          tasks={tasksByDate.get(dayModalDate) ?? []}
          projectMap={projectMap}
          onClose={() => setDayModalDate(null)}
          onToggle={toggleTask}
          onOpenDetail={(t) => {
            setDayModalDate(null);
            openTaskDetail(t.id);
          }}
        />
      )}
    </div>
  );
}
