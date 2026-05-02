import { useEffect, useState, useCallback, useRef } from "react";
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
import { useAppStore } from "../stores/appStore";
import {
  getWeeklyPlan,
  upsertWeeklyPlan,
  getTasksForWeek,
  getProjects,
  createTask,
  updateTask,
  updateTaskStatus,
  updateTaskDateScheduled,
  getAllTasksForProjectIds,
  setManualWorkedMinutes,
  getWeeklyShutdown,
  deleteTask,
} from "../db/queries";
import ErrorBanner from "../components/ErrorBanner";
import TaskDetailOverlay from "../components/TaskDetailOverlay";
import DisclosureCaret from "../components/DisclosureCaret";
import type { Task, Project } from "../types";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const MAX_TITLE_LENGTH = 200;

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
          {task.estimated_minutes}m
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
    <div ref={setDropRef} className="flex flex-col min-w-0">
      {/* Column body */}
      <div
        className={`border-r border-line-hairline last:border-r-0 p-1.5 flex flex-col gap-[3px] flex-1 transition-colors duration-150 ${
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

        {/* Add — opens the task detail overlay for a fresh task scheduled to
            this day. Dashed-outline treatment is the design system's "drop /
            add new here" affordance. */}
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
                        {task.estimated_minutes}m
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

export default function WeeklyPlanner() {
  const { selectedWeek, setSelectedWeek, openProject } =
    useAppStore();

  const [weekTasks, setWeekTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [allProjectTasks, setAllProjectTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeDragTask, setActiveDragTask] = useState<Task | null>(null);

  // Undo banner for date moves (drag-drop between days)
  const [pendingMove, setPendingMove] = useState<{
    taskId: number;
    taskTitle: string;
    fromDate: string | null;
    toDate: string;
    timeoutId: ReturnType<typeof setTimeout>;
  } | null>(null);

  // Task detail overlay
  const [detailTask, setDetailTask] = useState<Task | null>(null);

  // Tasks created via the "+ Add" button on a day column — held until the
  // overlay closes. If the user closes without naming, we delete the empty
  // draft so the calendar doesn't fill with blank rows.
  const draftTaskIds = useRef<Set<number>>(new Set());

  // Day modal — full task list for a single day
  const [dayModalDate, setDayModalDate] = useState<string | null>(null);

  // Carry forward from last week
  const [carryForwardNotes, setCarryForwardNotes] = useState<string | null>(null);
  const [carryForwardDismissed, setCarryForwardDismissed] = useState(false);

  // Weekly notes (auto-saved with debounce)
  const [weeklyNotes, setWeeklyNotes] = useState("");

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedWeekRef = useRef(selectedWeek);
  selectedWeekRef.current = selectedWeek;

  const weekDates = getWeekdayDates(selectedWeek);
  const fridayIso = getFridayIso(selectedWeek);
  const todayStr = new Date().toISOString().split("T")[0];
  const isThisWeek = selectedWeek === getMondayOfWeek();

  const projectMap = new Map(projects.map((p) => [p.id, p]));

  // ── Data loading ──────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    try {
      const [wp, wt, p] = await Promise.all([
        getWeeklyPlan(selectedWeek),
        getTasksForWeek(selectedWeek, fridayIso),
        getProjects(),
      ]);

      // Auto-show all active, non-completed projects
      const activeProjects = p.filter((proj) => !proj.archived && !proj.completed);
      const activeIds = activeProjects.map((proj) => proj.id);

      // Also include any project IDs from this week's tasks (even if archived/completed)
      for (const t of wt) {
        if (t.project_id != null && !activeIds.includes(t.project_id)) {
          activeIds.push(t.project_id);
        }
      }

      const projectTasks = await getAllTasksForProjectIds(activeIds);

      setWeekTasks(wt);
      setAllProjectTasks(projectTasks);
      setProjects(p);
      setWeeklyNotes(wp?.notes ?? "");

      // Load carry forward from previous week's shutdown
      const prevMonday = new Date(selectedWeek + "T00:00:00");
      prevMonday.setDate(prevMonday.getDate() - 7);
      const prevMondayIso = prevMonday.toISOString().split("T")[0];
      const prevShutdown = await getWeeklyShutdown(prevMondayIso);
      setCarryForwardNotes(prevShutdown?.incomplete_items ?? null);
      setCarryForwardDismissed(false);

      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load weekly data");
    }
  }, [selectedWeek, fridayIso]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Auto-save with debounce ───────────────────────────────────────────

  function debouncedSave(newNotes: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        await upsertWeeklyPlan(
          selectedWeekRef.current,
          null,
          newNotes.trim() || null
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save");
      }
    }, 600);
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function handleWeeklyNotesChange(value: string) {
    setWeeklyNotes(value);
    debouncedSave(value);
  }

  // ── Actions ───────────────────────────────────────────────────────────

  async function toggleTask(task: Task) {
    try {
      await updateTaskStatus(task.id, task.status === "done" ? "todo" : "done");
      loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update task");
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
      // Refetch so the overlay receives a fully-formed Task row.
      const fresh = await getTasksForWeek(selectedWeek, fridayIso);
      const newTask = fresh.find((t) => t.id === id);
      setWeekTasks(fresh);
      if (newTask) setDetailTask(newTask);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add task");
    }
  }

  async function handleDetailClose() {
    const closing = detailTask;
    setDetailTask(null);
    if (closing && draftTaskIds.current.has(closing.id)) {
      draftTaskIds.current.delete(closing.id);
      try {
        const fresh = await getTasksForWeek(selectedWeek, fridayIso);
        const updated = fresh.find((t) => t.id === closing.id);
        if (updated && !updated.title.trim()) {
          await deleteTask(closing.id);
        }
      } catch {
        // best effort — leave the row if the cleanup query fails
      }
    }
    loadData();
  }


  function changeWeek(offset: number) {
    const d = new Date(selectedWeek + "T00:00:00");
    d.setDate(d.getDate() + offset * 7);
    setSelectedWeek(d.toISOString().split("T")[0]);
  }

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
      setError(e instanceof Error ? e.message : "Failed to schedule task");
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
      setError(e instanceof Error ? e.message : "Failed to undo move");
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

  // Unassigned tasks (no project) — rendered separately
  const unassignedTasks = weekTasks.filter((t) => t.project_id === null);

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

  // Total planned hours
  const totalPlannedMinutes = weekTasks.reduce(
    (sum, t) => sum + (t.estimated_minutes ?? 0),
    0
  );
  const totalPlannedHours = (Math.round(totalPlannedMinutes / 6) / 10)
    .toFixed(1)
    .replace(/\.0$/, "");

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

      {/* ── Header — hero title + utility row ─────────────────────────── */}
      <div className="px-7 pt-6 pb-4 border-b border-line-soft flex-shrink-0">
        <div className="flex items-center gap-3 mb-3">
          <h2 className="flex-1 text-[22px] font-medium text-fg leading-tight min-w-0 truncate">
            {formatWeekHeader(selectedWeek)}
          </h2>
          {isThisWeek && (
            <span className="text-[11px] bg-accent-orange-soft text-accent-orange-soft-fg px-2 py-0.5 rounded-full flex-shrink-0">
              This week
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => changeWeek(-1)}
            className="w-7 h-7 rounded-full flex items-center justify-center text-fg-muted cursor-pointer hover:bg-overlay-hover transition-colors duration-150 ease-out"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 4l-4 4 4 4" />
            </svg>
          </button>
          <button
            onClick={() => changeWeek(1)}
            className="w-7 h-7 rounded-full flex items-center justify-center text-fg-muted cursor-pointer hover:bg-overlay-hover transition-colors duration-150 ease-out"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 4l4 4-4 4" />
            </svg>
          </button>
          {!isThisWeek && (
            <button
              onClick={() => setSelectedWeek(getMondayOfWeek())}
              className="text-[11px] text-accent-orange-soft-fg hover:text-accent-orange cursor-pointer ml-1"
            >
              Jump to this week
            </button>
          )}
          <span className="text-[12px] text-fg-faded ml-auto">
            Planned{" "}
            <span className="text-fg-secondary tabular-nums">
              {totalPlannedHours}h
            </span>
          </span>
        </div>
      </div>

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
              Projects
            </span>

            {projectGroups.length === 0 && unassignedTasks.length === 0 ? (
              <p className="text-[12px] text-fg-faded py-4 text-center">
                No active projects
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
                    onOpenDetail={setDetailTask}
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
                          onOpenDetail={setDetailTask}
                          isLast={i === unassignedTasks.length - 1}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Bottom: weekly notes — always visible writing surface */}
          <div className="flex-shrink-0 px-5 py-3 border-t border-line-soft bg-elevated">
            <span className="uppercase text-fg-faded mb-1.5 block [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)]">
              Weekly notes
            </span>
            <textarea
              value={weeklyNotes}
              onChange={(e) => handleWeeklyNotesChange(e.target.value)}
              placeholder="Notes for this week..."
              className="w-full bg-elevated border border-line-hairline rounded-md px-3 py-2 text-[13px] text-fg-secondary placeholder:text-fg-disabled leading-relaxed resize-none h-[72px] outline-none focus:border-accent-blue"
            />
          </div>
        </div>

        {/* ── Main: Calendar ────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Calendar header */}
          <div className="grid grid-cols-5 border-b border-line-soft flex-shrink-0">
            {weekDates.map((date, i) => {
              const dayNum = new Date(date + "T00:00:00").getDate();
              const isToday = date === todayStr;
              return (
                <button
                  key={date}
                  onClick={() => setDayModalDate(date)}
                  className="px-2.5 pt-3 pb-3 text-center border-r border-line-hairline last:border-r-0 cursor-pointer hover:bg-overlay-hover transition-colors"
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
              );
            })}
          </div>

          {/* Calendar body */}
          <div className="grid grid-cols-5 flex-1 overflow-y-auto items-stretch">
            {weekDates.map((date) => (
              <DayColumn
                key={date}
                date={date}
                tasks={tasksByDate.get(date) ?? []}
                projectMap={projectMap}
                isToday={date === todayStr}
                onCreateForDate={handleCreateForDate}
                onOpenDetail={setDetailTask}
              />
            ))}
          </div>
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

      {/* Task detail overlay */}
      {detailTask && (
        <TaskDetailOverlay
          key={detailTask.id}
          task={detailTask}
          projects={projects}
          autoFocusTitle={draftTaskIds.current.has(detailTask.id)}
          onClose={handleDetailClose}
          onSave={(updates) => updateTask(updates).then(() => loadData()).catch(() => {})}
          onToggle={(t) => { toggleTask(t).catch(() => {}); }}
          onSetWorkedMinutes={(id, mins) => setManualWorkedMinutes(id, mins).then(() => loadData()).catch(() => {})}
        />
      )}

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
            setDetailTask(t);
          }}
        />
      )}
    </div>
  );
}
