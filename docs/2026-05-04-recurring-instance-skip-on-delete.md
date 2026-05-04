# Recurring instance skip-on-delete + template-leak filter

**Date:** 2026-05-04
**Branch:** `fix/recurring-instance-skip-on-delete`
**Status:** in progress
**Reviewer:** Verse (APPROVED with conditions, all addressed)
**Related:** see [2026-05-04-recurring-task-duplicates.md](./2026-05-04-recurring-task-duplicates.md)
for the dedup work and post-mortem rules this fix carries forward.

## Symptom

User reported "we still have add new events from forrest twice. Even when I
deleted it it stayed." Daily Plan rendered two rows with the same title for
the recurring task; deleting one did not remove it (a row with the same
title reappeared on the next render).

## Two root causes (independent)

**Bug A — template leaking into the daily list.** Live DB inspection:
```
id=13  title="Add new events..."  recurrence='{"freq":"weekly","day":1}'
       recurrence_source_id=NULL  date_scheduled='2026-05-04'        ← TEMPLATE
id=83  title="Add new events..."  recurrence=NULL
       recurrence_source_id=13    date_scheduled='2026-05-04'        ← INSTANCE
```
Templates should have `date_scheduled = NULL` (`setRecurrence` enforces
this). Row id=13 has it set anyway — the most plausible path is rollover:
`rolloverUnfinishedTasks` advances any non-done row whose
`date_scheduled < today` and whose `recurrence_source_id IS NULL`. That
filter excludes recurring *instances* but **not templates**. A regular task
that gets marked recurring later, then carried forward by rollover, ends
up as a template with a leaked `date_scheduled`. The daily list then shows
both the template and the instance.

