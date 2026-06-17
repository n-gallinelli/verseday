import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  selectActiveObjectiveOptions,
  selectTaskIdsByProject,
  useAppStore,
} from "../../stores/appStore";
import { weekdayDates } from "../../utils/dates";
import { snapCenterToCursor } from "../../utils/dnd";
import { PLAN_TASK_DRAG_PREFIX } from "./PlanTaskList";
import { PLAN_DAY_DROP_PREFIX } from "./PlanDayStrip";
import {
  getWeeklyPlanProjectStatuses,
  setWeeklyPlanProjectStatus,
  clearWeeklyPlanProjectStatus,
  getWeeklyPlanCommitments,
  getWeeklyPlanCommitmentMarkers,
  setWeeklyPlanCommitment,
  clearWeeklyPlanCommitment,
  getWorkedSecondsForTask,
  getDefaultTaskEstimateMin,
  type WeeklyPlanProjectStatus,
} from "../../db/queries";
import type { Task } from "../../types";
import PlanProjectRail from "./PlanProjectRail";
import PlanProjectPanel from "./PlanProjectPanel";
import ErrorBanner from "../../components/ErrorBanner";
import { errorMessage } from "../../utils/errors";
import { parseTimeFromTitle } from "../../utils/format";

// Title for an auto-created day-cell "General task" — "Spend time addressing
// <first few words of the project>". Keeps the row self-explanatory (which
// project it's chipping away at) while staying short; the user can rename it.
// Falls back to a generic label if the project name is missing.
function generalTaskTitle(projectName: string | undefined): string {
  const words = (projectName ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "Spend time on this objective";
  return `Spend time addressing ${words.slice(0, 4).join(" ")}`;
}

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
  const createTaskAction = useAppStore((s) => s.createTaskAction);
  const tasksById = useAppStore((s) => s.tasksById);
  const weekDates = weekdayDates(selectedWeek);

  // Active objectives (archived=0 && !completed, name-sorted) — Plan is
  // forward-looking, so archived/completed projects don't surface. The
  // canonical selector returns exactly that filter+sort.
  const projects = useAppStore(useShallow((s) => selectActiveObjectiveOptions(s, "")));
  const [statuses, setStatuses] = useState<
    Map<number, WeeklyPlanProjectStatus>
  >(new Map());
  const [commitments, setCommitments] = useState<
    Map<number, Map<number, number>>
  >(new Map());
  // Which backing "General task" owns each (project, day) slot — drives the
  // day strip's ± / clear (Approach A). The `commitments` minutes above are
  // DERIVED from task estimates; these markers say which task ± edits.
  const [markers, setMarkers] = useState<Map<number, Map<number, number>>>(
    new Map()
  );
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
      const [statusMap, commitMap, markerMap] = await Promise.all([
        getWeeklyPlanProjectStatuses(selectedWeek),
        getWeeklyPlanCommitments(selectedWeek),
        getWeeklyPlanCommitmentMarkers(selectedWeek),
      ]);
      setStatuses(statusMap);
      setCommitments(commitMap);
      setMarkers(markerMap);
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

  // Initialize / re-validate the selected project once projects + statuses
  // are available. Keeps the prior selection if still valid; otherwise picks
  // the first not-yet-reviewed project. (Was inline in loadData when projects
  // came from a fetch; now that projects flow from the canonical selector the
  // selection logic lives in its own effect keyed on both inputs.)
  useEffect(() => {
    setSelectedId((current) => {
      if (current != null && projects.some((p) => p.id === current)) {
        return current;
      }
      const firstUnplanned = projects.find((p) => !statuses.has(p.id));
      return firstUnplanned?.id ?? null;
    });
  }, [projects, statuses]);

  // M3.2.b.5.b — verseday:task-updated/-deleted listener retired.
  // PlanTab's loadData refreshes project metadata, weekly plan
  // statuses, and commitments — none of which are derived from
  // task data. The listener was overcautious (it only fired
  // loadData; task-data reactivity already flows through
  // selectTaskIdsByProject + tasksById). Project / status /
  // commitment refreshes happen on selectedWeek change via the
  // existing useEffect.

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

  // Approach A: the day cell shows a DERIVED sum of task estimates; manual
  // ± / type sets the desired new cell TOTAL. The delta from the current sum is
  // absorbed by the slot's backing "General task" — created if none, its estimate
  // edited, or pristine-cleared if driven to 0. Dragged/other scheduled tasks are
  // never touched.
  async function setCommitment(
    projectId: number,
    dayOffset: number,
    minutes: number
  ) {
    try {
      const dateIso = weekDates[dayOffset];
      if (!dateIso) return;
      const currentSum = commitments.get(projectId)?.get(dayOffset) ?? 0;
      const delta = minutes - currentSum;
      if (delta === 0) return;
      const markerTaskId = markers.get(projectId)?.get(dayOffset) ?? null;

      if (markerTaskId == null) {
        // No General task yet. A decrease has nothing to reduce (the shown sum
        // comes from other scheduled tasks) — ignore. An increase spawns a
        // General task carrying the added minutes.
        if (delta <= 0) return;
        const newId = await createTaskAction({
          title: generalTaskTitle(
            projects.find((p) => p.id === projectId)?.name
          ),
          projectId,
          dateScheduled: dateIso,
          estimatedMinutes: delta,
        });
        await setWeeklyPlanCommitment(selectedWeek, projectId, dayOffset, newId);
      } else {
        const task = tasksById.get(markerTaskId);
        const currentEst = task?.estimated_minutes ?? 0;
        const nextEst = Math.max(0, Math.min(1440, currentEst + delta));
        if (nextEst <= 0) {
          await clearCommitment(projectId, dayOffset);
          return;
        }
        if (task) {
          await updateTaskAction({
            id: task.id,
            title: task.title,
            projectId: task.project_id,
            estimatedMinutes: nextEst,
            priority: task.priority,
            notes: task.notes,
            dateScheduled: task.date_scheduled,
            dueDate: task.due_date,
          });
        }
      }
      await loadData();
    } catch (e) {
      setError(errorMessage(e, "Failed to save commitment"));
    }
  }

  // Clear the slot's General task. Rule 1: hard-delete ONLY if it's pristine
  // (no worked time, not completed); otherwise keep the task (it holds real
  // logged time) and just drop the marker. Other tasks on the day are untouched.
  async function clearCommitment(projectId: number, dayOffset: number) {
    try {
      const markerTaskId = markers.get(projectId)?.get(dayOffset) ?? null;
      if (markerTaskId != null) {
        const worked = await getWorkedSecondsForTask(markerTaskId);
        const task = tasksById.get(markerTaskId);
        if (worked === 0 && task?.status !== "done") {
          await deleteTaskAction(markerTaskId);
        }
      }
      await clearWeeklyPlanCommitment(selectedWeek, projectId, dayOffset);
      await loadData();
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
      await createTaskAction({
        title: cleanTitle,
        projectId: selectedId,
        dateScheduled: null,
        estimatedMinutes: est,
      });
      // createTaskAction already wrote to canonical map + indices;
      // explicit reloadTasks is redundant for the new task itself
      // but kept for cases where the project_id of the new task
      // doesn't match selectedId (defensive — should always match).
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

      // Approach A: no commitment aggregate to maintain — rescheduling the task
      // is the whole story. The day cells are DERIVED from task estimates, so
      // refresh them (and markers) from truth after the move.
      await loadData();
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
          (M1 — see TaskDetailOverlayHost). After M3.2.b.5.b, host
          mutations route through store actions — local state
          re-renders via canonical-map subscriptions automatically. */}
    </div>
  );
}
