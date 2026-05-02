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
  getWorkedMinutesForTask,
  setManualWorkedMinutes,
  getWeeklyShutdown,
} from "../db/queries";
import ErrorBanner from "../components/ErrorBanner";
import TaskDetailOverlay from "../components/TaskDetailOverlay";
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
  isLast,
}: {
  task: Task;
  weekDates: string[];
  onToggleTask: (task: Task) => void;
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
      className={`flex items-center gap-2 px-2.5 py-2 mb-0.5 ${
        !isLast ? "border-b border-divider" : ""
      } ${isDragging ? "opacity-30" : ""}`}
    >
      {/* Drag handle */}
      <span
        {...attributes}
        {...listeners}
        className="text-[10px] text-fg-disabled cursor-grab active:cursor-grabbing select-none"
      >
        ⠿
      </span>

      {/* Checkbox */}
      <button
        onClick={() => onToggleTask(task)}
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

      {/* Day pill */}
      {dayAbbrev ? (
        <span className="text-[10px] bg-overlay-hover text-fg-muted px-1.5 py-0.5 rounded">
          {dayAbbrev}
        </span>
      ) : (
        <span className="text-[10px] bg-accent-orange/[0.08] text-accent-orange px-1.5 py-0.5 rounded">
          —
        </span>
      )}
    </div>
  );
}

// ─── Left panel: Project card (collapsible) ─────────────────────────────────

function ProjectCard({
  project,
  tasks,
  weekDates,
  onToggleTask,
  onNavigateProject,
}: {
  project: { id: number | null; name: string; color: string };
  tasks: Task[];
  weekDates: string[];
  onToggleTask: (task: Task) => void;
  onNavigateProject: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-elevated border border-line-soft rounded-[9px] mb-2.5 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[18px] leading-none text-fg-faded cursor-pointer hover:text-fg-muted w-5 flex-shrink-0 transition-transform duration-150"
          style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
        >
          ▸
        </button>
        <div
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: project.color }}
        />
        <span
          className={`text-[13px] font-medium text-fg flex-1 truncate ${
            project.id !== null
              ? "cursor-pointer hover:text-accent-orange"
              : ""
          }`}
          onClick={() => {
            if (project.id !== null) onNavigateProject(project.id);
          }}
        >
          {project.name}
        </span>
      </div>

      {/* Tasks — collapsible */}
      {expanded && tasks.length > 0 && (
            <div className="border-t border-line-hairline">
              {tasks.map((task, i) => (
                <DraggableTaskRow
                  key={task.id}
                  task={task}
                  weekDates={weekDates}
                  onToggleTask={onToggleTask}
                  isLast={i === tasks.length - 1}
                />
              ))}
            </div>
          )}
    </div>
  );
}

// ─── Right panel: Calendar task chip ────────────────────────────────────────

