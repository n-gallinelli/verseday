import { getDb } from "./database";
import { desktopDir, join } from "@tauri-apps/api/path";
import {
  SQL_WORKED_ENTRIES_IN_WINDOW,
  SQL_CLOSE_ORPHANED_TIME_ENTRIES,
} from "./workedSecondsSql";
import { SQL_UPSERT_WEEKLY_SHUTDOWN } from "./shutdownSql";
import {
  SQL_ROLLOVER_CAPTURE,
  SQL_ROLLOVER_MOVE,
  SQL_ROLLOVER_EXPIRE,
  SQL_ROLLOVER_EXPIRE_CAPTURE,
} from "./rolloverSql";
import { createTaskSortSubquery } from "./createTaskSortSql";
import { assertReschedulable } from "./rescheduleGuard";
import { todayString, localDateIso, localDayStartUtc, localDayEndUtc, weekdayDates, addDaysIso } from "../utils/dates";
import { emitIconsChanged } from "../utils/iconEvents";
import type { Project, Task, DailyPlan, WeeklyShutdown, Link, CustomIcon } from "../types";
import type { DismissalReason } from "../calendar/types";

/** The colors offered in project color pickers and auto-assigned to new
 *  projects: 12 pastels that vary LIGHTNESS and CHROMA, not just hue.
 *
 *  Design rules (so this can be extended later without re-introducing
 *  lookalikes — the old 24-color set failed because every swatch sat at one
 *  fixed lightness/saturation and only hue rotated, collapsing adjacent hues):
 *   1. Stagger lightness deliberately — butter/lime/apricot sit lightest;
 *      teal/blue/periwinkle sit noticeably deeper. NEVER ship two same-family
 *      hues at the same lightness (the #1 cause of confusion).
 *   2. Space hues by *perceived* difference, not even degrees — the eye
 *      resolves more steps in green–blue than in orange–yellow.
 *   3. If generating programmatically, use OKLCH (not HSL — HSL "lightness"
 *      lies). Target ~L 0.80–0.92, C 0.06–0.12 to stay pastel, varying L and C
 *      between neighbors. */
export const PROJECT_PALETTE = [
  "#F4A6B8", // Rose
  "#F6A98C", // Coral
  "#F3C58A", // Apricot
  "#EFDA72", // Butter
  "#C3DE84", // Lime
  "#8FD3A0", // Green
  "#6FC9BD", // Teal
  "#9BC9EC", // Sky
  "#7BA3E0", // Blue
  "#A99CE8", // Periwinkle
  "#CBA6E9", // Lavender
  "#E89CD0", // Orchid
  "#BFCBA6", // Sage
  "#C8A9B6", // Mauve
  "#9DB0C9", // Slate
  "#C99E82", // Clay
  "#D4BC6A", // Mustard
  "#AE82AC", // Plum
  "#C7BCA8", // Stone
  "#C5DCE0", // Powder
];

/** Every color validateColor accepts: the current pastel palette PLUS every
 *  previously-shipped/legacy hex, so projects created under older palettes
 *  still validate, render, and save. Only PROJECT_PALETTE is offered in the UI. */
export const PRESET_COLORS = [
  ...PROJECT_PALETTE,
  // Retired 24-color even-hue palette — kept so existing objectives validate.
  "#EAA4A4", "#A4EAD8", "#EAA4C7", "#A4EAB6", "#EAA4EA", "#B6EAA4",
  "#C7A4EA", "#D8EAA4", "#A4A4EA", "#EAD8A4", "#A4C7EA", "#EAB6A4",
  "#A4EAEA", "#EAA4B6", "#A4EAC7", "#EAA4D8", "#A4EAA4", "#D8A4EA",
  "#C7EAA4", "#B6A4EA", "#EAEAA4", "#A4B6EA", "#EAC7A4", "#A4D8EA",
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
}

// ── Custom objective icons (#25) ──────────────────────────────────────────
// data is a canvas-re-encoded PNG data URI (utils/iconUpload) — never raw
// upload bytes. created_at stamped here (ISO), not a SQL default.
export async function createCustomIcon(data: string): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    "INSERT INTO custom_icons (data, created_at) VALUES ($1, $2)",
    [data, new Date().toISOString()]
  );
  emitIconsChanged();
  return result.lastInsertId ?? 0;
}

export async function getCustomIcons(): Promise<CustomIcon[]> {
  const db = await getDb();
  return db.select(
    "SELECT id, data, created_at FROM custom_icons ORDER BY created_at DESC, id DESC LIMIT 500"
  );
}

/** Set a project's icon: an emoji (icon set, customIconId null), a custom image
 *  (customIconId set, icon null), or none (both null). Emits project-changed so
 *  every project-list holder re-renders the glyph. */
export async function setProjectIcon(
  id: number,
  icon: string | null,
  customIconId: number | null
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE projects SET icon = $1, custom_icon_id = $2 WHERE id = $3",
    [icon, customIconId, id]
  );
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
}

