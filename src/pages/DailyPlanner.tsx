import { useEffect, useState, useRef } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { useAppStore } from "../stores/appStore";
import {
  getTasksForDate,
  getProjects,
  createTask,
  updateTask,
  updateTaskStatus,
  updateTaskSortOrders,
  deleteTask,
  startTimeEntry,
  getTotalPlannedMinutes,
  getTotalWorkedMinutes,
  getDailyPlan,
  upsertDailyPlan,
  getSidebarTasks,
  updateTaskDateScheduled,
  getWorkedMinutesForTaskIds,
  getWorkedMinutesForTask,
  setManualWorkedMinutes,
  getProjectStats,
  generateRecurringInstances,
  rolloverUnfinishedTasks,
  getUnfinishedRolloverTasks,
} from "../db/queries";
import ErrorBanner from "../components/ErrorBanner";
import TaskCard from "../components/TaskCard";
import DatePicker from "../components/DatePicker";
import DurationPicker from "../components/DurationPicker";
import TaskDetailOverlay from "../components/TaskDetailOverlay";
import RichTextEditor from "../components/RichTextEditor";
import SummaryOverlay from "../components/SummaryOverlay";
import { formatHoursMinutes, parseTimeFromTitle } from "../utils/format";
import type { Task, DailyPlan, Project } from "../types";
import type { PlanSummaryData } from "../utils/summaryPrompts";


const MAX_TITLE_LENGTH = 200;
const MAX_ESTIMATE_MINUTES = 480;

// Smart time parsing: extract duration from end of task title.
// Known limitation: compound durations like "2h30m" only match the trailing
// unit (30m), leaving "2h" in the title. Use a single unit instead (e.g. "150m" or "2.5h").



