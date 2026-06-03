# New tasks land at the top (store/DB ordering parity)

**Date:** 2026-06-03
**Branch:** `fix/new-task-to-top`
**Author:** Terse · **Reviewer:** Verse (plan APPROVED after 4 required changes)

## Problem

Adding a task in the daily view didn't put it at the top. The DB was correct
(`createTask` sets `sort_order = MIN(existing) - 1`), but the in-memory store
disagreed: the daily list renders raw `taskIdsByDate` array order
(`selectTaskIdsByDate`, no re-sort), and the optimistic insert
`withTaskInserted` **appended** to that array. So a new task showed at the
bottom until a `loadTasksForDate` re-sorted it by `sort_order`.

## Fix

Index arrays are supposed to mirror `loadTasksFor*`'s `ORDER BY ... sort_order`.
Replaced the blind `indexAppend` in the insert/move reducers with an ordered
splice that places an id by its key:

- `indexInsertOrdered(idx, key, id, keyOf)` — stable splice keeping the bucket
  ascending by `keyOf`; ties land after existing members; mirrors
  `indexAppend`'s dedup + new-Map-only-on-change identity behavior.
- `sortKeyOf` — `[sort_order]` for single-date / single-project buckets.
- `weekKeyOf` — `[date_scheduled, sort_order]` for the week bucket.

This places new rows (MIN−1) at the front, recurring instances (999) at the
back, and calendar imports (0) among the zeros — all without special-casing,
because each just follows its `sort_order`.

## Verse's four required changes (all landed)

1. **Week index must order by `(date_scheduled, sort_order)`, not `sort_order`
   alone.** The week bucket spans Mon–Sun; `Dashboard.tsx:186` and
   `SummaryOverlay.tsx:326` read it as a flat array and depend on date-then-sort
   order. A sort_order-only splice would put a Wednesday task at −1 ahead of
   Monday's 0s. `weekKeyOf` carries the date term. (ScheduleTab re-groups by
   date itself, so it's order-agnostic — eyeballed, fine.)
2. **`withTaskMutated` moves must also splice, not append.**
   `updateTaskDateScheduled` keeps the moved task's `sort_order`, so a
   reschedule has to land in `sort_order` position in the new bucket or the
   store drifts from `loadTasksForDate` until reload — the June canonical-drift
   class. Same helper; week branch uses the compound key.
3. **Calendar imports are `sort_order = 0`, not "the bottom"**
   (`queries.ts:1913`). Rationale + test corrected to assert calendar(0) lands
   among/above `sort_order ≥ 0` tasks; the 999-recurring-instance-lands-last
   assertion is kept.
4. **Missing-id guard.** An index id absent from `tasksById` (transient gap)
   yields a `+∞` key so it sorts to the end instead of producing a NaN compare.

Out of scope per Verse: the b.2 loader appends (`appStore.ts` load reducers) —
secondary indices replaced on their own load, already tracked as debt.

## Validation

- `src/stores/calendarRollover.test.ts` — 6 new ordering cases (front / last /
  calendar-among-zeros / mid / week date-then-sort / missing-id) + the move
  case; 10 pass.
- Full suite: 63/63. `tsc --noEmit` (main + test) clean. `vite build` clean.

No DB / DDL / schema change.
