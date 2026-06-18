# Plan — Multi-day tasks span their date range in the daily view

**Author:** Terse
**Date:** 2026-06-17
**Status:** PENDING Verse review (architectural — review BEFORE code)
**Branch (proposed):** `feat/multi-day-daily-view` (off `build/combined-install`)
**Scope:** Daily view only. No DDL (uses existing `due_date`; rollover SQL is runtime, not a
frozen migration). Changes core daily query + rollover predicate + completion refetch.

## Goal (Nick's spec)

A task with a date RANGE — start `date_scheduled`, end `due_date` (set via "Add end date")
— should appear in the daily view on EVERY day in `[start, end]` while incomplete. Once
completed, it must NOT appear on days after completion. Example: task 17→18 shows on the
17th and 18th; complete it on the 17th → it no longer shows on the 18th.

## Confirmed current state (from investigation)

- Range IS `(date_scheduled = start, due_date = end)` — `DateRangeField` "Add end date" writes
  exactly this (`TaskDetailOverlay.tsx:928`).
- Daily query is single-day only: `getTasksForDate` (`db/queries.ts:391`) =
  `WHERE date_scheduled = $1 AND recurrence IS NULL AND external_dismissal_reason IS NULL`.
- **Rollover MUTATES `date_scheduled`** to today for incomplete past tasks
  (`rolloverSql.ts:30` `SQL_ROLLOVER_MOVE`) — would destroy a live range's start.
- Completion stamps `completed_at`; weekly views already group done tasks by `completed_at`.

## Change

### 1. Range-aware daily query (`getTasksForDate`)
```sql
SELECT * FROM tasks
WHERE recurrence IS NULL AND external_dismissal_reason IS NULL
  AND (
    date_scheduled = $1
    OR (due_date IS NOT NULL AND date_scheduled < $1 AND due_date >= $1 AND status != 'done')
  )
ORDER BY sort_order LIMIT 500
```
Semantics:
- Single-day tasks (`due_date` null): unchanged — show on `date_scheduled`, any status.
- Range task on its START day (`date_scheduled = $1`): shown any status (a done one still
  shows on its start day, exactly like single-day done tasks today).
- Range task on CONTINUATION days (`start < $1 <= due_date`): shown only if `status != 'done'`.
- ⇒ Complete on the start day → continuation days drop it. Matches the 17→18 example.

### 2. Don't let rollover eat a live range (`rolloverSql.ts`)
Add to BOTH `SQL_ROLLOVER_CAPTURE` and `SQL_ROLLOVER_MOVE` WHERE:
`AND (due_date IS NULL OR due_date < $1)` — so a task still inside its range (due_date ≥ today)
never rolls. Only single-day or FULLY-past ranges roll. On the MOVE, also `due_date = NULL`
for rolled rows (a fully-past range rolled to today would otherwise have end < start — clear
it so it becomes a normal single-day task for today). [Verse: confirm this nulling is wanted.]

### 3. Completion must drop the task from the day you're viewing
The store indexes by date (`taskIdsByDate`); a range task lands in multiple date buckets.
When a range task is completed FROM a continuation day, that day must re-derive visibility.
Plan: on completion of a task that has a `due_date`, refetch the currently-viewed day
(`loadTasksForDate(currentDay)`) so the done task leaves continuation days — this is the
standing reconcile-on-success / refetch discipline, just extended to the viewed day. [Verse:
is per-day refetch enough, or must we also evict the id from other in-memory continuation
buckets? Single-day tasks are unaffected.]

## Out of scope (explicit — daily view only, per Nick)
- Weekly Plan grid, Plan tab, Dashboard still show a range task on its `date_scheduled`/start
  day only (not across columns). Listed as follow-ups, NOT changed here, to bound blast radius.
- No visual range indicator on the day cell (could be a follow-up).

## Edge cases (defaults — flag for Verse/Nick)
- 3-day task done on day 2: shows on start day (done), hidden on days 2 & 3. (Done anchors to
  the start day, not the completion day. Alternative: also show on `completed_at` day — more
  query complexity + tz care. Default = anchor to start.)
- Fully-past incomplete range: rolls to today, `due_date` cleared (becomes single-day).
- `due_date < date_scheduled` (invalid): the continuation predicate can't match (start < D and
  due_date >= D impossible), so it just behaves single-day. Benign.

## Risk / blast radius
- Core daily query change — every daily-view load. Single-day behavior is preserved verbatim
  (first OR-arm identical to today). The new arm only ADDS range continuation rows.
- Store index: a task now legitimately appears under multiple dates; the reconcile/refetch
  discipline must keep completion consistent across them (item 3 — the key review point).
- Rollover predicate change — verify the fully-past-range path and that single-day rollover
  is byte-identical otherwise.

## Self-validation
- `tsc --noEmit` → `tauri build --debug`.
- Unit-level: query returns the start day for a done range task and hides continuation days;
  returns all days for an incomplete range; single-day tasks unchanged.
- **Eyes-on:** make a 17→18 task → appears on both days → complete on 17 → gone from 18,
  still on 17. Confirm an incomplete past range that still covers today shows today and did
  NOT get rolled/moved.

## No DDL confirmation
`due_date` already exists (migration v-old). `rolloverSql.ts` strings are executed at runtime
(rollover time), not a numbered/applied migration file — so editing them is NOT a
byte-frozen-migration violation. No `ALTER`/new column. (Verse to confirm before code.)
