import { getDb } from "./database";
import {
  SQL_TOTAL_WORKED_MINUTES_FOR_DATE,
  SQL_CLOSE_ORPHANED_TIME_ENTRIES,
} from "./workedSecondsSql";
import { SQL_UPSERT_WEEKLY_SHUTDOWN } from "./shutdownSql";
import {
  SQL_ROLLOVER_CAPTURE,
  SQL_ROLLOVER_MOVE,
  SQL_ROLLOVER_EXPIRE,
} from "./rolloverSql";
import { todayString, localDayStartUtc, localDayEndUtc } from "../utils/dates";
import { emitProjectChanged } from "../utils/projectEvents";
import type { Project, Task, DailyPlan, TimeEntry, WeeklyPlan, WeeklyShutdown, Link } from "../types";
import type { DismissalReason } from "../calendar/types";

/** The colors offered in project color pickers and auto-assigned to new
 *  projects: 24 distinct pastels at even 15° hue spacing (so no two are within
 *  15° of each other — maximally distinct), ordered with a +11 step so the
 *  auto-pick sequence hands out far-apart colors as projects are created. */
export const PROJECT_PALETTE = [
  "#EAA4A4", // 0°
  "#A4EAD8", // 165°
  "#EAA4C7", // 330°
  "#A4EAB6", // 135°
  "#EAA4EA", // 300°
  "#B6EAA4", // 105°
  "#C7A4EA", // 270°
  "#D8EAA4", // 75°
  "#A4A4EA", // 240°
  "#EAD8A4", // 45°
  "#A4C7EA", // 210°
  "#EAB6A4", // 15°
  "#A4EAEA", // 180°
  "#EAA4B6", // 345°
  "#A4EAC7", // 150°
  "#EAA4D8", // 315°
  "#A4EAA4", // 120°
  "#D8A4EA", // 285°
  "#C7EAA4", // 90°
  "#B6A4EA", // 255°
  "#EAEAA4", // 60°
  "#A4B6EA", // 225°
  "#EAC7A4", // 30°
  "#A4D8EA", // 195°
];

/** Every color validateColor accepts: the current pastel palette PLUS every
 *  previously-shipped/legacy hex, so projects created under older palettes
 *  still validate, render, and save. Only PROJECT_PALETTE is offered in the UI. */
export const PRESET_COLORS = [
  ...PROJECT_PALETTE,
  // Previously-curated + legacy hexes — retained for backward compat only.
  "#809BC2", "#D4897A", "#7EAD8B", "#C9A86E", "#9B89BF", "#CC8A9D", "#6BAEC8", "#908A82",
  "#B5826B", "#6FA0A0", "#A88FC6", "#A6AE6A", "#C77F84", "#7E8CC4", "#CBA64E", "#5FA38C",
  "#6b5fd4", "#d95f5f", "#4aad82", "#e4a945", "#378add", "#d4537e", "#e07b39", "#888780",
  "#6366f1", "#ec4899", "#f59e0b", "#22c55e", "#06b6d4", "#f97316", "#8b5cf6", "#ef4444",
];

const VALID_PRIORITIES = ["low", "medium", "high", "urgent"];
const VALID_TASK_STATUSES = ["todo", "in_progress", "done"];

function validateColor(color: string): void {
  if (!PRESET_COLORS.includes(color)) {
    throw new Error(`Invalid color: ${color}`);
  }
}

// No two *active* projects (archived = 0) may share a color. `completed`
// does not exempt a project — a completed-but-not-archived project still
// reserves its color. Pass the project's own id as excludeId when editing
// so it doesn't conflict with itself.
//
// KNOWN LIMITATION (accepted, see docs/2026-06-01-unique-active-project-colors.md):
// this reads then writes without a transaction, so two near-simultaneous
// writes could both pass. Acceptable for a single-user local app; a partial
// unique index is the real fix if it ever matters.
async function assertColorAvailable(
  color: string,
  excludeId?: number
): Promise<void> {
  const db = await getDb();
  const rows: { id: number }[] = await db.select(
    "SELECT id FROM projects WHERE archived = 0 AND color = $1",
    [color]
  );
  if (rows.some((r) => r.id !== excludeId)) {
    throw new Error("That color is already used by another active project — pick a different one.");
  }
}

function validatePriority(priority: string): void {
  if (!VALID_PRIORITIES.includes(priority)) {
    throw new Error(`Invalid priority: ${priority}`);
  }
}

function validateTaskStatus(status: string): void {
  if (!VALID_TASK_STATUSES.includes(status)) {
    throw new Error(`Invalid task status: ${status}`);
  }
}

// Projects
export async function getProjects(includeArchived = false): Promise<Project[]> {
  const db = await getDb();
  if (includeArchived) {
    return db.select("SELECT * FROM projects ORDER BY name LIMIT 200");
  }
  return db.select(
    "SELECT * FROM projects WHERE archived = 0 ORDER BY name LIMIT 200"
  );
}

export async function createProject(
  name: string,
  color: string
): Promise<number> {
  validateColor(color);
  await assertColorAvailable(color);
  const db = await getDb();
  const result = await db.execute(
    "INSERT INTO projects (name, color) VALUES ($1, $2)",
    [name, color]
  );
  emitProjectChanged();
  return result.lastInsertId ?? 0;
}

export interface UpdateProjectInput {
  id: number;
  name: string;
  color: string;
  description: string | null;
  startDate: string | null;
  targetDate: string | null;
  notes: string | null;
}

export async function updateProject(input: UpdateProjectInput): Promise<void> {
  validateColor(input.color);
  await assertColorAvailable(input.color, input.id);
  const db = await getDb();
  await db.execute(
    "UPDATE projects SET name = $1, color = $2, description = $3, start_date = $4, target_date = $5, notes = $6 WHERE id = $7",
    [input.name, input.color, input.description, input.startDate, input.targetDate, input.notes, input.id]
  );
  emitProjectChanged();
}

export async function completeProject(
  id: number,
  completed: boolean
): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE projects SET completed = $1 WHERE id = $2", [
    completed ? 1 : 0,
    id,
  ]);
  emitProjectChanged();
}

export async function setProjectPriority(
  id: number,
  priority: boolean
): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE projects SET priority = $1 WHERE id = $2", [
    priority ? 1 : 0,
    id,
  ]);
  emitProjectChanged();
}

export async function archiveProject(
  id: number,
  archived: boolean
): Promise<void> {
  const db = await getDb();
  // Re-activating a project brings it back into the active set — it must not
  // collide with a color claimed while it sat archived. Callers of the
  // un-archive path (e.g. the undo toast) must catch this.
  if (!archived) {
    const rows: { color: string }[] = await db.select(
      "SELECT color FROM projects WHERE id = $1",
      [id]
    );
    if (rows[0]) await assertColorAvailable(rows[0].color, id);
  }
  await db.execute("UPDATE projects SET archived = $1 WHERE id = $2", [
    archived ? 1 : 0,
    id,
  ]);
  emitProjectChanged();
}

export async function getProjectTaskCount(id: number): Promise<number> {
  const db = await getDb();
  const rows: { count: number }[] = await db.select(
    "SELECT COUNT(*) as count FROM tasks WHERE project_id = $1",
    [id]
  );
  return rows[0]?.count ?? 0;
}

export async function deleteProject(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM projects WHERE id = $1", [id]);
  emitProjectChanged();
}

export async function updateProjectSortOrders(
  updates: { id: number; sortOrder: number }[]
): Promise<void> {
  if (updates.length === 0) return;
  const db = await getDb();
  // SAFETY: IDs and sort orders are TypeScript numbers from internal state, not user input.
  const ids = updates.map((u) => u.id);
  const cases = updates
    .map((u) => `WHEN ${u.id} THEN ${u.sortOrder}`)
    .join(" ");
  await db.execute(
    `UPDATE projects SET sort_order = CASE id ${cases} END WHERE id IN (${ids.join(",")})`,
    []
  );
  emitProjectChanged();
}

