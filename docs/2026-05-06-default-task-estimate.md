# Default task estimate — 2026-05-06

Branch: `feat/default-task-estimate`

User ask: "all tasks should have a time allotment. if i don't put one,
default to 15 minutes. make that length changeable in settings."

## Setting

- Key: `default_task_estimate_min` in the existing `settings` table.
- Type: integer minutes, stored as string per the table convention.
- Fallback if missing/unparseable: **15**.
- Range exposed in UI: 5 – 240 minutes (5-min steps).

## Where the default fires

In `createTask` (`src/db/queries.ts`). If the caller passes
`estimatedMinutes == null`, we call `getDefaultTaskEstimateMin()` and
substitute. One extra `SELECT` per task creation — negligible.

**Why DB-layer instead of every call site:** there are six callers
(`QuickAdd`, `DailyPlanner`, `ProjectDetail` x2, `PlanTab`,
`ScheduleTab`). Centralising at the boundary means none of them have
to know about the setting. New callers get the behavior for free.

## Side effect — PlanTab drag default

`PlanTab.handleScheduleTask` had a hard-coded
`DEFAULT_DRAG_ESTIMATE_MINUTES = 30` that defaulted on drag for tasks
with null estimates. After this change, *new* tasks always have an
estimate, so this only applies to legacy tasks. Updated the function
to read the same setting (default 15) for consistency.

## Settings UI

New "Task defaults" section in `src/pages/Settings.tsx`, sitting
between Focus timer and Calendar. One pill-stepper field labeled
"Default time estimate", step 5, min 5, max 240, unit "min".
Live-debounced save (400ms) — same pattern as focus fields.

## Existing data

Existing tasks with `estimated_minutes IS NULL` are **not** backfilled.
- Display code already handles null gracefully (renders "—").
- Backfilling is a one-shot data migration; user did not request it.
- Flag if backfill is wanted later — would be a single
  `UPDATE tasks SET estimated_minutes = 15 WHERE estimated_minutes IS NULL`
  in a new migration.

## No DB migration

`settings` table already exists. No schema change.

## Risk / rollback

View + DB-helper changes only. Rollback = revert the branch.