**Bug B — deleting an instance regenerates it.** When the user deletes
id=83, `loadData()` re-runs, `generateRecurringInstances('2026-05-04')`
finds no instance for template id=13 on today's date, INSERTs a new one.
The "deleted" row reappears under a new id. The dedup branch's `ON CONFLICT
DO NOTHING` doesn't help — there's no conflict if the row was actually
deleted. Confirmed against live DB: id=56 (the original instance the user
saw) had been replaced by id=83 by the time we re-queried.

## Fix design — additive only

Per the post-mortem rule from the dedup work (failure mode 1: destructive
migrations must ride behind an *already-deployed* backup hook), v15 is
designed with **zero destructive operations**: one new table, no UPDATE on
existing rows, no DELETE. The v14 backup hook is one-shot; relying on it
for a fresh snapshot is a non-starter, so we sidestep the dependency
entirely.

### Migration v15

```sql
CREATE TABLE IF NOT EXISTS recurring_instance_skips (
    recurrence_source_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    date_scheduled       TEXT NOT NULL,
    PRIMARY KEY (recurrence_source_id, date_scheduled)
);
```

Single statement, idempotent, additive. `ON DELETE CASCADE` ensures the
skip table stays in sync with the template — deleting a template removes
its skip rows automatically.

### Read-side: filter templates out of every "tasks for date" surface (Bug A)

Eight read paths across `src/db/queries.ts` get an `AND recurrence IS NULL`
predicate so the template can never bleed into a daily/weekly list,
regardless of whether `date_scheduled` is leaked. All instances have
`recurrence IS NULL` (verified pre-coding against the live DB:
0 rows where `recurrence_source_id IS NOT NULL AND recurrence IS NOT NULL`).

| Site                                | Lines (main) | Purpose                          |
|-------------------------------------|--------------|----------------------------------|
| `getTasksForDate`                   | 217          | daily plan list                  |
| `getCompletedTasksForDate`          | 470          | completed-today list             |
| `getTimeEntriesForDate`             | 482          | time entries by date             |
| `getTotalPlannedMinutes`            | 541          | daily planned aggregate          |
| `getTotalWorkedMinutes`             | 556          | daily worked aggregate           |
| `getTasksForWeek`                   | 593          | weekly plan grid (Verse callout) |
| `getWorkedMinutesForWeek`           | 622          | weekly worked aggregate          |
| `getCompletedShutdowns` subqueries  | 446–452      | past-shutdown stats              |

`getStatsForProjects` and `getPreviewTasksForProjects` deliberately stay
unfiltered — those are project-scoped, and templates legitimately belong
to projects.

### Write-side: record skip before delete (Bug B)

`deleteTask` reads the row first and, if it's a recurring instance,
INSERTs into `recurring_instance_skips` *before* the DELETE.

```js
const t = (await db.select(
  "SELECT recurrence_source_id, date_scheduled FROM tasks WHERE id = $1",
  [id]
))[0];
if (t?.recurrence_source_id != null && t?.date_scheduled != null) {
  await db.execute(
    "INSERT INTO recurring_instance_skips (recurrence_source_id, date_scheduled) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [t.recurrence_source_id, t.date_scheduled]
  );
}
await db.execute("DELETE FROM tasks WHERE id = $1", [id]);
```

`generateRecurringInstances` checks the skip table before each per-template
INSERT and `continue`s if a skip exists.

### Race analysis

`deleteTask` and `generateRecurringInstances` running concurrently:

| Interleave | Outcome |
|------------|---------|
| Generation runs *before* skip-insert | Generation sees existing instance; ON CONFLICT swallows. Delete then removes the instance and the skip prevents future regeneration. ✓ |
| Generation runs *between* skip-insert and delete | Generation sees the skip; `continue`s without inserting. Existing instance still gets deleted by user's DELETE. ✓ |
| Generation runs *after* delete | Generation sees the skip; no insert. ✓ |

No transaction is needed because the two statements are commutative w.r.t.
correctness. `INSERT ... ON CONFLICT DO NOTHING` makes the skip-insert
idempotent. The skip-table `PRIMARY KEY` enforces uniqueness.

## Out of scope (tracked, not fixed here)

- **No skip removal UI.** Once you delete a recurring instance, it's gone
  for that date. Restore-from-skip is a follow-up.
- **No cleanup of the existing template id=13's stale `date_scheduled`.**
  The read-time filter is sufficient; cleaning it up requires a destructive
  migration and the backup-hook discipline isn't ready. Tracked for a
  later cycle.
- **Orphan time entries on templates.** If a user logged time on a row
  before it became a template, that time becomes invisible in daily totals
  (because the template is filtered out). Pre-existing artifact, separate
  fix.

## Branch posture

Cut from current `main`, **not stacked on `fix/recurring-task-duplicates`**.
v15 has zero logical dependency on v14's index/cleanup — the skip table
stands alone. At merge time, v14 (if it lands) slots between v13 and v15
in the migrations vec, with a trivial conflict that resolves by keeping
both entries.

If `fix/recurring-task-duplicates` is abandoned: v15 still works on its
own. The user's already-applied v14 row in `_sqlx_migrations` would need
to be reconciled separately (out of scope here).

## Pre-flight verification (Verse condition 1)

Ran before coding:
```sql
SELECT id, recurrence, recurrence_source_id, date_scheduled
FROM tasks WHERE recurrence_source_id IS NOT NULL LIMIT 10;
```
All instance rows have `recurrence = NULL`. Counted: 0 rows where
`recurrence_source_id IS NOT NULL AND recurrence IS NOT NULL`. Filter
assumption is safe.

## Backup posture (Verse condition 5)

`verseday.db.snapshot-pre-v15-2026-05-04` taken before any v15 code
touched disk. v15 is non-destructive; the snapshot is for the rule, not
because it's needed.

## Test harness

`scripts/test-skip-migration.sh` — fresh v15-specific harness, kept
separate from the dedup branch's `test-dedup-migration.sh` so each
migration's coverage stands on its own. Five new fixtures (A–E) plus the
cascade test (F) that Verse called out:

| # | Scenario | Expected |
|---|----------|----------|
| A | Template (`recurrence='daily'`, `date_scheduled` set) excluded from `WHERE date_scheduled = ? AND recurrence IS NULL` | not returned |
| B | `deleteTask`-equivalent flow inserts a skip row when target has both `recurrence_source_id` and `date_scheduled` | skip row exists |
| C | After skip recorded, generation pre-check skips the INSERT | row count unchanged |
| D | Deleting a template (`recurrence_source_id IS NULL`) doesn't insert a skip | skip table empty |
| E | Deleting a regular non-recurring task (both NULL) doesn't insert a skip | skip table empty |
| F | Insert template + instance + skip; delete template; assert skip table empty (FK CASCADE) | skip rows gone |

Wired in as `npm run test:skip-migration`. Must run green before commit
(Verse condition 6 plus the post-mortem rule).

## Verification path post-deploy

1. Quit, relaunch.
2. Daily Plan: one "Add new events from Forrest..." (instance), template
   row hidden.
3. Delete that instance.
4. Daily Plan: zero rows for that title. Stays zero across reload/navigation.
5. `SELECT id, date_scheduled FROM tasks WHERE id = 13;` — confirm the
   stale `date_scheduled` is **still there** (we deliberately don't clean
   it; the read-time filter is doing the work).
6. `SELECT * FROM recurring_instance_skips;` — confirm a row with
   `(13, '2026-05-04')` exists after step 3.
7. Tomorrow (5/5): the recurring task regenerates because no skip exists
   for that date.

If step 4 fails: stop, do not touch DB, escalate.

## Post-mortem — failure mode 4

The fourth durable lesson from this work, on top of the three captured in
[2026-05-04-recurring-task-duplicates.md](./2026-05-04-recurring-task-duplicates.md):

**4. sqlx applied-migration validation breaks "logically independent"
branches at runtime.** The dedup post-mortem established
"destructive migrations must ship behind an already-deployed backup
hook." It didn't capture that *any* migration applied on a user's DB
locks that version into the source list of every future binary,
regardless of whether new work logically depends on it. Cutting v15
from main without v14 was correct from a code-review and
logical-dependency standpoint and exactly what Verse directed; it was
wrong from a deployment standpoint because the user's DB was already
past v14. sqlx-sqlite validates each row in `_sqlx_migrations` against
the source migration list (version + checksum); a missing entry errors
"applied migration not found" and `Database.load()` rejects, surfacing
as the silent "Failed to load data" banner.

*Corrective action — encode as a deployment invariant:* when a
migration version exists in any production user's DB, every subsequent
binary must include that migration entry **verbatim** (byte-identical
SQL body so the sqlx checksum matches), even on branches that are
otherwise independent. This is a deployment invariant, not a branching
one. Branches still get cut from main per Verse — they just carry
forward every applied-in-the-wild migration version as part of the
source list. Generalizes beyond v14 to every future migration.

The fix on this branch (`eb154ad`) cherry-picked v14's body via
`git show fix/recurring-task-duplicates:src-tauri/src/lib.rs`,
md5-verified the SQL body matched (`69243cc58960be7e6826b94a56a9d868`),
and added an explanatory comment block on the migration entry calling
out that this is a checksum/coexistence concern rather than a logical
dependency.

## P0 follow-up: surface SQL errors in `loadData()` ✅ resolved

Resolved on `fix/surface-tauri-string-errors` (merged before #8 of the
daily-plan polish work, per Verse's "slot it in before the focus-flow
work" recommendation).

- Added `src/utils/errors.ts` with a single `errorMessage(e, fallback)`
  utility that prefers `typeof e === "string"` for Tauri-style
  rejections, then `e.message` for `Error` instances, then `String(e)`
  for truthy non-string non-Error throws, falling back to the supplied
  default only for null/undefined/empty cases.
- Swept every `e instanceof Error ? e.message : "..."` site (43 across
  8 files) to call the utility instead. Mechanical substitution; no
  behavior change for cases where the underlying error is already a
  proper `Error`, but Tauri-string rejections now surface their actual
  message instead of being replaced with the generic fallback.
- The catch-block fallback string is preserved in every call site as
  the second argument — still meaningful when the thrown value carries
  no useful message.



Three separate rounds of "Failed to load data" in this session, each
with no JS-visible console signal — one for the partial-index ON
CONFLICT mismatch, one for the missing v14 migration entry. The
catch block in `DailyPlanner.tsx` does:

```js
catch (e) {
  setError(e instanceof Error ? e.message : "Failed to load data");
}
```

Tauri's SQL plugin rejects with strings, not `Error` instances, so the
ternary always lands on the fallback string and the actual SQL error
never reaches the user or the console. Every failure becomes a
guessing exercise.

Fix is small: change the ternary to `typeof e === "string" ? e : (e
instanceof Error ? e.message : String(e))` (or equivalent) so the
underlying error message survives. Verse elevated this to P0 follow-up
explicitly. Next branch off main after this one merges.