export async function getProjectById(id: number): Promise<Project | null> {
  const db = await getDb();
  const rows: Project[] = await db.select(
    "SELECT * FROM projects WHERE id = $1",
    [id]
  );
  return rows[0] ?? null;
}

// Tasks

/**
 * Roll over unfinished tasks from previous days to today.
 *
 * Counting (documented = actual): a task is moved forward on each missed day
 * while `rollover_count < 4`, incrementing the count to at most 4. On the next
 * (5th) missed day the count is already 4, so it's no longer moved — instead
 * it's unscheduled (`date_scheduled = NULL`). So: moved on misses 1–4,
 * unscheduled on miss 5.
 *
 * - Sets `original_date` on first rollover to remember where the task started.
 * - Rolled tasks are renumbered to the end of today's list in a deterministic
 *   order (#10) so they don't collide with today's existing `sort_order`.
 * - Only call this for today's date, never for navigated dates.
 */
export async function rolloverUnfinishedTasks(today: string): Promise<void> {
  const db = await getDb();

  // #10 — capture the rows about to roll forward, in a deterministic order
  // (oldest first, then prior sort_order), BEFORE the move. Without renumbering
  // they'd keep their prior-day sort_order and interleave arbitrarily with
  // today's tasks; a later drag-reorder would then persist an order the user
  // never saw.
  const toRoll: { id: number }[] = await db.select(SQL_ROLLOVER_CAPTURE, [today]);

  // Roll forward: tasks from past dates, not done, rolled fewer than 4 times.
  // Skip calendar-imported tasks — they are date-specific snapshots from
  // the user's external calendar; rolling them forward would mis-attribute
  // a meeting that happened yesterday to today's agenda. The next sync
  // re-imports for the active date instead.
  await db.execute(SQL_ROLLOVER_MOVE, [today]);

  // Expire: any still-past, still-unfinished task now at count >= 4 (i.e. it
  // was moved on four prior days and missed again) is unscheduled. The
  // roll-forward above only touches count < 4, so these are exactly the
  // tasks that have exhausted their rollovers.
  await db.execute(SQL_ROLLOVER_EXPIRE, [today]);

  // #10 — append the rolled tasks after today's existing tasks, preserving
  // today's manual order and a stable order among the rolled ones. Each rolled
  // task lands on today (count < 4 → not expired above), so renumbering them
  // here is safe. SAFETY: ids/positions are internal numbers, not user input.
  if (toRoll.length > 0) {
    const rolledIds = toRoll.map((t) => t.id);
    const idList = rolledIds.join(",");
    const maxRows: { m: number | null }[] = await db.select(
      `SELECT MAX(sort_order) as m FROM tasks
       WHERE date_scheduled = $1 AND id NOT IN (${idList})`,
      [today]
    );
    const base = maxRows[0]?.m ?? 0;
    const cases = rolledIds
      .map((id, i) => `WHEN ${id} THEN ${base + i + 1}`)
      .join(" ");
    await db.execute(
      `UPDATE tasks SET sort_order = CASE id ${cases} END WHERE id IN (${idList})`,
      []
    );
  }
}

export async function getTaskById(id: number): Promise<Task | null> {
  const db = await getDb();
  const rows: Task[] = await db.select(
    "SELECT * FROM tasks WHERE id = $1 LIMIT 1",
    [id]
  );
  return rows[0] ?? null;
}

export async function getTasksForDate(date: string): Promise<Task[]> {
  const db = await getDb();
  // recurrence IS NULL excludes recurring templates, which can leak into a
  // day's list when their date_scheduled wasn't NULLed (e.g., a regular task
  // that was rolled forward and later marked recurring). The instance row
  // for that day still appears via recurrence_source_id; the template stays
  // hidden from daily lists. Same filter applies across every "tasks for
  // this date" surface — see migration v15 doc for the full set.
  return db.select(
    "SELECT * FROM tasks WHERE date_scheduled = $1 AND recurrence IS NULL AND external_dismissal_reason IS NULL ORDER BY sort_order LIMIT 500",
    [date]
  );
}

export async function getTasksForProject(
  projectId: number,
  includeDone = false
): Promise<Task[]> {
  const db = await getDb();
  if (includeDone) {
    return db.select(
      "SELECT * FROM tasks WHERE project_id = $1 ORDER BY status = 'done', sort_order LIMIT 500",
      [projectId]
    );
  }
  return db.select(
    "SELECT * FROM tasks WHERE project_id = $1 AND status != 'done' ORDER BY sort_order LIMIT 500",
    [projectId]
  );
}

// Substring match on task title — drives the Objectives page search,
// which surfaces matching tasks below matching projects. Open tasks first,
// then completed; newest scheduled date first within each group.
export async function searchTasksByTitle(
  query: string,
  limit = 25
): Promise<Task[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const db = await getDb();
  return db.select(
    `SELECT * FROM tasks
       WHERE title LIKE $1 COLLATE NOCASE
         AND external_dismissal_reason IS NULL
       ORDER BY status = 'done', date_scheduled DESC, id DESC
       LIMIT $2`,
    [`%${trimmed}%`, limit]
  );
}

export async function getIncompleteTasksForProjectIds(
  projectIds: number[]
): Promise<Task[]> {
  if (projectIds.length === 0) return [];
  const db = await getDb();
  // SAFETY: IDs are TypeScript numbers from internal state, not user input.
  const inList = projectIds.join(",");
  return db.select(
    `SELECT * FROM tasks WHERE project_id IN (${inList}) AND status != 'done' ORDER BY project_id, sort_order LIMIT 2000`,
    []
  );
}

export async function getAllTasksForProjectIds(
  projectIds: number[]
): Promise<Task[]> {
  if (projectIds.length === 0) return [];
  const db = await getDb();
  // SAFETY: IDs are TypeScript numbers from internal state, not user input.
  const inList = projectIds.join(",");
  return db.select(
    `SELECT * FROM tasks WHERE project_id IN (${inList}) ORDER BY project_id, status = 'done', sort_order LIMIT 2000`,
    []
  );
}

export interface CreateTaskInput {
  title: string;
  projectId: number | null;
  dateScheduled: string | null;
  estimatedMinutes: number | null;
  priority?: string;
  notes?: string | null;
}

// Fallback when the user hasn't set default_task_estimate_min.
// Matches the spec'd default in the Settings UI.
export const DEFAULT_TASK_ESTIMATE_FALLBACK_MIN = 15;

// Read the user's configured default estimate. Returns the fallback
// (15) if the setting is missing or unparseable. Live-reads from the
// settings table so a Settings-page change takes effect immediately
// — no app-wide cache to invalidate.
export async function getDefaultTaskEstimateMin(): Promise<number> {
  const raw = await getSetting("default_task_estimate_min");
  if (!raw) return DEFAULT_TASK_ESTIMATE_FALLBACK_MIN;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TASK_ESTIMATE_FALLBACK_MIN;
  }
  return parsed;
}

export async function createTask(input: CreateTaskInput): Promise<number> {
  const priority = input.priority ?? "medium";
  validatePriority(priority);
  const db = await getDb();

  // If the caller didn't supply an estimate, fall back to the user's
  // configured default. Centralising it here means every UI call site
  // (QuickAdd, DailyPlanner, ProjectDetail, PlanTab, ScheduleTab) gets
  // the behavior without having to thread the setting through. An
  // explicit 0 from the caller is still honored as "no time tracked"
  // — only null triggers the substitution.
  const estimatedMinutes =
    input.estimatedMinutes != null
      ? input.estimatedMinutes
      : await getDefaultTaskEstimateMin();

  // New tasks land at the top of their scope (project or date). Achieved by
  // assigning sort_order = min(existing) - 1 so they sort before everything
  // else without needing to renumber siblings. SQLite INTEGER is 64-bit,
  // monotonic decrement is fine.
  const scopeRows: { min_sort: number | null }[] = input.projectId != null
    ? await db.select("SELECT MIN(sort_order) as min_sort FROM tasks WHERE project_id = $1", [input.projectId])
    : input.dateScheduled != null
      ? await db.select("SELECT MIN(sort_order) as min_sort FROM tasks WHERE date_scheduled = $1", [input.dateScheduled])
      : await db.select("SELECT MIN(sort_order) as min_sort FROM tasks");
  const nextSort = (scopeRows[0]?.min_sort ?? 1) - 1;
  const result = await db.execute(
    "INSERT INTO tasks (title, project_id, date_scheduled, estimated_minutes, priority, notes, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [
      input.title,
      input.projectId,
      input.dateScheduled,
      estimatedMinutes,
      priority,
      input.notes ?? null,
      nextSort,
    ]
  );
  return result.lastInsertId ?? 0;
}

