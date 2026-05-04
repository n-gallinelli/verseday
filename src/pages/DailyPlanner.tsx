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
  stopTimeEntry,
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
import ProjectPicker from "../components/ProjectPicker";
import DisclosureCaret from "../components/DisclosureCaret";
import { formatHoursMinutes, parseTimeFromTitle, getEmptyDayMessage } from "../utils/format";
import { errorMessage } from "../utils/errors";
import { useFocusTick } from "../hooks/useFocusTick";
import type { Task, DailyPlan, Project } from "../types";


// Sanity belt only — see TaskDetailOverlay for the same constant. UI no
// longer gates titles below this; render surfaces truncate.
const MAX_TITLE_LENGTH = 5000;
const MAX_ESTIMATE_MINUTES = 480;

// Smart time parsing: extract duration from end of task title.
// Known limitation: compound durations like "2h30m" only match the trailing
// unit (30m), leaving "2h" in the title. Use a single unit instead (e.g. "150m" or "2.5h").



export default function DailyPlanner() {
  const { selectedDate, setSelectedDate, startFocus, stopFocus, openProject, focus, setPage, pendingDetailTask, setPendingDetailTask } = useAppStore();
  // 1Hz tick while focus is active. Returns the elapsed ms or null when no
  // session. Only the focused row's TaskCard re-renders per tick — every
  // other card bails out via the custom React.memo comparator that ignores
  // function-prop identity and only checks data props.
  const focusElapsedMs = useFocusTick();
  // The focused task's id (if any), surfaced cleanly so the renderRow
  // closure can compare without indexing into focus.task each time.
  const focusedTaskId = focus?.task.id ?? null;
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [plannedMinutes, setPlannedMinutes] = useState(0);
  const [workedMinutes, setWorkedMinutes] = useState(0);
  const [dailyPlan, setDailyPlan] = useState<DailyPlan | null>(null);
  const [workedMap, setWorkedMap] = useState<Map<number, number>>(new Map());
  // Tracks tasks that just transitioned to done so we can trigger the
  // arrival animation. Lives in the parent because the row unmounts when it
  // moves between the incomplete/completed render groups — a ref inside
  // TaskCard would reset on remount and the animation would never fire.
  const [arrivedIds, setArrivedIds] = useState<Set<number>>(new Set());
  // Tracks freshly-added tasks so the new row plays its entrance animation.
  const [addedIds, setAddedIds] = useState<Set<number>>(new Set());
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
  const [taskInputExpanded, setTaskInputExpanded] = useState(false);
  const taskInputRef = useRef<HTMLFormElement>(null);
  const newTaskInputRef = useRef<HTMLInputElement>(null);
  const datePickerAnchorRef = useRef<HTMLButtonElement>(null);

  // Right panel — expandable projects + unfinished + unscheduled
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<number>>(new Set());
  const [unfinishedExpanded, setUnfinishedExpanded] = useState(false);
  const [unscheduledExpanded, setUnscheduledExpanded] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState<boolean>(() => {
    return localStorage.getItem("dailyPlanner.rightPanelCollapsed") === "1";
  });

  function toggleRightPanel() {
    setRightPanelCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("dailyPlanner.rightPanelCollapsed", next ? "1" : "0");
      return next;
    });
  }

  // Task detail overlay
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [showSummary, setShowSummary] = useState(false);

  // Shutdown state (for localStorage check only)
  const initialLoadDone = useRef(false);

  // Sidebar state
  const [sidebarUnscheduled, setSidebarUnscheduled] = useState<Task[]>([]);
  const [sidebarOverdue, setSidebarOverdue] = useState<Task[]>([]);
  const [unfinishedTasks, setUnfinishedTasks] = useState<Task[]>([]);

  // Per-row undo for tasks pulled from the rail into today (10s window)
  const [recentlyPulled, setRecentlyPulled] = useState<
    Map<number, { task: Task; prevDate: string | null }>
  >(new Map());
  const recentTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(
    new Map()
  );
  useEffect(() => {
    const timers = recentTimersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

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

  // Hotkey: press `A` (no modifiers) to expand and focus the add-task
  // input. Skipped if the user is already typing somewhere (input,
  // textarea, contenteditable like the daily-notes editor or task-detail
  // overlay) or if a destructive confirmation row is showing — those
  // surfaces own the keystroke. Modifier check explicit so Cmd+A
  // (select-all) and similar combos pass through untouched.
  useEffect(() => {
    function isTypingTarget(el: EventTarget | null): boolean {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      return el.isContentEditable;
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (isTypingTarget(document.activeElement)) return;
      if (detailTask || confirmDeleteId !== null || editingId !== null) return;

      if (e.key === "a" || e.key === "A") {
        e.preventDefault();
        setTaskInputExpanded(true);
        // Focus on the next tick so the input has rendered after expanding.
        requestAnimationFrame(() => newTaskInputRef.current?.focus());
        return;
      }
      // Space-on-hover-to-start was removed alongside the row's Start
      // button — starting a timer from the daily plan is no longer a
      // gesture. Use the focus screen or the task detail overlay.
    }
    window.addEventListener("keydown", handleKeyDown);
    function onOpenTaskInput() {
      // Cmd+N from the global keymap dispatches this — surface the
      // collapsed add-task bar and focus its input on the next frame.
      setTaskInputExpanded(true);
      requestAnimationFrame(() => newTaskInputRef.current?.focus());
    }
    window.addEventListener("verseday:open-task-input", onOpenTaskInput);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("verseday:open-task-input", onOpenTaskInput);
    };
    // tasks/handleStartFocus/setPage closures are read at call time;
    // keeping the dep array narrow avoids re-binding the listener on
    // every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailTask, confirmDeleteId, editingId, tasks]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // FLIP: snapshot every task row's bounding rect right before a state
  // change that will reorder the list. The follow-up animateRowShifts call
  // (in a requestAnimationFrame after loadData lands) compares old vs new
  // positions per data-task-row-id and runs a transform animation back to
  // the natural position — so rows visibly slide to their new spot instead
  // of jumping. skipId opts a row out (e.g., the one being completed plays
  // its own arrival animation).
  function captureRowPositions(): Map<number, DOMRect> {
    const map = new Map<number, DOMRect>();
    document.querySelectorAll<HTMLElement>("[data-task-row-id]").forEach((el) => {
      const id = parseInt(el.dataset.taskRowId ?? "", 10);
      if (!Number.isNaN(id)) map.set(id, el.getBoundingClientRect());
    });
    return map;
  }

  function animateRowShifts(oldPositions: Map<number, DOMRect>, skipId?: number) {
    document.querySelectorAll<HTMLElement>("[data-task-row-id]").forEach((el) => {
      const id = parseInt(el.dataset.taskRowId ?? "", 10);
      if (Number.isNaN(id) || id === skipId) return;
      const oldRect = oldPositions.get(id);
      if (!oldRect) return;
      const newRect = el.getBoundingClientRect();
      const deltaY = oldRect.top - newRect.top;
      if (Math.abs(deltaY) < 1) return;
      el.animate(
        [
          { transform: `translateY(${deltaY}px)` },
          { transform: "translateY(0)" },
        ],
        { duration: 260, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }
      );
    });
  }


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
      setError(errorMessage(e, "Failed to load data"));
    }
  }

  useEffect(() => {
    initialLoadDone.current = false;
    setEditingId(null);
    setConfirmDeleteId(null);
    loadData();
  }, [selectedDate]);

  // Consume pendingDetailTask handed off from another page (e.g. Escape from
  // FocusMode / FocusLanding) — open the detail overlay for that task. Don't
  // clear pendingDetailTask here: App.tsx remounts this page when pageKey
  // increments after the page transition, so the first instance would clear
  // the slot before the second instance ever reads it. The slot gets cleared
  // when the overlay actually closes (see onClose handler below).
  useEffect(() => {
    if (pendingDetailTask) {
      setDetailTask(pendingDetailTask);
    }
  }, [pendingDetailTask]);

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

    // Snapshot positions before the new row lands so existing rows can FLIP
    // down to make room rather than jumping.
    const oldPositions = captureRowPositions();
    try {
      const newId = await createTask({
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
      await loadData();
      requestAnimationFrame(() => animateRowShifts(oldPositions));
      if (newId > 0) {
        setAddedIds((prev) => {
          const next = new Set(prev);
          next.add(newId);
          return next;
        });
        setTimeout(() => {
          setAddedIds((prev) => {
            if (!prev.has(newId)) return prev;
            const next = new Set(prev);
            next.delete(newId);
            return next;
          });
        }, 400);
      }
    } catch (e) {
      setError(errorMessage(e, "Failed to add task"));
    }
  }

  async function toggleTask(task: Task) {
    const wasDone = task.status === "done";
    // Snapshot positions BEFORE the status flip so FLIP can animate the
    // shift the surviving incomplete rows experience as they fill the gap.
    const oldPositions = captureRowPositions();
    try {
      await updateTaskStatus(task.id, wasDone ? "todo" : "done");
      // Unchecking a completed task bumps it to the BOTTOM of the
      // incomplete list (rather than restoring its prior position),
      // so the user can see what they just unchecked at a glance.
      // Find the max sort_order among other incomplete tasks for this
      // date and set the unchecked task's sort_order one higher.
      if (wasDone) {
        const maxOther = tasks
          .filter((t) => t.status !== "done" && t.id !== task.id)
          .reduce((max, t) => Math.max(max, t.sort_order), -1);
        await updateTaskSortOrders([
          { id: task.id, sortOrder: maxOther + 1 },
        ]);
      }
      setError(null);
      // Wait for the refreshed tasks list before flipping the arrival flag.
      // Otherwise the flag fires on a stale render where the row is still in
      // the incomplete section, then re-fires when loadData remounts the row
      // in the completed section — animation plays twice on the wrong state.
      await loadData();
      // Run FLIP one frame later so React has committed the new DOM. The
      // toggled task plays its own arrival animation, so skip it here.
      requestAnimationFrame(() => animateRowShifts(oldPositions, task.id));
      if (!wasDone) {
        setArrivedIds((prev) => {
          const next = new Set(prev);
          next.add(task.id);
          return next;
        });
        setTimeout(() => {
          setArrivedIds((prev) => {
            if (!prev.has(task.id)) return prev;
            const next = new Set(prev);
            next.delete(task.id);
            return next;
          });
        }, 700);
      }
    } catch (e) {
      setError(errorMessage(e, "Failed to update task"));
    }
  }

  async function handleStartFocus(task: Task) {
    const current = useAppStore.getState().focus;
    // Clicking play on the already-focused task is a no-op.
    if (current && current.task.id === task.id) return;
    try {
      if (current) {
        // Swap from one focused task to another. Phase 1: close the old
        // time entry in the DB and optimistically update workedMap so the
        // old row's pill flips from live → static cleanly with no flash.
        const finalElapsedMs = (Date.now() - current.startedAt) + current.priorElapsedMs;
        const finalMinutes = Math.floor(finalElapsedMs / 60000);
        const oldTaskId = current.task.id;
        await stopTimeEntry(current.timeEntryId, 0);
        setWorkedMap((prev) => {
          const next = new Map(prev);
          next.set(oldTaskId, finalMinutes);
          return next;
        });
      }
      // Phase 2: start the new entry.
      const priorMinutes = await getWorkedMinutesForTask(task.id);
      const priorMs = priorMinutes * 60 * 1000;
      const entryId = await startTimeEntry(task.id, "tracked");
      // Phase 3: replace focus state (overwrites any existing focus).
      // Deliberately NOT calling setPage("focus") — DailyPlanner is the
      // one call site that keeps focus inline.
      startFocus(task, entryId, "daily", priorMs);
      if (current) {
        // After a swap, refetch so the swapped-out task's pill picks up
        // the authoritative worked total from time_entries instead of
        // the optimistic value.
        await loadData();
      }
    } catch (e) {
      setError(errorMessage(e, "Failed to start timer"));
      // If we closed the old entry but blew up before replacing focus,
      // the in-memory focus still points to a session whose time entry
      // is closed in the DB. Clear it so the stale live counter stops.
      const after = useAppStore.getState().focus;
      if (current && after && after.timeEntryId === current.timeEntryId) {
        stopFocus();
      }
    }
  }

  // Signature accepts a Task argument to match TaskCard's onStop prop, but
  // we read the active focus from the store rather than trusting the
  // passed-in task — the row knows which task it is, but the focus state
  // is the source of truth for which session is being stopped.
  async function handleStopFocus(_task: Task) {
    const f = useAppStore.getState().focus;
    if (!f) return;
    // Capture the final elapsed before tearing down the session — this
    // value seeds the optimistic workedMap update so the time pill flips
    // from live → static without flashing through 0m or a stale value
    // while loadData() refetches.
    const finalElapsedMs = (Date.now() - f.startedAt) + f.priorElapsedMs;
    const finalMinutes = Math.floor(finalElapsedMs / 60000);
    const taskId = f.task.id;
    setWorkedMap((prev) => {
      const next = new Map(prev);
      next.set(taskId, finalMinutes);
      return next;
    });
    try {
      await stopTimeEntry(f.timeEntryId, 0);
      stopFocus();
      // Synchronous-feeling refresh: loadData replaces the optimistic
      // value with the authoritative one from time_entries; should match
      // within rounding so the user sees no jump.
      await loadData();
    } catch (e) {
      setError(errorMessage(e, "Failed to stop focus"));
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
      setError(errorMessage(e, "Failed to update task"));
    }
  }

  function handleDetailSave(updates: Parameters<typeof updateTask>[0]) {
    updateTask(updates).then(() => loadData()).catch(() => {});
  }

  async function pullTaskToDay(taskId: number) {
    // Capture original task + prev date for the undo window. Look in every
    // rail-side source so undo works regardless of which section it came from.
    const candidates: Task[] = [
      ...sidebarUnscheduled,
      ...sidebarOverdue,
      ...unfinishedTasks,
    ];
    const original = candidates.find((t) => t.id === taskId);
    const prevDate = original?.date_scheduled ?? null;
    try {
      await updateTaskDateScheduled(taskId, selectedDate);
      loadData();
      if (original) {
        const existing = recentTimersRef.current.get(taskId);
        if (existing) clearTimeout(existing);
        const timeoutId = setTimeout(() => {
          setRecentlyPulled((prev) => {
            const next = new Map(prev);
            next.delete(taskId);
            return next;
          });
          recentTimersRef.current.delete(taskId);
        }, 10000);
        recentTimersRef.current.set(taskId, timeoutId);
        setRecentlyPulled((prev) => {
          const next = new Map(prev);
          next.set(taskId, { task: original, prevDate });
          return next;
        });
      }
    } catch (e) {
      setError(errorMessage(e, "Failed to schedule task"));
    }
  }

  async function undoPull(taskId: number) {
    const entry = recentlyPulled.get(taskId);
    if (!entry) return;
    const timer = recentTimersRef.current.get(taskId);
    if (timer) clearTimeout(timer);
    recentTimersRef.current.delete(taskId);
    try {
      await updateTaskDateScheduled(taskId, entry.prevDate);
      setRecentlyPulled((prev) => {
        const next = new Map(prev);
        next.delete(taskId);
        return next;
      });
      loadData();
    } catch (e) {
      setError(errorMessage(e, "Failed to undo"));
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteTask(id);
      setConfirmDeleteId(null);
      setError(null);
      loadData();
    } catch (e) {
      setError(errorMessage(e, "Failed to delete task"));
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
      setError(errorMessage(e, "Failed to reorder tasks"));
      loadData();
    }
  }

  async function saveDailyNotes(valueToSave: string = dailyNotes) {
    try {
      const trimmed = valueToSave.trim();
      // Strip the empty-paragraph HTML Tiptap leaves behind so the DB still
      // sees "no notes" (NULL) when the user clears the editor.
      const isEmpty =
        trimmed === "" ||
        trimmed === "<p></p>" ||
        trimmed === "<p><br></p>";
      await upsertDailyPlan(
        selectedDate,
        isEmpty ? null : trimmed,
        hourBudget
      );
      setError(null);
      // Intentionally not calling loadData() — notes save is scoped to
      // daily_plans, refetching tasks on every debounced keystroke would
      // remount task rows mid-typing.
    } catch (e) {
      setError(errorMessage(e, "Failed to save notes"));
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
        {/* Date row with stats right-aligned. Capped to the same column
            width as the task list below so everything stays on a single
            visual axis. */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => changeDate(-1)}
            className="w-7 h-7 rounded-full flex items-center justify-center text-fg-muted cursor-pointer hover:bg-overlay-hover transition-colors duration-150 ease-out"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 4l-4 4 4 4" />
            </svg>
          </button>
          <h2 className="text-[16px] font-medium text-fg">
            {new Date(selectedDate + "T00:00:00").toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
          </h2>
          <button
            onClick={() => changeDate(1)}
            className="w-7 h-7 rounded-full flex items-center justify-center text-fg-muted cursor-pointer hover:bg-overlay-hover transition-colors duration-150 ease-out"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 4l4 4-4 4" />
            </svg>
          </button>
          <div className="flex items-center">
            <button
              ref={datePickerAnchorRef}
              onClick={() => setShowDatePicker(!showDatePicker)}
              className={`text-[11px] leading-none px-2 py-1 rounded-full cursor-pointer ${
                isToday
                  ? "bg-accent-blue-soft text-accent-blue-soft-fg"
                  : "bg-overlay-hover text-fg-secondary hover:bg-overlay-pressed"
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
          <div className="flex-1" />
          {/* Focus button — inline */}
          {(() => {
            const isFocusing = !!focus;
            const nextTask = tasks.find((t) => t.status !== "done");

            if (isFocusing) {
              return (
                <button
                  onClick={() => setPage("focus")}
                  // Status pill, not primary CTA: softer accent-blue tint
                  // with an outlined edge so it reads as "currently
                  // running" instead of "click to start something." A
                  // slow opacity pulse on the dot (2s cycle, .45 → 1)
                  // gives a localized recording-light feel without the
                  // whole pill breathing.
                  className="rounded-lg bg-accent-blue-soft text-accent-blue-soft-fg border border-accent-blue/40 hover:border-accent-blue hover:bg-accent-blue/15 cursor-pointer flex items-center gap-2 px-4 py-1.5 transition-colors"
                  title="Open focus screen"
                >
                  <span
                    className="w-2 h-2 rounded-full bg-accent-blue animate-focus-dot"
                    aria-hidden
                  />
                  <span className="text-[13px] font-medium">
                    Focusing<span aria-hidden>
                      <span>.</span>
                      <span className="animate-ellipsis-2">.</span>
                      <span className="animate-ellipsis-3">.</span>
                    </span>
                  </span>
                </button>
              );
            }

            if (!nextTask) return null;

            return (
              <button
                onClick={() => {
                  handleStartFocus(nextTask);
                  // Top-right "Start focusing" navigates to the immersive
                  // Focus page — the row's inline play button is the
                  // alternative for staying on Daily Plan.
                  setPage("focus");
                }}
                className="rounded-lg border border-accent-blue/50 text-accent-blue-soft-fg hover:border-accent-blue hover:bg-accent-blue-soft cursor-pointer flex items-center gap-2 px-4 py-1.5 transition-colors"
                title={`Start focus: ${nextTask.title}`}
              >
                <svg width="8" height="10" viewBox="0 0 8 10" fill="currentColor" className="ml-[1px]">
                  <path d="M0 0v10l8-5z" />
                </svg>
                <span className="text-[13px] font-medium">Start focusing</span>
              </button>
            );
          })()}
        </div>
      </div>

      {/* Main scrollable area — content lives inside a narrower column so
          the page reads as a focused single track instead of a wide grid
          of work. */}
      <div className="flex-1 overflow-y-auto px-7 py-5">
        <div className="max-w-[560px] mx-auto flex flex-col min-h-full">
        {/* Task Input — collapsed bar shows worked / planned for the day on
            the right so adding more work is in dialogue with the time you
            already have on the plate. Over-budget tips the planned figure
            into a warning hue so it nudges before you pile on. Click
            anywhere on the bar to open the full editor. */}
        <form onSubmit={handleAddTask} className="mb-9" ref={taskInputRef}>
          {!taskInputExpanded ? (
            (() => {
              const overBudget = plannedHours > hourBudget;
              const hasTime = workedMinutes > 0 || plannedMinutes > 0;
              return (
                <button
                  type="button"
                  onClick={() => setTaskInputExpanded(true)}
                  title="Add a task"
                  className={`w-full flex items-center gap-3 bg-elevated rounded-[10px] px-4 py-2.5 cursor-pointer transition-colors hover:bg-overlay-hover border ${
                    overBudget ? "border-accent-warning/30" : "border-line-soft"
                  }`}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="text-fg-faded shrink-0">
                    <path d="M7 2v10M2 7h10" />
                  </svg>
                  <span className="flex-1" />
                  {hasTime && (
                    <span className="text-[11.5px] tabular-nums">
                      <span className="text-fg-secondary">{formatHoursMinutes(workedMinutes)}</span>
                      <span className="text-fg-disabled"> / </span>
                      <span className={overBudget ? "text-accent-warning-soft-fg font-medium" : "text-fg-secondary"}>
                        {formatHoursMinutes(plannedMinutes)}
                      </span>
                    </span>
                  )}
                </button>
              );
            })()
          ) : (
            <div className="bg-elevated border border-line-soft rounded-[10px] p-3.5 cursor-text overflow-hidden">
              {/* Row 1: input + add */}
              <div className="flex items-center gap-2.5 mb-2.5">
                <input
                  ref={newTaskInputRef}
                  type="text"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  onKeyDown={(e) => {
                    // Esc collapses the bar AND resets every field so the
                    // next open starts blank. Without the reset, a half-
                    // typed title (and its estimate/project/priority)
                    // persists across opens, which the user found
                    // surprising.
                    if (e.key === "Escape") {
                      e.preventDefault();
                      e.stopPropagation();
                      setNewTaskTitle("");
                      setNewTaskEstimate(null);
                      setNewTaskProjectId("");
                      setNewTaskHighPriority(false);
                      setTaskInputExpanded(false);
                    }
                  }}
                  autoFocus
                  placeholder="New task"
                  className="flex-1 bg-transparent border-none outline-none text-[14px] text-fg placeholder:text-fg-faded"
                />
                <button
                  type="submit"
                  className="border border-accent-blue/50 text-accent-blue-soft-fg rounded-lg px-4 py-1.5 text-[13px] font-medium cursor-pointer hover:border-accent-blue hover:bg-accent-blue-soft transition-colors whitespace-nowrap"
                >
                  Add
                </button>
              </div>
              {/* Row 2: metadata pills */}
              <div className="flex items-center gap-2 flex-wrap min-w-0">
                <div className="w-[220px]">
                  <ProjectPicker
                    value={newTaskProjectId}
                    projects={projects}
                    onChange={setNewTaskProjectId}
                  />
                </div>
                <div className="w-px h-3.5 bg-line-soft" />
                <DurationPicker
                  value={newTaskEstimate}
                  onChange={setNewTaskEstimate}
                />
              </div>
            </div>
          )}
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
            <div className={`flex-1 ${!initialLoadDone.current ? "[&>*]:animate-stagger [&>*]:animate-slide-up" : ""}`}>
              {tasks.length === 0 ? (
                (() => {
                  const msg = isToday
                    ? getEmptyDayMessage()
                    : { title: "Nothing planned for this day", subtitle: "Add your first task above to start filling it in." };
                  return (
                    <div className="flex-1 flex flex-col items-center justify-center gap-2.5 px-8 py-8 text-center">
                      <div className="w-10 h-10 bg-accent-blue-soft rounded-[10px] flex items-center justify-center mb-1">
                        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                          <circle cx="9" cy="9" r="6" stroke="var(--accent-blue)" strokeWidth="1.2" opacity="0.5" fill="none" />
                          <path d="M6 9l2 2 4-4" stroke="var(--accent-blue)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                        </svg>
                      </div>
                      <p className="text-[14px] font-medium text-fg-secondary">{msg.title}</p>
                      <p className="text-[12px] text-fg-faded leading-relaxed max-w-[260px]">
                        {msg.subtitle}
                      </p>
                    </div>
                  );
                })()
              ) : (
                (() => {
                  // Flat list with generous spacing — incomplete tasks on
                  // top, done tasks below (visually distinguished by their
                  // green tint inside TaskCard).
                  const incomplete = sortedTasks.filter((t) => t.status !== "done");
                  const completed = sortedTasks.filter((t) => t.status === "done");

                  function renderRow(task: Task) {
                    if (editingId === task.id) {
                      return (
                        <div
                          key={task.id}
                          className="p-3.5 rounded-[10px] bg-elevated border border-line-soft space-y-2"
                          onKeyDown={handleEditKeyDown}
                        >
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={editTitle}
                              onChange={(e) => setEditTitle(e.target.value)}
                              autoFocus
                              className="flex-1 bg-transparent border border-line-soft rounded-md px-2.5 py-1.5 text-[13px] text-fg focus:outline-none focus:border-accent-blue"
                            />
                            <input
                              type="number"
                              value={editEstimate}
                              onChange={(e) => setEditEstimate(e.target.value)}
                              min={1}
                              max={MAX_ESTIMATE_MINUTES}
                              placeholder="min"
                              className="w-20 bg-transparent border border-line-soft rounded-md px-2.5 py-1.5 text-[13px] text-fg placeholder:text-fg-faded focus:outline-none focus:border-accent-blue"
                            />
                          </div>
                          <div className="flex gap-2">
                            <select
                              value={editProjectId}
                              onChange={(e) => setEditProjectId(e.target.value)}
                              className="flex-1 bg-transparent border border-line-soft rounded-md px-2.5 py-1.5 text-[12px] text-fg-secondary focus:outline-none focus:border-accent-blue"
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
                                  ? "bg-accent-danger/10 border-accent-danger/25 text-accent-danger"
                                  : "bg-transparent border-line-soft text-fg-secondary"
                              }`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${
                                  editPriority === "high"
                                    ? "bg-accent-danger"
                                    : "bg-fg-disabled"
                                }`}
                              />
                              High
                            </button>
                          </div>
                          <RichTextEditor
                            value={editNotes}
                            onChange={(html) => setEditNotes(html)}
                            placeholder="Notes..."
                            className="w-full bg-transparent border border-line-soft rounded-md px-2.5 py-2 text-[12px] text-fg-secondary min-h-[60px] focus-within:border-accent-blue"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={saveEdit}
                              className="bg-accent-blue text-fg-on-accent rounded-md px-3 py-1.5 text-[12px] cursor-pointer hover:bg-accent-blue-hover transition-colors"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="bg-overlay-hover text-fg-muted rounded-md px-3 py-1.5 text-[12px] cursor-pointer hover:bg-overlay-pressed transition-colors"
                            >
                              Cancel
                            </button>
                            <span className="text-[11px] text-fg-disabled self-center ml-auto">
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
                          className="p-3.5 rounded-[10px] bg-elevated border border-line-soft flex items-center gap-3"
                        >
                          <span className="flex-1 text-[13px]">
                            <span className="text-accent-destructive">
                              Delete &ldquo;{task.title}&rdquo;?
                            </span>{" "}
                            <span className="text-accent-warning-soft-fg">
                              Time entries will also be deleted.
                            </span>
                          </span>
                          <button
                            onClick={() => handleDelete(task.id)}
                            className="bg-accent-destructive text-fg-on-accent rounded-md px-3 py-1 text-[12px] cursor-pointer hover:bg-accent-destructive-hover"
                          >
                            Delete
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="text-fg-faded text-[12px] cursor-pointer hover:text-fg-secondary"
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
                        onStop={handleStopFocus}
                        onOpenDetail={setDetailTask}
                        onOpenProject={openProject}
                        expandedNotes={expandedId === task.id}
                        workedMinutes={workedMap.get(task.id)}
                        showProject={true}
                        justArrived={arrivedIds.has(task.id)}
                        justAdded={addedIds.has(task.id)}
                        isFocused={focusedTaskId === task.id}
                        liveElapsedMs={
                          focusedTaskId === task.id && focusElapsedMs != null
                            ? focusElapsedMs
                            : undefined
                        }
                      />
                    );
                  }

                  // Flat list — generous spacing between cards. Done tasks
                  // sit at the bottom and pick up a soft-green tint via
                  // TaskCard so the day's wins visually accumulate.
                  return (
                    <div className="space-y-3">
                      {incomplete.map(renderRow)}
                      {completed.length > 0 && incomplete.length > 0 && (
                        <div className="h-2" />
                      )}
                      {completed.map(renderRow)}
                    </div>
                  );
                })()
              )}
            </div>
          </SortableContext>
        </DndContext>

        </div>
      </div>

      {/* Daily Notes + Shutdown link — pinned to the bottom of the main
          column so the notes are always visible regardless of how many
          tasks are scrolled above. Sibling of the scrollable region above,
          not a child, so the scroll area shrinks to fit instead of pushing
          the notes off-screen. No top border / hairline divider — the
          section reads as a quiet bottom zone, not its own footer chrome. */}
      <div className="px-7 pt-3 pb-5 shrink-0">
        <div className="max-w-[640px] mx-auto">
          <div className="flex items-center justify-between mb-1.5">
            <label className="uppercase [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] text-fg-faded">
              Daily notes
            </label>
            <div className="flex items-center gap-3">
              {/* Both treated as quiet footer utilities — neither is a
                  primary CTA on this page (the primary actions are
                  checking off tasks and starting focus). Equal visual
                  weight so "Shutdown day" doesn't get drowned out by a
                  bolder "Summarize plan" link. */}
              <button
                onClick={() => setShowSummary(true)}
                className="flex items-center gap-1 text-[12px] text-fg-faded cursor-pointer hover:text-fg-secondary transition-colors"
              >
                <svg width="11" height="11" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
                  <line x1="3" y1="4" x2="12" y2="4" />
                  <line x1="3" y1="7.5" x2="12" y2="7.5" />
                  <line x1="3" y1="11" x2="9" y2="11" />
                </svg>
                Summarize plan
              </button>
              <button
                onClick={() => setPage("daily_shutdown")}
                className="flex items-center gap-1 text-[12px] text-fg-faded cursor-pointer hover:text-fg-secondary transition-colors"
              >
                <svg width="11" height="11" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="7.5" cy="7.5" r="5.5" />
                  <line x1="7.5" y1="7.5" x2="9.2" y2="10" />
                  <line x1="7.5" y1="7.5" x2="7.5" y2="11" />
                </svg>
                Shutdown day
              </button>
            </div>
          </div>
          {/* Rich text — bold/italic/bullets via the editor's bubble menu.
              min-h keeps the empty state visible at ~2 lines; max-h caps at
              ~3 lines and the inner editor scrolls beyond that, so a long
              note doesn't push the rest of the page around. */}
          <RichTextEditor
            value={dailyNotes}
            onChange={(html) => {
              setDailyNotes(html);
              saveDailyNotes(html);
            }}
            placeholder="Write notes for today..."
            className="w-full bg-elevated border border-line-hairline rounded-lg px-3 py-2 text-[13px] text-fg-secondary min-h-[64px] max-h-[112px] overflow-y-auto leading-relaxed focus-within:border-accent-blue"
          />
        </div>
      </div>

      </div>

      {/* ── Right panel: Projects (collapsible) ─────────────────────── */}
      <div
        className="flex-shrink-0 border-l border-line-hairline bg-sidebar flex flex-col overflow-hidden transition-[width] duration-200 ease-out"
        style={{ width: rightPanelCollapsed ? 28 : 220 }}
      >
      {rightPanelCollapsed ? (
        <div className="flex flex-col items-center pt-[22px]">
          <button
            onClick={toggleRightPanel}
            title="Show projects panel"
            className="w-6 h-6 rounded-md flex items-center justify-center text-fg-muted hover:bg-overlay-hover hover:text-fg-secondary cursor-pointer transition-colors"
          >
            {/* Double chevron — distinguishes "expand this whole panel" from
                the single-chevron disclosure carets used for tree expansion. */}
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3.5L4 7l4 3.5" />
              <path d="M12 3.5L8 7l4 3.5" />
            </svg>
          </button>
        </div>
      ) : (
      <div className="w-[220px] flex-shrink-0 flex flex-col overflow-y-auto">
        {/* Collapse handle (no top label — goal is "what to add to today").
            pt-[24px] aligns the button center with the Start focusing button
            in the main column's header (pt-5 + half of a 28px-tall button). */}
        <div className="flex items-center justify-end px-3 pt-[24px] pb-1">
          <button
            onClick={toggleRightPanel}
            title="Hide panel"
            className="w-5 h-5 -mr-1 rounded-md flex items-center justify-center text-fg-faded hover:bg-overlay-hover hover:text-fg-secondary cursor-pointer transition-colors"
          >
            <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 3.5L6 7l-4 3.5" />
              <path d="M6 3.5L10 7l-4 3.5" />
            </svg>
          </button>
        </div>

        {/* Project list — only projects with at least one open pullable task
            (or a recently-pulled task still in its undo window) */}
        <div className="px-2 space-y-1.5">
        {(() => {
          const activeProjects = projects.filter((p) => !p.completed);
          const projectSections = activeProjects
            .map((p) => {
              const unscheduled = sidebarUnscheduled.filter(
                (t) => t.project_id === p.id && t.status !== "done"
              );
              const overdue = sidebarOverdue.filter(
                (t) => t.project_id === p.id && t.status !== "done"
              );
              const recent = Array.from(recentlyPulled.values())
                .map((r) => r.task)
                .filter((t) => t.project_id === p.id);
              const pullable = [...unscheduled, ...overdue];
              return { project: p, pullable, recent };
            })
            .filter((s) => s.pullable.length > 0 || s.recent.length > 0);

          if (projectSections.length === 0) {
            return (
              <p className="px-2 py-4 text-[11px] text-fg-faded text-center">
                Nothing left to pull in
              </p>
            );
          }

          return projectSections.map(({ project: p, pullable, recent }) => {
            const isExpanded = expandedProjectIds.has(p.id);
            const allInList = [...pullable, ...recent];
            return (
              <div key={p.id} className="rounded-md bg-elevated/40 overflow-hidden">
                {/* Project header */}
                <button
                  onClick={() => {
                    setExpandedProjectIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(p.id)) next.delete(p.id);
                      else next.add(p.id);
                      return next;
                    });
                  }}
                  className="w-full flex items-center gap-1.5 px-2.5 py-1.5 hover:bg-overlay-hover transition-colors text-left cursor-pointer"
                >
                  <span className="w-3 flex items-center justify-center text-accent-orange-soft-fg/70 flex-shrink-0">
                    <DisclosureCaret expanded={isExpanded} />
                  </span>
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
                  <span className="text-[11.5px] text-fg truncate flex-1">{p.name}</span>
                  <span className="text-[10px] text-fg-disabled tabular-nums">{pullable.length}</span>
                </button>

                {/* Expanded task list */}
                {isExpanded && (
                  <div className="px-1.5 pb-1.5 space-y-px">
                    {allInList.map((task) => {
                      const isRecent = recentlyPulled.has(task.id);
                      return (
                        <button
                          key={task.id}
                          onClick={() => {
                            if (isRecent) undoPull(task.id);
                            else pullTaskToDay(task.id);
                          }}
                          title={isRecent ? "Undo (within 10s)" : "Add to today"}
                          className={`w-full flex items-center gap-1.5 px-2 py-1 rounded-md text-left cursor-pointer transition-colors group ${
                            isRecent ? "bg-accent-blue/[0.07]" : "hover:bg-overlay-hover"
                          }`}
                        >
                          <span
                            className={`text-[11px] flex-1 truncate ${
                              isRecent ? "text-fg-faded" : "text-fg"
                            }`}
                          >
                            {task.title}
                          </span>
                          {task.estimated_minutes != null && task.estimated_minutes > 0 && !isRecent && (
                            <span className="text-[9px] text-fg-disabled">{task.estimated_minutes}m</span>
                          )}
                          {isRecent ? (
                            <span className="text-[10px] text-accent-blue-soft-fg font-medium">
                              Undo
                            </span>
                          ) : (
                            <svg
                              width="13" height="13" viewBox="0 0 14 14" fill="none"
                              stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
                              className="text-accent-blue opacity-40 group-hover:opacity-100 transition-opacity flex-shrink-0"
                            >
                              <path d="M7 3v8M3 7h8" />
                            </svg>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          });
        })()}
        </div>

        {/* Spacer — push backlog + unscheduled to bottom */}
        <div className="flex-1 min-h-[40px]" />

        {/* Task backlog — tasks rolling over up to 4 days. Header + list share
            one shaded container so the section reads as a distinct group from
            the active project list above. */}
        {(() => {
          const backlog = unfinishedTasks.filter((t) => t.status !== "done");
          if (backlog.length === 0) return null;
          return (
            <div className="px-2 mt-2">
              <div className="rounded-md bg-overlay-hover/60 overflow-hidden">
                <button
                  onClick={() => setUnfinishedExpanded((v) => !v)}
                  className="w-full flex items-center gap-1.5 px-2.5 py-2 cursor-pointer text-left hover:bg-overlay-hover transition-colors"
                >
                  <span className="w-3 flex items-center justify-center text-accent-orange-soft-fg/70 flex-shrink-0">
                    <DisclosureCaret expanded={unfinishedExpanded} />
                  </span>
                  <span className="text-[11px] text-fg-muted flex-1">Task backlog</span>
                  <span className="text-[10px] text-fg-disabled tabular-nums">{backlog.length}</span>
                </button>
                {unfinishedExpanded && (
                  <div className="px-1.5 pb-1.5 space-y-px">
                    {backlog.map((task) => (
                      <button
                        key={task.id}
                        onClick={() => setDetailTask(task)}
                        className="w-full flex items-center gap-1.5 px-2 py-1 rounded-md text-left cursor-pointer hover:bg-overlay-hover transition-colors group"
                      >
                        <span className="text-[11px] text-fg-secondary group-hover:text-fg flex-1 truncate transition-colors">{task.title}</span>
                        <span className="text-[9px] text-accent-warning-soft-fg/70 tabular-nums">{task.rollover_count}d</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* Unscheduled — orphan tasks with no project */}
        {(() => {
          const orphanUnscheduled = sidebarUnscheduled.filter(
            (t) => t.project_id === null && t.status !== "done"
          );
          const orphanOverdue = sidebarOverdue.filter(
            (t) => t.project_id === null && t.status !== "done"
          );
          const orphanRecent = Array.from(recentlyPulled.values())
            .map((r) => r.task)
            .filter((t) => t.project_id === null);
          const unscheduledAll = [...orphanUnscheduled, ...orphanOverdue];
          const allInList = [...unscheduledAll, ...orphanRecent];
          if (allInList.length === 0) return null;
          return (
            <div className="px-2 mt-1.5 mb-2">
              <button
                onClick={() => setUnscheduledExpanded((v) => !v)}
                className="w-full flex items-center gap-1.5 px-1 py-1.5 cursor-pointer text-left"
              >
                <span className="w-3 flex items-center justify-center text-accent-orange-soft-fg/70 flex-shrink-0">
                  <DisclosureCaret expanded={unscheduledExpanded} />
                </span>
                <span className="text-[11px] text-fg-muted flex-1">Unscheduled</span>
                <span className="text-[10px] text-fg-disabled tabular-nums">{unscheduledAll.length}</span>
              </button>
              {unscheduledExpanded && (
                <div className="rounded-md bg-elevated/40 px-1.5 py-1.5 space-y-px">
                  {allInList.map((task) => {
                    const isRecent = recentlyPulled.has(task.id);
                    return (
                      <button
                        key={task.id}
                        onClick={() => {
                          if (isRecent) undoPull(task.id);
                          else pullTaskToDay(task.id);
                        }}
                        title={isRecent ? "Undo (within 10s)" : "Add to today"}
                        className={`w-full flex items-center gap-1.5 px-2 py-1 rounded-md text-left cursor-pointer transition-colors group ${
                          isRecent ? "bg-accent-blue/[0.07]" : "hover:bg-overlay-hover"
                        }`}
                      >
                        <span
                          className={`text-[11px] flex-1 truncate ${
                            isRecent ? "text-fg-faded" : "text-fg"
                          }`}
                        >
                          {task.title}
                        </span>
                        {task.estimated_minutes != null && task.estimated_minutes > 0 && !isRecent && (
                          <span className="text-[9px] text-fg-disabled">{task.estimated_minutes}m</span>
                        )}
                        {isRecent ? (
                          <span className="text-[10px] text-accent-blue-soft-fg font-medium">
                            Undo
                          </span>
                        ) : (
                          <span className="text-[10px] text-accent-blue opacity-0 group-hover:opacity-100 transition-opacity">+</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}
      </div>
      )}
      </div>

      {/* Task detail overlay */}
      {detailTask && (
        <TaskDetailOverlay
          key={detailTask.id}
          task={detailTask}
          projects={projects}
          onClose={() => { setDetailTask(null); setPendingDetailTask(null); }}
          onSave={(updates) => handleDetailSave(updates)}
          onToggle={(t) => { toggleTask(t).catch(() => {}); }}
          onDelete={(id) => { setConfirmDeleteId(id); setDetailTask(null); setPendingDetailTask(null); }}
          onStartFocus={(t) => {
            handleStartFocus(t);
            setDetailTask(null);
            setPendingDetailTask(null);
            // Detail-overlay's start button is a "go focus on this task"
            // gesture — navigate to the immersive Focus page rather than
            // staying inline. Daily Plan's own play button stays inline.
            setPage("focus");
          }}
          workedMinutes={workedMap.get(detailTask.id) ?? 0}
          onSetWorkedMinutes={(id, mins) => setManualWorkedMinutes(id, mins).then(() => loadData()).catch(() => {})}
        />
      )}

      {/* Plan summary overlay */}
      {showSummary && (
        <SummaryOverlay
          type="daily"
          anchorDate={selectedDate}
          onClose={() => setShowSummary(false)}
        />
      )}
    </div>
  );
}
