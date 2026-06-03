import { create } from "zustand";
import type { Page, Task, Project } from "../types";
import { todayString, mondayOfWeek } from "../utils/dates";
import {
  createTask as dbCreateTask,
  deleteTask as dbDeleteTask,
  getSidebarPoolTasks,
  getTaskById,
  getTasksForDate,
  getTasksForProject,
  getTasksForWeek,
  getTimeEntryById,
  getWorkedMinutesForTaskIds,
  getRecurringTemplates,
  rolloverUnfinishedTasks as dbRolloverUnfinishedTasks,
  setTaskRecurrence as dbSetTaskRecurrence,
  setManualWorkedMinutes as dbSetManualWorkedMinutes,
  setTaskStatusFromUI,
  stopTimeEntry,
  toggleTaskHighlight as dbToggleTaskHighlight,
  updateTask as dbUpdateTask,
  propagateTemplateFieldsToFutureInstances,
  updateTaskDateScheduled as dbUpdateTaskDateScheduled,
  updateTaskSortOrders as dbUpdateTaskSortOrders,
  updateTimeEntryWorkedSeconds,
  getProjects,
  getProjectById,
  createProject as dbCreateProject,
  updateProject as dbUpdateProject,
  completeProject as dbCompleteProject,
  archiveProject as dbArchiveProject,
  deleteProject as dbDeleteProject,
  setProjectPriority as dbSetProjectPriority,
  setProjectIcon as dbSetProjectIcon,
  updateProjectSortOrders as dbUpdateProjectSortOrders,
} from "../db/queries";
import type { UpdateProjectInput } from "../db/queries";
import type { CreateTaskInput, UpdateTaskInput } from "../db/queries";

/** Returns the local-tz Monday-ISO of the week containing `dateIso`.
 *  Anchors on T00:00:00 to keep DST transitions from shifting the bucket. */
function weekStartFromDate(dateIso: string): string {
  return mondayOfWeek(new Date(dateIso + "T00:00:00"));
}

/** Returns the Sunday-ISO closing the week starting at `mondayIso`. */
function weekEndFromMonday(mondayIso: string): string {
  const d = new Date(mondayIso + "T00:00:00");
  d.setDate(d.getDate() + 6);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Module-level stable empty list. Returning the same array reference for
 *  every "no entry" lookup keeps subscribers from re-rendering on
 *  unrelated store changes. */
const EMPTY_ID_LIST: number[] = [];

/** Append `id` to the index entry at `key` if not already present.
 *  Returns a NEW Map only when the entry actually changed, so unchanged
 *  loads don't churn subscriber identity. */
function indexAppend<K>(idx: Map<K, number[]>, key: K, id: number): Map<K, number[]> {
  const existing = idx.get(key);
  if (existing && existing.includes(id)) return idx;
  const next = new Map(idx);
  next.set(key, existing ? [...existing, id] : [id]);
  return next;
}

/** Remove `id` from the index entry at `key`. Returns a NEW Map only
 *  when the id was actually present. */
function indexRemove<K>(idx: Map<K, number[]>, key: K, id: number): Map<K, number[]> {
  const existing = idx.get(key);
  if (!existing || !existing.includes(id)) return idx;
  const filtered = existing.filter((x) => x !== id);
  const next = new Map(idx);
  if (filtered.length === 0) next.delete(key);
  else next.set(key, filtered);
  return next;
}

/** A bucket-ordering key, compared element-by-element ascending. Single-date
 *  and single-project buckets order by [sort_order]; the week bucket spans
 *  Mon..Sun across dates so it orders by [date_scheduled, sort_order]. */
type IndexKey = readonly (number | string)[];

function compareIndexKeys(a: IndexKey, b: IndexKey): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const av = a[i];
    const bv = b[i];
    if (av === bv) continue;
    if (av === undefined) return -1;
    if (bv === undefined) return 1;
    return av < bv ? -1 : 1;
  }
  return 0;
}

/** Splice `id` into the index entry at `key`, keeping the entry ascending by
 *  `keyOf`. Stable: an id whose key ties an existing member lands AFTER it —
 *  matching loadTasksFor*'s `ORDER BY ... sort_order` and the DB's placement
 *  rules (new rows get MIN-1 → front; recurring instances 999 → back; calendar
 *  imports 0 → among the zeros). Mirrors indexAppend: no-op (same Map) when
 *  `id` is already present; returns a NEW Map only on change. */
function indexInsertOrdered<K>(
  idx: Map<K, number[]>,
  key: K,
  id: number,
  keyOf: (id: number) => IndexKey,
): Map<K, number[]> {
  const existing = idx.get(key);
  if (existing && existing.includes(id)) return idx;
  const arr = existing ?? [];
  const target = keyOf(id);
  let i = 0;
  while (i < arr.length && compareIndexKeys(keyOf(arr[i]), target) <= 0) i++;
  const nextArr = arr.slice();
  nextArr.splice(i, 0, id);
  const next = new Map(idx);
  next.set(key, nextArr);
  return next;
}

/** Order key for single-date / single-project buckets: sort_order only. An id
 *  absent from `map` (a transient index/map gap) yields +∞, so it appends
 *  rather than producing a NaN comparison (#4). */
const sortKeyOf = (map: Map<number, Task>) => (id: number): IndexKey => {
  const t = map.get(id);
  return [t ? t.sort_order : Infinity];
};

/** Order key for the week bucket (spans dates): (date_scheduled, sort_order),
 *  matching loadTasksForWeek's ORDER BY and the flat-array reads in Dashboard /
 *  SummaryOverlay. Without the date term a later-date task at a negative
 *  sort_order would jump ahead of an earlier date. Missing id → (+∞, +∞). */
const weekKeyOf = (map: Map<number, Task>) => (id: number): IndexKey => {
  const t = map.get(id);
  if (!t || t.date_scheduled == null) return ["￿", Infinity];
  return [t.date_scheduled, t.sort_order];
};

/** A recurring-task TEMPLATE (the definition/source): recurrence set, no
 *  source pointer of its own. Templates are kept OUT of the date/week/project
 *  list indices (P4) — they live in tasksById only, surfaced via
 *  selectTemplates. Generated INSTANCES (recurrence_source_id set, recurrence
 *  null) index normally. */
function isTemplate(t: Task): boolean {
  return t.recurrence != null && t.recurrence_source_id == null;
}

/** State patch: insert `task` into tasksById and the relevant secondary
 *  indices. Pure — caller passes to set((s) => ...). Templates are added to
 *  the map but excluded from every list index. */
export function withTaskInserted(s: AppState, task: Task): Partial<AppState> {
  const nextMap = new Map(s.tasksById);
  nextMap.set(task.id, task);
  let nextDateIdx = s.taskIdsByDate;
  let nextWeekIdx = s.taskIdsByWeek;
  let nextProjIdx = s.taskIdsByProject;
  const tpl = isTemplate(task);
  if (!tpl && task.date_scheduled !== null) {
    nextDateIdx = indexInsertOrdered(nextDateIdx, task.date_scheduled, task.id, sortKeyOf(nextMap));
    nextWeekIdx = indexInsertOrdered(nextWeekIdx, weekStartFromDate(task.date_scheduled), task.id, weekKeyOf(nextMap));
  }
  if (!tpl && task.project_id !== null) {
    nextProjIdx = indexInsertOrdered(nextProjIdx, task.project_id, task.id, sortKeyOf(nextMap));
  }
  return {
    tasksById: nextMap,
    taskIdsByDate: nextDateIdx,
    taskIdsByWeek: nextWeekIdx,
    taskIdsByProject: nextProjIdx,
  };
}

/** State patch: drop `task` from tasksById and any index it appears in. */
function withTaskRemoved(s: AppState, task: Task): Partial<AppState> {
  const nextMap = new Map(s.tasksById);
  nextMap.delete(task.id);
  let nextDateIdx = s.taskIdsByDate;
  let nextWeekIdx = s.taskIdsByWeek;
  let nextProjIdx = s.taskIdsByProject;
  if (task.date_scheduled !== null) {
    nextDateIdx = indexRemove(nextDateIdx, task.date_scheduled, task.id);
    nextWeekIdx = indexRemove(nextWeekIdx, weekStartFromDate(task.date_scheduled), task.id);
  }
  if (task.project_id !== null) {
    nextProjIdx = indexRemove(nextProjIdx, task.project_id, task.id);
  }
  return {
    tasksById: nextMap,
    taskIdsByDate: nextDateIdx,
    taskIdsByWeek: nextWeekIdx,
    taskIdsByProject: nextProjIdx,
  };
}

/** State patch: replace tasksById[id] with `after` and update any index
 *  whose membership changed (date_scheduled or project_id moved between
 *  buckets). The before/after framing is what makes this incremental
 *  rather than rebuild-from-scratch. */
export function withTaskMutated(s: AppState, before: Task, after: Task): Partial<AppState> {
  const nextMap = new Map(s.tasksById);
  nextMap.set(after.id, after);
  let nextDateIdx = s.taskIdsByDate;
  let nextWeekIdx = s.taskIdsByWeek;
  let nextProjIdx = s.taskIdsByProject;
  // Index membership is computed through isTemplate (P4): a task that becomes
  // a template drops out of ALL list indices even if only `recurrence`
  // changed (project_id unchanged), and one that ceases re-enters. Treating
  // a template's effective date/project as null collapses every transition
  // (date change, project change, becoming/ceasing a template) into the same
  // remove-old / add-new comparison.
  const beforeDate = isTemplate(before) ? null : before.date_scheduled;
  const afterDate = isTemplate(after) ? null : after.date_scheduled;
  if (beforeDate !== afterDate) {
    if (beforeDate !== null) {
      nextDateIdx = indexRemove(nextDateIdx, beforeDate, after.id);
      nextWeekIdx = indexRemove(nextWeekIdx, weekStartFromDate(beforeDate), after.id);
    }
    if (afterDate !== null) {
      // Ordered insert, not append: updateTaskDateScheduled keeps the moved
      // task's sort_order, so a reschedule must land it in sort_order position
      // in the new bucket — matching what loadTasksForDate would produce on
      // reload. Appending drifts the store from the DB until the next load.
      nextDateIdx = indexInsertOrdered(nextDateIdx, afterDate, after.id, sortKeyOf(nextMap));
      nextWeekIdx = indexInsertOrdered(nextWeekIdx, weekStartFromDate(afterDate), after.id, weekKeyOf(nextMap));
    }
  }
  const beforeProj = isTemplate(before) ? null : before.project_id;
  const afterProj = isTemplate(after) ? null : after.project_id;
  if (beforeProj !== afterProj) {
    if (beforeProj !== null) {
      nextProjIdx = indexRemove(nextProjIdx, beforeProj, after.id);
    }
    if (afterProj !== null) {
      nextProjIdx = indexInsertOrdered(nextProjIdx, afterProj, after.id, sortKeyOf(nextMap));
    }
  }
  return {
    tasksById: nextMap,
    taskIdsByDate: nextDateIdx,
    taskIdsByWeek: nextWeekIdx,
    taskIdsByProject: nextProjIdx,
  };
}

// ── Project canonical-map transitions (P3) ────────────────────────────────
// No secondary index for projects (small set; active/archived/completed are
// derived in selectors — Verse-approved). So these are plain set/delete on
// projectsById; Inserted/Mutated are intentionally identical (kept distinct
// for caller intent + parity with the task helpers).
function withProjectInserted(s: AppState, project: Project): Partial<AppState> {
  const next = new Map(s.projectsById);
  next.set(project.id, project);
  return { projectsById: next };
}
function withProjectMutated(s: AppState, project: Project): Partial<AppState> {
  const next = new Map(s.projectsById);
  next.set(project.id, project);
  return { projectsById: next };
}
function withProjectRemoved(s: AppState, project: Project): Partial<AppState> {
  const next = new Map(s.projectsById);
  next.delete(project.id);
  return { projectsById: next };
}