export interface UpdateTaskInput {
  id: number;
  title: string;
  projectId: number | null;
  estimatedMinutes: number | null;
  priority: string;
  notes: string | null;
  dateScheduled: string | null;
  dueDate?: string | null;
}

export async function updateTask(input: UpdateTaskInput): Promise<void> {
  validatePriority(input.priority);
  const db = await getDb();
  // dueDate is optional in the input — when omitted (legacy callers
  // that don't know about due_date), we issue the same UPDATE minus
  // that column so we don't accidentally null out an existing value.
  if (input.dueDate === undefined) {
    await db.execute(
      "UPDATE tasks SET title = $1, project_id = $2, estimated_minutes = $3, priority = $4, notes = $5, date_scheduled = $6 WHERE id = $7",
      [
        input.title,
        input.projectId,
        input.estimatedMinutes,
        input.priority,
        input.notes,
        input.dateScheduled,
        input.id,
      ]
    );
    return;
  }
  await db.execute(
    "UPDATE tasks SET title = $1, project_id = $2, estimated_minutes = $3, priority = $4, notes = $5, date_scheduled = $6, due_date = $7 WHERE id = $8",
    [
      input.title,
      input.projectId,
      input.estimatedMinutes,
      input.priority,
      input.notes,
      input.dateScheduled,
      input.dueDate,
      input.id,
    ]
  );
}

export async function updateTaskStatus(
  id: number,
  status: string
): Promise<void> {
  validateTaskStatus(status);
  const db = await getDb();
  // Stamp completed_at when transitioning to done; clear it on any other status
  // so the weekly shutdown's wins-by-day groups by the day the user checked
  // the box (independent of date_scheduled).
  if (status === "done") {
    // Future-scheduled tasks marked done get snapped to today —
    // completing it today should make it appear under today's column,
    // not stay floating in the future. Past/today dates are left alone
    // (those reflect the planned/actual day correctly already). The
    // local-date helper imported at the top of this file uses the
    // user's TZ, matching how date_scheduled is written everywhere
    // else in the codebase.
    await db.execute(
      `UPDATE tasks
       SET status = $1,
           completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           date_scheduled = CASE
             WHEN date_scheduled IS NOT NULL AND date_scheduled > $3
               THEN $3
             ELSE date_scheduled
           END
       WHERE id = $2`,
      [status, id, todayString()]
    );
  } else {
    await db.execute(
      "UPDATE tasks SET status = $1, completed_at = NULL WHERE id = $2",
      [status, id]
    );
  }
}

/** Read a single task's current status. Returns null if no row with
 *  that id exists. Used by the focus engine's defensive mount check
 *  to clean up persisted focus state pointing at an already-done
 *  task. */
export async function getTaskStatusById(id: number): Promise<string | null> {
  const db = await getDb();
  const rows: { status: string }[] = await db.select(
    "SELECT status FROM tasks WHERE id = $1 LIMIT 1",
    [id]
  );
  return rows[0]?.status ?? null;
}

/** UI-initiated status change. Same DB write as `updateTaskStatus`,
 *  plus a `verseday:task-status-changed` broadcast so cross-surface
 *  listeners (notably FocusMode) can react — e.g. stop the running
 *  focus timer when a user marks the focused task done from a
 *  different screen. Use this from toggle handlers in DailyPlanner,
 *  Projects, ProjectDetail, DailyShutdown, PlanTab, ScheduleTab.
 *
 *  FocusMode's own `handleDone` deliberately uses raw
 *  `updateTaskStatus` (no broadcast) so it can advance to the next
 *  task without its own listener short-circuiting the flow. */
export async function setTaskStatusFromUI(
  id: number,
  status: string
): Promise<void> {
  await updateTaskStatus(id, status);
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("verseday:task-status-changed", {
        detail: { taskId: id, status },
      })
    );
  }
}

export async function updateTaskSortOrders(
  updates: { id: number; sortOrder: number }[]
): Promise<void> {
  if (updates.length === 0) return;
  const db = await getDb();
  // SAFETY: IDs and sort orders are interpolated directly because tauri-plugin-sql
  // does not support parameterized CASE expressions or dynamic IN lists.
  // This is safe ONLY because both values are TypeScript `number` types from internal
  // state (never user input). Do NOT copy this pattern for string or external data.
  const ids = updates.map((u) => u.id);
  const cases = updates
    .map((u) => `WHEN ${u.id} THEN ${u.sortOrder}`)
    .join(" ");
  await db.execute(
    `UPDATE tasks SET sort_order = CASE id ${cases} END WHERE id IN (${ids.join(",")})`,
    []
  );
}

export async function deleteTask(id: number): Promise<void> {
  const db = await getDb();
  // Pull the metadata we need to decide between the three delete paths
  // in one round-trip: recurring-instance bookkeeping, calendar-import
  // soft-delete, or plain hard-delete.
  const taskRows: { recurrence_source_id: number | null; date_scheduled: string | null; external_source: string | null }[] =
    await db.select(
      "SELECT recurrence_source_id, date_scheduled, external_source FROM tasks WHERE id = $1",
      [id]
    );
  const t = taskRows[0];

  // Calendar-imported tasks soft-delete via column instead of removing
  // the row. Tombstones serve two roles: (a) they keep time_entries
  // FKs valid for any work the user logged before dismissing, and
  // (b) they tell the next sync to skip re-importing this external_id
  // for this date (see getDismissedExternalIds + sync.ts step 5).
  if (t && t.external_source === "calendar") {
    await markTaskDismissed(id, "user");
    return;
  }

  // If this row is a recurring instance, record the (template, date) pair
  // so the next generateRecurringInstances call doesn't recreate it.
  // Skip-insert happens *before* the DELETE because the two statements are
  // commutative w.r.t. correctness — if a concurrent generation runs in
  // between, it'll either still see the live instance (ON CONFLICT swallows)
  // or already see the skip (NOT EXISTS guard short-circuits). See the v15
  // doc for the full race walk-through.
  if (t && t.recurrence_source_id != null && t.date_scheduled != null) {
    await db.execute(
      "INSERT INTO recurring_instance_skips (recurrence_source_id, date_scheduled) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [t.recurrence_source_id, t.date_scheduled]
    );
  }
  // time_entries have ON DELETE CASCADE, so they'll be cleaned up automatically
  await db.execute("DELETE FROM tasks WHERE id = $1", [id]);
}

// Daily Plans
export async function getDailyPlan(date: string): Promise<DailyPlan | null> {
  const db = await getDb();
  const rows: DailyPlan[] = await db.select(
    "SELECT * FROM daily_plans WHERE date = $1",
    [date]
  );
  return rows[0] ?? null;
}

export async function upsertDailyPlan(
  date: string,
  notes: string | null,
  hourBudget: number
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO daily_plans (date, notes, hour_budget) VALUES ($1, $2, $3)
     ON CONFLICT(date) DO UPDATE SET notes = $2, hour_budget = $3`,
    [date, notes, hourBudget]
  );
}

export async function upsertDailyShutdown(
  date: string,
  mood: string | null,
  reflection: string | null
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO daily_plans (date, mood, reflection) VALUES ($1, $2, $3)
     ON CONFLICT(date) DO UPDATE SET mood = $2, reflection = $3`,
    [date, mood, reflection]
  );
}

export interface CompletedShutdown {
  date: string;
  mood: string | null;
  reflection: string | null;
  tasksDone: number;
  workedMinutes: number;
}

