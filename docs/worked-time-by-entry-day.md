# Plan — Attribute worked time to the day it was actually worked

**Author:** Terse
**Date:** 2026-06-17
**Status:** PENDING Verse review (canonical worked-time model — review BEFORE code)
**Branch (proposed):** `fix/worked-time-by-entry-day` (off `build/combined-install`)
**Scope:** Three reporting queries + a pinned-SQL test update. No DDL. No schema change.

## Problem (Nick)
A task worked 40m on Jun16, 50m on Jun17, 3h on Jun18 should show those amounts on those
days in the weekly review / dashboard / daily total — not the whole sum dumped on the task's
scheduled date. (Companion to the multi-day-task feature.)

## Confirmed
- `time_entries` rows each carry their OWN `start_time` + `worked_seconds` (lib.rs; v22), so
  per-day attribution is fully reconstructible from entries.
- The correct primitive already exists: `bucketWorkedByLocalDay(rows)` (queries.ts:1447) buckets
  worked_seconds by `localDateIso(start_time)` — local-day, dodging the UTC off-by-one the
  codebase is careful about. `getWorkedMinutesByDate` (task-detail overlay) already uses it. ✅
- Three aggregate surfaces are WRONG — they `GROUP BY t.date_scheduled`:
  - `getWorkedMinutesForWeek` (queries.ts:1003) — Dashboard worked-per-day bars.
  - `getWorkedMinutesPerProjectPerDay` (queries.ts:1028) — Weekly review per-day/per-project.
  - `getTotalWorkedMinutes` via `SQL_TOTAL_WORKED_MINUTES_FOR_DATE` (workedSecondsSql.ts:15) —
    Daily-view day-total header. This SQL is PINNED by workedSeconds.integrity.test.ts:98.

## Fix — bucket by entry `start_time` local day (mirror getWorkedMinutesByDate)
Replace the `GROUP BY t.date_scheduled` SQL with: fetch raw `(te.start_time, te.worked_seconds
[, t.project_id])` for the relevant entries, then bucket in JS by `localDateIso(start_time)`.
Keep the existing task filters (`t.recurrence IS NULL`, `t.external_dismissal_reason IS NULL`,
`te.end_time IS NOT NULL`).

Windowing (week/day): `start_time` is an ISO timestamp; to capture a LOCAL [start,end] range,
fetch with `te.start_time >= $pad_start AND te.start_time < $pad_end` where the window is padded
±1 day (`start − 1d` … `end + 2d`) so no local-day entry is missed across timezone offset, then
JS-bucket and keep only days within [start, end] (ISO string compare).

1. **getWorkedMinutesForWeek(start,end) → Map<day,minutes>**: padded-window fetch of
   `(start_time, worked_seconds)` → `bucketWorkedByLocalDay` → filter to [start,end] → Map.
2. **getWorkedMinutesPerProjectPerDay(start,end) → Map<day,Map<projId,minutes>>**: padded-window
   fetch of `(start_time, worked_seconds, project_id)` → group by (localDay, project_id),
   `NULL` project bucketed under a sentinel exactly as today → filter to [start,end].
3. **getTotalWorkedMinutes(date) → number**: replace the `date_scheduled = $1` SQL with a
   padded-window fetch of `(start_time, worked_seconds)` (end_time IS NOT NULL already excludes
   the live session — the property the current comment relies on, preserved), JS-bucket, return
   `date`'s minutes. Introduce `SQL_WORKED_ENTRIES_IN_WINDOW` in workedSecondsSql.ts and retire
   `SQL_TOTAL_WORKED_MINUTES_FOR_DATE`; **update workedSeconds.integrity.test.ts in lockstep**
   (it pins the old text — same freeze discipline as the rollover test).

## Behavior change to call out (Verse)
- Attribution key flips from `date_scheduled` → the day each SESSION STARTED. This also corrects
  SINGLE-day tasks: time logged on a day other than the task's scheduled date now lands on the
  work day (e.g. a task scheduled Mon but worked Tue shows under Tue). More correct, but a
  reporting-behavior change for everyone, not just multi-day.
- A session spanning local midnight counts entirely to its START day (matches the existing
  `getWorkedMinutesByDate` semantics — consistent, no new convention).

## Open question for Nick (NOT in this plan's default)
The DAILY-view per-task "worked" pill (`workedByTaskId`, queries.ts:1410) shows a task's
ALL-TIME total, not that day's slice. For a multi-day task on Jun17 it would show cumulative,
not 50m. Changing it to per-day alters the pill's meaning for every surface that renders a task
card (focus screen, overlay), so it's deliberately OUT of this plan pending Nick's call.

## Risk / blast radius
- Three reporting reads; the canonical worked-seconds store/data is untouched (read-only change).
- Pinned-SQL test must move in lockstep (mandatory).
- Padded window + JS local-day bucketing must match `bucketWorkedByLocalDay` exactly (reuse it,
  don't reimplement) so all surfaces agree.

## Self-validation
- `tsc --noEmit` → relevant vitest (workedByLocalDay + the updated integrity test) → `tauri build --debug`.
- New test: a task with 3 entries on 3 different local days, scheduled on day 1 → week/day
  aggregates report 40/50/180 on the right days, not 270 on day 1.
- Eyes-on: the Jun16–18 scenario in weekly review + dashboard + each daily header.

## Out of scope
- Daily per-task pill cumulative-vs-per-day (pending Nick).
- Any change to how worked time is RECORDED (entries already carry start_time + worked_seconds).