function CalendarTaskChip({
  task,
  project,
  onToggle,
  onNavigateProject,
  onOpenDetail,
}: {
  task: Task;
  project: Project | undefined;
  onToggle: (task: Task) => void;
  onNavigateProject: (id: number) => void;
  onOpenDetail: (task: Task) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `cal-task-${task.id}`,
    data: { task },
  });

  const prevStatusRef = useRef(task.status);
  const justCompleted = task.status === "done" && prevStatusRef.current !== "done";
  useEffect(() => { prevStatusRef.current = task.status; }, [task.status]);

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`bg-elevated border-[0.5px] border-line-soft rounded-md px-3 py-2.5 cursor-grab active:cursor-grabbing hover:bg-overlay-hover ${isDragging ? "opacity-30" : ""}`}
      style={{ borderLeftWidth: 3, borderLeftColor: project?.color ?? "var(--text-faded)" }}
    >
      {/* Title row with checkbox */}
      <div className="flex items-start gap-1.5">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle(task);
          }}
          title={task.status === "done" ? "Mark as not done" : "Mark complete"}
          className={`w-[18px] h-[18px] rounded-full border-2 flex-shrink-0 cursor-pointer flex items-center justify-center mt-[1px] transition-colors ${
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
        <span
          className={`text-[12px] leading-snug flex-1 line-clamp-3 cursor-pointer hover:text-accent-orange transition-colors ${
            task.status === "done"
              ? "text-fg-faded line-through"
              : "text-fg"
          }`}
          onClick={(e) => {
            e.stopPropagation();
            onOpenDetail(task);
          }}
        >
          {task.title}
        </span>
      </div>

      {/* Project name + duration */}
      <div className="flex items-center gap-1.5 mt-0.5 ml-[19px]">
        {project && (
          <span
            className="text-[10px] text-fg-faded truncate max-w-[100px] cursor-pointer hover:text-accent-orange"
            onClick={(e) => {
              e.stopPropagation();
              onNavigateProject(project.id);
            }}
          >
            {project.name}
          </span>
        )}
        {task.estimated_minutes != null && task.estimated_minutes > 0 && (
          <span className="text-[10px] text-fg-faded">
            {task.estimated_minutes}m
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Right panel: Day column ────────────────────────────────────────────────

function DayColumn({
  date,
  tasks,
  projectMap,
  isToday,
  onToggle,
  onQuickAdd,
  onNavigateProject,
  onOpenDetail,
  projects,
}: {
  date: string;
  tasks: Task[];
  projectMap: Map<number, Project>;
  isToday: boolean;
  onToggle: (task: Task) => void;
  onQuickAdd: (date: string, title: string, projectId: number | null) => void;
  onNavigateProject: (id: number) => void;
  onOpenDetail: (task: Task) => void;
  projects: Project[];
}) {
  const [quickAddTitle, setQuickAddTitle] = useState("");
  const [quickAddProjectId, setQuickAddProjectId] = useState<number | null>(null);
  const { isOver, setNodeRef: setDropRef } = useDroppable({
    id: `day-${date}`,
    data: { date },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const title = quickAddTitle.trim();
    if (!title) return;
    onQuickAdd(date, title, quickAddProjectId);
    setQuickAddTitle("");
  }

  return (
    <div ref={setDropRef} className="flex flex-col min-w-0">
      {/* Column body */}
      <div
        className={`border-r border-line-hairline last:border-r-0 p-1.5 flex flex-col gap-[6px] flex-1 transition-colors duration-150 ${
          isOver ? "bg-accent-orange/[0.08]" : isToday ? "bg-accent-orange/[0.02]" : ""
        }`}
      >
        {tasks.map((task) => (
          <CalendarTaskChip
            key={task.id}
            task={task}
            project={projectMap.get(task.project_id ?? -1)}
            onToggle={onToggle}
            onNavigateProject={onNavigateProject}
            onOpenDetail={onOpenDetail}
          />
        ))}

        {/* Quick add */}
        <form onSubmit={handleSubmit} className="mt-auto">
          <input
            type="text"
            value={quickAddTitle}
            onChange={(e) => setQuickAddTitle(e.target.value)}
            maxLength={MAX_TITLE_LENGTH}
            placeholder="+ Add"
            className="text-[11px] text-fg-faded cursor-pointer px-1 py-1 rounded hover:bg-overlay-hover hover:text-fg-muted block w-full bg-transparent border-none outline-none placeholder:text-fg-faded"
          />
          {quickAddTitle.trim() && (
            <select
              value={quickAddProjectId ?? ""}
              onChange={(e) =>
                setQuickAddProjectId(
                  e.target.value === "" ? null : Number(e.target.value)
                )
              }
              className="text-[10px] text-fg-muted bg-transparent border border-line-soft rounded px-1 py-0.5 mt-0.5 w-full outline-none cursor-pointer"
            >
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </form>
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

  async function handleQuickAdd(date: string, title: string, projectId: number | null) {
    if (title.length > MAX_TITLE_LENGTH) {
      setError(`Task title must be ${MAX_TITLE_LENGTH} characters or less`);
      return;
    }
    try {
      await createTask({
        title,
        projectId,
        dateScheduled: date,
        estimatedMinutes: null,
      });
      loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add task");
    }
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
    const tasks = allProjectTasks.filter((t) => t.project_id === p.id);
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
    <div className="flex flex-col h-full bg-base overflow-hidden">
      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {pendingMove && (
        <div
          className="flex items-center gap-3 px-7 py-2 bg-banner text-[12px] flex-shrink-0"
          style={{ color: "var(--text-banner)" }}
        >
          <span className="flex-1 truncate">
            Moved &ldquo;{pendingMove.taskTitle}&rdquo;
            {pendingMove.fromDate ? "" : " to scheduled"}
          </span>
          <button
            onClick={undoMove}
            className="text-accent-orange font-medium cursor-pointer transition-colors"
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-banner)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = ""; }}
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
            <span className="text-[11px] bg-accent-orange-soft text-accent-orange px-2 py-0.5 rounded-full flex-shrink-0">
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
              className="text-[11px] text-accent-orange hover:text-accent-orange-hover cursor-pointer ml-1"
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

      {/* ── Body: calendar (main) + right rail (projects + notes) ─────── */}
      <DndContext
        sensors={dndSensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
      <div className="flex flex-1 min-h-0">
        {/* ── Main: Calendar ────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Calendar header */}
          <div className="grid grid-cols-5 border-b border-line-soft flex-shrink-0">
            {weekDates.map((date, i) => {
              const dayNum = new Date(date + "T00:00:00").getDate();
              const isToday = date === todayStr;
              return (
                <div
                  key={date}
                  className="px-2.5 pt-3 pb-3 text-center border-r border-line-hairline last:border-r-0"
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
                </div>
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
                onToggle={toggleTask}
                onQuickAdd={handleQuickAdd}
                onNavigateProject={navigateToProject}
                onOpenDetail={setDetailTask}
                projects={projects}
              />
            ))}
          </div>
        </div>

        {/* ── Right rail: projects + weekly notes ────────────────────────── */}
        <div
          className="w-[300px] flex-shrink-0 flex flex-col overflow-hidden"
          style={{ borderLeft: "1px solid var(--border-medium)" }}
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
          onClose={() => { setDetailTask(null); loadData(); }}
          onSave={(updates) => updateTask(updates).then(() => loadData()).catch(() => {})}
          onToggle={(t) => { toggleTask(t).catch(() => {}); }}
          onSetWorkedMinutes={(id, mins) => setManualWorkedMinutes(id, mins).then(() => loadData()).catch(() => {})}
        />
      )}
    </div>
  );
}