export async function deleteProject(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM projects WHERE id = $1", [id]);
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
/** What a rollover moved, so the store can reconcile EVERY affected bucket
 *  (source past dates + their weeks, today + its week, the unscheduled set) —
 *  not just the active one. `toDate` is `today` for rolled tasks, `null` for
 *  expired (unscheduled) ones. P6. */
export interface RolloverMove {
  id: number;
  fromDate: string;
  toDate: string | null;
}

export async function rolloverUnfinishedTasks(today: string): Promise<RolloverMove[]> {
  const db = await getDb();

  // #10 — capture the rows about to roll forward, in a deterministic order
  // (oldest first, then prior sort_order), BEFORE the move. Without renumbering
  // they'd keep their prior-day sort_order and interleave arbitrarily with
  // today's tasks; a later drag-reorder would then persist an order the user
  // never saw.
  const toRoll: { id: number }[] = await db.select(SQL_ROLLOVER_CAPTURE, [today]);

  // P6 — capture old dates of the rolling set + the expiring set BEFORE the
  // move, so the caller can reconcile the source buckets they vacate.
  const rolledIdList = toRoll.map((t) => t.id).join(",");
  const rolledDates: { id: number; date_scheduled: string }[] =
    toRoll.length > 0
      ? await db.select(
          `SELECT id, date_scheduled FROM tasks WHERE id IN (${rolledIdList})`,
          []
        )
      : [];
  const expiredRows: { id: number; date_scheduled: string }[] = await db.select(
    SQL_ROLLOVER_EXPIRE_CAPTURE,
    [today]
  );

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

  const fromById = new Map(rolledDates.map((r) => [r.id, r.date_scheduled]));
  return [
    ...toRoll
      .map((t) => ({ id: t.id, fromDate: fromById.get(t.id), toDate: today as string | null }))
      .filter((m): m is RolloverMove => m.fromDate != null),
    ...expiredRows.map((r) => ({ id: r.id, fromDate: r.date_scheduled, toDate: null as string | null })),
  ];
}

export async function getTaskById(id: number): Promise<Task | null> {
  const db = await getDb();
  const rows: Task[] = await db.select(
    "SELECT * FROM tasks WHERE id = $1 LIMIT 1",
    [id]
  );
  return rows[0] ?? null;
}

/** Resolve a calendar-imported task by its external_id — used by the
 *  meeting-notification click handler to jump to the task on the focus
 *  screen. Prefers a non-done instance; deterministic tiebreaker. */
export async function getTaskByExternalId(externalId: string): Promise<Task | null> {
  const db = await getDb();
  const rows: Task[] = await db.select(
    `SELECT * FROM tasks
     WHERE external_source = 'calendar' AND external_id = $1
     ORDER BY (status = 'done') ASC, created_at ASC, id ASC
     LIMIT 1`,
    [externalId]
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
  //
  // Multi-day range tasks (due_date set): a task spans every day in
  // [date_scheduled, due_date] in the daily view. Arm A (date_scheduled = $1)
  // is the start day (any status — a done range task still shows on its start
  // day, exactly like a single-day done task). Arm B is the CONTINUATION days
  // (after the start, through due_date) and only while NOT done — so completing
  // the task drops it from later days. Single-day tasks (due_date NULL) match
  // arm A only, byte-identical to before. The OR is parenthesised so the
  // recurrence / dismissal filters apply to both arms.
  return db.select(
    `SELECT * FROM tasks
     WHERE recurrence IS NULL AND external_dismissal_reason IS NULL
       AND (
         date_scheduled = $1
         OR (due_date IS NOT NULL AND date_scheduled < $1 AND due_date >= $1 AND status != 'done')
       )
     ORDER BY sort_order LIMIT 500`,
    [date]
  );
}

export async function getTasksForProject(
  projectId: number,
  includeDone = false
): Promise<Task[]> {
  const db = await getDb();
  // recurrence IS NULL excludes recurring TEMPLATES (P4) — a template can carry
  // a project_id, and this feeds the canonical taskIdsByProject slice directly
  // (load replaces the slice, bypassing the isTemplate index predicate), so it
  // must filter here or the template would show in the objective's task list.
  if (includeDone) {
    return db.select(
      "SELECT * FROM tasks WHERE project_id = $1 AND recurrence IS NULL ORDER BY status = 'done', sort_order LIMIT 500",
      [projectId]
    );
  }
  return db.select(
    "SELECT * FROM tasks WHERE project_id = $1 AND recurrence IS NULL AND status != 'done' ORDER BY sort_order LIMIT 500",
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

/** P4 — export a CONSISTENT snapshot of the DB to the Desktop. Uses
 *  `VACUUM INTO`, not a file copy: the live DB may have an open rollback
 *  journal / in-flight writes, so a raw copy can be torn. VACUUM INTO writes a
 *  transactionally-consistent standalone copy. The destination is a SQL string
 *  LITERAL (not a bindable param), so single quotes in the path are escaped by
 *  doubling. Returns the destination path. */
export async function exportDatabaseToDesktop(): Promise<string> {
  const db = await getDb();
  const dir = await desktopDir();
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const dest = await join(dir, `verseday-export-${stamp}.db`);
  const escaped = dest.replace(/'/g, "''");
  await db.execute(`VACUUM INTO '${escaped}'`);
  return dest;
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

  // New tasks land at the top of their scope via sort_order = min(existing) - 1
  // (monotonic decrement; SQLite INTEGER is 64-bit). #11 — compute that min
  // INSIDE the INSERT as a subquery rather than SELECT-then-INSERT so two
  // concurrent creates (main + QuickAdd webview) can't read the same MIN and
  // collide. Scope precedence is date-before-project (see createTaskSortSql.ts):
  // a dated task tops its DATE list even when it also carries an Objective —
  // the daily planner is the primary surface and the target of new-task-to-top.
  // The subquery reuses the row's own bound params ($2 project_id / $3
  // date_scheduled) so no extra binds.
  const sortSubquery = createTaskSortSubquery({
    projectId: input.projectId,
    dateScheduled: input.dateScheduled,
  });
  const result = await db.execute(
    `INSERT INTO tasks (title, project_id, date_scheduled, estimated_minutes, priority, notes, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, ${sortSubquery})`,
    [
      input.title,
      input.projectId,
      input.dateScheduled,
      estimatedMinutes,
      priority,
      input.notes ?? null,
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

/** #10 — propagate a recurring TEMPLATE's title/estimate edit to its existing
 *  FUTURE-dated instances (option (a), future-only). Past and today's instances
 *  are left untouched as a historical record; done instances are never
 *  rewritten. Returns the affected instance ids so the store can reconcile the
 *  canonical map. No-op (returns []) for non-template ids. */
export async function propagateTemplateFieldsToFutureInstances(
  templateId: number,
  title: string,
  estimatedMinutes: number | null
): Promise<number[]> {
  const db = await getDb();
  const today = todayString(); // local tz, matches date_scheduled everywhere
  const rows: { id: number }[] = await db.select(
    `SELECT id FROM tasks
       WHERE recurrence_source_id = $1
         AND date_scheduled > $2
         AND status != 'done'`,
    [templateId, today]
  );
  if (rows.length === 0) return [];
  await db.execute(
    `UPDATE tasks SET title = $1, estimated_minutes = $2
       WHERE recurrence_source_id = $3
         AND date_scheduled > $4
         AND status != 'done'`,
    [title, estimatedMinutes, templateId, today]
  );
  return rows.map((r) => r.id);
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
  const rows: { date: string; mood: string | null; reflection: string | null; tasks_done: number }[] = await db.select(
    `SELECT
       dp.date,
       dp.mood,
       dp.reflection,
       (SELECT COUNT(*) FROM tasks t WHERE t.date_scheduled = dp.date AND t.recurrence IS NULL AND t.external_dismissal_reason IS NULL AND t.status = 'done') AS tasks_done
     FROM daily_plans dp
     WHERE dp.mood IS NOT NULL OR (dp.reflection IS NOT NULL AND dp.reflection != '')
     ORDER BY dp.date DESC
     ${limit != null ? "LIMIT " + Math.max(1, Math.floor(limit)) : ""}`
  );
  // Worked minutes are attributed by the LOCAL day each session was worked
  // (localDateIso(start_time)), NOT by t.date_scheduled — the same fix as the
  // dashboard/weekly charts, so reflection history agrees with them rather than
  // dumping a multi-day task's whole total onto its scheduled date. One windowed
  // fetch over the span of returned dates, bucketed in JS. (tasks_done stays a
  // date_scheduled count — out of scope per the worked-time plan.)
  const workedByDay = new Map<string, number>();
  if (rows.length > 0) {
    const sortedDates = rows.map((r) => r.date).sort();
    const entries = await fetchWorkedEntriesForLocalRange(
      sortedDates[0],
      sortedDates[sortedDates.length - 1]
    );
    for (const { date, minutes } of bucketWorkedByLocalDay(entries)) {
      workedByDay.set(date, minutes);
    }
  }
  return rows.map(r => ({
    date: r.date,
    mood: r.mood,
    reflection: r.reflection,
    tasksDone: Number(r.tasks_done) || 0,
    workedMinutes: workedByDay.get(r.date) ?? 0,
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
export async function startTimeEntry(
  taskId: number,
  type: "pomodoro" | "tracked"
): Promise<number> {
  const db = await getDb();
  // INVARIANT (Stage 3 boot reconcile): an OPEN row (end_time NULL) == a live
  // focus session. This is the ONLY path that deliberately leaves end_time NULL.
  // Any future INSERT INTO time_entries (import/sync/backfill) MUST set end_time,
  // or reconcileFocusOnBoot will treat it as a phantom session on next launch.
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
  // Idempotent: only close a still-open row. A double stop — focus Done
  // racing a stray re-fire, or a row already closed by a prior stop — is a
  // no-op instead of re-stamping end_time / clobbering break_seconds.
  await db.execute(
    "UPDATE time_entries SET end_time = $1, break_seconds = $2 WHERE id = $3 AND end_time IS NULL",
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
export async function getOpenTimeEntries(): Promise<
  { id: number; task_id: number; worked_seconds: number; start_time: string }[]
> {
  const db = await getDb();
  // Stage 3 boot reconcile: the most-recent open row is the live session; the
  // rest are crash orphans. Source of truth, replacing the localStorage blob.
  return db.select(
    "SELECT id, task_id, worked_seconds, start_time FROM time_entries WHERE end_time IS NULL ORDER BY start_time DESC",
    [],
  );
}

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

// Daily worked-minutes total — attributed to the day each session was actually
// worked (localDateIso(start_time)), NOT the task's date_scheduled, so a
// multi-day task's time lands on the right day. #15 still holds: the
// `te.end_time IS NOT NULL` guard in SQL_WORKED_ENTRIES_IN_WINDOW excludes the
// open in-progress session so its checkpointed worked_seconds isn't
// double-counted against the live focus.workedMs added at the app layer. SQL
// lives in ./workedSecondsSql so the integrity test runs the identical text.
export async function getTotalWorkedMinutes(date: string): Promise<number> {
  const rows = await fetchWorkedEntriesForLocalRange(date, date);
  return bucketWorkedByLocalDay(rows).find((b) => b.date === date)?.minutes ?? 0;
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
  // recurrence IS NULL excludes templates (P4): a template has date_scheduled
  // NULL, so without this it would surface as an "unscheduled" task.
  if (projectId != null) {
    return db.select(
      "SELECT * FROM tasks WHERE date_scheduled IS NULL AND recurrence IS NULL AND status != 'done' AND project_id = $1 ORDER BY sort_order LIMIT 50",
      [projectId]
    );
  }
  return db.select(
    "SELECT * FROM tasks WHERE date_scheduled IS NULL AND recurrence IS NULL AND status != 'done' ORDER BY sort_order LIMIT 50"
  );
}

// Worked minutes per day for the dashboard week chart — bucketed by the LOCAL
// day each session was worked (start_time), not t.date_scheduled, so a multi-day
// task's time is split across the days it was actually worked. The final
// [startDate,endDate] filter is on the bucketed LOCAL date (the window is
// over-padded; out-of-range days are dropped here).
export async function getWorkedMinutesForWeek(
  startDate: string,
  endDate: string
): Promise<Map<string, number>> {
  const rows = await fetchWorkedEntriesForLocalRange(startDate, endDate);
  const map = new Map<string, number>();
  for (const { date, minutes } of bucketWorkedByLocalDay(rows)) {
    if (date >= startDate && date <= endDate) map.set(date, minutes);
  }
  return map;
}

// Per-day, per-project worked minutes for a week. Used by the weekly
// shutdown bar chart to show "where effort went" each day, segmented
// by objective. Tasks without a project are bucketed under projectId
// = -1 ("Unassigned"). Bucketed by the LOCAL work day of each session
// (start_time), not t.date_scheduled — consistent with getWorkedMinutesForWeek.
export async function getWorkedMinutesPerProjectPerDay(
  startDate: string,
  endDate: string
): Promise<Map<string, Map<number, number>>> {
  const rows = await fetchWorkedEntriesForLocalRange(startDate, endDate);
  const all = bucketWorkedByLocalDayAndProject(rows);
  const out = new Map<string, Map<number, number>>();
  for (const [date, inner] of all) {
    if (date >= startDate && date <= endDate) out.set(date, inner);
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

// Returns the id(s) of any recurring-sibling rows DELETED by the collision
// guard, so the caller (store action) can reconcile them out of the canonical
// map/indices via withTaskRemoved — otherwise they linger as ghost rows until
// a reload. Empty array when nothing was dropped.
/** Result of a reschedule that may have absorbed a colliding recurring
 *  sibling. `deletedSiblingIds` are rows the store must drop from
 *  `tasksById`; `mergedData` is true only when *real* data (worked time,
 *  notes, or a done-status) was carried over — the signal for an optional
 *  non-blocking "merged" toast. When true the store must also reconcile the
 *  keeper from DB truth (its notes/status/worked-minutes changed). */
export interface RescheduleResult {
  deletedSiblingIds: number[];
  mergedData: boolean;
}

export async function updateTaskDateScheduled(
  id: number,
  dateScheduled: string | null
): Promise<RescheduleResult> {
  const db = await getDb();
  let deletedSiblingIds: number[] = [];
  let mergedData = false;

  // Fetch the moved row's recurrence + current date up front: the source id
  // drives the collision merge (target date) AND the skip-on-move (#4, source
  // date); the old date is the one we must skip so it doesn't regenerate.
  const selfRows: {
    recurrence_source_id: number | null;
    date_scheduled: string | null;
    external_source: string | null;
  }[] = await db.select(
    "SELECT recurrence_source_id, date_scheduled, external_source FROM tasks WHERE id = $1",
    [id]
  );
  // Calendar-imported tasks can't be manually re-dated — their date is owned by
  // the calendar. Throw BEFORE any merge/skip/update side effect. Reached only
  // by the carry buttons (already filtered in the UI, so this is their backstop)
  // and the drag wrapper setTaskDateScheduled, whose refetch-and-revert snaps an
  // optimistic drag back cleanly. The calendar importer uses its own upsert path,
  // so this never blocks import.
  assertReschedulable(selfRows[0]?.external_source);
  const sourceId = selfRows[0]?.recurrence_source_id ?? null;
  const oldDate = selfRows[0]?.date_scheduled ?? null;

  // Recurring-instance collision guard. The partial UNIQUE index
  // idx_tasks_recurrence_per_date (recurrence_source_id, date_scheduled)
  // means moving an instance onto a date that already holds a sibling of
  // the same recurrence violates the constraint and the UPDATE throws.
  // This happens routinely: viewing a day auto-generates that day's
  // instance, so pulling an overdue straggler of the same recurrence onto
  // today collides with the just-generated one.
  //
  // #1 (P1) — MERGE, not hard-delete. The moved instance (`id`) is the
  // keeper; the colliding sibling(s) are absorbed into it and then deleted.
  // CRITICAL ORDERING: time_entries are reassigned to the keeper BEFORE the
  // sibling row is deleted. `time_entries.task_id` is `ON DELETE CASCADE`
  // and FK enforcement is ON at runtime (verified empirically), so deleting
  // a sibling that still owned time_entries would cascade-destroy them. The
  // tauri-plugin-sql JS layer has no transaction API (pooled connections),
  // so atomicity is achieved by failure-safe ordering + per-statement
  // atomicity: reassign-then-delete means an interruption can never lose
  // worked time (worst case leaves an empty shell that the next collision
  // re-absorbs).
  if (dateScheduled !== null) {
    if (sourceId !== null) {
      const sibs: {
        id: number;
        notes: string | null;
        status: string;
        completed_at: string | null;
      }[] = await db.select(
        "SELECT id, notes, status, completed_at FROM tasks WHERE recurrence_source_id = $1 AND date_scheduled = $2 AND id <> $3",
        [sourceId, dateScheduled, id]
      );
      deletedSiblingIds = sibs.map((r) => r.id);
      if (deletedSiblingIds.length > 0) {
        const idList = deletedSiblingIds.join(",");

        // 1) Reassign the siblings' worked time to the keeper FIRST.
        const reassigned = await db.execute(
          `UPDATE time_entries SET task_id = $1 WHERE task_id IN (${idList})`,
          [id]
        );

        // 2) Fold sibling notes + done-status into the keeper.
        const keeperRows: {
          notes: string | null;
          status: string;
          completed_at: string | null;
        }[] = await db.select(
          "SELECT notes, status, completed_at FROM tasks WHERE id = $1",
          [id]
        );
        const keeper = keeperRows[0];
        const keeperNotes = keeper?.notes ?? null;
        const keeperDone = keeper?.status === "done";

        const sibNotes = sibs
          .map((s) => s.notes)
          .filter((n): n is string => n != null && n.trim() !== "");
        const doneSib = sibs.find((s) => s.status === "done");
        const sibDone = doneSib != null;

        // Done if either side is done. Preserve a real completion stamp:
        // keep the keeper's if it was already done, else inherit the
        // sibling's completed_at (when the work was actually finished).
        const nextStatus = keeperDone || sibDone ? "done" : keeper?.status;
        const nextCompletedAt = keeperDone
          ? keeper?.completed_at ?? null
          : sibDone
            ? doneSib?.completed_at ?? null
            : keeper?.completed_at ?? null;
        const mergedNotes =
          [keeperNotes, ...sibNotes]
            .filter((n): n is string => n != null && n.trim() !== "")
            .join("\n\n") || null;

        const notesChanged = mergedNotes !== keeperNotes;
        const statusChanged = nextStatus !== keeper?.status;
        if (notesChanged || statusChanged) {
          await db.execute(
            "UPDATE tasks SET notes = $1, status = $2, completed_at = $3 WHERE id = $4",
            [mergedNotes, nextStatus, nextCompletedAt, id]
          );
        }

        // Real data absorbed → caller may surface a non-blocking toast.
        mergedData =
          (reassigned.rowsAffected ?? 0) > 0 || sibNotes.length > 0 || sibDone;

        // 3) Delete the now-empty shells. Their time_entries already moved
        //    to the keeper in step 1, so the FK cascade deletes nothing.
        await db.execute(`DELETE FROM tasks WHERE id IN (${idList})`, []);
      }
    }
  }

  // #4 — skip-on-move. When a recurring instance is moved OFF its native date
  // (to another date or to unscheduled), record a skip for the original date
  // so the next generateRecurringInstances doesn't recreate the instance the
  // user just relocated. Mirrors deleteTask's skip-insert. ON CONFLICT swallows
  // a duplicate (e.g. a re-move of the same instance).
  if (sourceId !== null && oldDate !== null && oldDate !== dateScheduled) {
    await db.execute(
      "INSERT INTO recurring_instance_skips (recurrence_source_id, date_scheduled) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [sourceId, oldDate]
    );
  }

  await db.execute(
    "UPDATE tasks SET date_scheduled = $1 WHERE id = $2",
    [dateScheduled, id]
  );
  return { deletedSiblingIds, mergedData };
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

/** #7 — bucket worked seconds by LOCAL calendar day. start_time is a UTC
 *  instant (Date.toISOString()); SQL `date(start_time)` buckets on the UTC day,
 *  so an evening session east of UTC (or late-night work) is mis-attributed to
 *  the wrong day. Grouping in JS via localDateIso fixes it. Pure + exported for
 *  the integrity test. */
export function bucketWorkedByLocalDay(
  rows: { start_time: string; worked_seconds: number }[]
): { date: string; minutes: number }[] {
  const byDay = new Map<string, number>();
  for (const r of rows) {
    const day = localDateIso(new Date(r.start_time));
    byDay.set(day, (byDay.get(day) ?? 0) + r.worked_seconds);
  }
  return Array.from(byDay.entries())
    .map(([date, secs]) => ({ date, minutes: Math.round(secs / 60) }))
    .filter((r) => r.minutes > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Like bucketWorkedByLocalDay but ALSO grouped by project, for the weekly
 *  per-day/per-project chart. NULL project_id buckets under -1 ("Unassigned"),
 *  matching the prior convention. Rounds seconds→minutes per (day, project) and
 *  drops empties. Pure + exported for the integrity test. */
export function bucketWorkedByLocalDayAndProject(
  rows: { start_time: string; worked_seconds: number; project_id: number | null }[]
): Map<string, Map<number, number>> {
  const secsByDayProj = new Map<string, Map<number, number>>();
  for (const r of rows) {
    const day = localDateIso(new Date(r.start_time));
    let inner = secsByDayProj.get(day);
    if (!inner) { inner = new Map(); secsByDayProj.set(day, inner); }
    const proj = r.project_id ?? -1;
    inner.set(proj, (inner.get(proj) ?? 0) + r.worked_seconds);
  }
  const out = new Map<string, Map<number, number>>();
  for (const [day, inner] of secsByDayProj) {
    const mins = new Map<number, number>();
    for (const [proj, secs] of inner) {
      const m = Math.round(secs / 60);
      if (m > 0) mins.set(proj, m);
    }
    if (mins.size > 0) out.set(day, mins);
  }
  return out;
}

/** Fetch raw closed time entries whose start_time falls in the PADDED window
 *  around the [start,end] LOCAL day range (start−1d … end+2d, to cover the
 *  range across any UTC offset), for JS local-day bucketing. Shared by the daily
 *  total, the dashboard week chart, the weekly per-project chart, and reflection
 *  history so every surface attributes worked time to the day it was worked. */
async function fetchWorkedEntriesForLocalRange(
  start: string,
  end: string
): Promise<{ start_time: string; worked_seconds: number; project_id: number | null }[]> {
  const db = await getDb();
  return db.select(SQL_WORKED_ENTRIES_IN_WINDOW, [addDaysIso(start, -1), addDaysIso(end, 2)]);
}

export async function getWorkedMinutesByDate(
  taskId: number
): Promise<{ date: string; minutes: number }[]> {
  const db = await getDb();
  const rows: { start_time: string; worked_seconds: number }[] = await db.select(
    `SELECT start_time, worked_seconds
    FROM time_entries
    WHERE task_id = $1 AND end_time IS NOT NULL AND worked_seconds > 0`,
    [taskId]
  );
  return bucketWorkedByLocalDay(rows);
}

/** Tag on the synthetic entry created when an untimed task is completed and its
 *  time-spent is backfilled from the estimate. Used to strip it on reopen and
 *  to separate it from real tracked time. NOT excluded from any worked-time
 *  read — backfilled time counts in totals (that's the feature). */
export const ESTIMATE_BACKFILL_ENTRY_TYPE = "estimate_backfill";

/** Raw committed worked seconds for a task (closed entries only), UNrounded —
 *  callers that must distinguish 0 from 1–29s (which getWorkedMinutesForTask
 *  rounds to 0) use this, e.g. the estimate backfill guard. */
export async function getWorkedSecondsForTask(taskId: number): Promise<number> {
  const db = await getDb();
  const rows: { total: number }[] = await db.select(
    `SELECT COALESCE(SUM(worked_seconds), 0) as total
     FROM time_entries WHERE task_id = $1 AND end_time IS NOT NULL`,
    [taskId]
  );
  return rows[0]?.total ?? 0;
}

/** Strip the estimate-backfill entry for a task (at most one). Called when a
 *  done task is reopened, so reopened work no longer carries the assumed time. */
export async function deleteEstimateBackfillEntries(taskId: number): Promise<void> {
  const db = await getDb();
  await db.execute(
    "DELETE FROM time_entries WHERE task_id = $1 AND entry_type = $2",
    [taskId, ESTIMATE_BACKFILL_ENTRY_TYPE]
  );
}

export async function setManualWorkedMinutes(
  taskId: number,
  targetMinutes: number,
  entryType: string = "tracked"
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
      "INSERT INTO time_entries (task_id, start_time, end_time, entry_type, worked_seconds) VALUES ($1, $2, $3, $4, $5)",
      [taskId, startTime, now, entryType, diff * 60]
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
      "INSERT INTO time_entries (task_id, start_time, end_time, entry_type, worked_seconds) VALUES ($1, $2, $3, $4, $5)",
      [taskId, startTime, now, entryType, targetMinutes * 60]
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
  // #1 — local-tz format; toISOString() would shift the cutoff ±1 day
  // east-of-UTC (evening), mis-filtering the overdue window.
  const overdueCutoffIso = localDateIso(overdueCutoff);
  const hardFloor = new Date(today + "T00:00:00");
  hardFloor.setDate(hardFloor.getDate() - 14);
  const hardFloorIso = localDateIso(hardFloor);
  return db.select(
    `SELECT * FROM tasks
       WHERE status != 'done'
         AND recurrence IS NULL
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

/**
 * Day-cell minutes per (project, day_offset) for a week — DERIVED from tasks
 * (Approach A, task-as-truth): the SUM of `estimated_minutes` of non-done tasks
 * scheduled to each weekday. This is the authoritative planned number read by the
 * day strip AND PlanWeekSummary, so neither can drift onto a stale aggregate after
 * a task-side reschedule/estimate edit. (The `weekly_plan_commitments` table no
 * longer stores this — its rows are now markers; see getWeeklyPlanCommitmentMarkers.)
 * Excludes done tasks (matches the strip's non-done chips), recurrence templates,
 * and dismissed external rows — mirroring the daily-plan task filter.
 */
export async function getWeeklyPlanCommitments(
  weekStartDate: string
): Promise<Map<number, Map<number, number>>> {
  validateWeekDate(weekStartDate);
  const db = await getDb();
  const week = weekdayDates(weekStartDate);
  const rows: { project_id: number; date_scheduled: string; minutes: number }[] =
    await db.select(
      `SELECT project_id, date_scheduled, COALESCE(SUM(estimated_minutes), 0) AS minutes
         FROM tasks
        WHERE date_scheduled IN ($1, $2, $3, $4, $5)
          AND project_id IS NOT NULL
          AND status != 'done'
          AND recurrence IS NULL
          AND external_dismissal_reason IS NULL
        GROUP BY project_id, date_scheduled`,
      week
    );
  const dayByIso = new Map(week.map((iso, i) => [iso, i]));
  const out = new Map<number, Map<number, number>>();
  for (const row of rows) {
    const day = dayByIso.get(row.date_scheduled);
    if (day === undefined) continue;
    const mins = Number(row.minutes) || 0;
    if (mins <= 0) continue;
    let inner = out.get(row.project_id);
    if (!inner) {
      inner = new Map<number, number>();
      out.set(row.project_id, inner);
    }
    inner.set(day, mins);
  }
  return out;
}

export interface CommitmentMarkerRow {
  project_id: number;
  day_offset: number;
  task_id: number | null;
}
export interface MarkerTaskFacts {
  project_id: number | null;
  date_scheduled: string | null;
}

/**
 * Pure marker resolution (extracted for unit testing). A marker row is VALID only
 * if its linked task still sits at exactly that (project, day); otherwise it's
 * `stale` and the caller prunes it (write-on-read). So a General task rescheduled
 * elsewhere simply unbinds (becomes a normal task); the derived cell sum stays
 * correct regardless. PK(week, project, day) ⇒ one marker per slot — no collisions.
 */
export function resolveCommitmentMarkers(
  rows: CommitmentMarkerRow[],
  taskFactsById: Map<number, MarkerTaskFacts>,
  weekDays: string[]
): {
  markers: Map<number, Map<number, number>>;
  stale: { project_id: number; day_offset: number }[];
} {
  const dayByIso = new Map(weekDays.map((iso, i) => [iso, i]));
  const markers = new Map<number, Map<number, number>>();
  const stale: { project_id: number; day_offset: number }[] = [];
  for (const row of rows) {
    if (row.task_id == null) {
      stale.push({ project_id: row.project_id, day_offset: row.day_offset });
      continue;
    }
    const t = taskFactsById.get(row.task_id);
    const day = t && t.date_scheduled ? dayByIso.get(t.date_scheduled) : undefined;
    if (!t || t.project_id !== row.project_id || day !== row.day_offset) {
      stale.push({ project_id: row.project_id, day_offset: row.day_offset });
      continue;
    }
    let inner = markers.get(row.project_id);
    if (!inner) {
      inner = new Map<number, number>();
      markers.set(row.project_id, inner);
    }
    inner.set(row.day_offset, row.task_id);
  }
  return { markers, stale };
}

/**
 * Which backing "General task" owns each (project, day_offset) slot — for the day
 * strip's ± / clear to target. Validates each marker against its task's CURRENT
 * position (task-as-truth) and prunes stale rows. See resolveCommitmentMarkers.
 */
export async function getWeeklyPlanCommitmentMarkers(
  weekStartDate: string
): Promise<Map<number, Map<number, number>>> {
  validateWeekDate(weekStartDate);
  const db = await getDb();
  const week = weekdayDates(weekStartDate);
  const rows: CommitmentMarkerRow[] = await db.select(
    "SELECT project_id, day_offset, task_id FROM weekly_plan_commitments WHERE week_start_date = $1",
    [weekStartDate]
  );
  const taskFactsById = new Map<number, MarkerTaskFacts>();
  for (const row of rows) {
    if (row.task_id == null) continue;
    const task = await getTaskById(row.task_id);
    if (task) {
      taskFactsById.set(row.task_id, {
        project_id: task.project_id,
        date_scheduled: task.date_scheduled,
      });
    }
  }
  const { markers: out, stale } = resolveCommitmentMarkers(rows, taskFactsById, week);
  // Best-effort prune (write-on-read; ignore failures — the map is already
  // task-derived, so a failed delete just lingers a harmless row).
  for (const d of stale) {
    try {
      await db.execute(
        "DELETE FROM weekly_plan_commitments WHERE week_start_date = $1 AND project_id = $2 AND day_offset = $3",
        [weekStartDate, d.project_id, d.day_offset]
      );
    } catch {
      /* refetch-on-failure: markers already reflect task truth */
    }
  }
  return out;
}

/** True if `taskId` is a live backing "General task" (referenced by a marker row).
 *  Used to EXCLUDE General tasks from estimate-backfill — a planning placeholder
 *  completed unworked must record worked = 0, not its planned estimate. */
export async function isWeeklyPlanGeneralTask(taskId: number): Promise<boolean> {
  const db = await getDb();
  const rows: { n: number }[] = await db.select(
    "SELECT COUNT(*) AS n FROM weekly_plan_commitments WHERE task_id = $1",
    [taskId]
  );
  return (rows[0]?.n ?? 0) > 0;
}

/** Upsert the marker row binding a General task to a (project, day) slot. The
 *  `minutes` column is vestigial under Approach A (cell minutes derive from
 *  tasks) — written 0 and non-authoritative. */
export async function setWeeklyPlanCommitment(
  weekStartDate: string,
  projectId: number,
  dayOffset: number,
  taskId: number
): Promise<void> {
  validateWeekDate(weekStartDate);
  validateDayOffset(dayOffset);
  const db = await getDb();
  await db.execute(
    `INSERT INTO weekly_plan_commitments (week_start_date, project_id, day_offset, minutes, task_id)
     VALUES ($1, $2, $3, 0, $4)
     ON CONFLICT(week_start_date, project_id, day_offset) DO UPDATE SET task_id = $4, minutes = 0`,
    [weekStartDate, projectId, dayOffset, taskId]
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

/** All recurring task templates (recurrence set). Instances point at these via
 *  recurrence_source_id and are excluded (they have recurrence NULL). */
export async function getRecurringTemplates(): Promise<Task[]> {
  const db = await getDb();
  return db.select(
    // recurrence_source_id IS NULL = the template/source itself, not a
    // generated instance (instances never carry recurrence, so this is belt
    // + suspenders for exactness).
    "SELECT * FROM tasks WHERE recurrence IS NOT NULL AND recurrence_source_id IS NULL ORDER BY title COLLATE NOCASE LIMIT 500"
  );
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

/** #5 — parse a SQLite datetime('now') value ("YYYY-MM-DD HH:MM:SS", UTC, no tz
 *  marker) into a correct UTC instant. `new Date(thatString)` would parse the
 *  space-separated form as LOCAL, mis-dating the creation instant by the tz
 *  offset. Defensive: pass through values that already carry a 'T'/'Z' (ISO). */
export function parseSqliteUtc(s: string): Date {
  if (s.includes("T") || s.endsWith("Z")) return new Date(s);
  return new Date(s.replace(" ", "T") + "Z");
}

export async function generateRecurringInstances(date: string): Promise<void> {
  const db = await getDb();
  // Get all recurring templates (tasks with recurrence set, no source_id = they are templates)
  const templates: { id: number; project_id: number | null; title: string; priority: string; estimated_minutes: number | null; notes: string | null; recurrence: string; created_at: string }[] =
    // #6 — a template is a RULE, not a completable task. Do NOT exclude
    // templates whose own status is 'done': if a template row ever gets marked
    // done (e.g. via a UI path that completes the template instead of the
    // instance), generation must keep running. Status is irrelevant to whether
    // a template should generate — only the recurrence rule + skips are.
    await db.select(
      "SELECT id, project_id, title, priority, estimated_minutes, notes, recurrence, created_at FROM tasks WHERE recurrence IS NOT NULL AND recurrence_source_id IS NULL",
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
        //
        // #5 — created_at is stored by datetime('now'), which is UTC in the
        // form "YYYY-MM-DD HH:MM:SS" (space, no 'T'/'Z'). `new Date(thatString)`
        // would parse it as LOCAL, mis-dating the creation instant by the tz
        // offset and flipping the biweekly phase when creation was near a UTC
        // day boundary. Parse it as the true UTC instant first; mondayOf then
        // reads LOCAL components, matching how targetDate (local midnight) is
        // built — so both Mondays are in the same (local) frame.
        const anchorMonday = mondayOf(parseSqliteUtc(tmpl.created_at));
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

    // #9 — idempotent insert. The old SELECT-exists-then-INSERT was racy: two
    // concurrent generators (the main window + the QuickAdd webview both call
    // this) could each pass the existence check and then both INSERT, the
    // second throwing on the partial UNIQUE index
    // idx_tasks_recurrence_per_date. ON CONFLICT … DO NOTHING makes a duplicate
    // a silent no-op against that index instead of an uncaught error.
    await db.execute(
      `INSERT INTO tasks (project_id, title, priority, estimated_minutes, notes, date_scheduled, recurrence_source_id, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 999)
       ON CONFLICT(recurrence_source_id, date_scheduled) WHERE recurrence_source_id IS NOT NULL DO NOTHING`,
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