/** Pure reducer for project deletion (exported for tests): remove the project
 *  from projectsById AND mirror the DB's ON DELETE SET NULL — clear project_id
 *  on every task that pointed at it (canonical map + taskIdsByProject index),
 *  so no task is left referencing a deleted project. This is the audit-flagged
 *  orphan-divergence invariant. */
export function reduceProjectDeleted(s: AppState, id: number): Partial<AppState> {
  const before = s.projectsById.get(id);
  let working: AppState = before ? ({ ...s, ...withProjectRemoved(s, before) } as AppState) : s;
  const projTaskIds = s.taskIdsByProject.get(id) ?? [];
  for (const tid of projTaskIds) {
    const t = working.tasksById.get(tid);
    if (t) working = { ...working, ...withTaskMutated(working, t, { ...t, project_id: null }) } as AppState;
  }
  return {
    projectsById: working.projectsById,
    tasksById: working.tasksById,
    taskIdsByProject: working.taskIdsByProject,
    taskIdsByDate: working.taskIdsByDate,
    taskIdsByWeek: working.taskIdsByWeek,
  };
}

const FOCUS_STORAGE_KEY = "verseday_focus";
const SIDEBAR_COLLAPSED_KEY = "verseday_sidebar_collapsed";

// P0-1 — one-shot OS-resume flag (sleep/lid-close worked-time guard).
// Set by the `system-resumed` listener (App.tsx) when the OS signals a wake
// from sleep; consumed by the focus tick so the suspended span contributes 0.
// Module-level (not store state) — it's transient, must not trigger a render,
// and is read/cleared imperatively from the tick. See utils/workedTime.ts.
let focusResumePending = false;
/** Mark that the OS just resumed from sleep. */
export function markFocusResume(): void {
  focusResumePending = true;
}
/** Read-and-clear the resume flag. */
export function consumeFocusResume(): boolean {
  const v = focusResumePending;
  focusResumePending = false;
  return v;
}
/** Clear without reading — used when restarting the tick (e.g. unpause) so a
 *  flag that arrived while paused/inactive can't later eat a legitimate first
 *  second on resume. */
export function clearFocusResume(): void {
  focusResumePending = false;
}

// Discriminated union: a focus session is either *preview* (task picked,
// shown on the focus screen, but no time entry created — what the user
// sees when they click the Focus icon) or *active* (running session with
// a real time entry). The mode tag lets TypeScript narrow timeEntryId /
// startedAt accesses to the active branch and catch any code path that
// touches them in preview by mistake.
// S.6 — wall-clock fields (startedAt, pausedAtMs, pausedAccumMs)
// retired. workedMs is the sole source of truth for session-only
// elapsed; tickFocus increments it while running, togglePauseFocus
// flips a flag that gates the increment. taskId remains the canonical
// task reference (M2.2); selectFocusedTask resolves task data from the
// canonical tasksById map (M3.2.a).
export type FocusState =
  | {
      mode: "preview";
      taskId: number;
      previousPage: Page;
      priorElapsedMs: number;
    }
  | {
      mode: "active";
      taskId: number;
      timeEntryId: number;
      previousPage: Page;
      priorElapsedMs: number;
      /** Pause is a flag — tickFocus is gated on !paused, so workedMs
       *  freezes naturally during pauses. No wall-clock bookkeeping. */
      paused: boolean;
      /** Worked time this session, in ms. Incremented by tickFocus
       *  every ~1s while running. The live truth between start and
       *  stop; written to time_entries.worked_seconds on stop. */
      workedMs: number;
    };

