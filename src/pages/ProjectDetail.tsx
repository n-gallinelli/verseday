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
import { parseTimeFromTitle } from "../utils/format";
import type { Project, Task } from "../types";

const MAX_TITLE_LENGTH = 200;
const MAX_ESTIMATE_MINUTES = 480;
const MAX_NOTES_LENGTH = 5000;
const MAX_DESCRIPTION_LENGTH = 1000;


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

  const isHighPriority = task.priority === "high" || task.priority === "urgent";
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
            ? "bg-[#e0873e] border-[#e0873e]"
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
          {isHighPriority && (
            <>
              <span>·</span>
              <span className="w-1.5 h-1.5 rounded-full inline-block bg-[#d95f5f]" />
              <span>High</span>
            </>
          )}
        </div>
      </div>

      {/* Actions (visible on hover) */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        {task.status !== "done" && (
          <button
            onClick={() => onStart(task)}
            className="text-[11px] text-[#e0873e] border border-[#e0873e]/20 bg-[#e0873e]/[0.06] px-1.5 py-0.5 rounded-[5px] cursor-pointer hover:bg-[#e0873e]/[0.12]"
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

function ProjectSwitcher({
  activeProjectId,
  onSelectProject,
  onError,
}: {
  activeProjectId: number | null;
  onSelectProject: (id: number) => void;
  onError: (msg: string) => void;
}) {
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const p = await getProjects(true);
        setAllProjects(p);
      } catch (e) {
        onError(e instanceof Error ? e.message : "Failed to load projects");
      }
    })();
  }, [activeProjectId]);

  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [activeProjectId, allProjects]);

  const active = allProjects.filter((p) => !p.archived);
  const archived = allProjects.filter((p) => p.archived);

  return (
    <div className="w-[168px] flex-shrink-0 flex flex-col overflow-hidden bg-[#f5f4f0]">
      {/* Header */}
      <div className="flex items-center justify-between px-[14px] pt-4 pb-2.5 flex-shrink-0">
        <span className="text-[10px] uppercase tracking-widest text-black/30">
          Projects
        </span>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {active.map((p) => {
          const isActive = p.id === activeProjectId;
          return (
            <button
              key={p.id}
              ref={isActive ? activeRef : null}
              onClick={() => onSelectProject(p.id)}
              className={`w-full flex items-center gap-2 px-2 py-[7px] rounded-[7px] cursor-pointer mb-[1px] text-left ${
                isActive
                  ? "bg-white border border-black/[0.08]"
                  : "hover:bg-black/[0.04] border border-transparent"
              }`}
            >
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: p.color }}
              />
              <span
                className={`text-[13px] truncate ${
                  isActive
                    ? "text-[#2c2a35] font-medium"
                    : "text-black/50"
                }`}
              >
                {p.name}
              </span>
            </button>
          );
        })}

        {/* Archived section */}
        {archived.length > 0 && (
          <>
            <div className="h-px bg-black/[0.07] mx-2 my-2" />
            {archived.map((p) => {
              const isActive = p.id === activeProjectId;
              return (
                <button
                  key={p.id}
                  ref={isActive ? activeRef : null}
                  onClick={() => onSelectProject(p.id)}
                  className={`w-full flex items-center gap-2 px-2 py-[7px] rounded-[7px] cursor-pointer mb-[1px] text-left ${
                    isActive
                      ? "bg-white border border-black/[0.08]"
                      : "hover:bg-black/[0.04] border border-transparent"
                  }`}
                >
                  <div className="w-2 h-2 rounded-full bg-black/20 flex-shrink-0" />
                  <span className="text-[13px] text-black/30 italic truncate">
                    {p.name}
                  </span>
                </button>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export default function ProjectDetail() {
  const { selectedProjectId, openProject, startFocus } = useAppStore();
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  // Inline project fields (auto-saved)
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editStartDate, setEditStartDate] = useState("");
  const [editTargetDate, setEditTargetDate] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const projectSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Notes editing
  const [notesEditing, setNotesEditing] = useState(false);
  const notesTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

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
      // Populate inline fields
      if (p) {
        setEditName(p.name);
        setEditColor(p.color);
        setEditDescription(p.description ?? "");
        setEditStartDate(p.start_date ?? "");
        setEditTargetDate(p.target_date ?? "");
        setEditNotes(p.notes ?? "");
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
      loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add task");
    }
  }

  async function toggleTask(task: Task) {
    try {
      await updateTaskStatus(task.id, task.status === "done" ? "todo" : "done");
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
      loadData();
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
    loadData();
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
      loadData();
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
        <ProjectSwitcher
          activeProjectId={selectedProjectId}
          onSelectProject={openProject}
          onError={setError}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* ── Project content panel ──────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden border-r border-black/[0.07]">
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
        <div className="px-[22px] py-4 border-b border-black/[0.07] flex-shrink-0 space-y-3">
          {/* Title row + color + archive */}
          <div className="flex items-center gap-2.5">
            {/* Color picker */}
            <div className="relative group">
              <div
                className="w-[9px] h-[9px] rounded-full flex-shrink-0 cursor-pointer"
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

            {/* Editable name */}
            <input
              type="text"
              value={editName}
              onChange={(e) => updateField("name", e.target.value)}
              maxLength={MAX_TITLE_LENGTH}
              className="flex-1 text-[19px] font-medium text-[#2c2a35] bg-transparent border-none outline-none focus:bg-white focus:border focus:border-[#e0873e]/20 focus:rounded-md focus:px-2 focus:-mx-2"
            />

            {/* Complete button */}
            <button
              onClick={handleCompleteToggle}
              className={`text-[12px] cursor-pointer px-2.5 py-1 rounded-md border ${
                project.completed
                  ? "bg-[#3a9e6e]/10 border-[#3a9e6e]/25 text-[#3a9e6e]"
                  : "border-black/[0.1] bg-white text-black/30 hover:bg-black/[0.03]"
              }`}
            >
              {project.completed ? "✓ Completed" : "Mark Complete"}
            </button>
          </div>


          {/* Description — compact */}
          <div className="bg-white border border-black/[0.08] rounded-lg px-3 py-2">
            <label className="text-[9px] uppercase tracking-widest text-black/25 mb-0.5 block">Description</label>
            <textarea
              value={editDescription}
              onChange={(e) => updateField("description", e.target.value)}
              maxLength={MAX_DESCRIPTION_LENGTH}
              placeholder="Brief description..."
              rows={1}
              className="w-full bg-transparent border-none rounded-md px-0 py-0 text-[11px] text-black/45 placeholder-black/20 resize-none focus:outline-none"
            />
          </div>

          {/* Date range — Start → Due */}
          <div className="bg-white border border-black/[0.08] rounded-lg p-3">
            <label className="text-[10px] uppercase tracking-widest text-black/30 mb-1.5 block">Dates</label>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-black/30">Start</span>
                <input
                  type="date"
                  value={editStartDate}
                  onChange={(e) => updateField("startDate", e.target.value)}
                  className="bg-black/[0.03] border border-black/[0.06] rounded-md px-2 py-1 text-[11px] text-black/45 focus:outline-none focus:border-[#e0873e]/30 cursor-pointer"
                />
              </div>
              <span className="text-[11px] text-black/20">&rarr;</span>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-black/30">Due</span>
                <input
                  type="date"
                  value={editTargetDate}
                  onChange={(e) => updateField("targetDate", e.target.value)}
                  className="bg-black/[0.03] border border-black/[0.06] rounded-md px-2 py-1 text-[11px] text-black/45 focus:outline-none focus:border-[#e0873e]/30 cursor-pointer"
                />
              </div>
              {(editStartDate || editTargetDate) && (
                <span className="text-[11px] text-black/35 ml-1">
                  {editStartDate
                    ? new Date(editStartDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })
                    : "?"}
                  {" \u2192 "}
                  {editTargetDate
                    ? new Date(editTargetDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })
                    : "?"}
                </span>
              )}
            </div>
          </div>

          {/* Notes — prominent section */}
          <div className="bg-white border border-black/[0.08] rounded-lg p-4">
            <label className="text-[10px] uppercase tracking-widest text-black/30 mb-1.5 block">Notes</label>
            {notesEditing ? (
              <textarea
                ref={notesTextareaRef}
                value={editNotes}
                onChange={(e) => updateField("notes", e.target.value)}
                onBlur={() => setNotesEditing(false)}
                maxLength={MAX_NOTES_LENGTH}
                placeholder="Add notes, links, references..."
                rows={5}
                className="w-full bg-transparent border-none rounded-md px-0 py-0.5 text-[13px] text-black/55 placeholder-black/20 resize-none focus:outline-none leading-relaxed"
              />
            ) : (
              <div
                onClick={() => {
                  setNotesEditing(true);
                  requestAnimationFrame(() => notesTextareaRef.current?.focus());
                }}
                className="w-full min-h-[72px] bg-transparent rounded-md px-0 py-0.5 text-[13px] text-black/55 cursor-text whitespace-pre-wrap break-words leading-relaxed"
              >
                {editNotes ? (
                  editNotes.split(/(https?:\/\/[^\s]+)/g).map((segment, i) =>
                    /^https?:\/\//.test(segment) ? (
                      <a
                        key={i}
                        href={segment}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-[#e0873e] hover:underline"
                        title={segment}
                      >
                        {(() => {
                          try {
                            const host = new URL(segment).hostname.replace(/^www\./, "");
                            return host.length > 20 ? host.slice(0, 18) + "..." : host;
                          } catch {
                            return "link";
                          }
                        })()}
                      </a>
                    ) : (
                      <span key={i}>{segment}</span>
                    )
                  )
                ) : (
                  <span className="text-black/20">Add notes...</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Task input row */}
        <form
          onSubmit={handleAddTask}
          className="flex items-center gap-2 px-[22px] py-[9px] border-b border-black/[0.06] flex-shrink-0 bg-white"
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
            className="flex-1 bg-transparent border-none outline-none text-[13px] text-[#2c2a35] placeholder-black/25 font-sans"
          />
          {/* Date pill */}
          <label className="flex items-center gap-1.5 bg-black/[0.04] border border-black/[0.08] rounded-md px-2 py-1 text-[11px] text-black/40 cursor-pointer">
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            >
              <rect x="1" y="2" width="8" height="7" rx="1" />
              <line x1="3" y1="1" x2="3" y2="3" />
              <line x1="7" y1="1" x2="7" y2="3" />
            </svg>
            <span>{newTaskDate ? new Date(newTaskDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "No date"}</span>
            <input
              type="date"
              value={newTaskDate}
              onChange={(e) => setNewTaskDate(e.target.value)}
              className="sr-only"
            />
          </label>
          {/* Priority toggle */}
          <button
            type="button"
            onClick={() => setNewTaskHighPriority(!newTaskHighPriority)}
            className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] cursor-pointer transition-colors ${
              newTaskHighPriority
                ? "bg-[#d95f5f]/10 border border-[#d95f5f]/25 text-[#d95f5f]"
                : "bg-black/[0.04] border border-black/[0.08] text-black/40 hover:bg-black/[0.07]"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                newTaskHighPriority ? "bg-[#d95f5f]" : "bg-black/20"
              }`}
            />
            High
          </button>
          <button
            type="submit"
            className="bg-[#e0873e] text-white border-none rounded-lg px-3.5 py-1.5 text-[12px] font-medium cursor-pointer hover:bg-[#cc7633]"
          >
            Add
          </button>
        </form>

        {/* Task list header */}
        <div className="flex items-center justify-between px-[22px] py-[9px] flex-shrink-0">
          <span className="text-[10px] uppercase tracking-widest text-black/30">
            Tasks
          </span>
          <button
            onClick={() => setShowDone(!showDone)}
            className={`flex items-center gap-1.5 text-[11px] cursor-pointer px-2 py-1 rounded-full border bg-white hover:bg-black/[0.03] ${
              showDone
                ? "text-[#e0873e] border-[#e0873e]/20"
                : "text-black/35 border-black/[0.08]"
            }`}
          >
            {showDone ? "Hide completed" : "Show completed"}
          </button>
        </div>

        {/* Task list */}
        <div className="flex-1 overflow-y-auto px-[22px] pb-4">
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
                            className="flex-1 px-2.5 py-1.5 rounded-md bg-black/[0.03] border border-black/[0.08] text-[13px] text-[#2c2a35] focus:outline-none focus:border-[#e0873e]/40"
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
                            className="w-20 px-2.5 py-1.5 rounded-md bg-black/[0.03] border border-black/[0.08] text-[13px] text-[#2c2a35] placeholder-black/25 focus:outline-none focus:border-[#e0873e]/40"
                          />
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="date"
                            value={taskEditDate}
                            onChange={(e) => setTaskEditDate(e.target.value)}
                            className="px-2.5 py-1.5 rounded-md bg-black/[0.03] border border-black/[0.08] text-[12px] text-black/50 focus:outline-none focus:border-[#e0873e]/40"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setTaskEditPriority(
                                taskEditPriority === "high" ? "medium" : "high"
                              )
                            }
                            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] cursor-pointer border ${
                              taskEditPriority === "high"
                                ? "bg-[#d95f5f]/10 border-[#d95f5f]/25 text-[#d95f5f]"
                                : "bg-transparent border-black/[0.08] text-black/45"
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                taskEditPriority === "high"
                                  ? "bg-[#d95f5f]"
                                  : "bg-black/20"
                              }`}
                            />
                            High
                          </button>
                        </div>
                        <textarea
                          value={taskEditNotes}
                          onChange={(e) => setTaskEditNotes(e.target.value)}
                          maxLength={MAX_NOTES_LENGTH}
                          placeholder="Notes..."
                          rows={3}
                          className="w-full px-2.5 py-2 rounded-md bg-black/[0.03] border border-black/[0.08] text-[12px] text-black/55 placeholder-black/25 focus:outline-none focus:border-[#e0873e]/40 resize-none"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={saveTaskEdit}
                            className="bg-[#e0873e] text-white rounded-md px-3 py-1.5 text-[12px] cursor-pointer hover:bg-[#cc7633]"
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
                          className="bg-[#d95f5f] text-white rounded-md px-3 py-1 text-[11px] cursor-pointer"
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
      </div>

      {/* ── Project switcher panel ────────────────────────────────────── */}
      <ProjectSwitcher
        activeProjectId={selectedProjectId}
        onSelectProject={openProject}
        onError={setError}
      />

      {/* Task detail overlay */}
      {detailTask && (
        <TaskDetailOverlay
          task={detailTask}
          projects={projects}
          onClose={() => { setDetailTask(null); loadData(); }}
          onSave={(updates) => updateTask(updates).then(() => loadData()).catch(() => {})}
          onToggle={(t) => { toggleTask(t); setDetailTask(null); }}
          onDelete={(id) => { handleDeleteTask(id); setDetailTask(null); }}
          onStartFocus={(t) => { handleStartFocus(t); setDetailTask(null); }}
        />
      )}
    </div>
  );
}
