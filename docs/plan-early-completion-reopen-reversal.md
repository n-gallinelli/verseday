# Plan — Reverse early-completion suppression on reopen (no DDL)

Date: 2026-06-18
Author: Terse
Status: AWAITING Verse pre-code review + Nick approval
DDL: **migration v27** — `ALTER TABLE tasks ADD COLUMN suppressed_cycle_date TEXT;`
(Verse ruled against the `original_date` overload — opposite lifecycles
[rollover = COALESCE-sticky-never-cleared; this = set-then-clear] couple two
features on one column via a convention-only invariant. Dedicated nullable
column, DDL gate cleared. The reuse analysis below is kept for the record but
SUPERSEDED.)
Builds on: PR #42 (early-completion suppression)

## The edge being fixed

Completing a weekly instance early does two things: (1) **snaps** `date_scheduled`
to the day you did it (Thu→Wed, so it reads "done Wed"), and (2) inserts a skip
for the original date (Thu) so it doesn't regenerate. On **reopen** (uncheck),
the cycle should come back — but the snap overwrote the original date, so today
the task stays parked on Wednesday and Thursday's slot never returns that week.

## Why no DDL

`original_date` (migration v11) is written by exactly one path — `SQL_ROLLOVER_MOVE`
— which is guarded `recurrence_source_id IS NULL AND recurrence IS NULL` on every
statement, so **recurring instances never get an `original_date`** (always NULL).
Nothing reads it for display/filtering/bucketing (verified repo-wide). So for a
recurring instance it's a free, unused slot. Non-recurring rollover memory and
this new use operate on disjoint row sets (the `recurrence_source_id` divide), so
there's no semantic collision. Same meaning, even: "where this task originally sat
before it was moved."

## Design (FINAL — dedicated column)

New column `suppressed_cycle_date TEXT` (migration v27, NULL on every row except
an early-completed weekly instance). 1:1 with the row, so a column not a side
table; guard is just `suppressed_cycle_date IS NOT NULL` (no recurrence_source_id
disambiguation), and storing the exact date makes the skip-DELETE target
precisely our skip.

**At early-completion suppression** (`updateTaskStatus`, the existing suppression
`if`-block): in addition to inserting the skip, `UPDATE … SET
suppressed_cycle_date = <pre-snap date>`. Only happens when we actually suppress
(weekly + future), so non-recurring/normal completions are untouched.

**At reopen** (`updateTaskStatus` non-done branch): read the row's
`recurrence_source_id` + `suppressed_cycle_date`. If `suppressed_cycle_date` is
set, fully reverse the early completion:
1. one `UPDATE`: `status`, `completed_at = NULL`,
   `date_scheduled = suppressed_cycle_date` (move back to the real due day),
   `suppressed_cycle_date = NULL` (reset),
2. `DELETE FROM recurring_instance_skips WHERE recurrence_source_id = ? AND
   date_scheduled = ?` (un-suppress that cycle) — the **first** skip-delete in the
   codebase; all other paths only INSERT. Cross-reference the insert paths.

Net: reopening returns the task to exactly its pre-early-completion state — the
Thursday instance, todo, cycle no longer suppressed. Exactly one instance, no
double-show (the skip kept Thursday from regenerating while it was done, so the
move-back can't collide on `idx_tasks_recurrence_per_date`).

### Ordering (fail-safe, no txn API — matches the suppression path)

Do the reverse as: SELECT the row → single `UPDATE` (status/completed_at +
date_scheduled + suppressed_cycle_date=NULL) → `DELETE` skip. A mid-failure
(UPDATE ok, DELETE fails) leaves a **restored row plus an inert orphan skip** —
still no double-show (the restored instance now occupies (source, date) and
generation's ON CONFLICT blocks a regen anyway), and the orphan self-heals (a
later delete/move re-INSERTs the same key). NOT "stays suppressed."

### Notes / decisions for Verse

- **`original_date` overload vs a dedicated column.** We can do this with zero DDL
  by reusing `original_date` (verified safe). The alternative — a purpose-named
  column — is cleaner semantically but needs a migration + your DDL gate. Terse
  recommends the no-DDL reuse; flagging the tradeoff for your call.
- **Move-back when the due day is already past.** If the user reopens days later
  (original Thursday now in the past), this restores the task to that past
  Thursday (a normal missed instance — instances don't roll). Simpler and
  predictable; alternative is to only move-back when `original_date >= today`.
  Terse leans uniform always-restore; open to the conditional if you prefer.
- This **changes** the behavior the suppression PR documented as an accepted v1
  limitation — the in-code comment, the `/docs` plan, and the
  `reopen-leaves-cycle-suppressed` test all get updated to assert the reversal.

## Verification

- Replace the `reopen-leaves-cycle-suppressed` test with `reopen-restores-cycle`:
  after early-complete + reopen, assert date_scheduled back to original, skip
  gone, original_date cleared.
- Add: reopening a normal (non-recurring, or non-early) done task does NOT touch
  date_scheduled / skips (original_date null → no-op).
- Add: early-complete sets original_date to the pre-snap date.
- `tsc --noEmit` + full vitest suite + build green.

## Out of scope
- Daily/weekdays (never suppressed in the first place).
- Changing the snap-to-today completion display behavior.
