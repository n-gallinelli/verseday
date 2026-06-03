# Recurring tasks must never carry over (rollover fix)

**Date:** 2026-06-03
**Branch:** `fix/rollover-skip-recurring-templates`
**Author:** Terse · **Reviewer:** Verse (plan APPROVED with required 4th-statement addition)

## Problem

A weekday-repeating task ("Check all outstanding 🎫 and notifications") was being
carried over from one day to the next. The user's intent: a recurring weekday
task either gets done that day or it doesn't — it must never roll forward.

## Root cause

Daily rollover (`src/db/rolloverSql.ts` + `rolloverUnfinishedTasks` in
`queries.ts`) excluded recurring **instances** via `recurrence_source_id IS NULL`,
but did **not** exclude recurring **templates** (rows where `recurrence` is set
and `recurrence_source_id` is NULL).

A template normally has `date_scheduled = NULL` (set by `setTaskRecurrence`). But
a template can re-acquire a stale `date_scheduled` (e.g. made recurring, then
re-dated). The day-list and project queries already defend against this exact
"template leak" with `AND recurrence IS NULL` (`queries.ts:380`, `:397`) —
rollover was the one path missing that guard, so a dated template slipped the
filter and rolled forward daily.

## The contract (now enforced on all FOUR statements)

A row is eligible for rollover only if it is **neither a template nor an
instance** of recurrence, and not a calendar import:

```
recurrence_source_id IS NULL   -- not a generated instance
AND recurrence IS NULL         -- not a template (NEW)
AND external_source IS NULL    -- not a calendar import
```

## Changes

1. **`src/db/rolloverSql.ts`** — added `AND recurrence IS NULL` to
   `SQL_ROLLOVER_CAPTURE`, `SQL_ROLLOVER_MOVE`, `SQL_ROLLOVER_EXPIRE`.

2. **4th statement (Verse-required).** `rolloverUnfinishedTasks` had an *inlined*
   copy of the EXPIRE predicate to capture expiring rows for the `RolloverMove`
   reconciliation return value. Guarding only the three constants would leave
   this copy unguarded: a count≥4 template would stop being expired (good) yet
   still be **reported** as `RolloverMove{toDate:null}` → store marks it expired
   while the DB row is unchanged → canonical store/DB drift (the class of bug the
   2026-06-02 remediation closed). Fix: lifted it into `rolloverSql.ts` as a
   pinned `SQL_ROLLOVER_EXPIRE_CAPTURE` (predicate-identical to
   `SQL_ROLLOVER_EXPIRE`, both guards) so it can never drift again. `queries.ts`
   now imports and uses it instead of an inline string.

3. **`src/db/shutdownRollover.integrity.test.ts`** — added a `recurrence` column
   to the fixture and two template rows: H (count0 stale-dated template → not
   moved) and I (count4 stale-dated template → not expired **and** absent from
   the expire-capture, asserting no phantom `RolloverMove`).

## One-time data cleanup (DML — Verse APPROVED, applied 2026-06-03)

```sql
UPDATE tasks SET date_scheduled = NULL
WHERE recurrence IS NOT NULL AND recurrence_source_id IS NULL AND date_scheduled IS NOT NULL;
```

Normalized 3 malformed templates that carried stale dates (ids 694, 698, 756) —
including id 698, a `todo` weekdays template dated today that was actively
leaking. No DDL; query text + DML only.

- **761** (done historical copy): left untouched — legitimate completed history.
- **760** (active plain non-recurring duplicate): not a recurrence row; deleted
  in-app via the normal store-reconciling delete path, not via DML.

## Validation

- `npx vitest run src/db/shutdownRollover.integrity.test.ts` — 7 passed.
- `tsc --noEmit` (main + test projects) — clean.
- grep: no rollover predicate exists outside `rolloverSql.ts`.