export async function getCompletedShutdowns(
  limit?: number
): Promise<CompletedShutdown[]> {
  const db = await getDb();
  const rows: { date: string; mood: string | null; reflection: string | null; tasks_done: number; worked_seconds: number | null }[] = await db.select(
    `SELECT
       dp.date,
       dp.mood,
       dp.reflection,
       (SELECT COUNT(*) FROM tasks t WHERE t.date_scheduled = dp.date AND t.recurrence IS NULL AND t.external_dismissal_reason IS NULL AND t.status = 'done') AS tasks_done,
       (SELECT COALESCE(SUM(te.worked_seconds), 0)
        FROM time_entries te
        JOIN tasks t ON te.task_id = t.id
        WHERE t.date_scheduled = dp.date AND t.recurrence IS NULL AND t.external_dismissal_reason IS NULL AND te.end_time IS NOT NULL) AS worked_seconds
     FROM daily_plans dp
     WHERE dp.mood IS NOT NULL OR (dp.reflection IS NOT NULL AND dp.reflection != '')
     ORDER BY dp.date DESC
     ${limit != null ? "LIMIT " + Math.max(1, Math.floor(limit)) : ""}`
  );
  return rows.map(r => ({
    date: r.date,
    mood: r.mood,
    reflection: r.reflection,
    tasksDone: Number(r.tasks_done) || 0,
    workedMinutes: Math.round((Number(r.worked_seconds) || 0) / 60),
  }));
}

export async function getCompletedTasksForDate(date: string): Promise<Task[]> {
  const db = await getDb();
  return db.select(
    `SELECT * FROM tasks WHERE date_scheduled = $1 AND recurrence IS NULL AND external_dismissal_reason IS NULL AND status = 'done' ORDER BY sort_order ASC LIMIT 200`,
    [date]
  );
}

// Time Entries
export async function getTimeEntriesForDate(
  date: string
): Promise<TimeEntry[]> {
  const db = await getDb();
  return db.select(
    `SELECT te.* FROM time_entries te
     JOIN tasks t ON te.task_id = t.id
     WHERE t.date_scheduled = $1 AND t.recurrence IS NULL AND t.external_dismissal_reason IS NULL
     ORDER BY te.start_time LIMIT 1000`,
    [date]
  );
}

export async function startTimeEntry(
  taskId: number,
  type: "pomodoro" | "tracked"
): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    "INSERT INTO time_entries (task_id, start_time, entry_type) VALUES ($1, $2, $3)",
    [taskId, new Date().toISOString(), type]
  );
  return result.lastInsertId ?? 0;
}

export async function stopTimeEntry(
  id: number,
  breakSeconds = 0
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE time_entries SET end_time = $1, break_seconds = $2 WHERE id = $3",
    [new Date().toISOString(), Math.round(breakSeconds), id]
  );
}

/** Read a single time_entries row by id. Used by the worked-seconds
 *  R1 orphan check in restoreFocus: if focus references a row that's
 *  already closed (closeOrphanedTimeEntries closed it during a prior
 *  run, etc.), the loader writes any locally-tracked workedMs to the
 *  closed row and clears focus rather than letting Resume → Stop
 *  write to a closed row.
 *  Added in S.2 of docs/2026-05-07-worked-seconds-simplification.md. */
export async function getTimeEntryById(
  id: number,
): Promise<{ id: number; end_time: string | null; worked_seconds: number } | null> {
  const db = await getDb();
  const rows: { id: number; end_time: string | null; worked_seconds: number }[] =
    await db.select(
      "SELECT id, end_time, worked_seconds FROM time_entries WHERE id = $1 LIMIT 1",
      [id],
    );
  return rows[0] ?? null;
}

/** Set worked_seconds on a time_entries row. Single-row update, used
 *  by the R1 orphan landing path and by the S.5 stop-side write.
 *  Added in S.2. */
export async function updateTimeEntryWorkedSeconds(
  id: number,
  workedSeconds: number,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE time_entries SET worked_seconds = $1 WHERE id = $2",
    [Math.max(0, Math.round(workedSeconds)), id],
  );
}

export async function closeOrphanedTimeEntries(
  excludeId: number | null = null,
): Promise<number> {
  const db = await getDb();
  // Cap orphaned entries at 4 hours from their start_time. If the app was
  // force-quit / asleep for days, naively setting end_time = now would
  // attribute that entire wall-clock gap as "worked time" — see the
  // 166h-on-a-15m-task bug. 4 hours is the longest plausible single
  // unbroken focus session.
  //
  // M3.5 — excludeId lets the caller skip a known-active time entry
  // (e.g. the persisted focus session restored on app boot) so that
  // older orphans from prior crashes still get cleaned up. Without
  // this, an app where every launch restores a focus would leave
  // those older orphans permanently open.
  const MAX_ORPHAN_HOURS = 4;
  const result = await db.execute(SQL_CLOSE_ORPHANED_TIME_ENTRIES, [
    MAX_ORPHAN_HOURS,
    excludeId,
  ]);
  return result.rowsAffected;
}

// Utility
export async function getTotalPlannedMinutes(date: string): Promise<number> {
  const db = await getDb();
  const rows: { total: number }[] = await db.select(
    "SELECT COALESCE(SUM(estimated_minutes), 0) as total FROM tasks WHERE date_scheduled = $1 AND recurrence IS NULL AND external_dismissal_reason IS NULL",
    [date]
  );
  return rows[0]?.total ?? 0;
}

// #15 — daily worked-minutes total. The `te.end_time IS NOT NULL` guard (in
// SQL_TOTAL_WORKED_MINUTES_FOR_DATE) excludes the open in-progress session so
// its checkpointed worked_seconds isn't double-counted against the live
// focus.workedMs added at the app layer. SQL lives in ./workedSecondsSql so the
// integrity test runs the identical text.
export async function getTotalWorkedMinutes(date: string): Promise<number> {
  const db = await getDb();
  const rows: { total: number }[] = await db.select(
    SQL_TOTAL_WORKED_MINUTES_FOR_DATE,
    [date]
  );
  return rows[0]?.total ?? 0;
}

// Weekly Plans
export async function getWeeklyPlan(
  weekStartDate: string
): Promise<WeeklyPlan | null> {
  const db = await getDb();
  const rows: WeeklyPlan[] = await db.select(
    "SELECT * FROM weekly_plans WHERE week_start_date = $1",
    [weekStartDate]
  );
  return rows[0] ?? null;
}

