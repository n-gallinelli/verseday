# Audit Remediation Plan — 2026-06-02

Source: Verse deep audits 1–4. 12 confirmed findings (1 P1, 6 P2, 5 P3).
Status: **PLAN ONLY — awaiting Verse sign-off. No code written.**

## Phase 0 — Pre-flight & decisions (no code)

### Empirical FK verification (settled)
Ran against a throwaway copy of the live `verseday.db`, with
`PRAGMA foreign_keys=ON` (the sqlx/tauri-plugin-sql default — confirmed it is
the runtime state):

- **Project delete →** tasks survive, `project_id` set to `NULL`
  (`ON DELETE SET NULL` enforced).
- **Task delete →** its `time_entries` are **CASCADE-deleted** (0 remain).
  With `foreign_keys=OFF` the same delete orphans them (1 remains) — proving
  the cascade is live, not inert.

**Conclusion:** FK enforcement is ON at runtime. Finding #1's hard-`DELETE` of
the colliding sibling genuinely destroys that sibling's `time_entries` via
cascade. The fix must preserve them. This is real data loss, confirmed.

### Decision 1 (#1) — collision: **MERGE, silently** (LOCKED by Verse)
When moving instance **X** onto a date already holding sibling **Y** (same
`recurrence_source_id`): **X is the keeper.**
1. Reassign Y's `time_entries` to X.
2. Carry over notes (fold Y's into X if non-empty).
3. Carry over done-status: **X becomes done if *either* X or Y was done.**
4. Delete the now-empty shell Y.
Never block, never lose data. **Optional** non-blocking toast when real data
was actually merged (entries/notes/done present on Y) — nice-to-have, not
required. Replaces the current hard-delete in `updateTaskDateScheduled`.

### Decision 2 (#10) — template edit → existing instances (LOCKED by Verse)
**UPDATE existing copies to match**, split by edit type:
- **Title + estimate changes → propagate to ALL existing instances** of that
  template (`UPDATE tasks SET title/estimated_minutes WHERE
  recurrence_source_id = <template id>`), plus the template row itself.
- **Cadence (recurrence rule) changes → future-only by nature** (can't
  un-create past instances): apply the new cadence to future generation, and
  **optionally** drop future, not-yet-started instances (no `time_entries`,
  not done) that no longer fit the new rule.

No per-instance "dirty" flag is introduced, so **no schema change** for #10.

### Schema impact (whole plan)
**Zero DDL required across the entire plan.** Verified the two reused objects
already exist: the partial unique index
`idx_tasks_recurrence_per_date(recurrence_source_id, date_scheduled)` (for #9's
`ON CONFLICT`) and the `recurring_instance_skips` table (for #4). Every fix is
query-text / TS-logic / docs only. If anything forces a DDL during build, I
stop and relay the literal statement before writing it.

---

## Phase 1 — Tier 1: data-loss + core integrity (review gate before merge)

### 1.1 (#1, P1) Collision merge in `updateTaskDateScheduled` (`src/db/queries.ts`)
Replace the hard `DELETE` of colliding sibling(s) with a silent merge, in one
transaction (keeper = X, the moved instance):
1. `UPDATE time_entries SET task_id = X WHERE task_id IN (sibling ids)` —
   reassign worked time to the keeper.
2. Fold each sibling's non-empty `notes` into X's notes.
3. Done-status: set X `done` if X **or** any merged sibling was done.
4. `DELETE` the now-empty sibling rows.
5. `UPDATE tasks SET date_scheduled = … WHERE id = X`.
Return a richer result than today's `deletedSiblingIds` so the store can (a)
drop merged ids from `tasksById` and (b) know whether *real* data was merged
(for the optional toast). Keeper is reconciled from DB truth. Integrity tests:
sibling with a `time_entry` → after move, entry belongs to X and worked-minutes
preserved; sibling `done` → X ends `done`; sibling notes → present on X.

### 1.2 (#2 + #3, P2) Worked-time clamp rework (`src/utils/workedTime.ts`, `src/pages/FocusMode.tsx`)
Today `clampWorkedDelta` only drops deltas > 300s, so a **sub-5-min
sleep/lid-close** (resume event loses the race) and a **forward clock jump**
both get credited. Per Verse: stop relying on the racy `system-resumed` event.
- **Per-tick cap to a few seconds** (cadence is 1 Hz; cap ≈ 3–5 s). Anything
  larger is treated as a gap and not credited.
- **Synchronous cross-check at tick time:** `document.visibilityState` +
  a monotonic wall-clock reference, evaluated in the tick itself (not via the
  async OS event), to distinguish "occluded but working" from "suspended."
- Keep the OS-resume drop as a redundant backstop, not the primary signal.
- Tradeoff to validate: must not discard legitimate App-Nap throttled-but-
  working catch-up while foreground/visible. Unit-test the matrix
  (normal tick / short sleep / long sleep / forward jump / throttled-visible).

---

## Phase 2 — Tier 2: recurrence cluster (one coherent pass)
These interact in `updateTaskDateScheduled` + `generateRecurringInstances`, so
they ship together.

- **#4 record a skip on move** — when an instance moves off its native date,
  `INSERT INTO recurring_instance_skips … ON CONFLICT DO NOTHING` for the
  original date so it doesn't regenerate. (Existing table; no DDL.)
- **#6 template-done halts generation** — `generateRecurringInstances` filters
  templates by `status != 'done'`, so marking a template done silently kills
  all future generation. Fix: a template is a rule, not a completable task —
  generate regardless of the template's own status (and/or prevent a template
  row from being marked done). Final mechanism chosen at build, surfaced in PR.
- **#5 biweekly anchor UTC-shift** — `mondayOf(new Date(tmpl.created_at))`
  parses a UTC timestamp; east of UTC the anchor Monday can shift a day (same
  tz class as the batch we just fixed). Derive the anchor from the local-tz
  date consistently with `targetDate`.
- **#7 TaskDetailOverlay bypasses the store** — it calls `setTaskRecurrence()`
  (raw query) directly. Route through `setTaskRecurrenceAction` so the
  canonical store reconciles. (`src/components/TaskDetailOverlay.tsx`.)
- **#9 idempotent generation** — replace the racy SELECT-then-INSERT existence
  check with `INSERT … ON CONFLICT(recurrence_source_id, date_scheduled)
  WHERE recurrence_source_id IS NOT NULL DO NOTHING`, so concurrent generates
  (main + QuickAdd webviews) can't throw on the unique index.
- **#10 template-edit propagation** — implement per Decision 2 (LOCKED):
  - *Title/estimate edit* (in the task-update path, when the edited row is a
    template — `recurrence != null && recurrence_source_id == null`): after
    updating the template, `UPDATE tasks SET title=?, estimated_minutes=?
    WHERE recurrence_source_id = <template id>` to propagate to all existing
    instances, routed through the store so `tasksById` reconciles.
  - *Cadence edit* (`setTaskRecurrenceAction`): apply new rule to future
    generation; **optional** cleanup of future, not-yet-started, no-longer-
    fitting instances (no `time_entries`, not done). Cleanup gated behind the
    same action so the store stays canonical.

---

## Phase 3 — Tier 3: correctness

- **#8 (`src/pages/FocusMode.tsx`)** — starting focus on a new task while a
  prior session holds uncommitted `workedMs` leaves it stale. Route the
  outgoing task through `stopFocusedSessionForTask` (commit worked seconds)
  before starting the new session. Exact call site pinned at build.
- **#11 `createTask` sort_order atomicity (`src/db/queries.ts`)** — the
  `SELECT MIN(sort_order)` then `INSERT` is two statements; collapse into a
  single `INSERT … VALUES (…, (SELECT COALESCE(MIN(sort_order),1)-1 FROM …))`
  so concurrent creates can't read the same MIN.
- **#12 migration-discipline doc (`docs/migration-discipline.md`)** — the doc
  tells authors to prepend `PRAGMA foreign_keys = OFF;` inside a migration
  body, but that PRAGMA is a **no-op inside a transaction** (sqlx wraps each
  migration), so it silently does nothing. Correct the guidance (the
  enforcement state can't be toggled mid-transaction; document the real
  inbound-FK rebuild procedure). Docs-only.

---

## Phase 4 — Operational: backup + export
No DB backup/export exists today.
- **Copy-on-launch backup** — in Rust app setup (`src-tauri/src/lib.rs`), copy
  `verseday.db` to a rotating `backups/` (keep last N) before migrations run.
- **Manual export** — a tauri command + UI affordance to copy the DB to a
  user-chosen location. No schema change.

---

## Proposed review cadence
Tier 1 is data-loss; recommend a **Verse review gate after Phase 1** before it
merges, then Phases 2–4 batched with a **final review**. Open to Verse
preferring a gate per tier.

## Validation per phase
`tsc` clean, `npm run build` clean, lint held at baseline (0 new), `cargo
check` clean for any Rust, plus the new unit/integrity tests noted above. No
push / no reinstall without separate explicit authorization.
