import { useEffect, useState, useRef, useCallback } from "react";
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
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAppStore } from "../stores/appStore";
import {
  getProjectById,
  getProjects,
  getTasksForProject,
  updateProject,
  createTask,
  updateTask,
  updateTaskStatus,
  updateTaskSortOrders,
  deleteTask,
  startTimeEntry,
  completeProject,
  getWorkedMinutesForTask,
  PRESET_COLORS,
} from "../db/queries";
import ErrorBanner from "../components/ErrorBanner";
import CheckIcon from "../components/CheckIcon";
import TaskDetailOverlay from "../components/TaskDetailOverlay";
import CalendarPicker from "../components/CalendarPicker";
import { parseTimeFromTitle } from "../utils/format";
import RichTextEditor from "../components/RichTextEditor";
import type { Project, Task } from "../types";

const MAX_TITLE_LENGTH = 200;
const MAX_ESTIMATE_MINUTES = 480;

// ─── Sortable task row ──────────────────────────────────────────────────────

function SortableTaskRow({
  task,
  onToggle,
  onOpenDetail,
  onDelete,
  onStart,
}: {
  task: Task;
  onToggle: (task: Task) => void;
  onOpenDetail: (task: Task) => void;
  onDelete: (id: number) => void;
  onStart: (task: Task) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const dateLabel = task.date_scheduled
    ? new Date(task.date_scheduled + "T00:00:00").toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
    : null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2.5 px-[11px] py-2 bg-white border border-black/[0.07] rounded-lg mb-[5px] cursor-pointer hover:border-black/[0.11] group"
    >
      {/* Drag handle */}
      <span
        {...attributes}
        {...listeners}
        className="text-[12px] text-black/15 cursor-grab active:cursor-grabbing select-none"
      >
        ⠿
      </span>

      {/* Checkbox */}
      <button
        onClick={() => onToggle(task)}
        className={`w-[14px] h-[14px] rounded-[4px] border flex-shrink-0 cursor-pointer flex items-center justify-center ${
          task.status === "done"
            ? "bg-[#6A9E7F] border-[#6A9E7F]"
            : "border-black/[0.18]"
        }`}
      >
        {task.status === "done" && <CheckIcon />}
      </button>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <button
          onClick={() => onOpenDetail(task)}
          className={`text-[13px] truncate text-left cursor-pointer hover:underline block w-full ${
            task.status === "done"
              ? "text-black/30 line-through"
              : "text-[#2c2a35]"
          }`}
        >
          {task.title}
        </button>
        <div className="text-[11px] text-black/30 mt-0.5 flex items-center gap-1.5">
          {dateLabel ? (
            <span>{dateLabel}</span>
          ) : (
            <span className="italic">Unscheduled</span>
          )}
          {task.estimated_minutes != null && task.estimated_minutes > 0 && (
            <>
              <span>·</span>
              <span>{task.estimated_minutes}m</span>
            </>
          )}
        </div>
      </div>

      {/* Actions (visible on hover) */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        {task.status !== "done" && (
          <button
            onClick={() => onStart(task)}
            className="text-[11px] text-[#6B84A3] border border-[#6B84A3]/20 bg-[#6B84A3]/[0.06] px-1.5 py-0.5 rounded-[5px] cursor-pointer hover:bg-[#6B84A3]/[0.12]"
          >
            Start
          </button>
        )}
        <button
          onClick={() => onDelete(task.id)}
          className="text-[11px] text-black/35 px-1.5 py-0.5 rounded-[5px] cursor-pointer border border-transparent hover:text-[#c0392b] hover:bg-[#c0392b]/[0.06] hover:border-[#c0392b]/[0.15]"
        >
          Del
        </button>
      </div>
    </div>
  );
}

// ─── Project switcher panel ─────────────────────────────────────────────────
// ─── Main component ─────────────────────────────────────────────────────────

export default function ProjectDetail() {
  const { selectedProjectId, openProject, startFocus, goBack } = useAppStore();
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(true);

  // Inline project fields (auto-saved)
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editStartDate, setEditStartDate] = useState("");
  const [editTargetDate, setEditTargetDate] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const projectSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  // Task creation
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskEstimate, setNewTaskEstimate] = useState("");
  const [newTaskHighPriority, setNewTaskHighPriority] = useState(false);
  const [newTaskDate, setNewTaskDate] = useState("");

  // Task editing
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const [taskEditTitle, setTaskEditTitle] = useState("");
  const [taskEditEstimate, setTaskEditEstimate] = useState("");
  const [taskEditPriority, setTaskEditPriority] = useState("medium");
  const [taskEditNotes, setTaskEditNotes] = useState("");
  const [taskEditDate, setTaskEditDate] = useState("");

  // Task detail overlay
  const [detailTask, setDetailTask] = useState<Task | null>(null);

  // UI state
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    task: Task;
    timeoutId: ReturnType<typeof setTimeout>;
  } | null>(null);


  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // Refresh task list only — safe to call during edits
  const refreshTasks = useCallback(async () => {
    if (!selectedProjectId) return;
    try {
      const [t, allP] = await Promise.all([
        getTasksForProject(selectedProjectId, showDone),
        getProjects(),
      ]);
      setTasks(t);
      setProjects(allP.filter((pr) => !pr.archived));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tasks");
    }
  }, [selectedProjectId, showDone]);

  // Full load — resets edit fields (only on mount / project switch)
  const loadData = useCallback(async () => {
    if (!selectedProjectId) return;
    try {
      const [p, t, allP] = await Promise.all([
        getProjectById(selectedProjectId),
        getTasksForProject(selectedProjectId, showDone),
        getProjects(),
      ]);
      setProject(p);
      setTasks(t);
      setProjects(allP.filter((pr) => !pr.archived));
      if (p) {
        setEditName(p.name);
        setEditColor(p.color);
        setEditDescription(p.description ?? "");
        setEditStartDate(p.start_date ?? "");
        setEditTargetDate(p.target_date ?? "");
        const mergedNotes = p.notes
          ? p.notes
          : p.description
            ? p.description
            : "";
        setEditNotes(mergedNotes);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load project");
    }
  }, [selectedProjectId, showDone]);

  useEffect(() => {
    // Finalize any pending delete when switching projects
    if (pendingDelete) {
      clearTimeout(pendingDelete.timeoutId);
      deleteTask(pendingDelete.task.id).catch(() => {});
      setPendingDelete(null);
    }
    loadData();
    setEditingTaskId(null);
    setConfirmDeleteId(null);
  }, [loadData]);

  // ── Project auto-save (debounced) ─────────────────────────────────────

  function debouncedSaveProject(
    name: string,
    color: string,
    description: string,
    startDate: string,
    targetDate: string,
    notes: string
  ) {
    if (projectSaveRef.current) clearTimeout(projectSaveRef.current);
    projectSaveRef.current = setTimeout(async () => {
      if (!project) return;
      const trimmedName = name.trim();
      if (!trimmedName) return;
      try {
        await updateProject({
          id: project.id,
          name: trimmedName,
          color,
          description: description.trim() || null,
          startDate: startDate || null,
          targetDate: targetDate || null,
          notes: notes.trim() || null,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save project");
      }
    }, 600);
  }

  useEffect(() => {
    return () => {
      if (projectSaveRef.current) clearTimeout(projectSaveRef.current);
    };
  }, []);

  // Auto-grow project title textarea whenever the name (or its derived
  // font size) changes — covers async loads and project switches.
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [editName]);

  // Flush pending saves immediately (for modal close)
  function flushProjectSave() {
    if (projectSaveRef.current && project) {
      clearTimeout(projectSaveRef.current);
      projectSaveRef.current = null;
      const trimmedName = editName.trim();
      if (trimmedName) {
        updateProject({
          id: project.id,
          name: trimmedName,
          color: editColor,
          description: editDescription.trim() || null,
          startDate: editStartDate || null,
          targetDate: editTargetDate || null,
          notes: editNotes.trim() || null,
        }).catch(() => {});
      }
    }
  }

  function handleClose() {
    flushProjectSave();
    goBack();
  }

  function updateField(
    field: "name" | "color" | "description" | "startDate" | "targetDate" | "notes",
    value: string
  ) {
    const next = {
      name: editName,
      color: editColor,
      description: editDescription,
      startDate: editStartDate,
      targetDate: editTargetDate,
      notes: editNotes,
      [field]: value,
    };
    if (field === "name") setEditName(value);
    else if (field === "color") setEditColor(value);
    else if (field === "description") setEditDescription(value);
    else if (field === "startDate") setEditStartDate(value);
    else if (field === "targetDate") setEditTargetDate(value);
    else if (field === "notes") setEditNotes(value);

    debouncedSaveProject(
      next.name,
      next.color,
      next.description,
      next.startDate,
      next.targetDate,
      next.notes
    );
  }

  // ── Project completion ───────────────────────────────────────────────

  async function handleCompleteToggle() {
    if (!project) return;
    try {
      await completeProject(project.id, !project.completed);
      loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update project");
    }
  }

  // ── Task CRUD ─────────────────────────────────────────────────────────

  async function handleAddTask(e: React.FormEvent) {
    e.preventDefault();
    let title = newTaskTitle.trim();
    if (!title) return;
    if (title.length > MAX_TITLE_LENGTH) {
      setError(`Title must be ${MAX_TITLE_LENGTH} characters or less`);
      return;
    }
    let est: number | null = null;
    if (newTaskEstimate) {
      est = parseInt(newTaskEstimate);
      if (isNaN(est) || est < 1 || est > MAX_ESTIMATE_MINUTES) {
        setError(`Estimate must be 1–${MAX_ESTIMATE_MINUTES} minutes`);
        return;
      }
    }
    // Smart time parsing from title if no manual estimate
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
        projectId: selectedProjectId,
        dateScheduled: newTaskDate || null,
        estimatedMinutes: est,
        priority: newTaskHighPriority ? "high" : "medium",
      });
      setNewTaskTitle("");
      setNewTaskEstimate("");
      setNewTaskHighPriority(false);
      setNewTaskDate("");
      setError(null);
      refreshTasks();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add task");
    }
  }

  async function toggleTask(task: Task) {
    try {
      await updateTaskStatus(task.id, task.status === "done" ? "todo" : "done");
      refreshTasks();
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
      const priorMinutes = await getWorkedMinutesForTask(task.id);
      const priorMs = priorMinutes * 60 * 1000;
      const entryId = await startTimeEntry(task.id, "tracked");
      startFocus(task, entryId, "project_detail", priorMs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start timer");
    }
  }

  function startEditTask(task: Task) {
    setEditingTaskId(task.id);
    setTaskEditTitle(task.title);
    setTaskEditEstimate(task.estimated_minutes?.toString() ?? "");
    setTaskEditPriority(task.priority);
    setTaskEditNotes(task.notes ?? "");
    setTaskEditDate(task.date_scheduled ?? "");
  }

  function handleTaskEditKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") setEditingTaskId(null);
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      saveTaskEdit();
    }
  }

  async function saveTaskEdit() {
    if (editingTaskId === null) return;
    const title = taskEditTitle.trim();
    if (!title || title.length > MAX_TITLE_LENGTH) {
      setError(`Title must be 1–${MAX_TITLE_LENGTH} characters`);
      return;
    }
    let est: number | null = null;
    if (taskEditEstimate) {
      est = parseInt(taskEditEstimate);
      if (isNaN(est) || est < 1 || est > MAX_ESTIMATE_MINUTES) {
        setError(`Estimate must be 1–${MAX_ESTIMATE_MINUTES} minutes`);
        return;
      }
    }
    try {
      await updateTask({
        id: editingTaskId,
        title,
        projectId: selectedProjectId,
        estimatedMinutes: est,
        priority: taskEditPriority,
        notes: taskEditNotes.trim() || null,
        dateScheduled: taskEditDate || null,
      });
      setEditingTaskId(null);
      setError(null);
      refreshTasks();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update task");
    }
  }

  function handleDeleteTask(id: number) {
    // Remove from UI immediately, defer actual delete for undo window
    const taskToDelete = tasks.find((t) => t.id === id);
    if (!taskToDelete) return;

    // Cancel any existing pending delete
    if (pendingDelete) {
      clearTimeout(pendingDelete.timeoutId);
      // Finalize the previous pending delete
      deleteTask(pendingDelete.task.id).catch(() => {});
    }

    setConfirmDeleteId(null);
    setTasks((prev) => prev.filter((t) => t.id !== id));

    const timeoutId = setTimeout(async () => {
      try {
        await deleteTask(id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to delete task");
      }
      setPendingDelete(null);
    }, 5000);

    setPendingDelete({ task: taskToDelete, timeoutId });
  }

  async function undoDelete() {
    if (!pendingDelete) return;
    clearTimeout(pendingDelete.timeoutId);
    setPendingDelete(null);
    // Re-insert the task by reloading
    refreshTasks();
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
      setError(e instanceof Error ? e.message : "Failed to reorder");
      refreshTasks();
    }
  }

  // ── Derived stats ─────────────────────────────────────────────────────

  const totalTasks = tasks.length;
  const doneTasks = tasks.filter((t) => t.status === "done").length;
  const totalEstimatedMinutes = tasks.reduce(
    (sum, t) => sum + (t.estimated_minutes ?? 0),
    0
  );
  const estimatedHours = (Math.round(totalEstimatedMinutes / 6) / 10)
    .toFixed(1)
    .replace(/\.0$/, "");
  const progressPercent =
    totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  // ── Render ────────────────────────────────────────────────────────────

  if (!project) {
    return (
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 flex items-center justify-center text-black/30 text-[14px]">
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 overflow-hidden flex-col h-full">
        <ErrorBanner error={error} onDismiss={() => setError(null)} />

        {/* Undo delete banner */}
        {pendingDelete && (
          <div className="flex items-center gap-3 px-[22px] py-2 bg-[#2c2a35] text-white text-[12px] flex-shrink-0">
            <span className="flex-1">
              Deleted &ldquo;{pendingDelete.task.title}&rdquo;
            </span>
            <button
              onClick={undoDelete}
              className="text-[#f0b070] font-medium cursor-pointer hover:text-white"
            >
              Undo
            </button>
          </div>
        )}

        {/* Project header — always inline editable */}
        <div className="px-[22px] pt-5 flex-shrink-0">
          {/* Title row + color + archive */}
          <div className="flex items-center gap-2.5">
            {/* Color picker */}
            <div className="relative group">
              <div
                className="w-[12px] h-[12px] rounded-full flex-shrink-0 cursor-pointer ring-2 ring-transparent hover:ring-black/10 transition-all"
                style={{ backgroundColor: editColor }}
              />
              <div className="absolute top-full left-0 mt-1 z-20 bg-white border border-black/[0.1] rounded-lg shadow-lg p-2 hidden group-hover:flex gap-1.5 flex-wrap w-[120px]">
                {PRESET_COLORS.slice(0, 8).map((c) => (
                  <button
                    key={c}
                    onClick={() => updateField("color", c)}
                    className="w-4 h-4 rounded-full cursor-pointer border"
                    style={{
                      backgroundColor: c,
                      borderColor: editColor === c ? "#2c2a35" : "transparent",
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Editable name — wraps freely; font shrinks as the name gets longer */}
            <textarea
              ref={titleRef}
              value={editName}
              onChange={(e) => updateField("name", e.target.value.replace(/\n/g, ""))}
              maxLength={MAX_TITLE_LENGTH}
              rows={1}
              className="flex-1 font-medium text-[#2c2a35] bg-transparent border-none outline-none resize-none leading-snug overflow-hidden focus:bg-white focus:border focus:border-[#7B9ED9]/30 focus:rounded-md focus:px-2 focus:-mx-2"
              style={{
                fontSize:
                  editName.length <= 40
                    ? 16
                    : editName.length <= 80
                      ? 14
                      : 13,
              }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = el.scrollHeight + "px";
              }}
            />

            {/* Complete button */}
            <button
              onClick={handleCompleteToggle}
              className={`text-[12px] cursor-pointer px-2.5 py-1 rounded-md border ${
                project.completed
                  ? "bg-[#6A9E7F] border-[#6A9E7F] text-white"
                  : "bg-[#6B84A3] border-[#6B84A3] text-white hover:bg-[#5A7390]"
              }`}
            >
              {project.completed ? "✓ Completed" : "Mark Complete"}
            </button>
            <button
              onClick={handleClose}
              className="text-black/25 hover:text-black/50 cursor-pointer text-[16px] flex-shrink-0 ml-1"
              title="Close"
            >
              ✕
            </button>
          </div>


          {/* Date range — Start → Due */}
          <div className="border-b border-black/[0.06] pt-5 pb-5">
            <label className="uppercase text-black/30 mb-2 block [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)]">Dates</label>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <span className="text-[12px] text-black/35">Start</span>
                <CalendarPicker
                  value={editStartDate}
                  onChange={(date) => updateField("startDate", date)}
                  onClear={() => updateField("startDate", "")}
                  placeholder="No start"
                />
              </div>
              <span className="text-[11px] text-black/20">&rarr;</span>
              <div className="flex items-center gap-1.5">
                <span className="text-[12px] text-black/35">Due</span>
                <CalendarPicker
                  value={editTargetDate}
                  onChange={(date) => updateField("targetDate", date)}
                  onClear={() => updateField("targetDate", "")}
                  placeholder="No due"
                />
              </div>
            </div>
          </div>

          {/* Notes — rich text editor (placeholder doubles as label) */}
          <div className="pt-5 pb-6 border-b border-black/[0.06]">
            <RichTextEditor
              value={editNotes}
              onChange={(html) => updateField("notes", html)}
              placeholder="Notes"
              className="text-[13px] text-black/55 leading-relaxed"
            />
          </div>
        </div>

        {/* Task input row */}
        <form
          onSubmit={handleAddTask}
          className="flex items-center gap-2 mx-[22px] my-3 px-3 py-[10px] border border-black/[0.06] rounded-lg bg-transparent flex-shrink-0"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="rgba(0,0,0,0.2)"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <line x1="7" y1="3" x2="7" y2="11" />
            <line x1="3" y1="7" x2="11" y2="7" />
          </svg>
          <input
            type="text"
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.target.value)}
            maxLength={MAX_TITLE_LENGTH}
            placeholder="Add a task to this project..."
            className="flex-1 bg-transparent border-none outline-none text-[13px] text-[#2c2a35] placeholder-black/25"
          />
          {/* Date picker */}
          <CalendarPicker
            value={newTaskDate}
            onChange={(date) => setNewTaskDate(date)}
            onClear={() => setNewTaskDate("")}
          />
          <button
            type="submit"
            className="bg-[#6B84A3] text-white border-none rounded-lg px-3.5 py-1.5 text-[12px] font-medium cursor-pointer hover:bg-[#5A7390]"
          >
            Add
          </button>
        </form>

        {/* Task list header */}
        <div className="flex items-center justify-between px-[22px] py-3 flex-shrink-0">
          <span className="uppercase text-black/30 [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)]">
            Tasks
          </span>
          <button
            onClick={() => setShowDone(!showDone)}
            className={`flex items-center gap-1.5 text-[11px] cursor-pointer px-2 py-1 rounded-full border bg-white hover:bg-black/[0.03] ${
              showDone
                ? "text-[#6B84A3] border-[#6B84A3]/20"
                : "text-black/35 border-black/[0.08]"
            }`}
          >
            {showDone ? "Hide completed" : "Show completed"}
          </button>
        </div>

        {/* Task list — scrollable region */}
        <div className="overflow-y-auto px-[22px] pb-4" style={{ maxHeight: "30vh" }}>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={tasks.map((t) => t.id)}
              strategy={verticalListSortingStrategy}
            >
              {tasks.length === 0 ? (
                <p className="text-center text-black/25 py-8 text-[13px]">
                  No tasks yet. Add one above.
                </p>
              ) : (
                tasks.map((task) => {
                  if (editingTaskId === task.id) {
                    return (
                      <div
                        key={task.id}
                        className="p-3 rounded-lg bg-white border border-black/[0.08] space-y-2 mb-[5px]"
                        onKeyDown={handleTaskEditKeyDown}
                      >
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={taskEditTitle}
                            onChange={(e) => setTaskEditTitle(e.target.value)}
                            maxLength={MAX_TITLE_LENGTH}
                            autoFocus
                            className="flex-1 px-2.5 py-1.5 rounded-md bg-black/[0.03] border border-black/[0.08] text-[13px] text-[#2c2a35] focus:outline-none focus:border-[#7B9ED9]/30"
                          />
                          <input
                            type="number"
                            value={taskEditEstimate}
                            onChange={(e) =>
                              setTaskEditEstimate(e.target.value)
                            }
                            min={1}
                            max={MAX_ESTIMATE_MINUTES}
                            placeholder="min"
                            className="w-20 px-2.5 py-1.5 rounded-md bg-black/[0.03] border border-black/[0.08] text-[13px] text-[#2c2a35] placeholder-black/25 focus:outline-none focus:border-[#7B9ED9]/30"
                          />
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="date"
                            value={taskEditDate}
                            onChange={(e) => setTaskEditDate(e.target.value)}
                            className="px-2.5 py-1.5 rounded-md bg-black/[0.03] border border-black/[0.08] text-[12px] text-black/50 focus:outline-none focus:border-[#7B9ED9]/30"
                          />
                        </div>
                        <RichTextEditor
                          value={taskEditNotes}
                          onChange={(html) => setTaskEditNotes(html)}
                          placeholder="Notes..."
                          className="w-full px-2.5 py-2 rounded-md bg-black/[0.03] border border-black/[0.08] text-[12px] text-black/55 min-h-[60px] focus-within:border-[#7B9ED9]/30"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={saveTaskEdit}
                            className="bg-[#6B84A3] text-white rounded-md px-3 py-1.5 text-[12px] cursor-pointer hover:bg-[#5A7390]"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingTaskId(null)}
                            className="bg-black/[0.05] text-black/45 rounded-md px-3 py-1.5 text-[12px] cursor-pointer hover:bg-black/[0.07]"
                          >
                            Cancel
                          </button>
                          <span className="text-[10px] text-black/20 self-center ml-auto">
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
                        className="p-3 rounded-lg bg-white border border-black/[0.08] flex items-center gap-3 mb-[5px]"
                      >
                        <span className="flex-1 text-[12px] text-[#c9923a]">
                          Delete &ldquo;{task.title}&rdquo;? Time entries will
                          also be deleted.
                        </span>
                        <button
                          onClick={() => handleDeleteTask(task.id)}
                          className="bg-[#C0614A] text-white rounded-md px-3 py-1 text-[11px] cursor-pointer"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="text-black/35 text-[11px] cursor-pointer hover:text-black/50"
                        >
                          Cancel
                        </button>
                      </div>
                    );
                  }

                  return (
                    <SortableTaskRow
                      key={task.id}
                      task={task}
                      onToggle={toggleTask}
                      onOpenDetail={setDetailTask}
                      onDelete={(id) => setConfirmDeleteId(id)}
                      onStart={handleStartFocus}
                    />
                  );
                })
              )}
            </SortableContext>
          </DndContext>
        </div>

      {/* Task detail overlay */}
      {detailTask && (
        <TaskDetailOverlay
          key={detailTask.id}
          task={detailTask}
          projects={projects}
          onClose={() => { setDetailTask(null); refreshTasks(); }}
          onSave={(updates) => updateTask(updates).then(() => refreshTasks()).catch(() => {})}
          onToggle={(t) => { toggleTask(t); setDetailTask(null); }}
          onDelete={(id) => { handleDeleteTask(id); setDetailTask(null); }}
          onStartFocus={(t) => { handleStartFocus(t); setDetailTask(null); }}
        />
      )}
    </div>
  );
}