export async function upsertWeeklyPlan(
  weekStartDate: string,
  focusAreas: string | null,
  notes: string | null
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO weekly_plans (week_start_date, focus_areas, notes) VALUES ($1, $2, $3)
     ON CONFLICT(week_start_date) DO UPDATE SET focus_areas = $2, notes = $3`,
    [weekStartDate, focusAreas, notes]
  );
}

export async function getTasksForWeek(
  startDate: string,
  endDate: string
): Promise<Task[]> {
  const db = await getDb();
  return db.select(
    "SELECT * FROM tasks WHERE date_scheduled >= $1 AND date_scheduled <= $2 AND recurrence IS NULL AND external_dismissal_reason IS NULL ORDER BY date_scheduled, sort_order LIMIT 500",
    [startDate, endDate]
  );
}

export async function getUnscheduledTasks(
  projectId?: number | null
): Promise<Task[]> {
  const db = await getDb();
  if (projectId != null) {
    return db.select(
      "SELECT * FROM tasks WHERE date_scheduled IS NULL AND status != 'done' AND project_id = $1 ORDER BY sort_order LIMIT 50",
      [projectId]
    );
  }
  return db.select(
    "SELECT * FROM tasks WHERE date_scheduled IS NULL AND status != 'done' ORDER BY sort_order LIMIT 50"
  );
}

export async function getWorkedMinutesForWeek(
  startDate: string,
  endDate: string
): Promise<Map<string, number>> {
  const db = await getDb();
  const rows: { date_scheduled: string; total: number }[] = await db.select(
    `SELECT t.date_scheduled, COALESCE(SUM(te.worked_seconds), 0) / 60.0 as total
    FROM time_entries te
    JOIN tasks t ON te.task_id = t.id
    WHERE t.date_scheduled >= $1 AND t.date_scheduled <= $2 AND t.recurrence IS NULL AND t.external_dismissal_reason IS NULL AND te.end_time IS NOT NULL
    GROUP BY t.date_scheduled`,
    [startDate, endDate]
  );
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.date_scheduled, row.total);
  }
  return map;
}

// Per-day, per-project worked minutes for a week. Used by the weekly
// shutdown bar chart to show "where effort went" each day, segmented
// by objective. Tasks without a project are bucketed under projectId
// = -1 ("Unassigned"). Same date_scheduled grouping convention as
// getWorkedMinutesForWeek above.
export async function getWorkedMinutesPerProjectPerDay(
  startDate: string,
  endDate: string
): Promise<Map<string, Map<number, number>>> {
  const db = await getDb();
  const rows: { date_scheduled: string; project_id: number | null; total: number }[] =
    await db.select(
      `SELECT t.date_scheduled, t.project_id, COALESCE(SUM(te.worked_seconds), 0) / 60.0 as total
      FROM time_entries te
      JOIN tasks t ON te.task_id = t.id
      WHERE t.date_scheduled >= $1 AND t.date_scheduled <= $2 AND t.recurrence IS NULL AND t.external_dismissal_reason IS NULL AND te.end_time IS NOT NULL
      GROUP BY t.date_scheduled, t.project_id`,
      [startDate, endDate]
    );
  const out = new Map<string, Map<number, number>>();
  for (const row of rows) {
    let inner = out.get(row.date_scheduled);
    if (!inner) {
      inner = new Map();
      out.set(row.date_scheduled, inner);
    }
    inner.set(row.project_id ?? -1, row.total);
  }
  return out;
}

// Returns true if the user has started planning the given week —
// either committed time to any project (weekly_plan_commitments has
// rows) or marked any project planned/skipped (weekly_plan_project_status
// has rows). Used by Weekly Shutdown to decide whether to prompt the
// user to plan next week before completing the shutdown.
export async function hasWeekBeenPlanned(weekStartDate: string): Promise<boolean> {
  validateWeekDate(weekStartDate);
  const db = await getDb();
  const commitRows: { n: number }[] = await db.select(
    "SELECT COUNT(*) AS n FROM weekly_plan_commitments WHERE week_start_date = $1",
    [weekStartDate]
  );
  if ((commitRows[0]?.n ?? 0) > 0) return true;
  const statusRows: { n: number }[] = await db.select(
    "SELECT COUNT(*) AS n FROM weekly_plan_project_status WHERE week_start_date = $1",
    [weekStartDate]
  );
  return (statusRows[0]?.n ?? 0) > 0;
}

export async function updateTaskDateScheduled(
  id: number,
  dateScheduled: string | null
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE tasks SET date_scheduled = $1 WHERE id = $2",
    [dateScheduled, id]
  );
}

export async function updateTaskDueDate(
  id: number,
  dueDate: string | null
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE tasks SET due_date = $1 WHERE id = $2",
    [dueDate, id]
  );
}

// Weekly Shutdowns
export async function getWeeklyShutdown(
  weekStartDate: string
): Promise<WeeklyShutdown | null> {
  const db = await getDb();
  const rows: WeeklyShutdown[] = await db.select(
    "SELECT * FROM weekly_shutdowns WHERE week_start_date = $1",
    [weekStartDate]
  );
  return rows[0] ?? null;
}

export async function upsertWeeklyShutdown(
  weekStartDate: string,
  reflections: string | null,
  incompleteItems: string | null,
  mood: string | null = null
): Promise<void> {
  const db = await getDb();
  // #6 — null-preserving upsert (SQL in ./shutdownSql so the integrity test
  // runs the identical text). Weekly-ONLY: upsertDailyShutdown keeps the plain
  // replace because its callers pass full state and must be able to clear a
  // reflection to null.
  await db.execute(SQL_UPSERT_WEEKLY_SHUTDOWN, [
    weekStartDate,
    reflections,
    incompleteItems,
    mood,
  ]);
}

// Project stats (batched)
export async function getProjectStats(): Promise<
  Map<number, { total: number; done: number; lastDate: string | null }>
> {
  const db = await getDb();
  const rows: {
    project_id: number;
    total: number;
    done: number;
    last_date: string | null;
  }[] = await db.select(
    `SELECT project_id,
       COUNT(*) as total,
       SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done,
       MAX(date_scheduled) as last_date
     FROM tasks
     WHERE project_id IS NOT NULL
     GROUP BY project_id`
  );
  const map = new Map<
    number,
    { total: number; done: number; lastDate: string | null }
  >();
  for (const row of rows) {
    map.set(row.project_id, {
      total: row.total,
      done: row.done,
      lastDate: row.last_date,
    });
  }
  return map;
}

export async function getPreviewTasksForProjects(): Promise<Map<number, Task[]>> {
  const db = await getDb();
  // Fetch recent tasks per project — get a reasonable batch and group in JS
  const rows: Task[] = await db.select(
    `SELECT * FROM tasks
     WHERE project_id IS NOT NULL AND status != 'done'
     ORDER BY project_id, CASE WHEN date_scheduled IS NULL THEN 1 ELSE 0 END, date_scheduled, sort_order
     LIMIT 500`
  );
  const map = new Map<number, Task[]>();
  for (const task of rows) {
    if (task.project_id == null) continue;
    const existing = map.get(task.project_id) ?? [];
    if (existing.length < 3) {
      existing.push(task);
      map.set(task.project_id, existing);
    }
  }
  return map;
}

export async function getCompletedPreviewTasksForProjects(): Promise<Map<number, Task[]>> {
  const db = await getDb();
  const rows: Task[] = await db.select(
    `SELECT * FROM tasks
     WHERE project_id IS NOT NULL AND status = 'done'
     ORDER BY project_id, sort_order DESC
     LIMIT 500`
  );
  const map = new Map<number, Task[]>();
  for (const task of rows) {
    if (task.project_id == null) continue;
    const existing = map.get(task.project_id) ?? [];
    if (existing.length < 5) {
      existing.push(task);
      map.set(task.project_id, existing);
    }
  }
  return map;
}

// Dashboard queries
export async function getPlannedMinutesPerDay(
  startDate: string,
  endDate: string
): Promise<Map<string, number>> {
  const db = await getDb();
  const rows: { date_scheduled: string; total: number }[] = await db.select(
    `SELECT date_scheduled, COALESCE(SUM(estimated_minutes), 0) as total
     FROM tasks
     WHERE date_scheduled >= $1 AND date_scheduled <= $2 AND external_dismissal_reason IS NULL
     GROUP BY date_scheduled`,
    [startDate, endDate]
  );
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.date_scheduled, row.total);
  }
  return map;
}

export async function getRecentCompletedTasks(
  startDate: string,
  endDate: string
): Promise<Task[]> {
  const db = await getDb();
  return db.select(
    `SELECT * FROM tasks
     WHERE date_scheduled >= $1 AND date_scheduled <= $2 AND status = 'done' AND external_dismissal_reason IS NULL
     ORDER BY date_scheduled DESC, sort_order
     LIMIT 10`,
    [startDate, endDate]
  );
}

/**
 * Tasks completed during a week, grouped by the *check-the-box* day. Uses
 * `completed_at` (stamped at the moment the user marks done) instead of
 * `date_scheduled`, so a task scheduled Mon but completed Wed shows under Wed.
 * Falls back to `date_scheduled` for legacy rows where `completed_at` is null.
 */
export async function getTasksCompletedInWeek(
  mondayIso: string,
  fridayIso: string
): Promise<Task[]> {
  const db = await getDb();
  // #9 — completed_at is a UTC instant (Date.toISOString()), but the week is a
  // LOCAL Mon..Fri. Compare it against the UTC instants of local-Monday-start
  // and local-Friday-end, so a task completed near midnight is counted in the
  // correct local week (the old code compared a UTC timestamp against bare
  // local date strings + a UTC-suffixed Friday end). The date_scheduled
  // fallback branch stays on local date strings — that column IS a local date.
  const completedStartUtc = localDayStartUtc(mondayIso);
  const completedEndUtc = localDayEndUtc(fridayIso);
  return db.select(
    `SELECT * FROM tasks
     WHERE status = 'done'
       AND external_dismissal_reason IS NULL
       AND (
         (completed_at IS NOT NULL
            AND completed_at >= $1
            AND completed_at <= $2)
         OR (completed_at IS NULL
            AND date_scheduled >= $3
            AND date_scheduled <= $4)
       )
     ORDER BY COALESCE(completed_at, date_scheduled) ASC, sort_order ASC
     LIMIT 1000`,
    [completedStartUtc, completedEndUtc, mondayIso, fridayIso]
  );
}

// Links
export async function getLinksForEntity(
  entityType: string,
  entityId: number
): Promise<Link[]> {
  const db = await getDb();
  return db.select(
    "SELECT * FROM links WHERE entity_type = $1 AND entity_id = $2 ORDER BY created_at DESC LIMIT 50",
    [entityType, entityId]
  );
}

const SAFE_PROTOCOLS = ["http:", "https:", "mailto:", "ftp:"];

export function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return SAFE_PROTOCOLS.includes(parsed.protocol);
  } catch {
    return false;
  }
}

export async function createLink(
  entityType: string,
  entityId: number,
  url: string,
  label: string | null
): Promise<number> {
  if (!isSafeUrl(url)) {
    throw new Error("Only http, https, mailto, and ftp URLs are allowed");
  }
  const db = await getDb();
  const result = await db.execute(
    "INSERT INTO links (entity_type, entity_id, url, label) VALUES ($1, $2, $3, $4)",
    [entityType, entityId, url, label]
  );
  return result.lastInsertId ?? 0;
}

export async function deleteLink(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM links WHERE id = $1", [id]);
}

export async function getWorkedMinutesForTaskIds(
  taskIds: number[]
): Promise<Map<number, number>> {
  if (taskIds.length === 0) return new Map();
  const db = await getDb();
  // SAFETY: IDs are TypeScript numbers from internal state, not user input.
  const inList = taskIds.join(",");
  const rows: { task_id: number; total: number }[] = await db.select(
    `SELECT task_id, COALESCE(SUM(worked_seconds), 0) / 60.0 as total
    FROM time_entries
    WHERE task_id IN (${inList}) AND end_time IS NOT NULL
    GROUP BY task_id`,
    []
  );
  const map = new Map<number, number>();
  for (const row of rows) {
    map.set(row.task_id, Math.round(row.total));
  }
  return map;
}

export async function getWorkedMinutesForTask(taskId: number): Promise<number> {
  const db = await getDb();
  const rows: { total: number }[] = await db.select(
    `SELECT COALESCE(SUM(worked_seconds), 0) / 60.0 as total
    FROM time_entries
    WHERE task_id = $1 AND end_time IS NOT NULL`,
    [taskId]
  );
  return Math.round(rows[0]?.total ?? 0);
}

export async function getWorkedMinutesByDate(
  taskId: number
): Promise<{ date: string; minutes: number }[]> {
  const db = await getDb();
  const rows: { day: string; total: number }[] = await db.select(
    `SELECT date(start_time) as day,
      COALESCE(SUM(worked_seconds), 0) / 60.0 as total
    FROM time_entries
    WHERE task_id = $1 AND end_time IS NOT NULL
    GROUP BY date(start_time)
    ORDER BY day`,
    [taskId]
  );
  return rows
    .map((r) => ({ date: r.day, minutes: Math.round(r.total) }))
    .filter((r) => r.minutes > 0);
}

export async function setManualWorkedMinutes(
  taskId: number,
  targetMinutes: number
): Promise<void> {
  const db = await getDb();
  // Current worked minutes (sums closed entries only). S.5 — reads
  // worked_seconds. Adjustment INSERTs below also populate
  // worked_seconds explicitly so the new entry is immediately visible
  // to subsequent reads.
  const rows: { total: number }[] = await db.select(
    `SELECT COALESCE(SUM(worked_seconds), 0) / 60.0 as total
    FROM time_entries
    WHERE task_id = $1 AND end_time IS NOT NULL`,
    [taskId]
  );
  const currentMinutes = Math.round(rows[0]?.total ?? 0);
  const diff = targetMinutes - currentMinutes;
  if (diff === 0) return;

  const now = new Date().toISOString();

  if (diff > 0) {
    // Add an adjustment entry for the difference.
    const startTime = new Date(Date.now() - diff * 60 * 1000).toISOString();
    await db.execute(
      "INSERT INTO time_entries (task_id, start_time, end_time, entry_type, worked_seconds) VALUES ($1, $2, $3, 'tracked', $4)",
      [taskId, startTime, now, diff * 60]
    );
    return;
  }

  // diff < 0: user wants to reduce. Wipe closed entries for this task and
  // insert one fresh entry sized to the target. Keeps unclosed entries
  // (active focus sessions) untouched. If targetMinutes is 0, skip the
  // insert entirely.
  await db.execute(
    "DELETE FROM time_entries WHERE task_id = $1 AND end_time IS NOT NULL",
    [taskId]
  );
  if (targetMinutes > 0) {
    const startTime = new Date(Date.now() - targetMinutes * 60 * 1000).toISOString();
    await db.execute(
      "INSERT INTO time_entries (task_id, start_time, end_time, entry_type, worked_seconds) VALUES ($1, $2, $3, 'tracked', $4)",
      [taskId, startTime, now, targetMinutes * 60]
    );
  }
}

export async function updateTaskNotes(
  id: number,
  notes: string | null
): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE tasks SET notes = $1 WHERE id = $2", [notes, id]);
}

export async function updateTaskTitle(
  id: number,
  title: string
): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE tasks SET title = $1 WHERE id = $2", [title, id]);
}

export async function updateTaskEstimate(
  id: number,
  minutes: number | null
): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE tasks SET estimated_minutes = $1 WHERE id = $2", [minutes, id]);
}

// R.2 — Sidebar rebuild's membership pool. Returns a single flat
// Task[] union of:
//   - unscheduled: date_scheduled IS NULL AND status != 'done'
//   - overdue: 3+ days back from `today`, capped at 14 days (sanity
//     belt — older tasks are stale; user can find them via Projects).
// Excludes calendar-imported tasks (external_dismissal_reason IS NULL)
// since those aren't user-managed.
//
// `today` is the real-world current date (todayString()), NOT
// DailyPlanner's selectedDate. The overdue cutoff is anchored on
// real-world today; passing selectedDate would let the user "create
// overdue" by paging Daily Plan into the future.
export async function getSidebarPoolTasks(today: string): Promise<Task[]> {
  const db = await getDb();
  const overdueCutoff = new Date(today + "T00:00:00");
  overdueCutoff.setDate(overdueCutoff.getDate() - 3);
  const overdueCutoffIso = overdueCutoff
    .toISOString()
    .split("T")[0];
  const hardFloor = new Date(today + "T00:00:00");
  hardFloor.setDate(hardFloor.getDate() - 14);
  const hardFloorIso = hardFloor.toISOString().split("T")[0];
  return db.select(
    `SELECT * FROM tasks
       WHERE status != 'done'
         AND external_dismissal_reason IS NULL
         AND (
           date_scheduled IS NULL
           OR (date_scheduled <= $1 AND date_scheduled >= $2)
         )
       LIMIT 200`,
    [overdueCutoffIso, hardFloorIso]
  );
}

// Weekly Plan Projects (project timelines)
const WEEK_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function validateWeekDate(date: string): void {
  if (!WEEK_DATE_PATTERN.test(date)) {
    throw new Error(`Invalid week date format: ${date}`);
  }
}

export async function getWeeklyPlanProjects(
  weekStartDate: string
): Promise<number[]> {
  validateWeekDate(weekStartDate);
  const db = await getDb();
  const rows: { project_id: number }[] = await db.select(
    "SELECT project_id FROM weekly_plan_projects WHERE week_start_date = $1 ORDER BY created_at",
    [weekStartDate]
  );
  return rows.map((r) => r.project_id);
}

export async function addWeeklyPlanProject(
  weekStartDate: string,
  projectId: number
): Promise<void> {
  validateWeekDate(weekStartDate);
  const db = await getDb();
  await db.execute(
    `INSERT INTO weekly_plan_projects (week_start_date, project_id) VALUES ($1, $2)
     ON CONFLICT(week_start_date, project_id) DO NOTHING`,
    [weekStartDate, projectId]
  );
}

export async function removeWeeklyPlanProject(
  weekStartDate: string,
  projectId: number
): Promise<void> {
  validateWeekDate(weekStartDate);
  const db = await getDb();
  await db.execute(
    "DELETE FROM weekly_plan_projects WHERE week_start_date = $1 AND project_id = $2",
    [weekStartDate, projectId]
  );
}

export async function getPlannedWeeksForProject(
  projectId: number
): Promise<string[]> {
  const db = await getDb();
  const rows: { week_start_date: string }[] = await db.select(
    "SELECT week_start_date FROM weekly_plan_projects WHERE project_id = $1 ORDER BY week_start_date DESC LIMIT 50",
    [projectId]
  );
  return rows.map((r) => r.week_start_date);
}

// ── Weekly Planning (Plan tab) ────────────────────────────────────────────────
// Per-(week, project, day_offset) minimum-time commitments and per-(week,
// project) review status. See docs/2026-05-05-weekly-planning-plan.md.

export type WeeklyPlanProjectStatus = "planned" | "skipped";

const VALID_PLAN_STATUSES: WeeklyPlanProjectStatus[] = ["planned", "skipped"];

function validateDayOffset(day: number): void {
  if (!Number.isInteger(day) || day < 0 || day > 4) {
    throw new Error(`Invalid day_offset: ${day} (must be 0..4)`);
  }
}

function validatePlanStatus(status: string): void {
  if (!VALID_PLAN_STATUSES.includes(status as WeeklyPlanProjectStatus)) {
    throw new Error(`Invalid plan status: ${status}`);
  }
}

export async function getWeeklyPlanCommitments(
  weekStartDate: string
): Promise<Map<number, Map<number, number>>> {
  validateWeekDate(weekStartDate);
  const db = await getDb();
  const rows: { project_id: number; day_offset: number; minutes: number }[] =
    await db.select(
      "SELECT project_id, day_offset, minutes FROM weekly_plan_commitments WHERE week_start_date = $1",
      [weekStartDate]
    );
  const out = new Map<number, Map<number, number>>();
  for (const row of rows) {
    let inner = out.get(row.project_id);
    if (!inner) {
      inner = new Map<number, number>();
      out.set(row.project_id, inner);
    }
    inner.set(row.day_offset, row.minutes);
  }
  return out;
}

export async function setWeeklyPlanCommitment(
  weekStartDate: string,
  projectId: number,
  dayOffset: number,
  minutes: number
): Promise<void> {
  validateWeekDate(weekStartDate);
  validateDayOffset(dayOffset);
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) {
    throw new Error(`Invalid minutes: ${minutes} (must be 0..1440)`);
  }
  const db = await getDb();
  await db.execute(
    `INSERT INTO weekly_plan_commitments (week_start_date, project_id, day_offset, minutes)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT(week_start_date, project_id, day_offset) DO UPDATE SET minutes = $4`,
    [weekStartDate, projectId, dayOffset, minutes]
  );
}

export async function clearWeeklyPlanCommitment(
  weekStartDate: string,
  projectId: number,
  dayOffset: number
): Promise<void> {
  validateWeekDate(weekStartDate);
  validateDayOffset(dayOffset);
  const db = await getDb();
  await db.execute(
    "DELETE FROM weekly_plan_commitments WHERE week_start_date = $1 AND project_id = $2 AND day_offset = $3",
    [weekStartDate, projectId, dayOffset]
  );
}

export async function getWeeklyPlanProjectStatuses(
  weekStartDate: string
): Promise<Map<number, WeeklyPlanProjectStatus>> {
  validateWeekDate(weekStartDate);
  const db = await getDb();
  const rows: { project_id: number; status: WeeklyPlanProjectStatus }[] =
    await db.select(
      "SELECT project_id, status FROM weekly_plan_project_status WHERE week_start_date = $1",
      [weekStartDate]
    );
  const out = new Map<number, WeeklyPlanProjectStatus>();
  for (const row of rows) {
    out.set(row.project_id, row.status);
  }
  return out;
}

export async function setWeeklyPlanProjectStatus(
  weekStartDate: string,
  projectId: number,
  status: WeeklyPlanProjectStatus
): Promise<void> {
  validateWeekDate(weekStartDate);
  validatePlanStatus(status);
  const db = await getDb();
  await db.execute(
    `INSERT INTO weekly_plan_project_status (week_start_date, project_id, status, reviewed_at)
     VALUES ($1, $2, $3, datetime('now'))
     ON CONFLICT(week_start_date, project_id) DO UPDATE SET status = $3, reviewed_at = datetime('now')`,
    [weekStartDate, projectId, status]
  );
}

export async function clearWeeklyPlanProjectStatus(
  weekStartDate: string,
  projectId: number
): Promise<void> {
  validateWeekDate(weekStartDate);
  const db = await getDb();
  await db.execute(
    "DELETE FROM weekly_plan_project_status WHERE week_start_date = $1 AND project_id = $2",
    [weekStartDate, projectId]
  );
}

// ── Task Highlights ──────────────────────────────────────────────────────────

export async function toggleTaskHighlight(
  taskId: number,
  isHighlight: boolean
): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE tasks SET is_highlight = $1 WHERE id = $2", [
    isHighlight ? 1 : 0,
    taskId,
  ]);
}

// ── Settings ────────────────────────────────────────────────────────────────

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const rows: { value: string }[] = await db.select(
    "SELECT value FROM settings WHERE key = $1",
    [key]
  );
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT(key) DO UPDATE SET value = $2`,
    [key, value]
  );
}

