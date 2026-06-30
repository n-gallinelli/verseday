# Fix: exclude repeated tasks from "Unscheduled & overdue"

**Branch:** `fix/no-recurring-in-overdue` @ `09c140d` (cut off `origin/main`)
**Status:** Verse APPROVED 2026-06-30 — cleared to merge. Not yet merged/installed.

## Problem

The Daily Plan "Unscheduled & overdue" sidebar was flooded with repeated
recurring tasks — the same titles ("Catch up…", "Check all outstanding…",
"Review North St…") appearing ~11×. Daily recurring tasks were the worst
offenders. Nick's requirement: **no repeated task should ever show there.**

## Cause

`selectOrphanAndOverdueTasks` (`src/stores/appStore.ts`) bucketed every
non-done, non-dismissed task into either:

- **orphans** — `date_scheduled === null && project_id === null`
- **overdue** — `date_scheduled` between 3 and 14 days back

There was **no recurrence guard**. Recurrence *templates* have their
`date_scheduled` nulled in the DB, so they landed in the orphans bucket;
stale uncompleted *instances* landed in the overdue bucket. Result: every
uncompleted daily recurring task piled up as fake overdue/orphan rows.

## Fix

A single `continue` guard at the top of the loop, before either bucket:

```js
if (t.recurrence !== null || t.recurrence_source_id !== null) continue;
```

- `recurrence !== null` → recurrence TEMPLATE
- `recurrence_source_id !== null` → generated INSTANCE

Both are excluded unconditionally. Repeated tasks regenerate on their own
cadence and never belong in this list.

Pure read-side filter. No DDL, no schema, no API change. `tsc --noEmit` clean.
It is the sole selector feeding that sidebar list (Verse confirmed).

## Decision notes

- **"Never" is correct** for the unconditional exclusion (Verse + Nick).
- **Non-blocking follow-up (do NOT fold in now):** if Nick ever wants
  genuinely-missed *weekly/monthly* instances to surface as overdue, that is
  a **separate frequency-gated ticket** — daily must still never appear.