export default function DailyPlanner() {
  const { selectedDate, setSelectedDate, startFocus, openProject, focus, setPage } = useAppStore();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [plannedMinutes, setPlannedMinutes] = useState(0);
  const [workedMinutes, setWorkedMinutes] = useState(0);
  const [dailyPlan, setDailyPlan] = useState<DailyPlan | null>(null);
  const [workedMap, setWorkedMap] = useState<Map<number, number>>(new Map());
  const [projectStats, setProjectStats] = useState<Map<number, { total: number; done: number }>>(new Map());
  const [error, setError] = useState<string | null>(null);

  // Create form
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskEstimate, setNewTaskEstimate] = useState<number | null>(null);
  const [newTaskProjectId, setNewTaskProjectId] = useState<string>("");
  const [newTaskHighPriority, setNewTaskHighPriority] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editEstimate, setEditEstimate] = useState("");
  const [editProjectId, setEditProjectId] = useState<string>("");
  const [editPriority, setEditPriority] = useState("medium");
  const [editNotes, setEditNotes] = useState("");

  // UI state
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [dailyNotes, setDailyNotes] = useState("");
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTaskPicker, setShowTaskPicker] = useState(false);
  const [taskInputExpanded, setTaskInputExpanded] = useState(false);
  const taskInputRef = useRef<HTMLFormElement>(null);
  const datePickerAnchorRef = useRef<HTMLButtonElement>(null);

  // Right panel — expandable projects + unfinished + unscheduled
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<number>>(new Set());
  const [unfinishedExpanded, setUnfinishedExpanded] = useState(true);
  const [unscheduledExpanded, setUnscheduledExpanded] = useState(false);

  // Task detail overlay
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [showSummary, setShowSummary] = useState(false);

  // Shutdown state (for localStorage check only)
  const initialLoadDone = useRef(false);

  // Sidebar state
  const [sidebarUnscheduled, setSidebarUnscheduled] = useState<Task[]>([]);
  const [sidebarOverdue, setSidebarOverdue] = useState<Task[]>([]);
  const [unfinishedTasks, setUnfinishedTasks] = useState<Task[]>([]);

  const hourBudget = dailyPlan?.hour_budget ?? 8;
  const plannedHours = plannedMinutes / 60;
  const workedHours = workedMinutes / 60;

  const projectMap = new Map(projects.map((p) => [p.id, p]));

  // Collapse task input on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (taskInputRef.current && !taskInputRef.current.contains(e.target as Node)) {
        setTaskInputExpanded(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );


  async function loadData() {
    try {
      // Generate recurring task instances for this date before loading
      await generateRecurringInstances(selectedDate);
      const todayIso = new Date().toISOString().split("T")[0];
      // Roll over unfinished tasks from previous days (only for today)
      if (selectedDate === todayIso) {
        await rolloverUnfinishedTasks(todayIso);
      }
      const [t, pm, wm, dp, p, sb, uf] = await Promise.all([
        getTasksForDate(selectedDate),
        getTotalPlannedMinutes(selectedDate),
        getTotalWorkedMinutes(selectedDate),
        getDailyPlan(selectedDate),
        getProjects(),
        getSidebarTasks(todayIso),
        getUnfinishedRolloverTasks(),
      ]);
      setTasks(t);
      setPlannedMinutes(pm);
      setWorkedMinutes(wm);
      setDailyPlan(dp);
      setProjects(p);
      // Fetch project stats for right panel
      const pStats = await getProjectStats();
      setProjectStats(pStats);
      // Fetch worked minutes per task
      if (t.length > 0) {
        const wmap = await getWorkedMinutesForTaskIds(t.map((task) => task.id));
        setWorkedMap(wmap);
      } else {
        setWorkedMap(new Map());
      }
      setSidebarUnscheduled(sb.unscheduled);
      setSidebarOverdue(sb.overdue);
      setUnfinishedTasks(uf);
      setDailyNotes(dp?.notes ?? "");
      setError(null);
      // Mark initial load done (for stagger animation)
      setTimeout(() => {
        initialLoadDone.current = true;
      }, 200);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
    }
  }

  useEffect(() => {
    initialLoadDone.current = false;
    setEditingId(null);
    setConfirmDeleteId(null);
    loadData();
  }, [selectedDate]);

  async function handleAddTask(e: React.FormEvent) {
    e.preventDefault();
    let title = newTaskTitle.trim();
    if (!title) return;
    if (title.length > MAX_TITLE_LENGTH) {
      setError(`Task title must be ${MAX_TITLE_LENGTH} characters or less`);
      return;
    }

    // Smart time parsing: extract duration from title if no manual estimate set
    let est = newTaskEstimate;
    if (est == null) {
      const parsed = parseTimeFromTitle(title);
      if (parsed.minutes != null) {
        title = parsed.cleanTitle;
        est = parsed.minutes;
      }
    }

    try {
      await createTask({
        title,
        projectId: newTaskProjectId ? parseInt(newTaskProjectId) : null,
        dateScheduled: selectedDate,
        estimatedMinutes: est,
        priority: newTaskHighPriority ? "high" : "medium",
      });
      setNewTaskTitle("");
      setNewTaskEstimate(null);
      setNewTaskProjectId("");
      setNewTaskHighPriority(false);
      setError(null);
      loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add task");
    }
  }

  async function toggleTask(task: Task) {
    try {
      await updateTaskStatus(task.id, task.status === "done" ? "todo" : "done");
      setError(null);
      loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update task");
    }
  }

  async function handleStartFocus(task: Task) {
    if (useAppStore.getState().focus) {
      setError("A focus session is already active");
      return;
    }
    try {
      // Get accumulated worked time for this task
      const priorMinutes = await getWorkedMinutesForTask(task.id);
      const priorMs = priorMinutes * 60 * 1000;
      const entryId = await startTimeEntry(task.id, "tracked");
      startFocus(task, entryId, "daily", priorMs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start timer");
    }
  }

  function startEdit(task: Task) {
    setEditingId(task.id);
    setEditTitle(task.title);
    setEditEstimate(task.estimated_minutes?.toString() ?? "");
    setEditProjectId(task.project_id?.toString() ?? "");
    setEditPriority(task.priority);
    setEditNotes(task.notes ?? "");
  }

  function handleEditKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") setEditingId(null);
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      saveEdit();
    }
  }

  async function saveEdit() {
    if (editingId === null) return;
    const title = editTitle.trim();
    if (!title || title.length > MAX_TITLE_LENGTH) {
      setError(`Title must be 1-${MAX_TITLE_LENGTH} characters`);
      return;
    }
    let est: number | null = null;
    if (editEstimate) {
      est = parseInt(editEstimate);
      if (isNaN(est) || est < 1 || est > MAX_ESTIMATE_MINUTES) {
        setError(`Estimate must be 1-${MAX_ESTIMATE_MINUTES} minutes`);
        return;
      }
    }
    try {
      await updateTask({
        id: editingId,
        title,
        projectId: editProjectId ? parseInt(editProjectId) : null,
        estimatedMinutes: est,
        priority: editPriority,
        notes: editNotes.trim() || null,
        dateScheduled: selectedDate,
      });
      setEditingId(null);
      setError(null);
      loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update task");
    }
  }

  function handleDetailSave(updates: Parameters<typeof updateTask>[0]) {
    updateTask(updates).then(() => loadData()).catch(() => {});
  }

  async function pullTaskToDay(taskId: number) {
    try {
      await updateTaskDateScheduled(taskId, selectedDate);
      loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to schedule task");
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteTask(id);
      setConfirmDeleteId(null);
      setError(null);
      loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete task");
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = tasks.findIndex((t) => t.id === active.id);
    const newIndex = tasks.findIndex((t) => t.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(tasks, oldIndex, newIndex);
    setTasks(reordered);
    try {
      await updateTaskSortOrders(
        reordered.map((t, i) => ({ id: t.id, sortOrder: i }))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reorder tasks");
      loadData();
    }
  }

  async function saveDailyNotes() {
    try {
      await upsertDailyPlan(
        selectedDate,
        dailyNotes.trim() || null,
        hourBudget
      );
      setError(null);
      loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save notes");
    }
  }

  function changeDate(offset: number) {
    const d = new Date(selectedDate + "T00:00:00");
    d.setDate(d.getDate() + offset);
    setSelectedDate(d.toISOString().split("T")[0]);
  }

  const isToday = selectedDate === new Date().toISOString().split("T")[0];
  const progressPercent =
    plannedHours > 0
      ? Math.min((workedHours / plannedHours) * 100, 100)
      : 0;

  const selectedProjectName =
    newTaskProjectId
      ? projects.find((p) => p.id === parseInt(newTaskProjectId))?.name ??
        "No project"
      : "No project";

  // Sort tasks: incomplete first, completed at bottom (stable within each group)
  const sortedTasks = [...tasks].sort((a, b) =>
    a.status === "done" && b.status !== "done" ? 1
      : a.status !== "done" && b.status === "done" ? -1
      : 0
  );

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Main content ────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {/* Date Header */}
      <div className="px-7 pt-5 pb-4">
        {/* Date row with stats right-aligned */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => changeDate(-1)}
            className="w-6 h-6 rounded-md bg-black/[0.04] border border-black/[0.08] flex items-center justify-center text-black/35 text-[12px] cursor-pointer hover:bg-black/[0.07]"
          >
            ‹
          </button>
          <h2 className="text-[16px] font-medium text-[#2c2a35]">
            {new Date(selectedDate + "T00:00:00").toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
          </h2>
          <button
            onClick={() => changeDate(1)}
            className="w-6 h-6 rounded-md bg-black/[0.04] border border-black/[0.08] flex items-center justify-center text-black/35 text-[12px] cursor-pointer hover:bg-black/[0.07]"
          >
            ›
          </button>
          <div className="flex items-center">
            <button
              ref={datePickerAnchorRef}
              onClick={() => setShowDatePicker(!showDatePicker)}
              className={`text-[11px] leading-none px-2 py-1 rounded-full cursor-pointer ${
                isToday
                  ? "bg-[#7B9ED9]/10 text-[#7B9ED9]"
                  : "bg-black/[0.04] text-black/40 hover:bg-black/[0.07]"
              }`}
            >
              {isToday ? "Today" : "Jump to..."}
            </button>
            {showDatePicker && (
              <DatePicker
                selectedDate={selectedDate}
                onSelect={(date) => setSelectedDate(date)}
                onClose={() => setShowDatePicker(false)}
                anchorRef={datePickerAnchorRef}
              />
            )}
          </div>
          {(workedMinutes > 0 || plannedMinutes > 0) && (
            <>
              <div className="w-px h-3.5 bg-black/[0.08]" />
              <span className="text-[12px] leading-none text-black/30">
                Worked <span className="text-black/50 tabular-nums">{formatHoursMinutes(workedMinutes)}</span>
              </span>
              <span className="text-[12px] leading-none text-black/30">
                Planned <span className="text-black/50 tabular-nums">{formatHoursMinutes(plannedMinutes)}</span>
              </span>
            </>
          )}
          <div className="flex-1" />
          {/* Focus button — inline */}
          {(() => {
            const isFocusing = !!focus;
            const nextTask = tasks.find((t) => t.status !== "done");

            if (isFocusing) {
              return (
                <button
                  onClick={() => setPage("focus")}
                  className="rounded-lg bg-[#7B9ED9] text-white hover:bg-[#6889c4] cursor-pointer flex items-center gap-2 px-4 py-1.5 transition-colors"
                >
                  <svg width="8" height="10" viewBox="0 0 8 10" fill="white" className="ml-[1px]">
                    <path d="M0 0v10l8-5z" />
                  </svg>
                  <span className="text-[13px] font-medium">Focusing...</span>
                </button>
              );
            }

            if (!nextTask) return null;

            return (
              <button
                onClick={() => handleStartFocus(nextTask)}
                className="rounded-lg bg-[#7B9ED9] text-white hover:bg-[#6889c4] cursor-pointer flex items-center gap-2 px-4 py-1.5 transition-colors"
                title={`Start focus: ${nextTask.title}`}
              >
                <svg width="8" height="10" viewBox="0 0 8 10" fill="white" className="ml-[1px]">
                  <path d="M0 0v10l8-5z" />
                </svg>
                <span className="text-[13px] font-medium">Start focusing</span>
              </button>
            );
          })()}
        </div>
      </div>

      {/* Main scrollable area */}
      <div className="flex-1 overflow-y-auto px-7 py-5 flex flex-col">
        {/* Task Input — collapses when unfocused */}
        <form onSubmit={handleAddTask} className="mb-5" ref={taskInputRef}>
          <div className="bg-white border border-black/[0.08] rounded-[10px] p-3.5">
            {/* Row 1: input + add */}
            <div className={`flex items-center gap-2.5 ${taskInputExpanded ? "mb-2.5" : ""}`}>
              <input
                type="text"
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                onFocus={() => setTaskInputExpanded(true)}
                maxLength={MAX_TITLE_LENGTH}
                placeholder="Add a task..."
                className="flex-1 bg-transparent border-none outline-none text-[14px] text-[#2c2a35] placeholder-black/25"
              />
              <button
                type="submit"
                className="bg-[#7B9ED9] text-white rounded-lg px-4 py-1.5 text-[13px] font-medium cursor-pointer hover:bg-[#6889c4] transition-colors whitespace-nowrap"
              >
                Add
              </button>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowTaskPicker(!showTaskPicker)}
                  className="w-8 h-8 rounded-lg border border-black/[0.08] bg-black/[0.03] flex items-center justify-center text-black/35 cursor-pointer hover:bg-black/[0.06] text-[14px]"
                  title="Pull an existing task into today"
                >
                  ↓
                </button>
                {showTaskPicker && (
                  <div className="absolute top-full right-0 mt-1 z-30 bg-white border border-black/[0.1] rounded-[10px] shadow-lg w-[280px] max-h-[320px] overflow-y-auto animate-scale-in">
                    {sidebarUnscheduled.length === 0 && sidebarOverdue.length === 0 ? (
                      <p className="px-3 py-4 text-[12px] text-black/30 text-center">
                        No unscheduled or overdue tasks
                      </p>
                    ) : (
                      <>
                        {sidebarOverdue.length > 0 && (
                          <div className="px-3 pt-2.5 pb-1">
                            <span className="uppercase [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] text-[#d95f5f]/60">Overdue</span>
                          </div>
                        )}
                        {sidebarOverdue.map((task) => (
                          <button
                            key={task.id}
                            onClick={() => { pullTaskToDay(task.id); setShowTaskPicker(false); }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-left cursor-pointer hover:bg-black/[0.04] text-[12px]"
                          >
                            {task.project_id && projectMap.get(task.project_id) && (
                              <div
                                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                style={{ backgroundColor: projectMap.get(task.project_id)!.color }}
                              />
                            )}
                            <span className="flex-1 truncate text-[#2c2a35]">{task.title}</span>
                            {task.estimated_minutes != null && task.estimated_minutes > 0 && (
                              <span className="text-[10px] text-black/25">{task.estimated_minutes}m</span>
                            )}
                          </button>
                        ))}
                        {sidebarUnscheduled.length > 0 && (
                          <div className="px-3 pt-2.5 pb-1">
                            <span className="uppercase [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] text-black/30">Unscheduled</span>
                          </div>
                        )}
                        {(() => {
                          // Group unscheduled by project
                          const byProject = new Map<number | null, Task[]>();
                          for (const t of sidebarUnscheduled) {
                            const key = t.project_id;
                            if (!byProject.has(key)) byProject.set(key, []);
                            byProject.get(key)!.push(t);
                          }
                          const groups = Array.from(byProject.entries());
                          return groups.map(([pid, tasks]) => {
                            const proj = pid != null ? projectMap.get(pid) : null;
                            return (
                              <div key={pid ?? "none"}>
                                {pid != null && proj && (
                                  <div className="flex items-center gap-1.5 px-3 pt-1.5 pb-0.5">
                                    <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: proj.color }} />
                                    <span className="text-[10px] text-black/35 font-medium">{proj.name}</span>
                                  </div>
                                )}
                                {tasks.map((task) => (
                                  <button
                                    key={task.id}
                                    onClick={() => { pullTaskToDay(task.id); setShowTaskPicker(false); }}
                                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left cursor-pointer hover:bg-black/[0.04] text-[12px]"
                                  >
                                    <span className="flex-1 truncate text-[#2c2a35] pl-3">{task.title}</span>
                                    {task.estimated_minutes != null && task.estimated_minutes > 0 && (
                                      <span className="text-[10px] text-black/25">{task.estimated_minutes}m</span>
                                    )}
                                  </button>
                                ))}
                              </div>
                            );
                          });
                        })()}
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
            {/* Row 2: metadata pills — visible only when expanded */}
            {taskInputExpanded && (
            <div className="flex items-center gap-2">
              {/* Project dropdown */}
              <select
                value={newTaskProjectId}
                onChange={(e) => setNewTaskProjectId(e.target.value)}
                className="bg-black/[0.04] border border-black/[0.08] rounded-md px-2 py-1 text-[12px] text-black/45 cursor-pointer hover:bg-black/[0.07] outline-none"
              >
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>

              <div className="w-px h-3.5 bg-black/[0.08]" />

              {/* Duration picker */}
              <DurationPicker
                value={newTaskEstimate}
                onChange={setNewTaskEstimate}
              />

            </div>
            )}
          </div>
        </form>

        {/* Task List — grouped by project */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={sortedTasks.map((t) => t.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className={`space-y-1.5 flex-1 ${!initialLoadDone.current ? "[&>*]:animate-stagger [&>*]:animate-slide-up" : ""}`}>
              {tasks.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-2.5 px-8 py-8 text-center">
                  <div className="w-10 h-10 bg-[#7B9ED9]/10 rounded-[10px] flex items-center justify-center mb-1">
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                      <circle cx="9" cy="9" r="6" stroke="#7B9ED9" strokeWidth="1.2" opacity="0.5" fill="none" />
                      <path d="M6 9l2 2 4-4" stroke="#7B9ED9" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                    </svg>
                  </div>
                  <p className="text-[14px] font-medium text-black/50">Nothing planned yet</p>
                  <p className="text-[12px] text-black/25 leading-relaxed max-w-[220px]">
                    Add your first task above to start building your day.
                  </p>
                </div>
              ) : (
                (() => {
                  // Group sorted tasks by project
                  const grouped = new Map<number | null, Task[]>();
                  const groupOrder: (number | null)[] = [];
                  for (const task of sortedTasks) {
                    const pid = task.project_id;
                    if (!grouped.has(pid)) {
                      grouped.set(pid, []);
                      groupOrder.push(pid);
                    }
                    grouped.get(pid)!.push(task);
                  }
                  return groupOrder.map((pid) => {
                    const groupTasks = grouped.get(pid)!;
                    const proj = pid != null ? projectMap.get(pid) : null;
                    return (
                      <div key={pid ?? "none"} className="mb-2">
                        {/* Project section header — compact chip */}
                        <div className="flex items-center gap-1.5 mb-1 px-1 max-w-[300px]">
                          <div
                            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: proj?.color ?? "#999" }}
                          />
                          <span
                            className={`uppercase [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] text-black/20 truncate ${pid != null ? "cursor-pointer hover:text-[#7B9ED9] transition-colors" : ""}`}
                            onClick={() => { if (pid != null) openProject(pid); }}
                            title={proj?.name ?? "No project"}
                          >
                            {proj?.name ?? "No project"}
                          </span>
                        </div>
                        {groupTasks.map((task) => {
                  if (editingId === task.id) {
                    return (
                      <div
                        key={task.id}
                        className="p-3.5 rounded-[10px] bg-white border border-black/[0.08] space-y-2"
                        onKeyDown={handleEditKeyDown}
                      >
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            maxLength={MAX_TITLE_LENGTH}
                            autoFocus
                            className="flex-1 bg-transparent border border-black/[0.08] rounded-md px-2.5 py-1.5 text-[13px] text-[#2c2a35] focus:outline-none focus:border-[#7B9ED9]/40"
                          />
                          <input
                            type="number"
                            value={editEstimate}
                            onChange={(e) => setEditEstimate(e.target.value)}
                            min={1}
                            max={MAX_ESTIMATE_MINUTES}
                            placeholder="min"
                            className="w-20 bg-transparent border border-black/[0.08] rounded-md px-2.5 py-1.5 text-[13px] text-[#2c2a35] placeholder-black/25 focus:outline-none focus:border-[#7B9ED9]/40"
                          />
                        </div>
                        <div className="flex gap-2">
                          <select
                            value={editProjectId}
                            onChange={(e) => setEditProjectId(e.target.value)}
                            className="flex-1 bg-transparent border border-black/[0.08] rounded-md px-2.5 py-1.5 text-[12px] text-black/50 focus:outline-none focus:border-[#7B9ED9]/40"
                          >
                            <option value="">No project</option>
                            {projects.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() =>
                              setEditPriority(
                                editPriority === "high" ? "medium" : "high"
                              )
                            }
                            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] cursor-pointer border ${
                              editPriority === "high"
                                ? "bg-[#d95f5f]/10 border-[#d95f5f]/25 text-[#d95f5f]"
                                : "bg-transparent border-black/[0.08] text-black/45"
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                editPriority === "high"
                                  ? "bg-[#d95f5f]"
                                  : "bg-black/20"
                              }`}
                            />
                            High
                          </button>
                        </div>
                        <RichTextEditor
                          value={editNotes}
                          onChange={(html) => setEditNotes(html)}
                          placeholder="Notes..."
                          className="w-full bg-transparent border border-black/[0.08] rounded-md px-2.5 py-2 text-[12px] text-black/55 min-h-[60px] focus-within:border-[#7B9ED9]/40"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={saveEdit}
                            className="bg-[#7B9ED9] text-white rounded-md px-3 py-1.5 text-[12px] cursor-pointer hover:bg-[#6889c4] transition-colors"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="bg-black/[0.05] text-black/45 rounded-md px-3 py-1.5 text-[12px] cursor-pointer hover:bg-black/[0.07] transition-colors"
                          >
                            Cancel
                          </button>
                          <span className="text-[11px] text-black/20 self-center ml-auto">
                            Cmd+Enter to save, Esc to cancel
                          </span>
                        </div>
                      </div>
                    );
                  }

                  if (confirmDeleteId === task.id) {
                    return (
                      <div
                        key={task.id}
                        className="p-3.5 rounded-[10px] bg-white border border-black/[0.08] flex items-center gap-3"
                      >
                        <span className="flex-1 text-[13px] text-[#e4a945]">
                          Delete &ldquo;{task.title}&rdquo;? Time entries will
                          also be deleted.
                        </span>
                        <button
                          onClick={() => handleDelete(task.id)}
                          className="bg-[#d95f5f] text-white rounded-md px-3 py-1 text-[12px] cursor-pointer"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="text-black/35 text-[12px] cursor-pointer hover:text-black/50"
                        >
                          Cancel
                        </button>
                      </div>
                    );
                  }

                  return (
                    <TaskCard
                      key={task.id}
                      task={task}
                      project={projectMap.get(task.project_id ?? -1)}
                      onToggle={toggleTask}
                      onEdit={startEdit}
                      onDelete={(id) => setConfirmDeleteId(id)}
                      onToggleNotes={(id) =>
                        setExpandedId(expandedId === id ? null : id)
                      }
                      onStart={handleStartFocus}
                      onOpenDetail={setDetailTask}
                      expandedNotes={expandedId === task.id}
                      workedMinutes={workedMap.get(task.id)}
                      showProject={false}
                    />
                  );
                })}
                      </div>
                    );
                  });
                })()
              )}
            </div>
          </SortableContext>
        </DndContext>

        {/* Daily Notes + Shutdown link — bottom of scroll area */}
        <div className="mt-auto pt-3">
          <div className="flex items-center justify-between mb-1.5">
            <label className="uppercase [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] text-black/30">
              Daily notes
            </label>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowSummary(true)}
                className="text-[11px] text-[#7B9ED9] cursor-pointer hover:text-[#6889c4] transition-colors"
              >
                Summarize plan
              </button>
              <button
                onClick={() => setPage("daily_shutdown")}
                className="flex items-center gap-1 text-[12px] text-black/30 cursor-pointer hover:text-black/50 transition-colors"
              >
                <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
                  <circle cx="7" cy="7" r="5.5" />
                  <path d="M7 4v3h2.5" />
                </svg>
                Shutdown day
              </button>
            </div>
          </div>
          <textarea
            value={dailyNotes}
            onChange={(e) => setDailyNotes(e.target.value)}
            onBlur={saveDailyNotes}
            placeholder="Write notes for today..."
            className="w-full bg-white border border-black/[0.06] rounded-lg px-3 py-2 text-[13px] text-black/55 placeholder-black/20 resize-none min-h-[72px] leading-relaxed focus:outline-none focus:border-[#7B9ED9]/30"
          />
        </div>

      </div>
      </div>

      {/* ── Right panel: Projects ──────────────────────────────────── */}
      <div className="w-[220px] flex-shrink-0 border-l border-black/[0.06] bg-[#efede8] flex flex-col overflow-y-auto">
        <div className="px-3 pt-4 pb-1.5 text-[10px] text-black/[0.2] uppercase tracking-[0.08em]">
          Projects
        </div>
        {(() => {
          const activeProjects = projects.filter((p) => !p.completed);
          if (activeProjects.length === 0) {
            return (
              <p className="px-3 py-4 text-[12px] text-black/25 text-center">
                No active projects
              </p>
            );
          }
          return activeProjects.map((p) => {
            const isExpanded = expandedProjectIds.has(p.id);
            const unscheduled = sidebarUnscheduled.filter((t) => t.project_id === p.id);
            const overdue = sidebarOverdue.filter((t) => t.project_id === p.id);
            const todayTasks = tasks.filter((t) => t.project_id === p.id);
            const pullableTasks = [...unscheduled, ...overdue];

            return (
              <div key={p.id} className="border-b border-black/[0.04]">
                {/* Project header */}
                <div className="flex items-center gap-1.5 px-3 py-2 hover:bg-black/[0.04] transition-colors">
                  <button
                    onClick={() => {
                      setExpandedProjectIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(p.id)) next.delete(p.id);
                        else next.add(p.id);
                        return next;
                      });
                    }}
                    className="text-[18px] leading-none text-black/25 cursor-pointer w-5 flex-shrink-0"
                  >
                    {isExpanded ? "▾" : "▸"}
                  </button>
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
                  <button
                    onClick={() => openProject(p.id)}
                    className="text-[11px] text-[#2c2a35] truncate flex-1 text-left cursor-pointer hover:underline"
                  >
                    {p.name}
                  </button>
                </div>

                {/* Expanded task list */}
                {isExpanded && (
                  <div className="px-2 pb-2">
                    {pullableTasks.length === 0 && todayTasks.length === 0 && (
                      <p className="text-[10px] text-black/20 px-2 py-1">No open tasks</p>
                    )}
                    {pullableTasks.map((task) => (
                      <button
                        key={task.id}
                        onClick={() => pullTaskToDay(task.id)}
                        className="w-full flex items-center gap-1.5 px-2 py-1 rounded-md text-left cursor-pointer hover:bg-black/[0.05] transition-colors group"
                      >
                        <span className="text-[11px] text-[#2c2a35] flex-1 truncate">{task.title}</span>
                        {task.estimated_minutes != null && task.estimated_minutes > 0 && (
                          <span className="text-[9px] text-black/20">{task.estimated_minutes}m</span>
                        )}
                        <span className="text-[9px] text-[#7B9ED9] opacity-0 group-hover:opacity-100 transition-opacity">+</span>
                      </button>
                    ))}
                    {todayTasks.length > 0 && pullableTasks.length > 0 && (
                      <div className="h-px bg-black/[0.06] mx-2 my-1" />
                    )}
                    {todayTasks.map((task) => (
                      <div
                        key={task.id}
                        className="flex items-center gap-1.5 px-2 py-1 rounded-md"
                      >
                        <span className={`text-[11px] flex-1 truncate ${task.status === "done" ? "text-black/25 line-through" : "text-black/40"}`}>
                          {task.title}
                        </span>
                        <span className="text-[9px] text-black/15">today</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          });
        })()}

        {/* Spacer — push unfinished + unscheduled to bottom third */}
        <div className="flex-1 min-h-[40px]" />

        {/* Unfinished tasks section — tasks rolling over up to 4 days */}
        {(() => {
          const unfinished = unfinishedTasks;
          return (
          <div className="border-t border-black/[0.06]">
            <button
              onClick={() => setUnfinishedExpanded((v) => !v)}
              className="w-full flex items-center gap-1.5 px-3 py-2 hover:bg-black/[0.04] transition-colors"
            >
              <span className="text-[18px] leading-none text-black/25 w-5 flex-shrink-0">
                {unfinishedExpanded ? "▾" : "▸"}
              </span>
              <span className="text-[10px] text-black/[0.2] uppercase tracking-[0.08em] flex-1 text-left">
                Unfinished
              </span>
              {unfinished.length > 0 && (
                <span className="text-[9px] text-black/20 tabular-nums">{unfinished.length}</span>
              )}
            </button>
            {unfinishedExpanded && (
              <div className="px-2 pb-2">
                {unfinished.length === 0 ? (
                  <p className="text-[10px] text-black/20 px-2 py-1">All caught up</p>
                ) : (
                  unfinished.map((task) => (
                    <button
                      key={task.id}
                      onClick={() => setDetailTask(task)}
                      className="w-full flex items-center gap-1.5 px-2 py-1 rounded-md text-left cursor-pointer hover:bg-black/[0.05] transition-colors group"
                    >
                      <span className="text-[11px] text-black/40 group-hover:text-[#2c2a35] flex-1 truncate transition-colors">{task.title}</span>
                      <span className="text-[9px] text-[#c9923a]/70 tabular-nums">{task.rollover_count}d</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          );
        })()}

        {/* Unscheduled tasks section (includes orphan overdue tasks) */}
        {(() => {
          const orphanOverdue = sidebarOverdue.filter((t) => t.project_id === null);
          const unscheduledAll = [...sidebarUnscheduled, ...orphanOverdue];
          if (unscheduledAll.length === 0) return null;
          return (
          <div className="border-t border-black/[0.06]">
            <button
              onClick={() => setUnscheduledExpanded((v) => !v)}
              className="w-full flex items-center gap-1.5 px-3 py-2 hover:bg-black/[0.04] transition-colors"
            >
              <span className="text-[18px] leading-none text-black/25 w-5 flex-shrink-0">
                {unscheduledExpanded ? "▾" : "▸"}
              </span>
              <span className="text-[10px] text-black/[0.2] uppercase tracking-[0.08em] flex-1 text-left">
                Unscheduled
              </span>
            </button>
            {unscheduledExpanded && (
              <div className="px-2 pb-2">
                {unscheduledAll.map((task) => (
                  <button
                    key={task.id}
                    onClick={() => pullTaskToDay(task.id)}
                    className="w-full flex items-center gap-1.5 px-2 py-1 rounded-md text-left cursor-pointer hover:bg-black/[0.05] transition-colors group"
                  >
                    <span className="text-[11px] text-[#2c2a35] flex-1 truncate">{task.title}</span>
                    {task.estimated_minutes != null && task.estimated_minutes > 0 && (
                      <span className="text-[9px] text-black/20">{task.estimated_minutes}m</span>
                    )}
                    <span className="text-[9px] text-[#7B9ED9] opacity-0 group-hover:opacity-100 transition-opacity">+</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          );
        })()}
      </div>

      {/* Task detail overlay */}
      {detailTask && (
        <TaskDetailOverlay
          key={detailTask.id}
          task={detailTask}
          projects={projects}
          onClose={() => setDetailTask(null)}
          onSave={(updates) => handleDetailSave(updates)}
          onToggle={(t) => toggleTask(t).then(() => setDetailTask(null)).catch(() => {})}
          onDelete={(id) => { setConfirmDeleteId(id); setDetailTask(null); }}
          onStartFocus={(t) => { handleStartFocus(t); setDetailTask(null); }}
          workedMinutes={workedMap.get(detailTask.id) ?? 0}
          onSetWorkedMinutes={(id, mins) => setManualWorkedMinutes(id, mins).then(() => loadData()).catch(() => {})}
        />
      )}

      {/* Plan summary overlay */}
      {showSummary && (
        <SummaryOverlay
          type="plan"
          data={{
            date: selectedDate,
            tasks: tasks.map((t) => ({
              ...t,
              projectName: t.project_id ? projects.find((p) => p.id === t.project_id)?.name ?? null : null,
            })),
            totalPlannedMinutes: plannedMinutes,
            hourBudget: dailyPlan?.hour_budget ?? 8,
            notes: dailyPlan?.notes ?? null,
          } satisfies PlanSummaryData}
          onClose={() => setShowSummary(false)}
        />
      )}
    </div>
  );
}