export async function deleteSetting(key: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM settings WHERE key = $1", [key]);
}

// ── Recurring Tasks ──────────────────────────────────────────────────────────

interface RecurrenceRule {
  freq: "daily" | "weekly" | "weekdays";
  day?: number;      // 0=Sun..6=Sat, used with "weekly"
  interval?: number; // 1=every, 2=every other, 3=every third, ... (weekly only)
}

const VALID_FREQS = ["daily", "weekly", "weekdays"];

export function parseRecurrence(json: string | null): RecurrenceRule | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object") return null;
    if (!VALID_FREQS.includes(parsed.freq)) return null;
    if (parsed.freq === "weekly" && (typeof parsed.day !== "number" || parsed.day < 0 || parsed.day > 6)) return null;
    if (parsed.interval !== undefined) {
      if (typeof parsed.interval !== "number" || !Number.isInteger(parsed.interval) || parsed.interval < 1) return null;
    }
    return parsed as RecurrenceRule;
  } catch {
    return null;
  }
}

export function serializeRecurrence(rule: RecurrenceRule): string {
  return JSON.stringify(rule);
}

export async function setTaskRecurrence(
  taskId: number,
  recurrence: string | null
): Promise<void> {
  // Validate if non-null
  if (recurrence !== null && parseRecurrence(recurrence) === null) {
    throw new Error("Invalid recurrence format");
  }
  const db = await getDb();
  await db.execute(
    "UPDATE tasks SET recurrence = $1, date_scheduled = CASE WHEN $1 IS NOT NULL THEN NULL ELSE date_scheduled END WHERE id = $2",
    [recurrence, taskId]
  );
}

