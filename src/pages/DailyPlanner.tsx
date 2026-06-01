import { useEffect, useMemo, useState, useRef } from "react";
import { onProjectChanged } from "../utils/projectEvents";
import { activeObjectiveOptions } from "../utils/objectiveOptions";
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
import {
  selectOrphanAndOverdueTasks,
  selectTaskIdsByDate,
  selectUnscheduledTasksByProject,
  useAppStore,
} from "../stores/appStore";
import {
  getProjects,
  startTimeEntry,
  stopTimeEntry,
  updateTimeEntryWorkedSeconds,
  getTotalWorkedMinutes,
  getDailyPlan,
  upsertDailyPlan,
  getWorkedMinutesForTaskIds,
  getWorkedMinutesForTask,
  getProjectStats,
  generateRecurringInstances,
  rolloverUnfinishedTasks,
} from "../db/queries";
import { todayString, localDateIso } from "../utils/dates";
import ErrorBanner from "../components/ErrorBanner";
import TaskCard from "../components/TaskCard";
import DatePicker from "../components/DatePicker";
import DurationPicker from "../components/DurationPicker";
import RichTextEditor from "../components/RichTextEditor";
import ProjectPicker from "../components/ProjectPicker";
import DisclosureCaret from "../components/DisclosureCaret";
import PillToggleIcon from "../components/PillToggleIcon";
import { formatHoursMinutes, parseTimeFromTitle, getEmptyDayMessage } from "../utils/format";
import { useCalendarAutoSync } from "../calendar/hooks";
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
  const selectedTaskDetailId = useAppStore((s) => s.selectedTaskDetailId);
  const openTaskDetail = useAppStore((s) => s.openTaskDetail);
  const primeTasks = useAppStore((s) => s.primeTasks);
  const openSummaryOverlay = useAppStore((s) => s.openSummaryOverlay);
  // M3.2.b.1 — main task list comes from the canonical store. The
  // selector returns the ordered ID list for selectedDate; we resolve
  // each id against tasksById at render time. Subscribing to tasksById
  // wholesale re-renders the parent on any task mutation, but no DB
  // round-trip — net win over the prior verseday:task-* refetch path.
  // M3.2.b.4 splits this into per-row TaskCard subscriptions so the
  // parent stops re-rendering on unrelated mutations.
  const taskIds = useAppStore((s) => selectTaskIdsByDate(s, selectedDate));
  const tasksById = useAppStore((s) => s.tasksById);
  const loadTasksForDate = useAppStore((s) => s.loadTasksForDate);
  const loadSidebarPool = useAppStore((s) => s.loadSidebarPool);
  const updateTaskAction = useAppStore((s) => s.updateTask);
  const deleteTaskAction = useAppStore((s) => s.deleteTaskAction);
  const setTaskStatusAction = useAppStore((s) => s.setTaskStatus);
  const setTaskDateScheduledAction = useAppStore((s) => s.setTaskDateScheduled);
  const setTaskSortOrdersAction = useAppStore((s) => s.setTaskSortOrders);
  const createTaskAction = useAppStore((s) => s.createTaskAction);
  // 1Hz tick while focus is active. Returns the elapsed ms or null when no
  // session. Only the focused row's TaskCard re-renders per tick — every
  // other card bails out via the custom React.memo comparator that ignores
  // function-prop identity and only checks data props.
  const focusElapsedMs = useFocusTick();
  // The focused task's id (if any), surfaced cleanly so the renderRow
  // closure can compare without indexing into focus.task each time.
  const focusedTaskId = focus?.taskId ?? null;
  // M3.2.b.1 — derived from the canonical map. Memoized so its
  // reference is stable across renders that don't change the inputs
  // (taskIds is stable when the date's index entry is unchanged;
  // tasksById churns on any task mutation). Filters out the rare
  // window where an id is in the index but not yet in the map (e.g.
  // mid-update during a refetch). Per-row TaskCard subscription lands
  // in M3.2.b.4 — until then the parent re-renders on map changes,
  // but no DB roundtrip.
  const tasks = useMemo(() => {
    const out: Task[] = [];
    for (const id of taskIds) {
      const t = tasksById.get(id);
      if (t) out.push(t);
    }
    return out;
  }, [taskIds, tasksById]);
  const [projects, setProjects] = useState<Project[]>([]);
  // #3 — refresh on verseday:project-changed (project pills/colors on task
  // rows stay current). Read-only handler → no loop; mounted-guarded.
  useEffect(() => {
    let mounted = true;
    const off = onProjectChanged(() => {
      getProjects()
        .then((p) => {
          if (mounted) setProjects(p);
        })
        .catch(() => {});
    });
    return () => {
      mounted = false;
      off();
    };
  }, []);
  // M3.2.b.5.b — derived from canonical tasks (reactive; closes the stale-
  // total gap after the verseday listener removal). Sums the estimate of EVERY
  // task scheduled today, done or not — matching the planned total's intent
  // (and the pre-cutover getTotalPlannedMinutes SQL, which has no status
  // filter). A prior version wrongly excluded done tasks, so a day with all
  // tasks completed read "0m" planned.
  const plannedMinutes = useMemo(
    () => tasks.reduce((sum, t) => sum + (t.estimated_minutes ?? 0), 0),
    [tasks],
  );
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

  // M4 — auto-sync the user's calendar into selectedDate. Owns the
  // hourly tick + visibilitychange + window.focus + permission re-check
  // + auto-flip on revoke. See src/calendar/hooks.ts.
  const { syncing: calendarSyncing, lastResultAt: calendarLastResultAt } =
    useCalendarAutoSync(selectedDate);
  const [showSlowSyncToast, setShowSlowSyncToast] = useState(false);

  // Create form
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskEstimate, setNewTaskEstimate] = useState<number | null>(null);
  const [newTaskProjectId, setNewTaskProjectId] = useState<string>("");
  // Add-task objective picker: active objectives only (completed ones aren't
  // assignable), preserving any current pick. See utils/objectiveOptions.
  const newTaskObjectiveOptions = useMemo(
    () => activeObjectiveOptions(projects, newTaskProjectId),
    [projects, newTaskProjectId],
  );
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

  // Right panel — R.3 (sidebar rebuild). Two collapsible sections:
  //   - Top: per-project disclosure (expandedProjectIds tracks which
  //     project headers are open). Trade-off ack'd in R.3 commit:
  //     project ids stay in this Set even after their tasks drain
  //     (project drops out of the rail). Set entry is dormant until
  //     the project repopulates; harmless. Track for R.4 polish if
  //     pruning ever surfaces.
  //   - Bottom: unified mixed-list disclosure (orphans + overdue),
  //     collapsed by default. Renamed from unscheduledExpanded in
  //     R.3 since the bottom is no longer orphans-only.
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<number>>(new Set());
  const [bottomSectionExpanded, setBottomSectionExpanded] = useState(false);
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

  // Shutdown state (for localStorage check only)
  const initialLoadDone = useRef(false);

  // R.3 — Right sidebar derives from canonical tasksById via the
  // selectors added in R.2. The sidebar's membership pool is loaded
  // once per loadData via loadSidebarPool (called in Promise.all
  // below); reactivity flows through tasksById subscriptions
  // automatically (selectors apply bucket-filter discipline at the
  // call site).
  const today = todayString();
  // R.4 — selectors take tasksById directly (focused input shape),
  // no double-cast. Memoization contract: same Map ref → same return.
  const tasksByProject = useMemo(
    () => selectUnscheduledTasksByProject(tasksById),
    [tasksById],
  );
  const orphanAndOverdueItems = useMemo(
    () => selectOrphanAndOverdueTasks(tasksById, today),
    [tasksById, today],
  );
  // Project ordering proxy: max(task.created_at) per project across
  // its open unscheduled tasks. Projects rank by recency of new task
  // creation, the closest "touched" timestamp we have without per-task
  // updated_at tracking. Verse R.1 review tracked this for R.3
  // verification — swap to task.updated_at / project.updated_at /
  // time_entries-based recency if the order feels surprising in
  // practice.
  const projectOrder = useMemo(() => {
    const entries: Array<{ projectId: number; maxCreatedAt: string }> = [];
    for (const [projectId, tasks] of tasksByProject) {
      const max = tasks.reduce(
        (acc, t) => (t.created_at > acc ? t.created_at : acc),
        "",
      );
      entries.push({ projectId, maxCreatedAt: max });
    }
    entries.sort((a, b) => (a.maxCreatedAt < b.maxCreatedAt ? 1 : -1));
    return entries.map((e) => e.projectId);
  }, [tasksByProject]);

  // Hover hint label for rail rows. When selectedDate === today,
  // says "Add to today". Otherwise the weekday short form (matches
  // the date-header style in the page chrome). Makes the row's
  // primary click action explicit; complements the hover chevron
  // (secondary detail-open action).
  const pullTargetLabel = useMemo(() => {
    if (selectedDate === today) return "today";
    return new Date(selectedDate + "T00:00:00").toLocaleDateString("en-US", {
      weekday: "short",
    });
  }, [selectedDate, today]);

  // Per-row undo for tasks pulled from the rail into today (10s window).
  // recentlyPulled snapshots each pulled task's pre-pull state so the
  // rail can render the row in `Undo` styling at its pre-pull
  // position; once the 10s timer fires (or the user clicks Undo),
  // the entry clears. Single-component scope, drag-preview-style
  // ephemera (parallels activeDragTask in ScheduleTab); lifting to
  // canonical store would create cross-screen visibility for
  // single-rail UI state with no cross-screen consumer.
  const [recentlyPulled, setRecentlyPulled] = useState<
    // eslint-disable-next-line no-restricted-syntax -- single-component undo state, see comment above
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

  // #8 — memoized so it's rebuilt only when `projects` changes, not on every
  // render (it feeds row rendering on a list that re-renders each focus tick).
  const projectMap = useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects]
  );

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
      if (selectedTaskDetailId !== null || confirmDeleteId !== null || editingId !== null) return;

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
    // #8 — the handler body reads no `tasks` (Space-on-hover-to-start was
    // removed); any closures it does use are read at call time. `tasks` in the
    // deps re-bound these window listeners on every task mutation for nothing,
    // so it's dropped — the deps are only the gate flags the body branches on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTaskDetailId, confirmDeleteId, editingId]);

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


  // #14 — `isStale` lets an effect-driven load abort its state writes if the
  // date changed or the view unmounted mid-read (fast date paging over slow
  // reads), so stale data never flashes. Event-handler callers (mounted) omit
  // it and behave as before.
  async function loadData(isStale?: () => boolean) {
    try {
      // Generate recurring task instances for this date before loading
      await generateRecurringInstances(selectedDate);
      const todayIso = todayString();
      // Roll over unfinished tasks from previous days (only for today)
      if (selectedDate === todayIso) {
        await rolloverUnfinishedTasks(todayIso);
      }
      // M3.2.b.1 — main task list goes through the store via
      // loadTasksForDate; the selector subscription re-renders the
      // list automatically. R.3 — right sidebar's pool primed via
      // loadSidebarPool (replaces the legacy getSidebarTasks +
      // getUnfinishedRolloverTasks dual-fetch and the
      // primeTasks/setSidebar*Ids state plumbing — sidebar reads
      // through canonical store selectors now).
      const [_lt, wm, dp, p, _sp] = await Promise.all([
        loadTasksForDate(selectedDate),
        getTotalWorkedMinutes(selectedDate),
        getDailyPlan(selectedDate),
        getProjects(),
        loadSidebarPool(),
      ]);
      void _lt;
      void _sp;
      if (isStale?.()) return;
      setWorkedMinutes(wm);
      setDailyPlan(dp);
      setProjects(p);
      // Fetch project stats for right panel
      const pStats = await getProjectStats();
      if (isStale?.()) return;
      setProjectStats(pStats);
      // Fetch worked minutes per task. Read taskIdsByDate fresh from the
      // store after the loadTasksForDate above resolved — taskIds in the
      // selector's React closure may still point to the prior render.
      const freshIds = useAppStore
        .getState()
        .taskIdsByDate.get(selectedDate) ?? [];
      if (freshIds.length > 0) {
        const wmap = await getWorkedMinutesForTaskIds(freshIds);
        if (isStale?.()) return;
        setWorkedMap(wmap);
      } else {
        setWorkedMap(new Map());
      }
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
    // #14 — cancelled-ref: paging to another date (or unmounting) mid-load
    // marks this run stale so loadData skips its state writes.
    let cancelled = false;
    loadData(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [selectedDate]);

  // M4 — refetch when calendar auto-sync imported new rows. Only
  // fires on result.created > 0 (Verse polish: no refetch noise on
  // every visibility ping that produces zero new rows).
  useEffect(() => {
    if (calendarLastResultAt === null) return;
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarLastResultAt]);

  // M3.2.b.5.b — verseday:task-updated/-deleted listener retired.
  // Task-data reactivity flows through the canonical tasksById
  // subscription (the `tasks` memo above re-runs when the map
  // changes). Non-task-data here that the listener used to refresh
  // (planned minutes, project stats, sidebar lists, worked minutes)
  // is either now derived from tasks (plannedMinutes memo) or
  // accepts stale-until-mount per the M3.2.b.5 audit (worked
  // minutes are M3.3 territory).

  // M4 — slow-sync toast. Appears only after sync has been in flight
  // for ≥3s; auto-clears when sync resolves. Plan §5.
  useEffect(() => {
    if (!calendarSyncing) {
      setShowSlowSyncToast(false);
      return;
    }
    const t = setTimeout(() => setShowSlowSyncToast(true), 3000);
    return () => clearTimeout(t);
  }, [calendarSyncing]);

  // Consume pendingDetailTask handed off from another page (e.g. Escape
  // from FocusMode) — open the singleton detail overlay for that task
  // and clear the slot. Cache the task first so the host resolves it
  // synchronously instead of falling back to a getTaskById fetch.
  // Re-mounts triggered by App.tsx's pageKey increment see a cleared
  // slot on the second pass and no-op.
  useEffect(() => {
    if (pendingDetailTask) {
      primeTasks([pendingDetailTask]);
      openTaskDetail(pendingDetailTask.id);
      setPendingDetailTask(null);
    }
  }, [pendingDetailTask, primeTasks, openTaskDetail, setPendingDetailTask]);

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
      const newId = await createTaskAction({
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
      // Collapse the add-task affordance after a successful add —
      // single-add is the typical flow; staying expanded would leave
      // a focused empty input that the user has to dismiss manually.
      // The `A` hotkey + the inline Add button still re-open it.
      setTaskInputExpanded(false);
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
      // M3.2.b.1 — store action handles optimistic map write + DB +
      // verseday:task-status-changed broadcast (FocusMode auto-stop).
      await setTaskStatusAction(task.id, wasDone ? "todo" : "done");
      // Unchecking a completed task bumps it to the BOTTOM of the
      // incomplete list (rather than restoring its prior position),
      // so the user can see what they just unchecked at a glance.
      // Find the max sort_order among other incomplete tasks for this
      // date and set the unchecked task's sort_order one higher.
      if (wasDone) {
        // M3.2.b.5.b — route through the store's setTaskSortOrders.
        // The store action expects the complete ordered ID list for
        // the bucket; reconstruct it with the just-unchecked task
        // appended to the end of incomplete (where it should now
        // appear, per the existing UX). `tasks` here is the closure-
        // captured array from before setTaskStatusAction's optimistic
        // write reached this render, so task.id is still in the
        // status === "done" partition; build the new order from that
        // pre-toggle view.
        const oldIncomplete = tasks
          .filter((t) => t.status !== "done")
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((t) => t.id);
        const oldDone = tasks
          .filter((t) => t.status === "done" && t.id !== task.id)
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((t) => t.id);
        const orderedIds = [...oldIncomplete, task.id, ...oldDone];
        await setTaskSortOrdersAction(
          { kind: "date", date: selectedDate },
          orderedIds,
        );
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
    if (current && current.taskId === task.id) return;
    try {
      if (current && current.mode === "active") {
        // Swap from one *active* focused task to another. Phase 1: close
        // the old time entry in the DB and optimistically update
        // workedMap so the old row's pill flips from live → static
        // cleanly with no flash.
        //
        // S.5 — workedMs is the truth. Write it to worked_seconds
        // before stopping. break_seconds = 0 (Daily Plan path doesn't
        // track Pomodoro breaks; pre-existing limitation).
        const finalElapsedMs = current.workedMs + current.priorElapsedMs;
        const finalMinutes = Math.floor(finalElapsedMs / 60000);
        const oldTaskId = current.taskId;
        const workedSeconds = Math.round(current.workedMs / 1000);
        await updateTimeEntryWorkedSeconds(current.timeEntryId, workedSeconds);
        await stopTimeEntry(current.timeEntryId, 0);
        setWorkedMap((prev) => {
          const next = new Map(prev);
          next.set(oldTaskId, finalMinutes);
          return next;
        });
      }
      // Preview-mode current is just discarded by the startFocus call
      // below — no time entry to close, no workedMap update needed.

      // Phase 2: start the new entry.
      const priorMinutes = await getWorkedMinutesForTask(task.id);
      const priorMs = priorMinutes * 60 * 1000;
      const entryId = await startTimeEntry(task.id, "tracked");
      // Phase 3: replace focus state (overwrites any existing focus).
      // Deliberately NOT calling setPage("focus") — DailyPlanner is the
      // one call site that keeps focus inline.
      startFocus(task, entryId, "daily", priorMs);
      if (current && current.mode === "active") {
        // After a swap from active, refetch so the swapped-out task's
        // pill picks up the authoritative worked total from time_entries
        // instead of the optimistic value.
        await loadData();
      }
    } catch (e) {
      setError(errorMessage(e, "Failed to start timer"));
      // If we closed the old entry but blew up before replacing focus,
      // the in-memory focus still points to a session whose time entry
      // is closed in the DB. Clear it so the stale live counter stops.
      const after = useAppStore.getState().focus;
      if (
        current &&
        current.mode === "active" &&
        after &&
        after.mode === "active" &&
        after.timeEntryId === current.timeEntryId
      ) {
        stopFocus();
      }
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
      // M3.2.b.1 — store action: optimistic write to canonical map +
      // index maintenance + DB. Failure path refetches truth.
      await updateTaskAction({
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
      // Refresh worked-minutes / planned-minutes / sidebar — those are
      // outside the canonical-task-map's reach.
      loadData();
    } catch (e) {
      setError(errorMessage(e, "Failed to update task"));
    }
  }

  async function pullTaskToDay(taskId: number) {
    // Capture original task + prev date for the undo window. R.3 —
    // resolves through canonical tasksById; the rail's selectors are
    // derived from the same map, so any task the user can see in the
    // rail is in tasksById by definition.
    const original = tasksById.get(taskId);
    const prevDate = original?.date_scheduled ?? null;
    try {
      // M3.2.b.5.b — store action handles canonical-map mutation +
      // index transitions (date+week buckets) atomically via
      // withTaskMutated. The dup-flicker race that 47ab541 and
      // a81c1a1 wrestled with closes by construction here: the
      // sidebar's bucket filter sees the task's date_scheduled flip
      // in the same set as the index update, so it never appears in
      // both pullable and recent simultaneously.
      await setTaskDateScheduledAction(taskId, selectedDate);
      // loadData still runs to refresh non-task-data (worked-minutes,
      // sidebar IDs from the cross-cutting query). Could be narrowed
      // to non-task-data refresh in M3.3; for now keep the simple call.
      loadData();
      // Brief entrance animation on the destination row in today's
      // main list — visual confirmation that the task moved. Reuses
      // the existing `animate-task-added` keyframe applied via
      // addedIds, same pattern as handleAddTask.
      setAddedIds((prev) => {
        const next = new Set(prev);
        next.add(taskId);
        return next;
      });
      setTimeout(() => {
        setAddedIds((prev) => {
          if (!prev.has(taskId)) return prev;
          const next = new Set(prev);
          next.delete(taskId);
          return next;
        });
      }, 400);
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
      await setTaskDateScheduledAction(taskId, entry.prevDate);
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
      // M3.2.b.1 — store action: optimistic removal from canonical map
      // + index cleanup + DB. Failure path re-inserts on refetch.
      await deleteTaskAction(id);
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
    // M3.2.b.5.b — store action handles the SQL batch + canonical
    // map sort_order patches + index slice replacement in one
    // atomic set. dnd-kit's drop animation covers the round-trip;
    // the bucket-replacement semantic preserves the SQL-loaded
    // ordering for any tasks not in the rendered list (none in this
    // case since DailyPlanner renders the full date bucket).
    try {
      await setTaskSortOrdersAction(
        { kind: "date", date: selectedDate },
        reordered.map((t) => t.id),
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
    // #5 — parse + format in LOCAL tz. toISOString() would format the local
    // date in UTC, shifting the day by ±1 in evening-west / morning-east zones
    // and letting the arrows mis-step (and tasks added while paging land wrong).
    const d = new Date(selectedDate + "T00:00:00");
    d.setDate(d.getDate() + offset);
    setSelectedDate(localDateIso(d));
  }

  // Trackpad swipe to page between days. Swipe left → next day, swipe right →
  // previous. We accumulate BOTH axes across the gesture (a gesture ends after
  // a brief pause) and judge horizontal-vs-vertical over the whole gesture, not
  // per event — a per-event dominance check dropped the jittery mixed deltas a
  // real trackpad emits, which made it feel like it wouldn't budge. Fires once
  // per gesture, then waits for the fling's momentum to settle, so a single
  // swipe steps exactly one day and vertical scrolling is left alone.
  const swipeRef = useRef<HTMLDivElement | null>(null);
  const changeDateRef = useRef(changeDate);
  changeDateRef.current = changeDate;
  useEffect(() => {
    const el = swipeRef.current;
    if (!el) return;
    const SWIPE_THRESHOLD = 50; // px of accumulated horizontal travel
    const GESTURE_GAP_MS = 150; // pause that ends a gesture / clears the lock
    let accX = 0;
    let accY = 0;
    let last = 0;
    let fired = false;
    const onWheel = (e: WheelEvent) => {
      const now = performance.now();
      if (now - last > GESTURE_GAP_MS) {
        accX = 0;
        accY = 0;
        fired = false;
      }
      last = now;
      accX += e.deltaX;
      accY += e.deltaY;
      if (fired) return;
      // Clearly horizontal over the whole gesture, past the distance threshold.
      if (Math.abs(accX) >= SWIPE_THRESHOLD && Math.abs(accX) > Math.abs(accY) * 1.4) {
        changeDateRef.current(accX > 0 ? 1 : -1);
        fired = true;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Visual feedback when the day changes: the day column slides + fades in from
  // the direction of travel (next day → in from the right, previous → from the
  // left). Direction is derived from the date delta, so it's correct however
  // the change was triggered — swipe, arrows, or the calendar. ISO date strings
  // compare chronologically, so a lexical compare gives the direction.
  const prevDateRef = useRef(selectedDate);
  useEffect(() => {
    const el = swipeRef.current;
    const prev = prevDateRef.current;
    prevDateRef.current = selectedDate;
    if (!el || prev === selectedDate) return;
    const from = selectedDate > prev ? 28 : -28;
    el.animate(
      [
        { opacity: 0.25, transform: `translateX(${from}px)` },
        { opacity: 1, transform: "translateX(0)" },
      ],
      { duration: 220, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
  }, [selectedDate]);

  const isToday = selectedDate === todayString();
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
      <div ref={swipeRef} className="flex-1 flex flex-col overflow-hidden">
      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {showSlowSyncToast && (
        <div className="mx-6 mt-2 mb-1 px-3 py-1.5 rounded-md text-[12px] text-fg-faded text-center" style={{ background: "var(--bg-elevated)", border: "0.5px solid var(--border-hairline)" }}>
          Syncing calendar…
        </div>
      )}

      {/* Date Header — top padding matches the sidebar's pt-4 so the
          date arrows sit on the same horizontal axis as the sidebar's
          collapse chevron, giving the page header a consistent baseline
          across the two columns. */}
      <div className="px-7 pt-4 pb-4">
        {/* Date row with stats right-aligned. Capped to the same column
            width as the task list below so everything stays on a single
            visual axis. */}
        <div className="flex items-center gap-2.5 min-h-[32px]">
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
            // M2.6 — pause symmetry. When the active session is paused,
            // the pill drops its accent-blue tint, the dot stops
            // pulsing, and the label flips from "Focusing…" to "Paused"
            // — matching the row pill's paused treatment in M2.3 and
            // the PiP's paused treatment.
            const isPaused = focus?.mode === "active" && focus.paused;
            const nextTask = tasks.find((t) => t.status !== "done");

            if (isFocusing) {
              return (
                <button
                  onClick={() => setPage("focus")}
                  className={
                    isPaused
                      ? "rounded-lg bg-overlay-hover text-fg-faded border border-line-soft hover:border-line-strong hover:bg-overlay-pressed cursor-pointer flex items-center gap-2 px-4 py-1.5 transition-colors"
                      : // Status pill, not primary CTA: softer accent-blue
                        // tint with an outlined edge so it reads as
                        // "currently running" instead of "click to start
                        // something." A slow opacity pulse on the dot
                        // (2s cycle, .45 → 1) gives a localized
                        // recording-light feel without the whole pill
                        // breathing.
                        "rounded-lg bg-accent-blue-soft text-accent-blue-soft-fg border border-accent-blue/40 hover:border-accent-blue hover:bg-accent-blue/15 cursor-pointer flex items-center gap-2 px-4 py-1.5 transition-colors"
                  }
                  title={isPaused ? "Open focus screen (paused)" : "Open focus screen"}
                >
                  <span
                    className={
                      isPaused
                        ? "w-2 h-2 rounded-full bg-fg-disabled"
                        : "w-2 h-2 rounded-full bg-accent-blue animate-focus-dot"
                    }
                    aria-hidden
                  />
                  <span className="text-[13px] font-medium">
                    {isPaused ? (
                      "Paused"
                    ) : (
                      <>
                        Focusing<span aria-hidden>
                          <span>.</span>
                          <span className="animate-ellipsis-2">.</span>
                          <span className="animate-ellipsis-3">.</span>
                        </span>
                      </>
                    )}
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
                    projects={newTaskObjectiveOptions}
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
                        taskId={task.id}
                        project={projectMap.get(task.project_id ?? -1)}
                        onToggle={toggleTask}
                        onEdit={startEdit}
                        onDelete={(id) => setConfirmDeleteId(id)}
                        onToggleNotes={(id) =>
                          setExpandedId(expandedId === id ? null : id)
                        }
                        onStart={handleStartFocus}
                        onOpenDetail={(t) => openTaskDetail(t.id)}
                        onOpenProject={openProject}
                        expandedNotes={expandedId === task.id}
                        workedMinutes={workedMap.get(task.id)}
                        showProject={true}
                        justArrived={arrivedIds.has(task.id)}
                        justAdded={addedIds.has(task.id)}
                        isFocused={focusedTaskId === task.id}
                        isPaused={
                          focusedTaskId === task.id &&
                          focus?.mode === "active" &&
                          focus.paused
                        }
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
                onClick={() => openSummaryOverlay("daily", selectedDate)}
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
            className="cursor-pointer transition-opacity hover:opacity-80 inline-flex items-center justify-center"
          >
            {/* Pill toggle — knob on the left + left-chevron means
                "click to expand the panel leftward into view".
                Same visual language as the sidebar collapse so panel
                chrome reads consistently across the app. */}
            <PillToggleIcon direction="left" />
          </button>
        </div>
      ) : (
      <div className="w-[220px] flex-shrink-0 flex flex-col overflow-y-auto">
        {/* Collapse handle + rail label. pt-[24px] aligns the button
            center with the Start focusing button in the main column's
            header (pt-5 + half of a 28px-tall button). Label uses the
            same uppercase var-driven treatment as "Daily notes" for
            section-label consistency. */}
        <div className="flex items-center justify-between px-3 pt-[24px] pb-1">
          <label className="uppercase [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] text-fg-faded">
            Add to today
          </label>
          <button
            onClick={toggleRightPanel}
            title="Hide panel"
            className="cursor-pointer transition-opacity hover:opacity-80 inline-flex items-center justify-center"
          >
            {/* Pill toggle, mirror state — knob on the right +
                right-chevron means "click to push the panel back to
                the right wall". */}
            <PillToggleIcon direction="right" />
          </button>
        </div>

        {/* R.3 — Top section: projects with unscheduled-open tasks.
            Project ordering by max(task.created_at) DESC (recency
            proxy). Tasks within each project ordered by created_at
            DESC. Recently-pulled rows interleaved at natural position
            during their 10s undo window. Section disappears entirely
            when no project has matching tasks (no header, no
            placeholder — Nick's "quiet empty space" call). */}
        {projectOrder.length > 0 && (
          <div className="px-2 space-y-1.5">
            {projectOrder.map((projectId) => {
              const project = projectMap.get(projectId);
              if (!project) return null;
              const baseTasks = tasksByProject.get(projectId) ?? [];
              // Interleave recently-pulled tasks for this project so
              // the row stays put with isRecent styling for 10s.
              // Merge + sort by created_at DESC so the pulled row
              // lands in its pre-pull position (rather than at the
              // end), letting the user undo from the same place
              // they clicked. The recent task's snapshot has the
              // same created_at it had before the pull.
              const recentForProject = Array.from(recentlyPulled.values())
                .map((r) => r.task)
                .filter((t) => t.project_id === projectId);
              const baseIds = new Set(baseTasks.map((t) => t.id));
              const recentOnly = recentForProject.filter((t) => !baseIds.has(t.id));
              const allInList = [...baseTasks, ...recentOnly].sort(
                (a, b) => (a.created_at < b.created_at ? 1 : -1),
              );
              const isExpanded = expandedProjectIds.has(projectId);
              return (
                <div key={projectId} className="rounded-md bg-elevated/40 overflow-hidden">
                  <button
                    onClick={() => {
                      setExpandedProjectIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(projectId)) next.delete(projectId);
                        else next.add(projectId);
                        return next;
                      });
                    }}
                    className="w-full flex items-center gap-1.5 px-2.5 py-1.5 hover:bg-overlay-hover transition-colors text-left cursor-pointer"
                  >
                    <span className="w-3 flex items-center justify-center text-accent-orange-soft-fg/70 flex-shrink-0">
                      <DisclosureCaret expanded={isExpanded} />
                    </span>
                    <div
                      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: project.color }}
                    />
                    <span className="text-[11.5px] text-fg truncate flex-1">{project.name}</span>
                    <span className="text-[10px] text-fg-disabled tabular-nums">
                      {baseTasks.length}
                    </span>
                  </button>
                  {isExpanded && (
                    <div className="px-1.5 pb-1.5 space-y-px">
                      {allInList.map((task) => {
                        const isRecent = recentlyPulled.has(task.id);
                        return (
                          <div
                            key={task.id}
                            className={`w-full flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors group relative ${
                              isRecent ? "bg-accent-blue/[0.07]" : "hover:bg-overlay-hover"
                            }`}
                          >
                            <button
                              onClick={() => {
                                if (isRecent) undoPull(task.id);
                                else pullTaskToDay(task.id);
                              }}
                              title={isRecent ? "Undo (within 10s)" : `Add to ${pullTargetLabel}`}
                              className="flex-1 min-w-0 flex items-center gap-1.5 cursor-pointer text-left"
                            >
                              <span
                                className={`text-[11px] flex-1 truncate transition-colors ${
                                  isRecent ? "text-fg-faded" : "text-fg group-hover:text-fg"
                                }`}
                              >
                                {task.title}
                              </span>
                              {!isRecent && (
                                <span className="text-[10px] text-accent-blue opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 font-medium whitespace-nowrap">
                                  Add to {pullTargetLabel}
                                </span>
                              )}
                            </button>
                            {isRecent ? (
                              <span className="text-[10px] text-accent-blue-soft-fg font-medium flex-shrink-0">
                                Undo
                              </span>
                            ) : (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openTaskDetail(task.id);
                                }}
                                title="Open details"
                                className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 text-fg-faded hover:text-fg"
                              >
                                <svg
                                  width="13"
                                  height="13"
                                  viewBox="0 0 14 14"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.6"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <path d="M5.5 3l4 4-4 4" />
                                </svg>
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Spacer — push bottom section to bottom */}
        <div className="flex-1 min-h-[40px]" />

        {/* R.3 — Bottom section: orphans + overdue (3+ days back, 14-day
            floor) under one collapsed-by-default disclosure. Sorted
            overdue-first by date_scheduled DESC, then orphans by
            created_at DESC (selector handles the sort). recentlyPulled
            rows merged in so the row stays put with isRecent styling
            for the 10s undo window. Section disappears when the list
            is empty (no header, no placeholder). */}
        {(() => {
          const recentBottom = Array.from(recentlyPulled.values()).map(
            (r) => r.task,
          );
          const baseIds = new Set(orphanAndOverdueItems.map((t) => t.id));
          // Project-rail recents render in the top section under
          // their project header, so exclude them here. The recent's
          // task snapshot has its pre-pull project_id, which is the
          // right discriminator regardless of post-pull canonical state.
          const recentOnly = recentBottom.filter(
            (t) => !baseIds.has(t.id) && t.project_id === null,
          );
          // Merge and re-sort using the selector's logic so the
          // pulled row lands in its pre-pull position.
          // - overdue (date_scheduled !== null) first, by
          //   date_scheduled DESC with sort_order tiebreak
          // - orphans (date_scheduled === null) next, by created_at DESC
          const items = [...orphanAndOverdueItems, ...recentOnly].sort(
            (a, b) => {
              const aOverdue = a.date_scheduled !== null;
              const bOverdue = b.date_scheduled !== null;
              if (aOverdue && !bOverdue) return -1;
              if (!aOverdue && bOverdue) return 1;
              if (aOverdue) {
                const ad = a.date_scheduled as string;
                const bd = b.date_scheduled as string;
                if (ad !== bd) return ad < bd ? 1 : -1;
                return a.sort_order - b.sort_order;
              }
              return a.created_at < b.created_at ? 1 : -1;
            },
          );
          if (items.length === 0) return null;
          return (
            <div className="px-2 mt-2">
              <div className="rounded-md bg-overlay-hover/60 overflow-hidden">
                <button
                  onClick={() => setBottomSectionExpanded((v) => !v)}
                  className="w-full flex items-center gap-1.5 px-2.5 py-2 cursor-pointer text-left hover:bg-overlay-hover transition-colors"
                >
                  <span className="w-3 flex items-center justify-center text-accent-orange-soft-fg/70 flex-shrink-0">
                    <DisclosureCaret expanded={bottomSectionExpanded} />
                  </span>
                  <span className="text-[11px] text-fg-muted flex-1">Unscheduled & overdue</span>
                  <span className="text-[10px] text-fg-disabled tabular-nums">{items.length}</span>
                </button>
                {bottomSectionExpanded && (
                  <div className="px-1.5 pb-1.5 space-y-px">
                    {items.map((task) => {
                      const isRecent = recentlyPulled.has(task.id);
                      return (
                        <div
                          key={task.id}
                          className={`w-full flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors group relative ${
                            isRecent ? "bg-accent-blue/[0.07]" : "hover:bg-overlay-hover"
                          }`}
                        >
                          <button
                            onClick={() => {
                              if (isRecent) undoPull(task.id);
                              else pullTaskToDay(task.id);
                            }}
                            title={isRecent ? "Undo (within 10s)" : `Add to ${pullTargetLabel}`}
                            className="flex-1 min-w-0 flex items-center gap-1.5 cursor-pointer text-left"
                          >
                            <span
                              className={`text-[11px] flex-1 truncate transition-colors ${
                                isRecent ? "text-fg-faded" : "text-fg-secondary group-hover:text-fg"
                              }`}
                            >
                              {task.title}
                            </span>
                            {!isRecent && (
                              <span className="text-[10px] text-accent-blue opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 font-medium whitespace-nowrap">
                                Add to {pullTargetLabel}
                              </span>
                            )}
                          </button>
                          {isRecent ? (
                            <span className="text-[10px] text-accent-blue-soft-fg font-medium flex-shrink-0">
                              Undo
                            </span>
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openTaskDetail(task.id);
                              }}
                              title="Open details"
                              className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 text-fg-faded hover:text-fg"
                            >
                              <svg
                                width="13"
                                height="13"
                                viewBox="0 0 14 14"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.6"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M5.5 3l4 4-4 4" />
                              </svg>
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </div>
      )}
      </div>

      {/* Task detail overlay */}
      {/* TaskDetailOverlay is mounted as a singleton at App.tsx
          (M1 — see TaskDetailOverlayHost). This page calls openTaskDetail(id)
          to open it; the host owns rendering and DB plumbing. After
          M3.2.b.5.b, host mutations write through store actions —
          per-screen task lists re-render via canonical-map
          subscriptions, no event-bus refresh needed. */}

    </div>
  );
}