interface AppState {
  currentPage: Page;
  pageHistory: Page[];
  selectedDate: string;
  selectedWeek: string;
  selectedProjectId: number | null;
  focus: FocusState | null;
  pendingDetailTask: Task | null;
  /** ID of the task whose detail overlay is currently open. `null` = closed.
   *  Read by the singleton TaskDetailOverlayHost mounted at the App shell.
   *  Not persisted — overlay always closes on app restart (see plan §5.2). */
  selectedTaskDetailId: number | null;
  /** Set by openTaskDetail when the caller wants the overlay to auto-focus
   *  the title input on open (e.g., ScheduleTab's quick-add draft flow).
   *  Cleared by closeTaskDetail. */
  taskDetailAutoFocusTitle: boolean;
  /** Canonical store-owned task map (M3.2.a). Single source of truth
   *  for task data in-memory; SQL is durable truth, this is the live
   *  mirror. Populated by load* actions (and transitionally by
   *  primeTasks for hybrid-pattern callers — see action docstring).
   *  Per-row subscribers read
   *  via selectTaskById; the detail-overlay host and focus screen
   *  resolve their tasks from here via selectTaskDetailTask /
   *  selectFocusedTask. */
  tasksById: Map<number, Task>;
  /** Secondary index: task IDs grouped by date_scheduled (NULL-scheduled
   *  tasks are NOT in this index). Maintained on every load* / updateTask
   *  / deleteTask / insertTask call. Read via selectTaskIdsByDate. */
  taskIdsByDate: Map<string, number[]>;
  /** Secondary index: task IDs grouped by project_id (NULL-project tasks
   *  are NOT in this index — consumers that want them filter the canonical
   *  map directly). Read via selectTaskIdsByProject. */
  taskIdsByProject: Map<number, number[]>;
  /** Secondary index: task IDs grouped by Monday-ISO of the week the
   *  task is scheduled in. NULL-scheduled tasks are NOT in this index.
   *  Read via selectTaskIdsByWeek. */
  taskIdsByWeek: Map<string, number[]>;
  /** Canonical worked-minutes-per-task index (P2). Committed/closed
   *  time_entries only (end_time IS NOT NULL) — the live focus session's
   *  open minutes are NOT here; consumers add them via the
   *  selectWorkedMinutesWithLive derivation. Populated by
   *  loadWorkedMinutes; refreshed by setTaskWorkedMinutesAction and on
   *  focus stop so it never diverges from time_entries. */
  workedByTaskId: Map<number, number>;
  /** Refresh workedByTaskId for the given task ids from DB truth
   *  (getWorkedMinutesForTaskIds). Ids absent from the result are set to
   *  0 so a task whose entries were cleared drops to 0, not stale. */
  loadWorkedMinutes: (taskIds: number[]) => Promise<void>;
  /** P4 — load recurring-task TEMPLATES into tasksById (kept out of the list
   *  indices by isTemplate). Surfaced via selectTemplates. */
  loadTemplates: () => Promise<void>;
  /** P4 — set/clear a task's recurrence (task↔template transition only; does
   *  NOT generate future instances — that propagation stays deferred). Setting
   *  recurrence makes it a template (DB also nulls date_scheduled); the
   *  reconcile routes through withTaskMutated so the isTemplate predicate pulls
   *  it out of (or back into) the date/week/project indices. Refetch-truth on
   *  failure; rethrows the invalid-format validation error. */
  setTaskRecurrenceAction: (taskId: number, recurrence: string | null) => Promise<void>;
  /** P6 — run the unfinished-task rollover for `today` and reconcile EVERY
   *  bucket it moved (source past dates + their weeks, today + its week, and
   *  the unscheduled set for expired tasks) via withTaskMutated — not just the
   *  active date. Replaces the raw rolloverUnfinishedTasks call. */
  rolloverTasksAction: (today: string) => Promise<void>;
  /** P2.2c — stop+commit the live focus session IFF it's the active session
   *  for `taskId`: write worked_seconds (from focus.workedMs) + end_time,
   *  refresh workedByTaskId[taskId] from DB, and clear focus in ONE atomic
   *  set (no render sees the session double-counted or dropped). Awaited by
   *  the inline-complete path before it reads day totals, so the day total
   *  reads committed truth (kills the under-count race). No-op if the active
   *  session isn't this task. */
  stopFocusedSessionForTask: (taskId: number, breakSeconds?: number) => Promise<void>;
  /** #8 — commit whatever focus session is currently active (write its live
   *  workedMs to the time entry, refresh committed minutes, clear focus) before
   *  a NEW session starts. No-op if nothing is active. Centralizes the
   *  start-focus guard so external handlers (Cmd+F, ProjectDetail, the detail
   *  overlay) can't abandon an in-flight session's worked time by overwriting
   *  focus. Delegates to stopFocusedSessionForTask for the actual commit. */
  endActiveFocusSession: () => Promise<void>;
  /** P-fix4 — silently reconcile one task's canonical store entry from DB truth
   *  (getTaskById → withTaskMutated / withTaskInserted / withTaskRemoved). No
   *  broadcast — used after a raw, deliberately-non-broadcasting DB write (e.g.
   *  FocusMode.handleDone's updateTaskStatus) so tasksById reflects status /
   *  completed_at / the future-date snap without re-firing status listeners. */
  reconcileTaskFromDb: (id: number) => Promise<void>;
  /** Canonical project map (P3). Holds ALL projects (active + archived);
   *  active/archived/completed are derived in selectors (no secondary index
   *  — small set). Populated by loadProjects; every project mutation routes
   *  through a reconciling action below. */
  projectsById: Map<number, Project>;
  /** Refresh projectsById from DB truth (getProjects(true) — includes
   *  archived so the canonical map is complete). */
  loadProjects: () => Promise<void>;
  /** Create a project; reconciles the new row into projectsById. Returns id.
   *  Rethrows validation errors (e.g. color collision) for the caller. */
  createProjectAction: (name: string, color: string) => Promise<number>;
  /** Update name/color/description/dates/notes; reconcile-on-success,
   *  refetch-on-failure, then rethrow so the UI can surface color collisions. */
  updateProjectAction: (input: UpdateProjectInput) => Promise<void>;
  completeProjectAction: (id: number, completed: boolean) => Promise<void>;
  setProjectPriorityAction: (id: number, priority: boolean) => Promise<void>;
  /** Set icon: reconciles BOTH icon and custom_icon_id into projectsById. */
  setProjectIconAction: (id: number, icon: string | null, customIconId: number | null) => Promise<void>;
  /** Archive/unarchive; rethrows the un-archive color-collision error. */
  archiveProjectAction: (id: number, archived: boolean) => Promise<void>;
  /** Delete a project, then mirror the DB's ON DELETE SET NULL: clear
   *  project_id on every affected task in tasksById (orphan-divergence fix). */
  deleteProjectAction: (id: number) => Promise<void>;
  /** Reorder: non-optimistic SQL-then-map (mirrors setTaskSortOrders). */
  reorderProjectsAction: (orderedIds: number[]) => Promise<void>;
  /** Open the singleton task detail overlay for `id`. Pass
   *  `{ autoFocusTitle: true }` to focus the title input on open
   *  (used by quick-add flows that create the task in draft state). */
  openTaskDetail: (id: number, opts?: { autoFocusTitle?: boolean }) => void;
  /** Close the singleton task detail overlay. */
  closeTaskDetail: () => void;
  /** Write multiple tasks to the canonical `tasksById` map without
   *  touching secondary indices. Used by the hybrid-pattern primes
   *  (Projects search, ScheduleTab cross-cutting queries, WeeklyShutdown
   *  completed list, DailyPlanner sidebar) where the caller's local ID
   *  list is the primary membership truth and tasksById is the live
   *  rendered-data source.
   *
   *  Distinct from the load* actions (which own a bucket and replace its
   *  primary index slice) and from insertTask (which owns a single
   *  newly-created row and propagates to all three indices via
   *  withTaskInserted). Intended specifically for the hybrid pattern.
   *
   *  Renamed from cacheTasks in M3.2.b.5.a (the M1 transitional bridge
   *  is gone; the action's purpose is hybrid-pattern priming). */
  primeTasks: (tasks: Task[]) => void;
  /** Load tasks for a specific date. Writes each task to tasksById
   *  and replaces taskIdsByDate[date] with the loaded ID list. Idempotent.
   *  On DB failure: leaves prior state intact and surfaces error via
   *  console.error (UI surfaces error banners through their own paths). */
  loadTasksForDate: (date: string) => Promise<void>;
  /** Load tasks for a project, including done tasks. ProjectDetail
   *  filters by `showDone` at render time — same status-filter pattern
   *  DailyPlanner uses for its day-list. Loading the full set keeps
   *  the toggle from triggering a re-query. Failure-path: prior state
   *  intact + console.error. */
  loadTasksForProject: (projectId: number) => Promise<void>;
  /** Load tasks for a week (Monday-ISO key). Failure-path: prior state
   *  intact + console.error. */
  loadTasksForWeek: (weekStart: string) => Promise<void>;
  /** R.2 — Right sidebar rebuild. Fetches the rail's membership
   *  pool (unscheduled-open + overdue 3+ days back, 14-day floor)
   *  via getSidebarPoolTasks and primes canonical via primeTasks.
   *  No secondary-index propagation — the rail's selectors filter
   *  tasksById directly with bucket predicates.
   *
   *  Idempotent. Re-running on every loadData() call is mostly
   *  redundant (canonical reactivity covers most updates between
   *  calls) but harmless.
   *
   *  Failure-path: prior state intact + console.error. */
  loadSidebarPool: () => Promise<void>;
  /** #11 — evict tasks from `tasksById` that no current view references, once
   *  the map exceeds a high threshold. Conservative: the keep-set is computed
   *  from the live indices, the focus/detail refs, AND the actual rail
   *  selectors, so it can never drop a task a view shows. No-op below the cap. */
  pruneTasksById: () => void;
  /** Optimistic patch + DB write. Updates tasksById and any affected
   *  secondary indices, then writes through to SQL.
   *
   *  Failure path (Verse req): on DB write rejection, the action
   *  refetches the task via getTaskById and writes truth back to the
   *  canonical map (and re-derives index membership). It also
   *  console.error's with the original patch and the error so the
   *  failure is debuggable. Callers should still surface user-visible
   *  errors via their own paths until banner/toast infra exists. */
  updateTask: (patch: UpdateTaskInput) => Promise<void>;
  /** Optimistic delete + DB write. Failure path: refetch the task; if
   *  it still exists, restore it to the map and indices; if not (race
   *  with another delete), leave deleted. console.error on any
   *  unexpected exception. */
  deleteTaskAction: (id: number) => Promise<void>;
  /** Status-change with the existing UI-broadcast side-effect (FocusMode
   *  listens to verseday:task-status-changed for cross-surface
   *  auto-stop). Optimistic map write; failure-path refetches truth and
   *  console.error's. */
  setTaskStatus: (id: number, status: Task["status"]) => Promise<void>;
  /** Toggle the is_highlight flag on a task. Optimistic map patch +
   *  DB. is_highlight isn't keyed by any secondary index, so no
   *  withTaskMutated bucket transition is needed — a shallow
   *  tasksById entry rewrite is sufficient. Failure-path refetches
   *  via getTaskById and writes truth back; console.error with
   *  debug context. M3.5 cleanup: replaces the legacy direct-DB
   *  toggleTaskHighlight call from DailyShutdown that left the
   *  canonical map stale until the next loadData. */
  setTaskHighlight: (id: number, isHighlight: boolean) => Promise<void>;
  /** Set manual worked minutes on a task. The DB query inserts/updates
   *  a synthetic time_entries row; nothing about the task row itself
   *  changes, so the canonical map only needs a touch (refetch) on
   *  failure. console.error on failure. */
  setTaskWorkedMinutesAction: (id: number, minutes: number) => Promise<void>;
  /** Insert a freshly-created task into tasksById and the relevant
   *  secondary indices. Called by code paths that create tasks
   *  (quick-add, schedule-tab drag-create, etc.). Pure in-memory
   *  side-effect — caller has already DB-inserted. */
  insertTask: (task: Task) => void;
  /** Optimistic date_scheduled write + DB. Wraps updateTaskDateScheduled
   *  and routes through withTaskMutated so date and week index slices
   *  transition atomically (the M3.2.b.5.a replacement for the
   *  legacy SQL-direct path used by pullTaskToDay / undoPull /
   *  ScheduleTab drag-end).
   *
   *  Failure path: refetch via getTaskById, write truth back to the
   *  canonical map; console.error with debug context. */
  setTaskDateScheduled: (id: number, date: string | null) => Promise<void>;
  /** Atomic re-order for a single bucket. Caller passes the bucket
   *  (date or project) and the complete ordered ID list for that
   *  bucket. Action writes sort_order updates to SQL, patches each
   *  affected task's sort_order in tasksById, and replaces the
   *  bucket's secondary-index slice with `orderedIds`.
   *
   *  Bucket parameter is explicit (not inferred from task.date_scheduled
   *  / project_id) — Verse review M3.2.b.5: implicit inference would
   *  be brittle since callers already know which bucket they're
   *  reordering.
   *
   *  Non-optimistic — SQL writes before the map update; dnd-kit's
   *  drop animation covers the round-trip latency. Avoids the
   *  rollback path that an optimistic write would need on partial
   *  failure (other actions in this surface ARE optimistic; the
   *  asymmetry is deliberate).
   *
   *  Failure path: refetch the bucket via loadTasksForDate /
   *  loadTasksForProject (the load action's primary-slice replacement
   *  restores SQL truth). console.error with debug context. */
  setTaskSortOrders: (
    bucket:
      | { kind: "date"; date: string }
      | { kind: "project"; projectId: number },
    orderedIds: number[],
  ) => Promise<void>;
  /** SQL-insert + canonical-map insert in one action. Wraps
   *  createTask SQL, fetches the new row via getTaskById, applies
   *  withTaskInserted (writes tasksById + propagates to date / project
   *  / week indices), and returns the new id.
   *
   *  Return-valued-with-side-effects is intentional — quick-add and
   *  drag-create both need the new id immediately to open the detail
   *  overlay or play the entrance animation. Mirrors stopFocus(): Page
   *  precedent.
   *
   *  Failure path: SQL error rejects; caller's catch fires. No
   *  optimistic write to roll back. console.error on any unexpected
   *  exception (e.g. getTaskById failing after a successful insert). */
  createTaskAction: (input: CreateTaskInput) => Promise<number>;
  /** Open-state for the singleton SummaryOverlay (day-summary modal).
   *  `null` = closed. Read by the singleton SummaryOverlayHost mounted at
   *  the App shell. Not persisted — overlay always closes on app restart
   *  (matches selectedTaskDetailId precedent). M3.1.a additive seam — no
   *  callers wire this yet; per-screen useState mounts retire in M3.1.b. */
  summaryOverlay:
    | { kind: "daily"; anchorDate: string }
    | { kind: "weekly"; anchorDate: string }
    | null;
  /** Open the singleton SummaryOverlay. */
  openSummaryOverlay: (kind: "daily" | "weekly", anchorDate: string) => void;
  /** Close the singleton SummaryOverlay. */
  closeSummaryOverlay: () => void;
  /** Open-state for the singleton SunsetOverlay (shutdown-completion
   *  animation). Read by SunsetOverlayHost mounted at the App shell. Not
   *  persisted. M3.1.a additive — wires up in M3.1.b. */
  sunsetOverlayOpen: boolean;
  /** Open the singleton SunsetOverlay. */
  openSunsetOverlay: () => void;
  /** Close the singleton SunsetOverlay. */
  closeSunsetOverlay: () => void;
  /** Persisted user preference for collapsed sidebar (non-focus pages). */
  sidebarCollapsed: boolean;
  /** Ephemeral expand override on focus screens — resets on remount. */
  sidebarFocusExpanded: boolean;
  /** Last tab the user was on inside the Weekly Planner. Survives
   *  navigating away and back within a session so the user returns to
   *  whatever they had open (plan vs schedule). */
  weeklyPlannerTab: "plan" | "schedule";
  setWeeklyPlannerTab: (tab: "plan" | "schedule") => void;
  /** Schedule-tab planned-hours total surfaced into the WeeklyPlanner
   *  header. Written by ScheduleTab whenever its weekTasks change;
   *  read by WeeklyPlanner so the readout sits inline next to the
   *  Plan/Schedule toggle instead of taking a row of its own. */
  schedulePlannedMinutes: number;
  setSchedulePlannedMinutes: (minutes: number) => void;
  setPage: (page: Page) => void;
  goBack: () => void;
  setSelectedDate: (date: string) => void;
  setSelectedWeek: (date: string) => void;
  openProject: (id: number) => void;
  /** Stage a task on the focus screen without starting a time entry. */
  previewFocus: (task: Task, previousPage: Page, priorElapsedMs?: number) => void;
  /** Promote a preview session to active. Caller has already created the
   *  time entry — pass the resulting id. */
  activateFocus: (timeEntryId: number) => void;
  /** Patch the task on the current focus session in-place. Used so edits
   *  made on the focus screen (notes, title) survive navigating away and
   *  back without requiring a fresh DB fetch. */
  updateFocusTask: (patch: Partial<Task>) => void;
  /** Sync the focus session's prior-elapsed baseline when the user
   *  changes the task's worked-minutes elsewhere (e.g. TaskDetailOverlay).
   *  Only fires if the current focus is on the given task. */
  setFocusPriorElapsedMs: (taskId: number, priorMs: number) => void;
  startFocus: (task: Task, timeEntryId: number, previousPage: Page, priorElapsedMs?: number) => void;
  stopFocus: () => Page;
  restoreFocus: () => Promise<void>;
  /** Toggle pause on the active focus session. Manages pausedAtMs /
   *  pausedAccumMs internally. No-op if focus is null or in preview mode.
   *  M2.1 — wired from FocusMode/PiP/DailyPlan in M2.2/M2.3. */
  togglePauseFocus: () => void;
  /** Override the focus session's *displayed* elapsed by back-solving
   *  pausedAccumMs against the current reference (pausedAtMs if paused,
   *  now otherwise). Replaces the direct `pausedAccumRef.current = ...`
   *  mutation in FocusMode.applyActualMs. The desiredElapsedMs argument
   *  is the on-screen elapsed *excluding* priorElapsedMs (i.e. what the
   *  helper at src/utils/focusElapsed.ts returns minus priorElapsedMs).
   *  No-op if focus is null or in preview mode. */
  adjustFocusElapsed: (desiredElapsedMs: number) => void;
  /** Increment the running session's workedMs by deltaMs. No-op if
   *  focus is null, in preview mode, or paused. Caller passes
   *  `Date.now() - lastTickAt` (not a fixed 1000ms) so JS event-loop
   *  stalls don't drift the counter. Persists on every call —
   *  per-second localStorage write is cheap; the persisted value is
   *  the answer if the app crashes between writes. Added in S.2 of
   *  the worked-seconds simplification. */
  tickFocus: (deltaMs: number) => void;
  setPendingDetailTask: (task: Task | null) => void;
  /** Toggle the sidebar (smart: focus pages flip the ephemeral override; other pages flip the persisted preference). */
  toggleSidebar: () => void;
  /** Set collapsed=true/false explicitly (used by arrow-key shortcuts and chevron). */
  setSidebarCollapsed: (collapsed: boolean) => void;
}

