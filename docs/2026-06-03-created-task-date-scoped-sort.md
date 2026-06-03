# New dated tasks land at the top of their date — even with an Objective

**Date:** 2026-06-03
**Branch:** `fix/created-task-date-scoped-sort` (stacked on `fix/new-task-to-top`)
**Author:** Terse · **Reviewer:** Verse (APPROVED with 2 conditions, both met)

## Problem

A task added from QuickAdd (or the daily adder) **with an Objective** didn't go
to the top of the daily list. `createTask` (`queries.ts`) scoped the new
`sort_order` to the **first** matching scope — `project_id` before
`date_scheduled` — so a task with a project got a *project-relative* value
unrelated to the date bucket.

Live-DB evidence (today): task 913 (project 12, created 19:31) got
`sort_order −9` (= project-12 MIN − 1) → mid-list; task 912 (no project, created
19:05) got `−23` → top. QuickAdd always carries today's date + an Objective, so
it's the both-present case and reliably missed the top. This also silently
undercut new-task-to-top for any with-project add.

## Fix

`dateScheduled` now takes precedence over `projectId` when choosing the
`sort_order` subquery, so any task scheduled for a date lands at the top of that
date's list. Extracted the selection into a pure function
`createTaskSortSubquery` (`src/db/createTaskSortSql.ts`, same discipline as
`rolloverSql.ts`) and routed `createTask` through it.

```
dateScheduled != null → MIN(sort_order WHERE date_scheduled = $3) - 1
else projectId != null → MIN(sort_order WHERE project_id = $2) - 1
else → global
```

## Verse's two conditions (met)

1. **Stacked on `new-task-to-top`, not bare main.** The optimistic insert
   (`withTaskInserted`) only splices by `sort_order` on that branch; on bare
   main it appends, so a new dated+project task would flash at the bottom until
   reload. Basing the DB fix here keeps optimistic == reload.
2. **Pin the production selection, not a copied INSERT.** The old test
   hardcoded its own SQL and never ran the `queries.ts` ternary. Extracted the
   pure function and pinned it: precedence (date-wins-when-both), project-only,
   global, plus an end-to-end case running the *selected* subquery to prove a
   dated+Objective task gets the date-top value (−2), not project-top (−6).

## Accepted trade-off (Verse's call)

`sort_order` is one shared column across the date list and the Objective list
with independently drifting counters; only one bucket can be correct-on-create.
Date wins (primary surface). A dated task may also sort to the top of its
Objective list — accepted; the cross-bucket coupling is pre-existing
(`setTaskSortOrders` already rewrites bucket-wide). No second sort column (DDL,
off-budget).

## Validation

`createTaskSort.integrity.test.ts` — 6 pass (2 original + 4 new). Full suite
67/67. `tsc` (main + test) clean, `vite build` clean. No DDL.