export async function generateRecurringInstances(date: string): Promise<void> {
  const db = await getDb();
  // Get all recurring templates (tasks with recurrence set, no source_id = they are templates)
  const templates: { id: number; project_id: number | null; title: string; priority: string; estimated_minutes: number | null; notes: string | null; recurrence: string; created_at: string }[] =
    await db.select(
      "SELECT id, project_id, title, priority, estimated_minutes, notes, recurrence, created_at FROM tasks WHERE recurrence IS NOT NULL AND recurrence_source_id IS NULL AND status != 'done'",
      []
    );

  const targetDate = new Date(date + "T00:00:00");
  const dayOfWeek = targetDate.getDay(); // 0=Sun..6=Sat

  // Monday-of-week helper for weekly interval anchoring.
  function mondayOf(d: Date): Date {
    const dow = d.getDay();
    const diff = dow === 0 ? -6 : 1 - dow;
    const m = new Date(d);
    m.setDate(d.getDate() + diff);
    m.setHours(0, 0, 0, 0);
    return m;
  }

  for (const tmpl of templates) {
    const rule = parseRecurrence(tmpl.recurrence);
    if (!rule) continue;

    // Check if this template should generate for this date
    let shouldGenerate = false;
    if (rule.freq === "daily") {
      shouldGenerate = true;
    } else if (rule.freq === "weekdays") {
      shouldGenerate = dayOfWeek >= 1 && dayOfWeek <= 5;
    } else if (rule.freq === "weekly") {
      const dayMatches = dayOfWeek === (rule.day ?? 0);
      const interval = rule.interval ?? 1;
      if (interval > 1 && dayMatches) {
        // Anchor cycle to the Monday of the template's creation week.
        // Generate only when (weeks since anchor) % interval === 0.
        const anchorMonday = mondayOf(new Date(tmpl.created_at));
        const targetMonday = mondayOf(targetDate);
        const weeksDiff = Math.round(
          (targetMonday.getTime() - anchorMonday.getTime()) / (7 * 86400000)
        );
        shouldGenerate = weeksDiff >= 0 && weeksDiff % interval === 0;
      } else {
        shouldGenerate = dayMatches;
      }
    }

    if (!shouldGenerate) continue;

    // Skip-check: if the user explicitly deleted an instance for this
    // (template, date), respect that intent and don't regenerate. The skip
    // table is populated by deleteTask() for any row that's a recurring
    // instance. Without this, deleting today's recurring task would
    // regenerate it on the very next loadData() call. Idempotent — extra
    // checks are harmless.
    const skipped: { recurrence_source_id: number }[] = await db.select(
      "SELECT recurrence_source_id FROM recurring_instance_skips WHERE recurrence_source_id = $1 AND date_scheduled = $2 LIMIT 1",
      [tmpl.id, date]
    );
    if (skipped.length > 0) continue;

    // Check if instance already exists for this date
    const existing: { id: number }[] = await db.select(
      "SELECT id FROM tasks WHERE recurrence_source_id = $1 AND date_scheduled = $2 LIMIT 1",
      [tmpl.id, date]
    );
    if (existing.length > 0) continue;

    // Create instance
    await db.execute(
      `INSERT INTO tasks (project_id, title, priority, estimated_minutes, notes, date_scheduled, recurrence_source_id, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 999)`,
      [tmpl.project_id, tmpl.title, tmpl.priority, tmpl.estimated_minutes, tmpl.notes, date, tmpl.id]
    );
  }
}

