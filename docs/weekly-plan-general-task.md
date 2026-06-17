# Weekly Plan — day-time creates a backing "General task"

**Status:** PLAN v2 (post-Verse round 1) — migration written (NOT applied);
wiring awaiting Verse re-approval. Branch `feat/weekly-plan-general-task` (off main).
**Date:** 2026-06-17 · **Author:** Terse

## Problem

In Weekly Plan → a project's "TIME PER DAY" strip, clicking a day allocates time
(default 0:30) but it's an **abstract `weekly_plan_commitments` row** with no task
behind it. Nick wants clicking a day to create a real, editable **"General task"**
for that day/project he can open and rename — kept **in sync** with the cell.

## SOURCE OF TRUTH — pinned (resolves Verse round-1 rejection)

> **The TASK is the source of truth. The commitment row is a reconciled cache.**

Verse correctly showed a one-way cell→task binding breaks under four task-side
mutations. Inverting the direction makes them "just work" because the cell is
re-derived from the task on every load, never trusted as independent state.

- **`task.date_scheduled` + `task.estimated_minutes` are truth.** A day cell is a
  *view*: "is there a backing task scheduled to this (project, day)? show its
  estimate."
- The commitment row exists only to (a) hold the `task_id` link and (b) cache the
  day/minutes for cheap reads. On load it is reconciled from the task; on conflict,
  the task wins.

### How each Verse-flagged breakage is handled

| # | Mutation | Resolution under task-as-truth |
|---|----------|-------------------------------|
| 1 | **Rollover** moves `date_scheduled` to next day/week (doesn't touch commitments) | On load, the cell re-derives day_offset from `task.date_scheduled`. Task left the week → cell drops here and shows up wherever the task now lives. Just works. |
| 2 | **Reschedule task-side** (Daily Plan drag / TaskDetailOverlay date edit) | Same re-derivation on load. |
| 3 | **Estimate edited task-side** (Estimated pill) | Cell minutes = `task.estimated_minutes` on load (cache refreshed). |
| 4 | **Project delete** (commitments.project_id CASCADE deletes row; bypasses clearCommitment) | `tasks.project_id` is `ON DELETE SET NULL` → the General **task survives as Unassigned** (visible, not a hidden leak); the cache row is gone. Acceptable: user data preserved. (If Verse prefers deleting the task too, that needs an explicit trigger/app step — flagged.) |

Delete-the-task-elsewhere is handled at the DB layer: `task_id … ON DELETE SET
NULL` nulls the link automatically — no app reconcile code needed (per Verse).

## Migration #26 — WRITTEN, not yet applied

In `src-tauri/src/lib.rs` (latest applied = 25), exactly as Verse specified:

```sql
ALTER TABLE weekly_plan_commitments ADD COLUMN task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL;
```

`tasks.id` confirmed `INTEGER PRIMARY KEY AUTOINCREMENT`. Mirrors the
migration-25 `ADD COLUMN … REFERENCES … ON DELETE SET NULL` pattern (proven in
SQLite here). Additive + reversible. **Per discipline: bytes relayed to Verse for
final confirmation before first apply (= before any rebuild).**

## Wiring (task-as-truth)

- **Load (`PlanTab`):** for each commitment row, join its `task_id`. Derive the
  cell from the task: day_offset from `date_scheduled`, minutes from
  `estimated_minutes`, project from `task.project_id`. Row's cached day/minutes are
  refreshed if they drifted; rows whose task left the week/project are not rendered
  here. Legacy rows with `task_id IS NULL` (pre-feature) render from cached minutes
  as today, and materialize a task on first edit.
- **set (empty day):** `createTaskAction({title:"General task", projectId,
  dateScheduled: weekDates[dayOffset], estimatedMinutes: minutes})`; write row
  `{day_offset, minutes, task_id}`.
- **± / set (backed):** update linked task `estimated_minutes`; refresh cache.
- **clear:** delete linked task (DB nulls the row's task_id); delete the row.
- **drag-move between days (within strip):** update linked task's `date_scheduled`
  to the target day (cell follows on reload).

## Estimate-backfill interaction (Verse answer #2)

`estimate_backfill` injects `worked = estimate` when an **untimed** task is completed
([[project_estimate_backfill_worked_time]]). For a planning placeholder that would
turn PLANNED minutes into WORKED time — wrong. **Decision: exclude live backing
tasks from estimate-backfill** (identify by "task id is referenced by a
`weekly_plan_commitments.task_id`"). No new column — the link is the marker. A
General task that is actually worked records real time as normal.

## Title

"General task" (editable); project shown by row context, not baked into the title
(Verse-approved; accept identical-row clutter per Nick's ask).

## Open items for Verse (round 2)

1. Confirm the **task-as-truth / cache-reconcile** direction + the breakage table.
2. Project-delete: accept "task survives as Unassigned," or delete the backing task
   too?
3. Estimate-backfill: accept the "exclude linked backing tasks" rule (lookup by
   commitment link)?
4. Final literal DDL bytes of migration #26 (above) — OK to apply (rebuild)?

## Verse R2 — REQUIRED wiring rules (pinned before code)

**Rule 1 — clear must never destroy worked time.** `time_entries.task_id` is
`ON DELETE CASCADE`, so "clear → delete task" would silently destroy logged
time_entries (worked seconds = truth) if the task was worked. So:
- **clear hard-deletes ONLY a pristine task** (worked_seconds = 0 AND not
  completed). Otherwise **unlink** (null `task_id`) + drop the cache row, and
  **leave the task** intact. Never cascade-delete a worked/completed task from a
  cell clear.

**Rule 2 — reconcile collision (one cache slot, possibly two tasks).** Cache PK is
(week, project, day_offset); task-as-truth lets a reschedule put two of a project's
tasks on the same day. Rule: **link-one, lowest `task.id` owns the cell** (deterministic);
the cell's minutes = the owner's estimate. Any other task on that project+day is a
normal free task (still visible in Open Tasks / Daily Plan), simply not bound to the
cell. No INSERT collision, no dropped/summed planned time, no loss.

**Fold-in A — reconcile lives INSIDE `getWeeklyPlanCommitments` (queries.ts:1626)**,
not the component, so `schedulePlannedMinutes` + week summary never read a stale
cache after a task-side reschedule.

**Fold-in B — write-on-read reconcile is idempotent**; on a cache-write failure,
fall back to the in-memory task-derived value (refetch-on-failure) and never render
stale.

## Build order (after Verse round-2 approval)

1. Apply migration #26 (rebuild). 2. `getWeeklyPlanCommitments` returns task_id;
load-time reconcile from tasks. 3. set/±/clear create/update/delete the backing
task. 4. drag-move syncs `date_scheduled`. 5. estimate-backfill exclusion. tsc/build
+ eyes-on via `tauri build --debug`.
