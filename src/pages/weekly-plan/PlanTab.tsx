import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { selectTaskIdsByProject, useAppStore } from "../../stores/appStore";
import { weekdayDates } from "../../utils/dates";
import { snapCenterToCursor } from "../../utils/dnd";
import { PLAN_TASK_DRAG_PREFIX } from "./PlanTaskList";
import { PLAN_DAY_DROP_PREFIX } from "./PlanDayStrip";
import {
  getProjects,
  getWeeklyPlanProjectStatuses,
  setWeeklyPlanProjectStatus,
  clearWeeklyPlanProjectStatus,
  getWeeklyPlanCommitments,
  setWeeklyPlanCommitment,
  clearWeeklyPlanCommitment,
  createTask,
  getDefaultTaskEstimateMin,
  type WeeklyPlanProjectStatus,
} from "../../db/queries";
import type { Project, Task } from "../../types";
import PlanProjectRail from "./PlanProjectRail";
import PlanProjectPanel from "./PlanProjectPanel";
import ErrorBanner from "../../components/ErrorBanner";
import { errorMessage } from "../../utils/errors";
import { parseTimeFromTitle } from "../../utils/format";

// Plan tab orchestrator — owns the data + selection state. Children
// (rail / panel / summary) are presentational. Week navigation
// (arrows + "this week" pill) lives in WeeklyPlanner above this tab,
// shared with Schedule.
export default function PlanTab() {
  const { selectedWeek } = useAppStore();
  const openTaskDetail = useAppStore((s) => s.openTaskDetail);
  const loadTasksForProject = useAppStore((s) => s.loadTasksForProject);
  const updateTaskAction = useAppStore((s) => s.updateTask);
  const deleteTaskAction = useAppStore((s) => s.deleteTaskAction);
  const tasksById = useAppStore((s) => s.tasksById);
  const weekDates = weekdayDates(selectedWeek);

  const [projects, setProjects] = useState<Project[]>([]);
  const [statuses, setStatuses] = useState<
    Map<number, WeeklyPlanProjectStatus>
  >(new Map());
  const [commitments, setCommitments] = useState<
    Map<number, Map<number, number>>
  >(new Map());
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // M3.2.b.3 — tasks for the currently-selected project flow through
  // the canonical store. Render filter excludes done tasks (PlanTab
  // shows non-done only — legacy SQL passed includeDone=false).
  const projectTaskIds = useAppStore((s) =>
    selectedId !== null ? selectTaskIdsByProject(s, selectedId) : null,
  );
  const tasks = useMemo(() => {
    if (projectTaskIds === null) return [] as Task[];
    const out: Task[] = [];
    for (const id of projectTaskIds) {
      const t = tasksById.get(id);
      if (t && t.status !== "done") out.push(t);
    }
    return out;
  }, [projectTaskIds, tasksById]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 1–5 keyboard signals forwarded to the day strip (nonce so repeated
  // presses re-fire even on the same dayOffset).
  const [toggleSignal, setToggleSignal] = useState<{
    dayOffset: number;
    nonce: number;
  } | null>(null);
  const nonceRef = useRef(0);

  // Drag state — name shown in the floating overlay while a task is
  // being dragged onto a day button.
  const [dragTaskTitle, setDragTaskTitle] = useState<string | null>(null);

  // Task-detail overlay — opening a chip on the day strip pops the
  // same overlay used by Schedule / Daily / Projects.

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const loadData = useCallback(async () => {
    try {
      const [allProjects, statusMap, commitMap] = await Promise.all([
        getProjects(false),
        getWeeklyPlanProjectStatuses(selectedWeek),
        getWeeklyPlanCommitments(selectedWeek),
      ]);
      // Intentional divergence from ScheduleTab: Plan is forward-looking,
      // so archived-but-has-tasks projects do NOT surface here. Schedule
      // includes them because they may carry scheduled tasks that need
      // to render; Plan asks "what should we commit time to next week,"
      // and archived projects shouldn't bid for that time.
      const active = allProjects
        .filter((p) => !p.archived && !p.completed)
        .sort((a, b) => a.name.localeCompare(b.name));
      setProjects(active);
      setStatuses(statusMap);
      setCommitments(commitMap);

      setSelectedId((current) => {
        if (current != null && active.some((p) => p.id === current)) {
          return current;
        }
        const firstUnplanned = active.find((p) => !statusMap.has(p.id));
        return firstUnplanned?.id ?? null;
      });
      setError(null);
    } catch (e) {
      setError(errorMessage(e, "Failed to load weekly plan"));
    } finally {
      setLoading(false);
    }
  }, [selectedWeek]);

  useEffect(() => {
    setLoading(true);
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

  // Load tasks for the currently-selected project into the canonical
  // store. The selector subscription above re-renders the list when
  // tasksById updates. Render filter (status !== "done") replaces the
  // legacy SQL includeDone=false. Partitioning between unscheduled
  // and scheduled-this-week happens at render time below.
  const reloadTasks = useCallback(async (projectId: number | null) => {
    if (projectId == null) return;
    try {
      await loadTasksForProject(projectId);
    } catch (e) {
      setError(errorMessage(e, "Failed to load project tasks"));
    }
  }, [loadTasksForProject]);

  useEffect(() => {
    reloadTasks(selectedId);
  }, [selectedId, reloadTasks]);

  // Bare 1–5 toggle days when the Plan tab has a project open.
  // App.tsx uses Cmd+1..6 for page nav and bare T/W/O/D/S/F — bare
  // digits are free here.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (selectedId == null) return;
      const el = document.activeElement;
      const isInput =
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          (el as HTMLElement).isContentEditable);
      if (isInput) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const dayOffset = "12345".indexOf(e.key);
      if (dayOffset === -1) return;
      e.preventDefault();
      nonceRef.current += 1;
      setToggleSignal({ dayOffset, nonce: nonceRef.current });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  function nextUnplannedAfter(
    currentId: number,
    nextStatuses: Map<number, WeeklyPlanProjectStatus>
  ): number | null {
    const idx = projects.findIndex((p) => p.id === currentId);
    if (idx === -1) return null;
    for (let i = 1; i <= projects.length; i++) {
      const candidate = projects[(idx + i) % projects.length];
      if (!nextStatuses.has(candidate.id)) return candidate.id;
    }
    return null;
  }

  async function markStatus(id: number, status: WeeklyPlanProjectStatus) {
    try {
      await setWeeklyPlanProjectStatus(selectedWeek, id, status);
      const newStatuses = new Map(statuses);
      newStatuses.set(id, status);
      setStatuses(newStatuses);
      setSelectedId(nextUnplannedAfter(id, newStatuses));
    } catch (e) {
      setError(errorMessage(e, "Failed to update project status"));
    }
  }

  async function clearStatus(id: number) {
    try {
      await clearWeeklyPlanProjectStatus(selectedWeek, id);
      const newStatuses = new Map(statuses);
      newStatuses.delete(id);
      setStatuses(newStatuses);
    } catch (e) {
      setError(errorMessage(e, "Failed to update project status"));
    }
  }

  // "Done planning the week" — sweep every still-unreviewed project.
  // Projects with ≥1 day committed → planned; otherwise → skipped.
  // Auto-skipping empty projects is intentional: the button needs to
  // be one click. The user can still revisit any project from the
  // week summary to adjust days afterward.
  //
  // Updates state after EACH successful write rather than once at
  // the end so a mid-loop failure leaves UI and DB consistent for
  // projects that did succeed; the user can retry "Done planning"
  // and the loop picks up from where it stopped (already-reviewed
  // projects are filtered out at the top).
  async function markRemainingProjects() {
    const remaining = projects.filter((p) => !statuses.has(p.id));
    if (remaining.length === 0) return;
    try {
      for (const p of remaining) {
        const days = commitments.get(p.id);
        const status: WeeklyPlanProjectStatus =
          days && days.size > 0 ? "planned" : "skipped";
        await setWeeklyPlanProjectStatus(selectedWeek, p.id, status);
        setStatuses((prev) => {
          const next = new Map(prev);
          next.set(p.id, status);
          return next;
        });
      }
      setSelectedId(null);
    } catch (e) {
      setError(errorMessage(e, "Failed to finish weekly plan"));
    }
  }

  async function setCommitment(
    projectId: number,
    dayOffset: number,
    minutes: number
  ) {
    try {
      await setWeeklyPlanCommitment(selectedWeek, projectId, dayOffset, minutes);
      // Functional update so back-to-back commitment writes (e.g. move
      // task = decrement source + increment target) don't stomp on each
      // other via stale-closure baselines.
      setCommitments((prev) => {
        const next = new Map(prev);
        const projMap = new Map(next.get(projectId) ?? new Map());
        projMap.set(dayOffset, minutes);
        next.set(projectId, projMap);
        return next;
      });
    } catch (e) {
      setError(errorMessage(e, "Failed to save commitment"));
    }
  }

  async function clearCommitment(projectId: number, dayOffset: number) {
    try {
      await clearWeeklyPlanCommitment(selectedWeek, projectId, dayOffset);
      setCommitments((prev) => {
        const next = new Map(prev);
        const projMap = new Map(next.get(projectId) ?? new Map());
        projMap.delete(dayOffset);
        if (projMap.size === 0) {
          next.delete(projectId);
        } else {
          next.set(projectId, projMap);
        }
        return next;
      });
    } catch (e) {
      setError(errorMessage(e, "Failed to clear commitment"));
    }
  }

  async function handleCreateTask(title: string) {
    if (selectedId == null) return;
    // Smart time parsing — pull a trailing "~12" / "30m" / "1h"
    // off the title and use it as the estimate. Same behavior the
    // Daily Plan + Project Detail screens use, so the gesture works
    // consistently wherever the user adds a task.
    let cleanTitle = title;
    let est: number | null = null;
    const parsed = parseTimeFromTitle(title);
    if (parsed.minutes != null) {
      cleanTitle = parsed.cleanTitle;
      est = parsed.minutes;
    }
    try {
      await createTask({
        title: cleanTitle,
        projectId: selectedId,
        dateScheduled: null,
        estimatedMinutes: est,
      });
      await reloadTasks(selectedId);
    } catch (e) {
      setError(errorMessage(e, "Failed to create task"));
    }
  }

  async function handleUpdateTaskTitle(id: number, title: string) {
    const existing = tasks.find((t) => t.id === id);
    if (!existing) return;
    try {
      // Store action is itself optimistic — no need for a separate
      // setTasks patch.
      await updateTaskAction({
        id,
        title,
        projectId: existing.project_id,
        estimatedMinutes: existing.estimated_minutes,
        priority: existing.priority,
        notes: existing.notes,
        dateScheduled: existing.date_scheduled,
        dueDate: existing.due_date,
      });
    } catch (e) {
      setError(errorMessage(e, "Failed to update task"));
    }
  }

  async function handleScheduleTask(taskId: number, dateIso: string) {
    if (selectedId == null) return;
    const targetOffset = weekDates.indexOf(dateIso);
    if (targetOffset === -1) return;
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    if (task.date_scheduled === dateIso) return; // no-op self-drop

    // Source: where the task was (null = unscheduled, otherwise a day
    // ISO that may or may not be in the current week).
    const fromDate = task.date_scheduled;
    const fromOffset =
      fromDate != null ? weekDates.indexOf(fromDate) : -1;

    // If the task has no estimate, fall back to the user's configured
    // default (Settings → Task defaults; 15m if unset). Persist it on
    // the task — chip displays it, and any later move correctly
    // transfers those minutes between days. After the createTask
    // default-substitution change, brand-new tasks always have an
    // estimate, so this branch only fires for legacy null rows.
    // An explicit 0 from the user is still honored as "no time."
    let estimate = task.estimated_minutes;
    const needsDefaultEstimate = estimate == null;
    if (needsDefaultEstimate) {
      estimate = await getDefaultTaskEstimateMin();
    }

    try {
      // M3.2.b.3 — single store-action call covers BOTH the date
      // change and the default-estimate persist. updateTask routes
      // through withTaskMutated which handles the date+week index
      // transitions atomically. Replaces the legacy
      // updateTaskDateScheduled + conditional updateTask sequence.
      await updateTaskAction({
        id: task.id,
        title: task.title,
        projectId: task.project_id,
        estimatedMinutes: needsDefaultEstimate ? estimate : task.estimated_minutes,
        priority: task.priority,
        notes: task.notes,
        dateScheduled: dateIso,
        dueDate: task.due_date,
      });

      // Commitment delta — transfer the task's estimate. Dropping a
      // 45-min task on Tuesday adds 45 to Tuesday's commitment;
      // dragging it from Tuesday to Wednesday transfers those 45
      // minutes (Tue -= 45, Wed += 45). Source decrement only fires
      // when the source day was a tracked day in this week.
      if (estimate != null && estimate > 0) {
        if (fromOffset !== -1) {
          const projMap = commitments.get(selectedId);
          const sourceCurrent = projMap?.get(fromOffset) ?? 0;
          const sourceNext = Math.max(0, sourceCurrent - estimate);
          if (sourceNext === 0) {
            await clearCommitment(selectedId, fromOffset);
          } else {
            await setCommitment(selectedId, fromOffset, sourceNext);
          }
        }
        const projMap = commitments.get(selectedId);
        const targetCurrent = projMap?.get(targetOffset) ?? 0;
        const targetNext = Math.min(1440, targetCurrent + estimate);
        await setCommitment(selectedId, targetOffset, targetNext);
      }
    } catch (e) {
      setError(errorMessage(e, "Failed to schedule task"));
    }
  }

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data.current as { taskTitle?: string } | undefined;
    setDragTaskTitle(data?.taskTitle ?? "Task");
  }

  function handleDragEnd(event: DragEndEvent) {
    setDragTaskTitle(null);
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (!activeId.startsWith(PLAN_TASK_DRAG_PREFIX)) return;
    if (!overId.startsWith(PLAN_DAY_DROP_PREFIX)) return;
    const taskId = Number(activeId.slice(PLAN_TASK_DRAG_PREFIX.length));
    const dateIso = overId.slice(PLAN_DAY_DROP_PREFIX.length);
    if (Number.isNaN(taskId)) return;
    handleScheduleTask(taskId, dateIso);
  }

  async function handleDeleteTask(id: number) {
    try {
      await deleteTaskAction(id);
    } catch (e) {
      setError(errorMessage(e, "Failed to delete task"));
    }
  }

  const selected = projects.find((p) => p.id === selectedId) ?? null;
  const selectedStatus =
    selectedId != null ? statuses.get(selectedId) ?? null : null;
  const selectedCommitments =
    selectedId != null
      ? commitments.get(selectedId) ?? new Map<number, number>()
      : new Map<number, number>();
  const allReviewed =
    !loading &&
    projects.length > 0 &&
    projects.every((p) => statuses.has(p.id));

  // Partition the selected project's tasks: anything with date_scheduled
  // = null goes into the panel's task list (week-level intent);
  // anything scheduled to a date in this week becomes a chip under the
  // matching day button. Anything scheduled outside this week is
  // ignored here — it'll show in the Schedule tab.
  const unscheduledTasks = tasks.filter((t) => t.date_scheduled === null);
  const scheduledTasksByDate = new Map<string, Task[]>();
  for (const date of weekDates) {
    scheduledTasksByDate.set(date, []);
  }
  for (const t of tasks) {
    if (t.date_scheduled && scheduledTasksByDate.has(t.date_scheduled)) {
      scheduledTasksByDate.get(t.date_scheduled)!.push(t);
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 plan-ambient-bg">
      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <DndContext
        sensors={dndSensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
      <div className="flex flex-1 min-h-0">
        <PlanProjectRail
          projects={projects}
          statuses={statuses}
          selectedId={selectedId}
          onSelect={setSelectedId}
          loading={loading}
        />
        <PlanProjectPanel
          project={selected}
          status={selectedStatus}
          selectedCommitments={selectedCommitments}
          allCommitments={commitments}
          allProjects={projects}
          allStatuses={statuses}
          weekDates={weekDates}
          tasks={unscheduledTasks}
          scheduledTasksByDate={scheduledTasksByDate}
          allReviewed={allReviewed}
          hasProjects={projects.length > 0}
          loading={loading}
          toggleSignal={toggleSignal}
          onSelectProject={setSelectedId}
          onDeselect={() => setSelectedId(null)}
          onMarkPlanned={(id) => markStatus(id, "planned")}
          onMarkSkipped={(id) => markStatus(id, "skipped")}
          onMarkUnplanned={(id) => clearStatus(id)}
          onMarkAllRemaining={markRemainingProjects}
          onSetCommitment={setCommitment}
          onClearCommitment={clearCommitment}
          onCreateTask={handleCreateTask}
          onUpdateTaskTitle={handleUpdateTaskTitle}
          onDeleteTask={handleDeleteTask}
          onOpenTaskDetail={(t) => openTaskDetail(t.id)}
        />
      </div>

      <DragOverlay dropAnimation={null} modifiers={[snapCenterToCursor]}>
        {dragTaskTitle && (
          <div
            className="bg-elevated border border-accent-blue/40 rounded-md px-3 py-1.5 text-[12px] text-fg max-w-[240px] truncate opacity-95"
            style={{ boxShadow: "var(--shadow-card)" }}
          >
            {dragTaskTitle}
          </div>
        )}
      </DragOverlay>
      </DndContext>

      {/* TaskDetailOverlay is mounted as a singleton at App.tsx
          (M1 — see TaskDetailOverlayHost). The verseday:task-updated /
          task-deleted listeners refresh local state when the host
          commits changes. */}
    </div>
  );
}