// ───────────────────────────────────────────────────────────────────
// Calendar integration (M2)
// ───────────────────────────────────────────────────────────────────

export interface UpsertCalendarTaskInput {
  externalId: string;
  title: string;
  /** Local-tz `YYYY-MM-DD`. Caller is responsible for deriving from
   *  the event's local-tz `startLocal` via `'T'` split + format guard. */
  dateScheduled: string;
  estimatedMinutes: number | null;
  // v21 metadata. All optional — fall through as NULL if missing.
  notes?: string | null;
  location?: string | null;
  url?: string | null;
  /** JSON-stringified array of `{name, email, status}` objects. */
  attendees?: string | null;
  organizerEmail?: string | null;
  calendarName?: string | null;
  startLocal?: string | null;
  endLocal?: string | null;
}

/** Upsert a calendar-imported task. INSERTs new rows; on
 *  `(external_source, external_id)` conflict, refreshes only the
 *  fields where the calendar is the source of truth (event-shape
 *  metadata: time range, location, description, attendees,
 *  organizer, calendar name, URL) plus `date_scheduled` as a
 *  deliberate exception (calendar moving an event to another day
 *  should move the task with it).
 *
 *  Explicitly preserves on conflict — never clobbered by re-sync:
 *  - title / estimated_minutes (user-authored intent; the user may
 *    rename or re-estimate after import)
 *  - notes (the user's own task notes, distinct from external_notes
 *    which is the imported event description)
 *  - status, is_highlight, sort_order, priority, project_id,
 *    objective_id (in-app task state)
 *
 *  See `docs/2026-05-06-calendar-upsert-contract.md` for the full
 *  rationale and the title-preservation failure mode that drove the
 *  preserve-vs-refresh split (Verse review on PR #12).
 *
 *  Returns `true` if a new row was inserted (vs. an existing row
 *  updated), so the caller's "created" count stays accurate.
 *
 *  The conflict target matches v19's UNIQUE partial index
 *  byte-for-byte (see `idx_tasks_external`). */
export async function upsertCalendarTask(
  input: UpsertCalendarTaskInput
): Promise<boolean> {
  const db = await getDb();
  // Pre-check existence so the returned "created" boolean stays
  // honest — DO UPDATE makes rowsAffected always 1, so we can't
  // disambiguate from the upsert result alone.
  const existing: unknown[] = await db.select(
    "SELECT 1 FROM tasks WHERE external_source = 'calendar' AND external_id = $1 LIMIT 1",
    [input.externalId]
  );
  const isNew = existing.length === 0;
  await db.execute(
    `INSERT INTO tasks (
       title, project_id, date_scheduled, estimated_minutes,
       priority, status, sort_order,
       external_source, external_id,
       external_notes, external_location, external_url,
       external_attendees, external_organizer_email,
       external_calendar_name, external_start_local, external_end_local
     )
     VALUES ($1, NULL, $2, $3, 'medium', 'todo', 0, 'calendar', $4,
             $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT(external_source, external_id) WHERE external_source IS NOT NULL DO UPDATE SET
       date_scheduled = excluded.date_scheduled,
       external_notes = excluded.external_notes,
       external_location = excluded.external_location,
       external_url = excluded.external_url,
       external_attendees = excluded.external_attendees,
       external_organizer_email = excluded.external_organizer_email,
       external_calendar_name = excluded.external_calendar_name,
       external_start_local = excluded.external_start_local,
       external_end_local = excluded.external_end_local`,
    [
      input.title,
      input.dateScheduled,
      input.estimatedMinutes,
      input.externalId,
      input.notes ?? null,
      input.location ?? null,
      input.url ?? null,
      input.attendees ?? null,
      input.organizerEmail ?? null,
      input.calendarName ?? null,
      input.startLocal ?? null,
      input.endLocal ?? null,
    ]
  );
  return isNew;
}

/** Soft-delete a task by stamping `external_dismissal_reason`. The row
 *  stays so time_entries FKs remain valid and the sync loop has a
 *  tombstone to consult. User-facing queries filter `external_dismissal_reason
 *  IS NULL` (see commit 1's filter sweep). */
export async function markTaskDismissed(
  taskId: number,
  reason: DismissalReason
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE tasks SET external_dismissal_reason = $1 WHERE id = $2",
    [reason, taskId]
  );
}

/** External IDs the user explicitly dismissed for a given local date.
 *  Used by `syncCalendarEventsForDate` to skip re-importing them.
 *  Note: only `'user'` dismissals — `'cancelled'` (M5) doesn't block
 *  re-import (the calendar may un-cancel; that's a different surface). */
export async function getDismissedExternalIds(
  dateIso: string
): Promise<string[]> {
  const db = await getDb();
  const rows: { external_id: string | null }[] = await db.select(
    `SELECT external_id FROM tasks
       WHERE date_scheduled = $1
         AND external_source = 'calendar'
         AND external_dismissal_reason = 'user'`,
    [dateIso]
  );
  return rows
    .map((r) => r.external_id)
    .filter((x): x is string => x != null);
}