// todayString and mondayOfWeek used to live here as private helpers
// using UTC ISO formatting; both moved to src/utils/dates.ts as part of
// the local-date sweep (commit 450d761 + this work) so every consumer
// reads the same fixed implementation. Imported above.

function loadPersistedSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function persistSidebarCollapsed(v: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(v));
  } catch {
    // ignore quota / private mode
  }
}

function persistFocus(focus: FocusState | null): void {
  if (focus) {
    localStorage.setItem(FOCUS_STORAGE_KEY, JSON.stringify(focus));
  } else {
    localStorage.removeItem(FOCUS_STORAGE_KEY);
  }
}

/** Loader shape includes the legacy `task: Task` snapshot so restoreFocus
 *  can prime the cache from it on relaunch. The returned FocusState has
 *  no `task` field (M2.2 retired it); the caller picks the snapshot off
 *  this struct, primes the cache, then sets focus. */
type LoadedFocus = { focus: FocusState; legacyTaskSnapshot: Task | null };

function loadPersistedFocus(): LoadedFocus | null {
  try {
    const raw = localStorage.getItem(FOCUS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FocusState> & {
      mode?: "preview" | "active";
      task?: Task;
      taskId?: number;
    };
    // Back-compat: pre-mode entries default to "active" so users with a
    // live session at upgrade time keep it.
    const mode = parsed.mode ?? "active";

    // Migration: legacy shape only had `task: Task`. Backfill taskId
    // from the snapshot, hand the snapshot to restoreFocus to prime
    // the cache, then drop it from the returned focus state.
    const legacyTask = parsed.task as Task | undefined;
    const taskId = parsed.taskId ?? legacyTask?.id;
    if (taskId === undefined) {
      // Corrupt or pre-task-shape entry — drop it.
      localStorage.removeItem(FOCUS_STORAGE_KEY);
      return null;
    }

    if (mode === "preview") {
      return {
        focus: {
          mode: "preview",
          taskId,
          previousPage: parsed.previousPage ?? "daily",
          priorElapsedMs: parsed.priorElapsedMs ?? 0,
        },
        legacyTaskSnapshot: legacyTask ?? null,
      };
    }

    // mode === "active" — pause field defaults for pre-rev-2 entries.
    const active = parsed as Partial<Extract<FocusState, { mode: "active" }>>;
    if (active.timeEntryId === undefined) {
      // Active sessions need a time entry id. Corrupt.
      localStorage.removeItem(FOCUS_STORAGE_KEY);
      return null;
    }
    // S.6 — defensive retention of the pre-S.2 in-flight migration shim.
    // Modern persisted state has workedMs and lacks startedAt/pausedAtMs/
    // pausedAccumMs (S.6 retired those). Legacy state (from a build
    // pre-dating S.2) has the wall-clock fields but no workedMs.
    // - workedMs present → use it directly. No-op shim.
    // - workedMs missing → derive from the legacy wall-clock formula
    //   one final time, then immediately persist the modern shape
    //   (restoreFocus calls persistFocus right after — R3) so this
    //   path runs exactly once per legacy persisted entry.
    //
    // If the previous session was running (paused === false), force-
    // pause on derive — the worked-seconds model treats quit time as
    // not-worked, but the wall-clock formula included quit-window
    // elapsed up to the moment of relaunch. Force-pause prevents
    // ticking from that inflated value when the user resumes.
    const paused = active.paused ?? false;
    const persistedWorkedMs = (active as Partial<Extract<FocusState, { mode: "active" }>>)
      .workedMs;
    let workedMs: number;
    let resolvedPaused = paused;
    if (persistedWorkedMs !== undefined) {
      workedMs = persistedWorkedMs;
    } else {
      // Legacy derive path. Read the (now-extinct) wall-clock fields
      // from `parsed` directly — they're not on the FocusState type
      // anymore, but JSON.parse returns them if present in storage.
      const legacy = parsed as Partial<{
        startedAt: number;
        pausedAtMs: number | null;
        pausedAccumMs: number;
      }>;
      const startedAt = legacy.startedAt;
      if (startedAt === undefined) {
        // No workedMs and no startedAt → can't derive. Drop.
        localStorage.removeItem(FOCUS_STORAGE_KEY);
        return null;
      }
      const legacyPausedAtMs = legacy.pausedAtMs ?? null;
      const legacyPausedAccumMs = legacy.pausedAccumMs ?? 0;
      const now = Date.now();
      const openPause = paused && legacyPausedAtMs !== null ? now - legacyPausedAtMs : 0;
      workedMs = Math.max(0, now - startedAt - legacyPausedAccumMs - openPause);
      // Force-pause if the legacy state was running.
      if (!paused) resolvedPaused = true;
    }
    return {
      focus: {
        mode: "active",
        taskId,
        timeEntryId: active.timeEntryId,
        previousPage: active.previousPage ?? "daily",
        priorElapsedMs: active.priorElapsedMs ?? 0,
        paused: resolvedPaused,
        workedMs,
      },
      legacyTaskSnapshot: legacyTask ?? null,
    };
  } catch {
    localStorage.removeItem(FOCUS_STORAGE_KEY);
    return null;
  }
}

/** Selector: resolves the open detail overlay's task from the canonical
 *  tasksById map (M3.2.a). Returns null when the overlay is closed or
 *  the canonical map hasn't been primed for this id yet — the host's
 *  cache-miss effect issues a one-shot getTaskById fetch in that case
 *  to populate the map. */
export function selectTaskDetailTask(state: AppState): Task | null {
  const id = state.selectedTaskDetailId;
  if (id === null) return null;
  return state.tasksById.get(id) ?? null;
}

/** Selector: resolves the focused task from canonical tasksById so a
 *  rename or edit made elsewhere in the app re-renders subscribers
 *  immediately (M3.2.a).
 *
 *  Returns null when there is no focus session, or briefly during the
 *  load window after restoreFocus when the modern persisted shape has
 *  only taskId (no embedded snapshot to prime from). FocusMode and the
 *  PiP broadcast handle the null case. */
export function selectFocusedTask(state: AppState): Task | null {
  const f = state.focus;
  if (!f) return null;
  return state.tasksById.get(f.taskId) ?? null;
}

/** Selector: per-row task lookup. Stable reference — the same `Task`
 *  identity flows out across renders unless the entry was rewritten.
 *  Used by TaskCard's per-row subscription (M3.2.b.4). */
export function selectTaskById(state: AppState, id: number): Task | undefined {
  return state.tasksById.get(id);
}

/** Selector: ordered task IDs scheduled on `date`. Returns the stable
 *  module-level empty list when no entry has been loaded for that date,
 *  so subscribers don't churn on unrelated mutations. */
export function selectTaskIdsByDate(state: AppState, date: string): number[] {
  return state.taskIdsByDate.get(date) ?? EMPTY_ID_LIST;
}

/** Selector: ordered task IDs for `projectId`. */
export function selectTaskIdsByProject(state: AppState, projectId: number): number[] {
  return state.taskIdsByProject.get(projectId) ?? EMPTY_ID_LIST;
}

/** Selector: ordered task IDs scheduled in the week starting at
 *  `weekStart` (Monday-ISO). */
export function selectTaskIdsByWeek(state: AppState, weekStart: string): number[] {
  return state.taskIdsByWeek.get(weekStart) ?? EMPTY_ID_LIST;
}

/** Selector: worked-minutes for `taskId` INCLUDING the live focus session.
 *  P2 canonical derivation: committed closed-entry minutes
 *  (workedByTaskId) + the current session's minutes (focus.workedMs) — and
 *  ONLY when that task is the actively-running focus session. We add
 *  focus.workedMs (session-only, reset to 0 at start), NOT priorElapsedMs:
 *  priorElapsedMs is the committed baseline already counted in
 *  workedByTaskId, so adding it would double-count. Once focus clears (or
 *  pauses out of 'active'), this falls back to workedByTaskId alone — by
 *  which point the stopped session's minutes have been committed + the
 *  index refreshed (see commitFocusedSessionForTask), so there's no gap. */
export function selectWorkedMinutesWithLive(state: AppState, taskId: number): number {
  const committed = state.workedByTaskId.get(taskId) ?? 0;
  const f = state.focus;
  if (f && f.mode === "active" && f.taskId === taskId) {
    return committed + Math.round(f.workedMs / 60000);
  }
  return committed;
}

/** Selector: recurring-task TEMPLATES (P4) — the template-sources held in
 *  tasksById but excluded from every list index. Title-sorted (case-insensitive,
 *  matching getRecurringTemplates' COLLATE NOCASE). Fresh array — consume with
 *  useShallow. Populated via loadTemplates. */
export function selectTemplates(state: AppState): Task[] {
  return Array.from(state.tasksById.values())
    .filter(isTemplate)
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
}

/** Selector: a single project by id (no list → no useShallow needed). */
export function selectProjectById(state: AppState, id: number | null): Project | undefined {
  return id == null ? undefined : state.projectsById.get(id);
}

/** Selector: ALL projects incl. archived (equivalent to getProjects(true)).
 *  For surfaces that resolve chips for tasks on archived projects
 *  (PastShutdowns, WeeklyShutdown) — they must NOT use a status selector,
 *  which would drop archived projects. Fresh array — consume with useShallow. */
export function selectAllProjects(state: AppState): Project[] {
  return Array.from(state.projectsById.values());
}

/** Selector: objectives offered in a task's Objective dropdown — active
 *  (archived = 0) and NOT completed, name-ordered, with the current selection
 *  retained even if it's since been archived/completed (so an existing
 *  assignment still displays). Subsumes the old activeObjectiveOptions util +
 *  the hand-replicated getProjects() filters. Returns a fresh array — consume
 *  with useShallow. `currentValue` is the picker's value (id-as-string or ""). */
export function selectActiveObjectiveOptions(state: AppState, currentValue: string): Project[] {
  const active = Array.from(state.projectsById.values())
    .filter((p) => p.archived === 0 && !p.completed)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (currentValue && !active.some((p) => String(p.id) === currentValue)) {
    const current = state.projectsById.get(parseInt(currentValue, 10));
    if (current) return [...active, current];
  }
  return active;
}

/** Selector: projects filtered by archived status. "active" is sorted for the
 *  Objectives grid (priority desc, then sort_order asc, then name); "archived"
 *  by name. Returns a fresh array — consume with useShallow. */
export function selectProjectsByStatus(state: AppState, status: "active" | "archived"): Project[] {
  const all = Array.from(state.projectsById.values());
  if (status === "archived") {
    return all.filter((p) => p.archived === 1).sort((a, b) => a.name.localeCompare(b.name));
  }
  return all
    .filter((p) => p.archived === 0)
    .sort(
      (a, b) =>
        b.priority - a.priority ||
        (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
        a.name.localeCompare(b.name),
    );
}

/** R.2 — Right sidebar rebuild. Map of projectId → Task[] for
 *  projects that have at least one unscheduled, open task in the
 *  canonical map. Tasks within each project are sorted by
 *  `created_at DESC` (newest first per the rail's spec). Projects
 *  with zero matching tasks (or with project_id === null tasks,
 *  which belong to the orphan list instead) don't appear as keys.
 *
 *  Bucket-filter discipline: predicates re-validate `tasksById`
 *  membership at the call site, so a task whose status flips to
 *  done or whose date_scheduled gets set drops from the rail
 *  immediately without waiting for the next loadSidebarPool
 *  refresh.
 *
 *  Takes `tasksById` directly rather than the full AppState (R.4
 *  cleanup): this selector returns a fresh Map per call so it
 *  can't be used with Zustand's useAppStore subscription pattern
 *  (would re-render on every store change); consumers wrap with
 *  useMemo keyed on `tasksById`, which is the only input the body
 *  reads. Direct-input signature makes the dependency explicit
 *  and removes the `state as AppState` cast at the call site. */
export function selectUnscheduledTasksByProject(
  tasksById: Map<number, Task>,
): Map<number, Task[]> {
  const result = new Map<number, Task[]>();
  for (const t of tasksById.values()) {
    if (t.status === "done") continue;
    if (t.date_scheduled !== null) continue;
    if (t.project_id === null) continue;
    const list = result.get(t.project_id);
    if (list) list.push(t);
    else result.set(t.project_id, [t]);
  }
  for (const list of result.values()) {
    list.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }
  return result;
}

/** R.2 — Right sidebar rebuild. Flat list of "things to pull into
 *  today" — orphans (no project, no date) and overdue tasks (3+ days
 *  back from `today`, with a 14-day floor matching getSidebarPoolTasks).
 *
 *  `today` is the real-world current date (`todayString()`), NOT
 *  DailyPlanner's `selectedDate`. The overdue cutoff is anchored on
 *  real-world today; passing selectedDate would let the user "create
 *  overdue" by paging Daily Plan into the future. R.3's caller is
 *  responsible for passing the right value.
 *
 *  Sort order (per R.1 design + Verse confirmation): overdue first
 *  (date_scheduled DESC — most-recently-overdue at the top, since
 *  those are the most likely re-schedule candidates), then orphans
 *  (created_at DESC).
 *
 *  Takes `tasksById` directly rather than the full AppState (R.4
 *  cleanup) — see selectUnscheduledTasksByProject for the rationale.
 *  Wrap with useMemo at the consumer keyed on (tasksById, today). */
export function selectOrphanAndOverdueTasks(
  tasksById: Map<number, Task>,
  today: string,
): Task[] {
  const overdueCutoffDate = new Date(today + "T00:00:00");
  overdueCutoffDate.setDate(overdueCutoffDate.getDate() - 3);
  const overdueCutoffIso = `${overdueCutoffDate.getFullYear()}-${String(
    overdueCutoffDate.getMonth() + 1,
  ).padStart(2, "0")}-${String(overdueCutoffDate.getDate()).padStart(2, "0")}`;
  const hardFloorDate = new Date(today + "T00:00:00");
  hardFloorDate.setDate(hardFloorDate.getDate() - 14);
  const hardFloorIso = `${hardFloorDate.getFullYear()}-${String(
    hardFloorDate.getMonth() + 1,
  ).padStart(2, "0")}-${String(hardFloorDate.getDate()).padStart(2, "0")}`;
  const orphans: Task[] = [];
  const overdue: Task[] = [];
  for (const t of tasksById.values()) {
    if (t.status === "done") continue;
    if (t.external_dismissal_reason !== null) continue;
    if (t.date_scheduled === null && t.project_id === null) {
      orphans.push(t);
    } else if (
      t.date_scheduled !== null &&
      t.date_scheduled <= overdueCutoffIso &&
      t.date_scheduled >= hardFloorIso
    ) {
      overdue.push(t);
    }
  }
  overdue.sort((a, b) => {
    // Both date_scheduled non-null per the filter above.
    const ad = a.date_scheduled as string;
    const bd = b.date_scheduled as string;
    if (ad !== bd) return ad < bd ? 1 : -1;
    return a.sort_order - b.sort_order;
  });
  orphans.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return [...overdue, ...orphans];
}

export const useAppStore = create<AppState>((set, get) => ({
  currentPage: "daily",
  pageHistory: [],
  selectedDate: todayString(),
  selectedWeek: mondayOfWeek(),
  selectedProjectId: null,
  focus: null,
  pendingDetailTask: null,
  selectedTaskDetailId: null,
  taskDetailAutoFocusTitle: false,
  tasksById: new Map(),
  workedByTaskId: new Map(),
  projectsById: new Map(),
  taskIdsByDate: new Map(),
  taskIdsByProject: new Map(),
  taskIdsByWeek: new Map(),
  summaryOverlay: null,
  sunsetOverlayOpen: false,
  sidebarCollapsed: loadPersistedSidebarCollapsed(),
  sidebarFocusExpanded: false,
  weeklyPlannerTab: "plan",
  schedulePlannedMinutes: 0,
  setSchedulePlannedMinutes: (minutes) => set({ schedulePlannedMinutes: minutes }),
  setPage: (page) => {
    const prev = get().currentPage;
    if (prev === page) return;
    // Preview focus is scoped to the focus screen visit. Leaving focus
    // discards the preview so a fresh "next task" loads on next entry —
    // otherwise a queued task could go stale across navigation, or a
    // persisted preview could pin yesterday's pick.
    const f = get().focus;
    if (prev === "focus" && page !== "focus" && f?.mode === "preview") {
      persistFocus(null);
      set((s) => ({
        focus: null,
        currentPage: page,
        pageHistory: [...s.pageHistory.slice(-19), prev],
      }));
      return;
    }
    set((s) => ({
      currentPage: page,
      pageHistory: [...s.pageHistory.slice(-19), prev],
    }));
  },
  goBack: () => {
    const history = get().pageHistory;
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    set({ currentPage: prev, pageHistory: history.slice(0, -1) });
  },
  setSelectedDate: (date) => set({ selectedDate: date }),
  setSelectedWeek: (date) => set({ selectedWeek: date }),
  openProject: (id) => {
    const prev = get().currentPage;
    set((s) => ({
      currentPage: "project_detail",
      selectedProjectId: id,
      pageHistory: [...s.pageHistory.slice(-19), prev],
    }));
  },
  previewFocus: (task, previousPage, priorElapsedMs = 0) => {
    // Stages a task on the focus screen — no time entry, no startedAt.
    // The user transitions to active by hitting Play (FocusMode calls
    // activateFocus after creating the time entry).
    //
    // M2.2 — primes the canonical tasksById map so selectFocusedTask
    // resolves synchronously. The store no longer carries a task
    // snapshot; consumers read live task data through the selector.
    const focus: FocusState = {
      mode: "preview",
      taskId: task.id,
      previousPage,
      priorElapsedMs,
    };
    get().primeTasks([task]);
    persistFocus(focus);
    set({ focus });
  },
  activateFocus: (timeEntryId) => {
    const f = get().focus;
    if (!f || f.mode !== "preview") return;
    // Pause fields init to false / null / 0 on every active-mode
    // transition (here from preview, and in startFocus below). Replaces
    // FocusMode's reset-on-task-change effect at :177-181.
    const next: FocusState = {
      mode: "active",
      taskId: f.taskId,
      timeEntryId,
      previousPage: f.previousPage,
      priorElapsedMs: f.priorElapsedMs,
      paused: false,
      workedMs: 0,
    };
    persistFocus(next);
    set({ focus: next });
  },
  updateFocusTask: (patch) => {
    // M2.2 — `task` is no longer on FocusState; this action is a thin
    // primeTasks wrapper that preserves the existing API for callers
    // that want to splice an in-memory change to the focused task
    // (FocusMode's notes/title/estimate auto-saves; TaskDetailOverlay's
    // mirror writes). M3.2 may collapse this into the canonical
    // `updateTask` action depending on whether the wrapper still earns
    // its keep.
    const f = get().focus;
    if (!f) return;
    const current = get().tasksById.get(f.taskId);
    if (!current) return;
    const nextTask = { ...current, ...patch };
    get().primeTasks([nextTask]);
  },
  setFocusPriorElapsedMs: (taskId, priorMs) => {
    const f = get().focus;
    if (!f || f.taskId !== taskId) return;
    const next = { ...f, priorElapsedMs: priorMs } as FocusState;
    persistFocus(next);
    set({ focus: next });
  },
  startFocus: (task, timeEntryId, previousPage, priorElapsedMs = 0) => {
    // Sets focus state only — does NOT navigate to the immersive Focus page.
    // Callers that want the full-screen timer experience follow up with
    // setPage("focus") themselves (App.tsx F hotkey and ProjectDetail do).
    // DailyPlanner deliberately does not, so the user can keep planning
    // while the timer runs in the background with a live counter on the
    // focused task row.
    //
    // FocusMode no longer calls startFocus directly — it goes through
    // previewFocus → activateFocus so the screen can render the task
    // before the time entry is created.
    //
    // M2.2 — primes the cache so selectFocusedTask resolves
    // synchronously. Initializes pause fields.
    const focus: FocusState = {
      mode: "active",
      taskId: task.id,
      timeEntryId,
      previousPage,
      priorElapsedMs,
      paused: false,
      workedMs: 0,
    };
    get().primeTasks([task]);
    persistFocus(focus);
    set({ focus });
  },
  stopFocus: () => {
    const state = get();
    let prev = state.focus?.previousPage ?? "daily";
    // Guard against stale project_detail (#7)
    if (prev === "project_detail" && state.selectedProjectId === null) {
      prev = "projects";
    }
    persistFocus(null);
    // Only navigate when stopping from the immersive Focus screen.
    // Inline pauses (DailyPlanner row, etc.) must not whisk the user
    // back to wherever the timer was originally started.
    if (state.currentPage === "focus") {
      set({ focus: null, currentPage: prev });
    } else {
      set({ focus: null });
    }
    return prev;
  },
  restoreFocus: async () => {
    const persisted = loadPersistedFocus();
    if (!persisted) return;
    // Prime the cache so selectFocusedTask resolves on first render.
    // Legacy persisted shape carries a Task snapshot — use it directly.
    // Modern shape (post-M2.2) has only taskId; fall back to a one-shot
    // getTaskById fetch and prime asynchronously. Until that resolves,
    // FocusMode renders null (the cache-miss branch returns null), which
    // is invisible — millisecond order. M3.2 replaces this with the
    // canonical store-owned tasksById rehydration, removing the fetch.
    if (persisted.legacyTaskSnapshot) {
      get().primeTasks([persisted.legacyTaskSnapshot]);
    } else {
      const { taskId } = persisted.focus;
      void getTaskById(taskId)
        .then((t) => {
          if (t) get().primeTasks([t]);
        })
        .catch(() => {
          // Best effort — the host will refetch on first overlay open
          // or list refresh anyway.
        });
    }

    // S.2 R1 — orphan-entry-referenced-by-focus check. If the time
    // entry the focus points at is already closed (e.g.
    // closeOrphanedTimeEntries closed it during a prior run), don't
    // restore the focus; that would let a future Resume → Stop write
    // to a closed row. Land any locally-tracked workedMs on the
    // closed row first (only if its worked_seconds is currently 0 —
    // don't clobber a real backfill or prior write), then clear focus.
    if (persisted.focus.mode === "active") {
      try {
        const entry = await getTimeEntryById(persisted.focus.timeEntryId);
        if (entry && entry.end_time !== null) {
          if ((entry.worked_seconds ?? 0) === 0 && persisted.focus.workedMs > 0) {
            await updateTimeEntryWorkedSeconds(
              persisted.focus.timeEntryId,
              Math.round(persisted.focus.workedMs / 1000),
            );
          }
          persistFocus(null);
          return;
        }
      } catch {
        // DB read failed. Fall through and restore focus normally —
        // worse to crash on boot than to dangle a focus reference;
        // closeOrphanedTimeEntries (called after restoreFocus in
        // App.tsx) plus the existing stop path are the next safety net.
      }
    }

    // S.3 — auto-pause on relaunch (user mental model: "quit = paused").
    // Under the worked-seconds model this is a free flag flip:
    // workedMs was preserved correctly across the quit, so on
    // relaunch we just force-pause and the user clicks Resume to
    // continue. Already-paused sessions stay paused (the test below
    // is idempotent). Unlike the wall-clock-era pause-on-relaunch
    // milestone, no math is needed — no checkpoint lookup, no
    // pausedAtMs computation, no orphan-cap clamp. Just the flag.
    let restored = persisted.focus;
    if (restored.mode === "active" && !restored.paused) {
      restored = { ...restored, paused: true };
    }

    // S.2 R3 — flush the (possibly migrated, possibly auto-paused)
    // shape to localStorage immediately so the next launch sees the
    // new shape and the migration shim becomes a no-op. Without
    // this, every boot re-runs the shim against unchanged old-shape
    // JSON.
    persistFocus(restored);

    // Restore the (auto-paused) session state but do NOT navigate to the Focus
    // screen — the app should open to the Daily Plan by default. The restored
    // session is still there to resume from the daily row / Focus screen / PiP.
    set({ focus: restored });
  },
  togglePauseFocus: () => {
    // S.5 — flag flip only. Under the worked-seconds model, pause is
    // a flag; tickFocus is gated on !paused, so workedMs naturally
    // freezes during pauses. The legacy pausedAtMs/pausedAccumMs
    // accounting (M2.1) is no longer needed — wall-clock-derived
    // queries are gone (this commit), the displayed counter reads
    // focus.workedMs directly (S.3), and break_seconds no longer
    // captures pause time (the paused-time portion of getBreakSeconds
    // dropped this commit).
    const f = get().focus;
    if (!f || f.mode !== "active") return;
    const next: FocusState = { ...f, paused: !f.paused };
    persistFocus(next);
    set({ focus: next });
  },
  adjustFocusElapsed: (desiredElapsedMs) => {
    // S.5 — workedMs write only. The legacy back-solve against
    // pausedAccumMs is gone; wall-clock-derived queries are gone too.
    // The displayed counter reads focus.workedMs.
    const f = get().focus;
    if (!f || f.mode !== "active") return;
    const next: FocusState = { ...f, workedMs: Math.max(0, desiredElapsedMs) };
    persistFocus(next);
    set({ focus: next });
  },
  tickFocus: (deltaMs) => {
    // S.2 — increments workedMs while the session is running. No-op if
    // focus is null, in preview mode, or paused. Caller passes the
    // wall-clock delta since the last tick (Date.now() - lastTickAt),
    // not a fixed cadence — JS event-loop stalls or background-tab
    // throttling don't drift the counter; a stalled tick catches up
    // on the next iteration.
    //
    // INVARIANT (P0-1): this adds deltaMs unguarded. The sleep/lid-close
    // clamp lives at the SOLE caller — FocusMode's tick — because it must
    // consume the one-shot OS-resume flag (which doesn't belong in the
    // store). FocusMode's tick is the only thing that may call tickFocus.
    // Do NOT add another caller; that would route worked time around the
    // clamp (see utils/workedTime.ts, docs/...-stability-hardening-plan.md).
    //
    // Persists on every call. localStorage write-per-second is cheap;
    // the persisted value IS the answer if the app crashes.
    //
    // Wall-clock fields (startedAt/pausedAtMs/pausedAccumMs) are NOT
    // touched here — the dual-write seam in S.4 keeps them maintained
    // separately so wall-clock-derived queries continue to work
    // until the S.5 atomic cutover.
    const f = get().focus;
    if (!f || f.mode !== "active" || f.paused) return;
    if (deltaMs <= 0) return;
    const next: FocusState = { ...f, workedMs: f.workedMs + deltaMs };
    persistFocus(next);
    set({ focus: next });
  },
  setPendingDetailTask: (task) => set({ pendingDetailTask: task }),
  openTaskDetail: (id, opts) =>
    set({
      selectedTaskDetailId: id,
      taskDetailAutoFocusTitle: opts?.autoFocusTitle === true,
    }),
  closeTaskDetail: () =>
    set({ selectedTaskDetailId: null, taskDetailAutoFocusTitle: false }),
  openSummaryOverlay: (kind, anchorDate) =>
    set({ summaryOverlay: { kind, anchorDate } }),
  closeSummaryOverlay: () => set({ summaryOverlay: null }),
  openSunsetOverlay: () => set({ sunsetOverlayOpen: true }),
  closeSunsetOverlay: () => set({ sunsetOverlayOpen: false }),
  primeTasks: (tasks) => {
    if (tasks.length === 0) return;
    set((s) => {
      // M3.2.b.5.a — bulk write to canonical tasksById without
      // touching secondary indices. Hybrid-pattern callers own their
      // own ID list; the index propagation that load* actions do
      // would bloat secondary indices with hybrid-only data.
      const nextMap = new Map(s.tasksById);
      for (const t of tasks) nextMap.set(t.id, t);
      return { tasksById: nextMap };
    });
  },
  loadTasksForDate: async (date) => {
    try {
      const list = await getTasksForDate(date);
      set((s) => {
        // M3.2.a fix — propagate every loaded task across all three
        // indices, not just the primary one. The primary slice
        // (taskIdsByDate[date]) is set by replacement so the loaded
        // SQL order is preserved and tasks no longer scheduled for
        // this date drop out. The secondary indices
        // (taskIdsByProject / taskIdsByWeek) are appended via
        // indexAppend so cross-screen subscribers (b.2 Project
        // surfaces, b.3 Weekly surfaces) see the task without
        // requiring their own load. indexAppend is no-op-stable: if
        // the id is already present it returns the same Map ref.
        // Stale entries left in non-primary indices when a task moves
        // buckets via the legacy SQL-direct path are debt-2 territory
        // and get fixed in M3.2.b.5 when those paths route through
        // store actions.
        const nextMap = new Map(s.tasksById);
        let nextProjIdx = s.taskIdsByProject;
        let nextWeekIdx = s.taskIdsByWeek;
        const ids: number[] = [];
        for (const t of list) {
          nextMap.set(t.id, t);
          ids.push(t.id);
          if (t.project_id !== null) {
            nextProjIdx = indexAppend(nextProjIdx, t.project_id, t.id);
          }
          if (t.date_scheduled !== null) {
            nextWeekIdx = indexAppend(
              nextWeekIdx,
              weekStartFromDate(t.date_scheduled),
              t.id,
            );
          }
        }
        const nextDateIdx = new Map(s.taskIdsByDate);
        nextDateIdx.set(date, ids);
        return {
          tasksById: nextMap,
          taskIdsByDate: nextDateIdx,
          taskIdsByProject: nextProjIdx,
          taskIdsByWeek: nextWeekIdx,
        };
      });
    } catch (err) {
      console.error("[appStore] loadTasksForDate failed", { date, err });
    }
  },
  loadTasksForProject: async (projectId) => {
    try {
      // includeDone = true so ProjectDetail's showDone toggle is a
      // pure render-time filter rather than a re-query. SQL LIMIT 500
      // caps the worst case.
      const list = await getTasksForProject(projectId, true);
      set((s) => {
        // Same propagation pattern as loadTasksForDate. Primary slice
        // is taskIdsByProject[projectId]; secondary indices append.
        const nextMap = new Map(s.tasksById);
        let nextDateIdx = s.taskIdsByDate;
        let nextWeekIdx = s.taskIdsByWeek;
        const ids: number[] = [];
        for (const t of list) {
          nextMap.set(t.id, t);
          ids.push(t.id);
          if (t.date_scheduled !== null) {
            nextDateIdx = indexAppend(nextDateIdx, t.date_scheduled, t.id);
            nextWeekIdx = indexAppend(
              nextWeekIdx,
              weekStartFromDate(t.date_scheduled),
              t.id,
            );
          }
        }
        const nextProjIdx = new Map(s.taskIdsByProject);
        nextProjIdx.set(projectId, ids);
        return {
          tasksById: nextMap,
          taskIdsByDate: nextDateIdx,
          taskIdsByProject: nextProjIdx,
          taskIdsByWeek: nextWeekIdx,
        };
      });
    } catch (err) {
      console.error("[appStore] loadTasksForProject failed", { projectId, err });
    }
  },
  loadTasksForWeek: async (weekStart) => {
    try {
      const list = await getTasksForWeek(weekStart, weekEndFromMonday(weekStart));
      set((s) => {
        // Same propagation pattern as the other loaders. Primary
        // slice is taskIdsByWeek[weekStart]; secondary indices append.
        const nextMap = new Map(s.tasksById);
        let nextDateIdx = s.taskIdsByDate;
        let nextProjIdx = s.taskIdsByProject;
        const ids: number[] = [];
        for (const t of list) {
          nextMap.set(t.id, t);
          ids.push(t.id);
          if (t.date_scheduled !== null) {
            nextDateIdx = indexAppend(nextDateIdx, t.date_scheduled, t.id);
          }
          if (t.project_id !== null) {
            nextProjIdx = indexAppend(nextProjIdx, t.project_id, t.id);
          }
        }
        const nextWeekIdx = new Map(s.taskIdsByWeek);
        nextWeekIdx.set(weekStart, ids);
        return {
          tasksById: nextMap,
          taskIdsByDate: nextDateIdx,
          taskIdsByProject: nextProjIdx,
          taskIdsByWeek: nextWeekIdx,
        };
      });
    } catch (err) {
      console.error("[appStore] loadTasksForWeek failed", { weekStart, err });
    }
  },
  loadSidebarPool: async () => {
    try {
      const list = await getSidebarPoolTasks(todayString());
      // Pure prime — no secondary-index touch. The rail's selectors
      // (selectUnscheduledTasksByProject + selectOrphanAndOverdueTasks)
      // scan tasksById with bucket predicates, so the canonical map
      // is the only state that needs the rail's pool merged in.
      get().primeTasks(list);
      // #11 — bound canonical-map growth across a long always-open session.
      // Triggered here (Daily Planner path), never during Projects search,
      // whose primed-but-unindexed results live in component state the store
      // can't see — so it can't evict an actively-displayed search row.
      get().pruneTasksById();
    } catch (err) {
      console.error("[appStore] loadSidebarPool failed", { err });
    }
  },
  pruneTasksById: () => {
    const s = get();
    // High cap: a realistic working set (loaded days + project/week views +
    // rail pool) is in the low hundreds; only pathological multi-day
    // accumulation crosses this. Scanning is O(map) but runs only when over.
    const MAX_TASKS = 1500;
    if (s.tasksById.size <= MAX_TASKS) return;

    // Keep-set = everything any current view can resolve:
    //  - the three id indices (date / project / week)
    //  - focus + open-detail + pending-detail refs
    //  - whatever the rail selectors would surface (computed by invoking the
    //    SAME selectors the rail uses, so this can't drift from the views)
    const keep = new Set<number>();
    for (const ids of s.taskIdsByDate.values()) for (const id of ids) keep.add(id);
    for (const ids of s.taskIdsByProject.values()) for (const id of ids) keep.add(id);
    for (const ids of s.taskIdsByWeek.values()) for (const id of ids) keep.add(id);
    if (s.focus) keep.add(s.focus.taskId);
    if (s.selectedTaskDetailId !== null) keep.add(s.selectedTaskDetailId);
    if (s.pendingDetailTask) keep.add(s.pendingDetailTask.id);
    for (const list of selectUnscheduledTasksByProject(s.tasksById).values())
      for (const t of list) keep.add(t.id);
    for (const t of selectOrphanAndOverdueTasks(s.tasksById, todayString()))
      keep.add(t.id);

    if (keep.size >= s.tasksById.size) return; // nothing evictable
    const next = new Map<number, Task>();
    for (const id of keep) {
      const t = s.tasksById.get(id);
      if (t) next.set(id, t);
    }
    // No silent cap: report what was dropped.
    console.debug(
      `[appStore] pruneTasksById: ${s.tasksById.size} → ${next.size} (evicted ${s.tasksById.size - next.size} unreferenced)`,
    );
    set({ tasksById: next });
  },
  updateTask: async (patch) => {
    const current = get().tasksById.get(patch.id);
    // No current entry → caller is racing a delete. Run the DB write
    // anyway (caller's intent stands) but don't mutate the map; on
    // success we leave the map empty for this id, which is correct
    // (the task isn't currently visible anywhere).
    try {
      if (current) {
        const next: Task = {
          ...current,
          title: patch.title,
          project_id: patch.projectId,
          estimated_minutes: patch.estimatedMinutes,
          priority: patch.priority,
          notes: patch.notes,
          date_scheduled: patch.dateScheduled,
          due_date: patch.dueDate === undefined ? current.due_date : patch.dueDate,
        };
        // Optimistic in-memory write before the DB call so the UI updates
        // before the await completes.
        set((s) => withTaskMutated(s, current, next));
      }
      await dbUpdateTask(patch);

      // #10 — when the edited row is a recurring TEMPLATE, propagate its
      // title/estimate to existing FUTURE-dated instances (option (a),
      // future-only). Past/today instances stay as a historical record. Cadence
      // edits are handled separately by setTaskRecurrenceAction (future
      // generation only). Reconcile each touched instance from DB truth so the
      // canonical map/indices reflect the new title/estimate.
      if (current && isTemplate(current)) {
        const affected = await propagateTemplateFieldsToFutureInstances(
          patch.id,
          patch.title,
          patch.estimatedMinutes,
        );
        for (const instId of affected) {
          const freshInst = await getTaskById(instId);
          const beforeInst = get().tasksById.get(instId);
          if (freshInst && beforeInst) {
            set((s) => withTaskMutated(s, beforeInst, freshInst));
          } else if (freshInst) {
            set((s) => withTaskInserted(s, freshInst));
          }
        }
      }
    } catch (err) {
      console.error("[appStore] updateTask failed — refetching truth", {
        patch,
        err,
      });
      // Failure path (Verse req): refetch and write truth back.
      try {
        const fresh = await getTaskById(patch.id);
        const before = get().tasksById.get(patch.id);
        if (fresh) {
          if (before) set((s) => withTaskMutated(s, before, fresh));
          else set((s) => withTaskInserted(s, fresh));
        } else if (before) {
          set((s) => withTaskRemoved(s, before));
        }
      } catch (refetchErr) {
        console.error("[appStore] updateTask refetch also failed", refetchErr);
      }
    }
  },
  deleteTaskAction: async (id) => {
    const current = get().tasksById.get(id);
    if (current) set((s) => withTaskRemoved(s, current));
    try {
      await dbDeleteTask(id);
      // Broadcast so settings-only lists that aren't backed by the
      // canonical store indices (e.g. RepeatingTasksSettings, which loads
      // recurrence templates via getRecurringTemplates) can reload. The
      // store mutation above doesn't reach them — templates are excluded
      // from every taskIdsBy* index, so they hold their own local state.
      window.dispatchEvent(
        new CustomEvent("verseday:task-deleted", { detail: { id } }),
      );
    } catch (err) {
      console.error("[appStore] deleteTask failed — refetching truth", { id, err });
      try {
        const fresh = await getTaskById(id);
        if (fresh) set((s) => withTaskInserted(s, fresh));
      } catch (refetchErr) {
        console.error("[appStore] deleteTask refetch also failed", refetchErr);
      }
    }
  },
  setTaskStatus: async (id, status) => {
    const current = get().tasksById.get(id);
    if (current) {
      const next: Task = { ...current, status };
      set((s) => withTaskMutated(s, current, next));
    }
    try {
      // Delegates to the existing UI-broadcast helper so FocusMode's
      // verseday:task-status-changed listener keeps firing — that
      // event is OUT OF SCOPE for M3.2 retirement (only -updated and
      // -deleted are retired in M3.2.b.5).
      await setTaskStatusFromUI(id, status);
      // P1.1a — reconcile to DB truth on success. The optimistic patch
      // above only flips `status`; the DB (updateTaskStatus) ALSO stamps
      // completed_at and snaps a future-scheduled done task to today. A
      // shallow status-only patch leaves the store diverged (missing
      // completed_at, stale future date, wrong date/week buckets).
      // Refetch and route through withTaskMutated so completed_at, the
      // snapped date_scheduled, and the index transitions all land.
      const fresh = await getTaskById(id);
      const before = get().tasksById.get(id);
      if (fresh) {
        if (before) set((s) => withTaskMutated(s, before, fresh));
        else set((s) => withTaskInserted(s, fresh));
      }
    } catch (err) {
      console.error("[appStore] setTaskStatus failed — refetching truth", {
        id,
        status,
        err,
      });
      try {
        const fresh = await getTaskById(id);
        const before = get().tasksById.get(id);
        if (fresh && before) set((s) => withTaskMutated(s, before, fresh));
      } catch (refetchErr) {
        console.error("[appStore] setTaskStatus refetch also failed", refetchErr);
      }
    }
  },
  setTaskHighlight: async (id, isHighlight) => {
    const current = get().tasksById.get(id);
    if (current) {
      // P1.1b — route through withTaskMutated, not a shallow map poke, so
      // any future index-membership transition happens automatically and
      // this stays consistent with the non-negotiable reconcile discipline.
      // (is_highlight touches no secondary index today, so this is
      // behaviour-preserving now and correct-by-construction later.)
      const next: Task = { ...current, is_highlight: isHighlight ? 1 : 0 };
      set((s) => withTaskMutated(s, current, next));
    }
    try {
      await dbToggleTaskHighlight(id, isHighlight);
    } catch (err) {
      console.error("[appStore] setTaskHighlight failed — refetching truth", {
        id,
        isHighlight,
        err,
      });
      try {
        const fresh = await getTaskById(id);
        const before = get().tasksById.get(id);
        if (fresh) {
          if (before) set((s) => withTaskMutated(s, before, fresh));
          else set((s) => withTaskInserted(s, fresh));
        }
      } catch (refetchErr) {
        console.error("[appStore] setTaskHighlight refetch also failed", refetchErr);
      }
    }
  },
  loadWorkedMinutes: async (taskIds) => {
    if (taskIds.length === 0) return;
    try {
      const fresh = await getWorkedMinutesForTaskIds(taskIds);
      set((s) => {
        const next = new Map(s.workedByTaskId);
        // Set every requested id explicitly — ids absent from the query
        // result have zero committed minutes, so write 0 rather than leave
        // a stale value behind.
        for (const id of taskIds) next.set(id, fresh.get(id) ?? 0);
        return { workedByTaskId: next };
      });
    } catch (err) {
      console.error("[appStore] loadWorkedMinutes failed", { taskIds, err });
    }
  },
  loadTemplates: async () => {
    try {
      const templates = await getRecurringTemplates();
      set((s) => {
        // Templates go into the canonical map only — isTemplate keeps them out
        // of every list index, so a direct map set (not withTaskInserted) is
        // both correct and avoids touching the indices.
        const next = new Map(s.tasksById);
        for (const t of templates) next.set(t.id, t);
        return { tasksById: next };
      });
    } catch (err) {
      console.error("[appStore] loadTemplates failed", err);
    }
  },
  rolloverTasksAction: async (today) => {
    let moved;
    try {
      moved = await dbRolloverUnfinishedTasks(today);
    } catch (err) {
      console.error("[appStore] rolloverTasksAction failed", { today, err });
      return;
    }
    if (moved.length === 0) return;
    set((s) => {
      // Reconcile each moved task through withTaskMutated: the store's current
      // copy (before) carries the OLD date, so this removes it from the old
      // date+week (and project, unchanged) indices and adds it to the new
      // date/week — or, for expired tasks (toDate null), drops it from the
      // date/week indices entirely. Tasks not currently in the store are
      // skipped (not indexed → nothing stale). The caller still does
      // loadTasksForDate(today) afterward for today's exact sort/fields.
      let working: AppState = s;
      for (const m of moved) {
        const before = working.tasksById.get(m.id);
        if (before) {
          working = {
            ...working,
            ...withTaskMutated(working, before, { ...before, date_scheduled: m.toDate }),
          } as AppState;
        }
      }
      return {
        tasksById: working.tasksById,
        taskIdsByDate: working.taskIdsByDate,
        taskIdsByWeek: working.taskIdsByWeek,
        taskIdsByProject: working.taskIdsByProject,
      };
    });
  },
  setTaskRecurrenceAction: async (taskId, recurrence) => {
    const before = get().tasksById.get(taskId);
    if (before) {
      // Optimistic: setting recurrence makes it a template; the DB also nulls
      // date_scheduled, so mirror that. withTaskMutated + isTemplate pull it
      // out of the date/week/project indices (or back in when clearing).
      const next: Task =
        recurrence != null
          ? { ...before, recurrence, date_scheduled: null }
          : { ...before, recurrence: null };
      set((s) => withTaskMutated(s, before, next));
    }
    try {
      await dbSetTaskRecurrence(taskId, recurrence);
      const fresh = await getTaskById(taskId);
      const cur = get().tasksById.get(taskId);
      if (fresh) {
        if (cur) set((s) => withTaskMutated(s, cur, fresh));
        else set((s) => withTaskInserted(s, fresh));
      }
    } catch (err) {
      // Invalid-format throws before any DB write; refetch restores truth
      // (the unchanged row), then rethrow so the caller can surface it.
      console.error("[appStore] setTaskRecurrenceAction failed — refetching truth", { taskId, err });
      const fresh = await getTaskById(taskId).catch(() => null);
      const cur = get().tasksById.get(taskId);
      if (fresh && cur) set((s) => withTaskMutated(s, cur, fresh));
      else if (before && cur) set((s) => withTaskMutated(s, cur, before));
      throw err;
    }
  },
  stopFocusedSessionForTask: async (taskId, breakSeconds = 0) => {
    const f = get().focus;
    if (!f || f.mode !== "active" || f.taskId !== taskId) return;
    const { timeEntryId, workedMs } = f;
    try {
      // Commit the session's worked_seconds from the live counter (not a stale
      // read) and close the entry. break_seconds is an audit column; the inline
      // (DailyPlanner) caller passes 0 (no Pomodoro breaks on that path), the
      // Focus screen's Done/Stop pass getBreakSeconds() so the real break record
      // is preserved.
      await updateTimeEntryWorkedSeconds(timeEntryId, Math.round(workedMs / 1000));
      await stopTimeEntry(timeEntryId, breakSeconds);
    } catch (err) {
      console.error("[appStore] stopFocusedSessionForTask commit failed", { taskId, err });
    }
    // Re-read committed truth for this task, THEN clear focus in one set so
    // there's never a window where the session is counted twice (committed +
    // live) or not at all.
    let committed = get().workedByTaskId.get(taskId) ?? 0;
    try {
      const m = await getWorkedMinutesForTaskIds([taskId]);
      committed = m.get(taskId) ?? 0;
    } catch (err) {
      console.error("[appStore] stopFocusedSessionForTask refresh failed", { taskId, err });
    }
    persistFocus(null);
    set((s) => {
      const next = new Map(s.workedByTaskId);
      next.set(taskId, committed);
      return { workedByTaskId: next, focus: null };
    });
  },
  endActiveFocusSession: async () => {
    const f = get().focus;
    if (f && f.mode === "active") {
      await get().stopFocusedSessionForTask(f.taskId);
    }
  },
  reconcileTaskFromDb: async (id) => {
    try {
      const fresh = await getTaskById(id);
      const before = get().tasksById.get(id);
      if (fresh) {
        if (before) set((s) => withTaskMutated(s, before, fresh));
        else set((s) => withTaskInserted(s, fresh));
      } else if (before) {
        set((s) => withTaskRemoved(s, before));
      }
    } catch (err) {
      console.error("[appStore] reconcileTaskFromDb failed", { id, err });
    }
  },
  setTaskWorkedMinutesAction: async (id, minutes) => {
    try {
      await dbSetManualWorkedMinutes(id, minutes);
      // P2 — worked-minutes is now canonical in the store. The manual edit
      // mutates time_entries; mirror the committed truth into workedByTaskId
      // so every consumer (day total, row pills, badges) re-renders off one
      // source. The tasks row itself is unchanged.
      set((s) => {
        const next = new Map(s.workedByTaskId);
        next.set(id, minutes);
        return { workedByTaskId: next };
      });
      // #4 — if this task is the live focus session, keep its on-screen
      // elapsed readout in sync with the DB. setFocusPriorElapsedMs no-ops
      // unless focus.taskId === id, so this is safe for any task. Centralizing
      // it here covers every caller (ProjectDetail edit, etc.), not just the
      // TaskDetailOverlay which already calls it directly (idempotent — same
      // value); the focus baseline is the manual minutes the user just set.
      get().setFocusPriorElapsedMs(id, minutes * 60 * 1000);
    } catch (err) {
      console.error("[appStore] setTaskWorkedMinutes failed", { id, minutes, err });
    }
  },
  // ── Projects (P3) — every mutation reconciles to DB truth ──────────────
  loadProjects: async () => {
    try {
      const list = await getProjects(true); // include archived: canonical map is complete
      set(() => {
        const next = new Map<number, Project>();
        for (const p of list) next.set(p.id, p);
        return { projectsById: next };
      });
    } catch (err) {
      console.error("[appStore] loadProjects failed", err);
    }
  },
  createProjectAction: async (name, color) => {
    const id = await dbCreateProject(name, color); // may throw (color collision) — let it propagate
    try {
      const fresh = await getProjectById(id);
      if (fresh) set((s) => withProjectInserted(s, fresh));
    } catch (err) {
      console.error("[appStore] createProjectAction post-insert fetch failed", { id, err });
    }
    return id;
  },
  updateProjectAction: async (input) => {
    const before = get().projectsById.get(input.id);
    if (before) {
      set((s) => withProjectMutated(s, {
        ...before,
        name: input.name,
        color: input.color,
        description: input.description,
        start_date: input.startDate,
        target_date: input.targetDate,
        notes: input.notes,
      }));
    }
    try {
      await dbUpdateProject(input);
      const fresh = await getProjectById(input.id);
      if (fresh) set((s) => withProjectMutated(s, fresh));
    } catch (err) {
      // Restore truth, then rethrow so the caller can surface the message
      // (e.g. "color already used by another active project").
      const fresh = await getProjectById(input.id).catch(() => null);
      if (fresh) set((s) => withProjectMutated(s, fresh));
      else if (before) set((s) => withProjectMutated(s, before));
      throw err;
    }
  },
  completeProjectAction: async (id, completed) => {
    const before = get().projectsById.get(id);
    if (before) set((s) => withProjectMutated(s, { ...before, completed: completed ? 1 : 0 }));
    try {
      await dbCompleteProject(id, completed);
      const fresh = await getProjectById(id);
      if (fresh) set((s) => withProjectMutated(s, fresh));
    } catch (err) {
      console.error("[appStore] completeProjectAction failed — refetching truth", { id, err });
      const fresh = await getProjectById(id).catch(() => null);
      if (fresh) set((s) => withProjectMutated(s, fresh));
      else if (before) set((s) => withProjectMutated(s, before));
    }
  },
  setProjectPriorityAction: async (id, priority) => {
    const before = get().projectsById.get(id);
    if (before) set((s) => withProjectMutated(s, { ...before, priority: priority ? 1 : 0 }));
    try {
      await dbSetProjectPriority(id, priority);
      const fresh = await getProjectById(id);
      if (fresh) set((s) => withProjectMutated(s, fresh));
    } catch (err) {
      console.error("[appStore] setProjectPriorityAction failed — refetching truth", { id, err });
      const fresh = await getProjectById(id).catch(() => null);
      if (fresh) set((s) => withProjectMutated(s, fresh));
      else if (before) set((s) => withProjectMutated(s, before));
    }
  },
  setProjectIconAction: async (id, icon, customIconId) => {
    const before = get().projectsById.get(id);
    if (before) set((s) => withProjectMutated(s, { ...before, icon, custom_icon_id: customIconId }));
    try {
      await dbSetProjectIcon(id, icon, customIconId);
      const fresh = await getProjectById(id);
      if (fresh) set((s) => withProjectMutated(s, fresh));
    } catch (err) {
      console.error("[appStore] setProjectIconAction failed — refetching truth", { id, err });
      const fresh = await getProjectById(id).catch(() => null);
      if (fresh) set((s) => withProjectMutated(s, fresh));
      else if (before) set((s) => withProjectMutated(s, before));
    }
  },
  archiveProjectAction: async (id, archived) => {
    const before = get().projectsById.get(id);
    if (before) set((s) => withProjectMutated(s, { ...before, archived: archived ? 1 : 0 }));
    try {
      await dbArchiveProject(id, archived); // un-archive may throw on color collision
      const fresh = await getProjectById(id);
      if (fresh) set((s) => withProjectMutated(s, fresh));
    } catch (err) {
      const fresh = await getProjectById(id).catch(() => null);
      if (fresh) set((s) => withProjectMutated(s, fresh));
      else if (before) set((s) => withProjectMutated(s, before));
      throw err;
    }
  },
  deleteProjectAction: async (id) => {
    try {
      await dbDeleteProject(id);
      set((s) => reduceProjectDeleted(s, id));
    } catch (err) {
      console.error("[appStore] deleteProjectAction failed", { id, err });
      throw err;
    }
  },
  reorderProjectsAction: async (orderedIds) => {
    // Non-optimistic: SQL first, then patch the map (mirrors setTaskSortOrders).
    try {
      const updates = orderedIds.map((id, i) => ({ id, sortOrder: i }));
      await dbUpdateProjectSortOrders(updates);
      set((s) => {
        const next = new Map(s.projectsById);
        updates.forEach(({ id, sortOrder }) => {
          const p = next.get(id);
          if (p) next.set(id, { ...p, sort_order: sortOrder });
        });
        return { projectsById: next };
      });
    } catch (err) {
      console.error("[appStore] reorderProjectsAction failed", err);
    }
  },
  insertTask: (task) => {
    set((s) => withTaskInserted(s, task));
  },
  setTaskDateScheduled: async (id, date) => {
    const current = get().tasksById.get(id);
    if (current) {
      // Optimistic mutation. withTaskMutated handles the date and
      // week-bucket transitions atomically (and clears the project
      // bucket nothing here since project_id is unchanged).
      const next: Task = { ...current, date_scheduled: date };
      set((s) => withTaskMutated(s, current, next));
    }
    try {
      // The DB collision guard may MERGE a recurring sibling into this
      // instance (#1): the sibling's time_entries, notes and done-status are
      // absorbed into `id`, then the sibling row is deleted. Reconcile the
      // deleted siblings out of the canonical map/indices via withTaskRemoved
      // so they don't linger as ghost rows; when real data was merged, also
      // refetch the keeper's truth (its notes/status changed) and its
      // worked-minutes (it inherited the sibling's time_entries).
      const { deletedSiblingIds, mergedData } =
        await dbUpdateTaskDateScheduled(id, date);
      for (const sibId of deletedSiblingIds) {
        const sib = get().tasksById.get(sibId);
        if (sib) set((s) => withTaskRemoved(s, sib));
      }
      if (mergedData) {
        const fresh = await getTaskById(id);
        const before = get().tasksById.get(id);
        if (fresh && before) set((s) => withTaskMutated(s, before, fresh));
        await get().loadWorkedMinutes([id]);
      }
    } catch (err) {
      console.error("[appStore] setTaskDateScheduled failed — refetching truth", {
        id,
        date,
        err,
      });
      try {
        const fresh = await getTaskById(id);
        const before = get().tasksById.get(id);
        if (fresh) {
          if (before) set((s) => withTaskMutated(s, before, fresh));
          else set((s) => withTaskInserted(s, fresh));
        } else if (before) {
          set((s) => withTaskRemoved(s, before));
        }
      } catch (refetchErr) {
        console.error(
          "[appStore] setTaskDateScheduled refetch also failed",
          refetchErr,
        );
      }
    }
  },
  setTaskSortOrders: async (bucket, orderedIds) => {
    // Update SQL first — sort_order is a per-task column, the DB query
    // takes the {id, sortOrder}[] payload and writes them in one
    // batched UPDATE. If it succeeds, patch the canonical map and
    // replace the bucket's secondary index slice.
    try {
      const updates = orderedIds.map((id, i) => ({ id, sortOrder: i }));
      await dbUpdateTaskSortOrders(updates);
      set((s) => {
        const nextMap = new Map(s.tasksById);
        for (const { id, sortOrder } of updates) {
          const t = nextMap.get(id);
          if (t) nextMap.set(id, { ...t, sort_order: sortOrder });
        }
        if (bucket.kind === "date") {
          const nextDateIdx = new Map(s.taskIdsByDate);
          nextDateIdx.set(bucket.date, orderedIds);
          return { tasksById: nextMap, taskIdsByDate: nextDateIdx };
        } else {
          const nextProjIdx = new Map(s.taskIdsByProject);
          nextProjIdx.set(bucket.projectId, orderedIds);
          return { tasksById: nextMap, taskIdsByProject: nextProjIdx };
        }
      });
    } catch (err) {
      console.error("[appStore] setTaskSortOrders failed — refetching bucket", {
        bucket,
        err,
      });
      // Recovery: refetch the affected bucket via the load action,
      // which replaces the primary slice with SQL truth.
      try {
        if (bucket.kind === "date") {
          await get().loadTasksForDate(bucket.date);
        } else {
          await get().loadTasksForProject(bucket.projectId);
        }
      } catch (refetchErr) {
        console.error(
          "[appStore] setTaskSortOrders bucket refetch also failed",
          refetchErr,
        );
      }
    }
  },
  createTaskAction: async (input) => {
    // SQL insert returns the new id. Fetch the row back to populate
    // the canonical map with the full Task struct (createTask returns
    // just the id; getTaskById is the source of truth for the row's
    // post-insert state, including DB-applied defaults like
    // rollover_count, sort_order, etc.).
    const id = await dbCreateTask(input);
    try {
      const fresh = await getTaskById(id);
      if (fresh) set((s) => withTaskInserted(s, fresh));
    } catch (err) {
      // The DB insert succeeded; only the post-insert read failed.
      // The next loadTasksFor* covering this row will sync the
      // canonical map. Surface for debugging.
      console.error(
        "[appStore] createTaskAction post-insert getTaskById failed",
        { id, err },
      );
    }
    return id;
  },
  setWeeklyPlannerTab: (tab) => set({ weeklyPlannerTab: tab }),
  toggleSidebar: () => {
    const s = get();
    const isFocusScreen = s.currentPage === "focus";
    if (isFocusScreen) {
      set({ sidebarFocusExpanded: !s.sidebarFocusExpanded });
    } else {
      const next = !s.sidebarCollapsed;
      persistSidebarCollapsed(next);
      set({ sidebarCollapsed: next });
    }
  },
  setSidebarCollapsed: (collapsed) => {
    const s = get();
    const isFocusScreen = s.currentPage === "focus";
    if (isFocusScreen) {
      // On focus screens, "expanded" maps to focusExpanded=true.
      set({ sidebarFocusExpanded: !collapsed });
    } else {
      persistSidebarCollapsed(collapsed);
      set({ sidebarCollapsed: collapsed });
    }
  },
}));
