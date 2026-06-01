# Changelog — Branch B (#2 + #15): worked-seconds crash integrity

**Branch:** `fix/worked-seconds-crash-integrity` (off `main`)
**Items:** #2 + #15 from `docs/2026-06-01-stability-hardening-brief.md` (⚠️ time-write path).
**Coupling:** shipped together — see "Why atomic" below.

## Problem
- **#2:** a force-quit/crash left an open `time_entries` row with
  `worked_seconds = 0`, so the session contributed **0** to every total despite
  real work. Compounded by a latent bug: the periodic checkpoint effect depended
  on the whole `focus` object, which `tickFocus` replaces every second, so the
  30s interval was torn down every tick and **never fired** — and even when it
  did, it wrote only `end_time`, never `worked_seconds`.
- **#15:** the read aggregates summed `worked_seconds` without enforcing
  `end_time IS NOT NULL`, relying on open rows being 0 rather than guaranteeing
  it.

## Fix
- **#2 — revive + repurpose the checkpoint.** `FocusMode` checkpoint effect now
  depends on stable primitives (`focusTaskId`, `focusMode`) and reads live state
  via `getState()`, so it survives to fire every 30s. It writes **only**
  `worked_seconds` (`updateTimeEntryWorkedSeconds`) — never `end_time`, so the
  row stays open and the #15 guard still excludes it. On force-quit the row
  keeps this checkpointed value; the next boot's `closeOrphanedTimeEntries` sets
  `end_time` (preserving `worked_seconds`) and the session re-enters the totals.
  Worst case lost = seconds since the last 30s checkpoint.
- **#15 — guarantee single-count.** Added `end_time IS NOT NULL` to all six
  unguarded aggregates (`getTotalWorkedMinutes`, `getWorkedMinutesForWeek`,
  `getWorkedMinutesPerProjectPerDay`, `getWorkedMinutesForTaskIds`,
  `getWorkedMinutesForTask`, `getWorkedMinutesByDate`). The two already-guarded
  aggregates (`getCompletedShutdowns`, `setManualWorkedMinutes` read) unchanged.
- Removed the now-dead `checkpointTimeEntry` (it set `end_time` on a running row
  — a footgun that would defeat the #15 guard if reused).
- Added an INVARIANT comment on `tickFocus` (per Verse): it adds `deltaMs`
  unguarded; the P0-1 clamp lives at its sole caller (FocusMode tick); no new
  caller may be added.

## Why atomic (#2 and #15 are inseparable)
The moment the checkpoint writes a non-zero `worked_seconds` to a still-open
row, any aggregate lacking `end_time IS NOT NULL` would count it **and** the
live `focus.workedMs` added at the app layer → instant double-count. #15 is the
guard that makes #2 safe. Net effect on live views is behavior-preserving: open
rows were ~0 before and are excluded now, so the day/task totals behave exactly
as before — the change only (a) recovers crashed sessions and (b) prevents the
double-count #2 would otherwise introduce.

## Files
- `src/db/workedSecondsSql.ts` (new) — dependency-free module holding the daily-
  total SELECT + orphan-close UPDATE, so the test imports the identical SQL.
- `src/db/queries.ts` — import those SQLs; add `end_time IS NOT NULL` to the six
  aggregates; remove `checkpointTimeEntry`.
- `src/pages/FocusMode.tsx` — checkpoint effect reworked (stable deps, writes
  worked_seconds); dropped `checkpointTimeEntry` import.
- `src/stores/appStore.ts` — `tickFocus` invariant comment.
- `src/db/workedSeconds.integrity.test.ts` (new) — node:sqlite runtime check.
- `tsconfig.json` — exclude `*.test.ts` from the app build + pin `types: []` so
  the test-only `@types/node` can't leak Node globals into the browser app.
- `tsconfig.test.json` (new) — typechecks the suites with Node types (Verse note
  1: vitest runs but doesn't typecheck; correctness-critical tests stay checked).
- `package.json` — `test` now runs `tsc -p tsconfig.test.json && vitest run`;
  `@types/node` devDep; `engines.node >= 24`.

## Environment requirement (Verse note 2)
`npm test` requires **Node ≥ 24** — the integrity suite uses the built-in
`node:sqlite` (stable in 24; experimental, emits a warning). Recorded via
`engines.node` so the ⚠️ suite can't silently become unrunnable on an older
Node. The app build (vite) has no such floor.

## Validation (⚠️ runtime requirement met)
- `npm test` → **11/11** (6 from Branch A + 5 here). The integrity test runs the
  **identical** prod SQL (imported, params substituted) against in-memory
  `node:sqlite` (Node 24 built-in — no native dep, no install, **no cost**):
  - #15: open row → DB total 0 (counted once via live focus); closed row → once.
  - #2: orphan close preserves `worked_seconds` + sets `end_time` → 40m recovered.
  - never double-counts across the running→stopped lifecycle.
  - orphan close doesn't clobber a backfill or reopen closed rows.
- `npx tsc --noEmit` clean · `npm run build` clean (pre-existing chunk-size warn).
- Grep: all 8 `SUM(worked_seconds)` sites guarded; `tickFocus` single-caller;
  checkpoint writes `worked_seconds`, not `end_time`.
- `eslint` on changed files: 0 new errors (the one flagged — `setPendingDetailTask`
  unused — is pre-existing on `main`).

## Notes
- **No schema / migration touched.** Aligns with the migration-discipline rule:
  this is pure query-text + application-logic change, no DDL.
- Only new tooling is the node:sqlite test (built-in). **No money cost.**
