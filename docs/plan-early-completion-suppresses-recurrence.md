# Plan — Early completion suppresses the upcoming recurrence cycle

Date: 2026-06-18
Author: Terse
Status: AWAITING Verse pre-code review + Nick approval
DDL: **NONE** (reuses the existing `recurring_instance_skips` table)

## The problem (Nick's report)

A weekly task ("every Thursday") was done a day early on Wednesday: Nick
navigated to Thursday, marked the Thursday instance done. Completion correctly
**snapped** the instance back to Wednesday and stamped it done on Wednesday
(desired). But Thursday's instance then **regenerated**, because nothing recorded
that Thursday's cycle had already been satisfied.

## How the system works today (from investigation)

- Recurring instances are **materialized** rows. `generateRecurringInstances(date)`
  runs on every DailyPlanner load and INSERTs a `(template, date)` instance,
  `ON CONFLICT … DO NOTHING` (unique index `idx_tasks_recurrence_per_date`).
- It already honors a skip table: if `recurring_instance_skips` has
  `(recurrence_source_id, date_scheduled)`, generation skips that date. (Built to
  stop deleted instances from regenerating.)
- `updateTaskStatus(id, "done")` stamps `completed_at` and **snaps a
  future-scheduled instance to today** (`date_scheduled = min(date_scheduled, today)`).
  This is the "done on Wednesday" behavior Nick likes — keep it.
- Frequencies supported: `daily`, `weekdays`, `weekly` (+ `interval` for
  every-N-weeks). No monthly yet.

## The fix

Reuse the skip table. When a recurring **instance** is completed *before* its
scheduled day, record a skip for its **original** scheduled date so generation
won't recreate it.

### Condition (all must hold), evaluated inside `updateTaskStatus` when status→done

1. `recurrence_source_id IS NOT NULL` (it's an instance, not a one-off/template).
2. The template's recurrence `freq === "weekly"` — the only non-daily frequency.
   `daily` and `weekdays` are excluded (early-completion suppression is
   meaningless when the next day has its own instance anyway). If monthly is
   added later, it joins this set.
3. The instance's **current** `date_scheduled` (read *before* the snap) is in the
   future: `date_scheduled > today`.
4. ~~Day-count window~~ **DROPPED** (Verse rec, Nick agreed). A weekly task has
   one occurrence per cycle; finishing it 3 days early satisfies the cycle as
   much as 1 day early. A cap just relocates the double-show. Rule is simply
   `freq === "weekly"` + `date_scheduled > today` → suppress, matching the
   unconditional skip-on-move semantics. (This also moots the `daysBetweenIso`
   helper from the original plan.)

Ordering (Verse C1 — no transaction API here, so fail-safe ordering):
1. SELECT the instance's original `date_scheduled` + `recurrence_source_id`.
2. Run the existing snap+complete UPDATE.
3. `INSERT INTO recurring_instance_skips (recurrence_source_id, date_scheduled)
   VALUES (<template id>, <captured original date>) ON CONFLICT DO NOTHING`
   (Verse C3 — matches the DO NOTHING style at queries.ts:764/:1208).

Skip-AFTER-update so a mid-failure degrades to today's behavior (a regenerating
cycle), never a suppressed-but-incomplete task.

### Why this is safe

- Zero DDL — only INSERTs into an existing table generation already respects.
- The snapped, completed instance lands on today (Wednesday); a weekly template
  only generates on its one weekday, so no unique-index collision on the snap day.
- Next week's Thursday is a *different* date → still generates normally. Only the
  one already-satisfied cycle is suppressed.

### Implementation sketch

- `src/db/queries.ts` → `updateTaskStatus`: in the `status === "done"` branch,
  before the UPDATE, `SELECT date_scheduled, recurrence_source_id FROM tasks
  WHERE id`. If it's an instance with a future date, `SELECT recurrence FROM
  tasks WHERE id = <recurrence_source_id>`, `parseRecurrence`, and apply the
  condition; conditionally INSERT the skip.
- `src/utils/dates.ts` → add `daysBetweenIso(fromIso, toIso): number` (local-tz,
  whole days) for the window check.
- Centralizing in `updateTaskStatus` covers every completion path (daily card,
  detail overlay, focus mode) since they all funnel through it.

## Reopen reversal — RESOLVED (was a v1 limitation)

Originally shipped (PR #42) with reopen NOT restoring the suppressed cycle. That
limitation is now removed: a follow-up adds a dedicated `suppressed_cycle_date`
column (migration v27) so reopen restores the due date and deletes the skip. See
`docs/plan-early-completion-reopen-reversal.md`.

## Verification (self-validate)

- Unit/integration: extend recurrence tests — completing a weekly instance 1 and
  2 days early writes a skip for the original date and that date does not
  regenerate; 0 days (on the day) and 3 days early write no skip; daily/weekdays
  write no skip; reopen behavior asserted per the chosen option.
- `tsc --noEmit` + `npm test` (recurrence integrity suites) + build clean.

## Out of scope
- Monthly recurrence (not in the model yet).
- Changing the snap-to-today completion behavior.
