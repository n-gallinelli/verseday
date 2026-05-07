# Worked-Seconds Simplification

**Status:** Rev 3 — S.4/S.5 dual-write seam to avoid transitional-window `break_seconds` inconsistency
(Rev 2 incorporated Verse review R1: orphan interaction, R2: minute-rounding preservation, R3: shim persistence explicitness)
**Date:** 2026-05-07
**Author:** Terse
**Branch:** `refactor/task-as-entity` (lands after the M2.5.1 → revert baseline)
**Type:** Replacement of wall-clock-derived elapsed math with a directly-incremented worked-seconds counter.

---

## Motivation

The current focus-time architecture (post-M2) derives worked time from wall-clock timestamps via `computeFocusElapsedMs(focus, now)` using `startedAt`, `pausedAtMs`, `pausedAccumMs`. M2.4 reconciles to the DB by feeding paused time into the existing `break_seconds` column. It works, but it inherits the wall-clock model's complexity:

- **Pause-on-relaunch heuristics** — needed because quit-to-relaunch wall-clock leaks into elapsed; we read `time_entries.end_time` to approximate "last alive" and freeze the math
- **Iterated-quit clamp** — needed because stale `end_time` between cycles drives compute negative
- **Case A/B/C trichotomy** — checkpoint exists / no checkpoint / DB read failed
- **30s checkpoint cadence** — needed to keep `end_time` recent enough for the auto-pause math
- **`pausedAccumMs` + `pausedAtMs` invariants** — internal bookkeeping every action has to maintain
- **`computeFocusElapsedMs` helper + the `useFocusTick` derivation chain** — every consumer goes through the same wall-clock arithmetic

A simpler model: **count worked seconds directly**. Increment a counter while running. Don't increment while paused. Quit doesn't get counted because the counter wasn't running. The persisted value IS the answer — no derivation, no wall-clock cancellation math, no clamp.

Under this model, **the entire pause-on-relaunch milestone dissolves** — the bug it fixes can't exist when quit time is never counted as worked time in the first place. Roughly half of M2's complexity is wall-clock-derivation overhead that this model removes.

Reference: `~/.claude/projects/-Users-nickgallinelli-projects-my-app/memory/project_worked_seconds_simplification.md` — Verse-recommended deferral until appetite arose. Pivot directive 2026-05-07: that appetite has arrived.

---

## New `FocusState` shape

```ts
export type FocusState =
  | {
      mode: "preview";
      taskId: number;
      previousPage: Page;
      priorElapsedMs: number;
    }
  | {
      mode: "active";
      taskId: number;
      timeEntryId: number;
      previousPage: Page;
      priorElapsedMs: number;
      // Increments while !paused. Tick effect adds Date.now() deltas
      // since the last tick, so JS event-loop stalls don't drift the
      // counter. Persisted on every tick — localStorage write-per-second
      // is cheap.
      workedMs: number;
      paused: boolean;
    };
```

**Removed:** `startedAt`, `pausedAtMs`, `pausedAccumMs`. These were only meaningful under the wall-clock derivation; with a counter, none are needed.

**Kept:** `priorElapsedMs` — still represents prior-session worked time for this task (sum of `worked_seconds` across earlier closed `time_entries` rows). The displayed counter at any moment is `focus.workedMs + focus.priorElapsedMs`.

`previewFocus` and `activateFocus` keep their roles. The active branch's lack of `startedAt` is intentional — there's no start-anchor needed when the counter is its own source of truth.

---

## Schema migration

New migration at `src-tauri/src/lib.rs` as v22 (latest is v21).

```sql
ALTER TABLE time_entries ADD COLUMN worked_seconds INTEGER NOT NULL DEFAULT 0;

UPDATE time_entries
SET worked_seconds = MAX(
  0,
  CAST(ROUND((julianday(end_time) - julianday(start_time)) * 86400) AS INTEGER)
    - COALESCE(break_seconds, 0)
)
WHERE end_time IS NOT NULL;
-- Open rows (end_time IS NULL) keep worked_seconds = 0; the running
-- session writes its workedMs / 1000 on stop.
```

Backfill semantics:
- For closed rows with `end_time` set, derive worked seconds from the wall-clock formula one last time.
- `MAX(0, ...)` guards against any pre-existing rows where `break_seconds` exceeded the wall-clock duration (corrupt / edge data — shouldn't exist in practice).
- Open rows aren't backfilled. The S.5 stop-side write (`stopTimeEntry` callers) writes `workedMs / 1000` to `worked_seconds` going forward.

**`start_time` / `end_time` / `break_seconds` columns stay.** They're useful for audit, reports, and debugging. Reads switch to `worked_seconds`; writes still set `end_time` on stop for the audit trail. Old derivation queries die in S.5.

**Migration discipline:** new file, never edit existing migrations. Compliant with `/docs/migration-discipline.md`. Frozen-bytes rule respected — v22 is additive.

---

## Action rewrites

| Action | Before (wall-clock) | After (worked-seconds) |
|---|---|---|
| `startFocus(taskId, timeEntryId, previousPage, priorElapsedMs)` | sets `startedAt: Date.now()`, pause fields to false/null/0 | sets `workedMs: 0`, `paused: false` |
| `previewFocus(task, previousPage, priorElapsedMs)` | unchanged | unchanged |
| `activateFocus(timeEntryId)` | promotes preview → active with pause-field init | promotes preview → active with `workedMs: 0`, `paused: false` |
| `togglePauseFocus()` | atomic read-modify-write on pausedAtMs/pausedAccumMs | `set({ focus: { ...f, paused: !f.paused } })` + persist. **No math.** |
| `adjustFocusElapsed(desiredMs)` | back-solves pausedAccumMs against pausedAtMs | `set({ focus: { ...f, workedMs: desiredMs - priorElapsedMs } })` + persist |
| `updateFocusTask(patch)` | unchanged (cache wrapper) | unchanged |
| `stopFocus()` | unchanged signature | unchanged signature; the caller writes `workedMs / 1000` to DB before clearing focus (see S.5) |
| **NEW** `tickFocus(deltaMs)` | — | increments `workedMs` by `deltaMs` if active and `!paused`. Persists. No-op otherwise. Caller passes `Date.now() - lastTickAt` so JS event-loop stalls don't drift the counter. |

The asymmetry of the rewrite favors the new model: most actions get simpler, `togglePauseFocus` becomes trivial, the only addition is `tickFocus` which is a single line of arithmetic.

---

## Tick effect rewrite

At `src/pages/FocusMode.tsx`:

- 1 Hz interval (1000 ms). One tick per displayed second is the natural granularity for a counter; no point ticking faster.
- Each tick computes `delta = Date.now() - lastTickAt` and calls `tickFocus(delta)` if active and `!paused`. `lastTickAt` is a ref, updated each tick.
- The displayed counter reads `focus.workedMs + focus.priorElapsedMs` directly.

**What goes away:**
- `computeFocusElapsedMs` (utility deleted)
- The seed `useEffect` at `FocusMode.tsx:372-394` (M2.5.1) — no longer needed; `workedMs` is its own truth
- `useFocusTick` derivation logic — becomes a one-liner subscription to `focus.workedMs`
- Local `elapsed` `useState` — derived from `focus.workedMs`, no longer state

**What stays:**
- The 1Hz interval pattern and its dep gating on `focus`
- M2.5.1's separation discipline — even though the M2.5.1 seed effect itself dies, the dep-loop discipline applies to whatever new effects we add (the new tick effect uses minimal deps)

---

## Persistence cadence

`tickFocus` persists `focus` to `localStorage` on every call. localStorage writes are synchronous to the JS thread but cheap (~microseconds for the small JSON we write). One write per second is fine.

**Assumption:** if persistence cost shows up as a perf concern, batch to every 5 seconds with `flushOnPause` + `flushOnUnload`. Don't over-engineer this until measured. The current 30s checkpoint already does a SQLite write per cadence; localStorage is faster.

The DB `worked_seconds` column only updates on stop. The in-memory + localStorage value is the live truth between start and stop.

---

## Query rewrite

Eight worked-minutes call sites in `src/db/queries.ts` switch from `(julianday(end_time) - julianday(start_time)) * 1440 - COALESCE(break_seconds, 0) / 60.0` to `SUM(worked_seconds) / 60.0`:

| Line | Function / context |
|---|---|
| 613 | (TBD on inspection — verified by grep before S.5) |
| 717 | … |
| 786 | … |
| 815 | … |
| 1097 | `getWorkedMinutesForTaskIds` |
| 1116 | `getWorkedMinutesForTask` |
| 1133 | … |
| 1155 | … |

Exact line list and per-query SQL diff captured during S.5. Each query becomes shorter and faster (no `julianday` arithmetic, no `COALESCE` on `break_seconds`).

`getWorkedMinutesForTask` returns `Math.round(SUM(worked_seconds) / 60)` — same minute-rounding as today.

---

## Migration of in-flight state

At first app boot after upgrade, if persisted focus has wall-clock fields but no `workedMs`:

```ts
if (focus.mode === "active" && (focus as any).workedMs === undefined) {
  // Derive from old math, one time. After this point the wall-clock
  // fields are gone forever from the persisted shape.
  const f = focus as any; // legacy shape
  const now = Date.now();
  const openPause = f.paused && f.pausedAtMs ? now - f.pausedAtMs : 0;
  const derivedMs = Math.max(
    0,
    now - f.startedAt - (f.pausedAccumMs ?? 0) - openPause,
  );
  // If the user had a running session at upgrade time, freeze it so we
  // don't keep accumulating wall-clock during the upgrade window. The
  // user clicks Resume to start the new counter ticking.
  const wasRunning = !f.paused;
  focus = {
    mode: "active",
    taskId: f.taskId,
    timeEntryId: f.timeEntryId,
    previousPage: f.previousPage,
    priorElapsedMs: f.priorElapsedMs,
    workedMs: derivedMs,
    paused: wasRunning ? true : f.paused,
  };
  // delete f.startedAt / f.pausedAtMs / f.pausedAccumMs — handled
  // implicitly by constructing a fresh object that omits them.
}
```

This is the only place the old math survives. One-time conversion at the loader level; subsequent persists use the new shape. The shim removes in S.6 once we're confident no users have pre-S.2 persisted state (or kept for one release cycle as defensive).

### Shim must persist immediately (R3)

After deriving the new shape and before `set({ focus: convertedFocus })`, `restoreFocus` calls `persistFocus(convertedFocus)`. Without this, the next launch reloads the unchanged old-shape JSON from `localStorage` and re-runs the shim — wasted work and a perpetual derivation step on every boot. With the immediate persist, subsequent loads see the new shape; the shim becomes a no-op on every launch after the first post-upgrade boot.

```ts
focus = { /* new shape */ };
persistFocus(focus);   // R3 — flush new shape to localStorage so the shim is one-shot
```

### Orphaned-entry-referenced-by-focus (R1)

If `focus.timeEntryId` points at a `time_entries` row whose `end_time IS NOT NULL` at restore time — possible if `closeOrphanedTimeEntries` (the 4-hour cap path) closed it during a prior run, or if the app exited while focus referenced an already-stopped row — restoring the focus would let the user click Resume and accumulate `workedMs` against a closed DB row. A subsequent Stop would write to a closed row. Undefined behavior.

Resolution at the loader (or top of `restoreFocus`):

```ts
const persistedEntry = await getTimeEntryById(focus.timeEntryId);  // new read-only query
if (persistedEntry?.end_time !== null) {
  // The DB row is closed. Land any locally-tracked work credit on the
  // closed row (only if it currently has 0 worked_seconds — don't
  // clobber a real backfill or a previously-written stop value), then
  // clear focus so we don't dangle a reference.
  if ((persistedEntry.worked_seconds ?? 0) === 0 && focus.workedMs > 0) {
    await updateTimeEntryWorkedSeconds(
      focus.timeEntryId,
      Math.round(focus.workedMs / 1000),
    );
  }
  persistFocus(null);
  return;  // restoreFocus exits without setting focus
}
```

The user keeps their work credit on the historical entry; no dangling focus reference; no write to a closed row from a future Stop. Two new tiny queries (`getTimeEntryById`, `updateTimeEntryWorkedSeconds`) — both read-only-by-id / single-row-update-by-id, parameterized.

### Minute-rounding behavior preservation (R2)

Existing `getWorkedMinutesForTask` (`src/db/queries.ts:1122`) and friends already use `Math.round(...)` on a fractional minutes value (the wall-clock formula produces fractional minutes via `julianday * 1440 - break_seconds / 60.0`). The new query produces a fractional minutes value the same way: `SUM(worked_seconds) / 60.0`. Behavior preserved — same `Math.round` wrapper, same fractional input, same output modulo sub-second precision noise from backfill `ROUND`-to-integer.

The `Math.floor(finalElapsedMs / 60000)` from M2 capstone Test 6's "minute-rounding precision quirk" is a **separate site** — the optimistic UI computation in `DailyPlanner.tsx` (handleStartFocus swap path and dead handleStopFocus). Those sites compute from `focus` directly, not from the DB query. They're untouched by this milestone — they continue to read `Math.floor(displayedMs / 60000)` post-rewrite, just with `displayedMs` sourced from `workedMs + priorElapsedMs` instead of wall-clock math. Same `Math.floor` quirk preserved.

**Don't fix the rounding precision in this milestone.** That's its own UX concern, out of scope.

---

## Test plan

Manual tests in `npm run tauri dev`. Each sub-milestone runs the relevant subset; the capstone runs all of them end-to-end.

1. **Counter increments while running.** Start → counter ticks 0:01, 0:02. Pause → counter freezes. Resume → counter ticks. Stop → DB `worked_seconds` matches displayed value (within 1s of integer rounding).
2. **Quit-while-running** (the bug class pause-on-relaunch was solving). Start, work 10s, Cmd-Q, wait 60s, relaunch. Counter shows ~`0:10`, NOT `1:10`. Gone by construction.
3. **Quit-while-paused** (M2 capstone Test #7 regression). Identical to before: counter shows the same frozen value before and after quit.
4. **Resume across quit.** Quit-while-running scenario above + click Resume. Counter resumes from `0:10` and ticks up. No "stuck at 0" iterated-quit failure.
5. **Pause symmetry regression.** All M2 capstone tests still pass — 1, 2, 3, 4, 5, 7, 9. (Test 6 = paused-time-excluded; passes by construction. Test 8 = actual-time popover; `adjustFocusElapsed` rewrite preserves behavior.)
6. **Migration backfill correctness.** Pick 3 closed `time_entries` rows from before the upgrade. Verify `worked_seconds` matches `(end_time - start_time)*86400 - break_seconds` within 1s of integer rounding.
7. **In-flight state migration.** Simulate by manually injecting old-shape focus JSON into `localStorage` (via dev console), relaunching. Counter shows derived value, paused. Verify `localStorage["verseday_focus"]` after relaunch contains the new shape (R3 — shim persisted immediately).
8. **Orphan interaction (R1).** Simulate via dev console: write a focus JSON with a `timeEntryId` pointing at a closed `time_entries` row (set `end_time` to a real timestamp, `worked_seconds = 0`), include `workedMs > 0` in the focus blob, relaunch. Verify focus clears (no dangling reference); the closed row's `worked_seconds` matches `Math.round(workedMs / 1000)`. Re-run with `worked_seconds > 0` already set — verify the loader doesn't clobber the existing value.

---

## What goes away (vs what stays)

**Goes away:**
- `computeFocusElapsedMs` utility (delete)
- Seed `useEffect` at `FocusMode.tsx:372-394` (M2.5.1 — bug class disappears)
- `pause-on-relaunch.md` design — superseded; mark `OBSOLETE — replaced by worked-seconds simplification` in S.6
- `tick-effect-resilience.md` design — same
- `pause-symmetry.md` rev 3's `pausedAtMs`/`pausedAccumMs`/`computeFocusElapsedMs` sections — mark obsolete in S.6
- The iterated-quit clamp — N/A in the new model
- `getTimeEntryEndTime` query — never written under this model
- The 30s checkpoint cadence + the project_checkpoint_cadence.md memory follow-up — N/A; under the new model end_time is only updated on stop, with `worked_seconds`

**Stays:**
- M1 singleton overlay
- M2 pause symmetry across surfaces (Focus screen, PiP, Daily Plan row pill, top-right pill, in-page button)
- `FocusState.taskId` + `selectFocusedTask` (R2 PiP rename propagation)
- M2.5.1 dep-loop fix (the seed effect itself dies, but the dep-loop discipline applies to the new tick effect)
- M2.4's Pomodoro `break_seconds` tracking via `totalBreakTimeRef` — Pomodoro break time still flows into the existing `break_seconds` column on stop, unchanged

---

## Risks

- **Migration backfill.** One-time correctness exercise. SQL is stated above. Test on a copy of the prod DB before anything ships to user-visible. The `MAX(0, ...)` guard handles edge cases without crashing.
- **Tick reliability.** If the JS event loop stalls (long-running JS, GC, OS suspend), ticks can be missed. **Mitigation:** use `Date.now()` deltas inside the tick — `tickFocus(deltaMs)` where the caller passes `now - lastTickAt`, not a fixed 1000ms. A stalled event loop catches up on the next tick.
- **Persistence under crash.** If the app crashes between localStorage writes, lose up to N seconds of work credit (where N is the persist cadence). Acceptable trade-off — same risk as the current 30s checkpoint window, just smaller.
- **Background tab throttling.** If the focus window is backgrounded (Tauri WKWebView under macOS), the tick may slow or pause entirely. **State the trade-off:** under the new model, backgrounded time wouldn't count as worked time. Under the M2.4 wall-clock model, backgrounded time *did* count as worked time (the `now - startedAt` math kept ticking regardless of foreground state). Net wash — the new model arguably more accurate ("I wasn't actually working when the laptop was asleep"). Track if user pushback materializes.
- **No new IPC, no security surface, no budget impact.**
- **Orphan rows now get 0 worked credit** (Verse rev 2 observation). Under the wall-clock model, an orphaned entry (`end_time` NULL → `closeOrphanedTimeEntries` cap of 4 hours) inflated worked totals by up to 4 hours of phantom credit per orphan. Under the new model, an orphan that never had a tick has `worked_seconds = 0` — no phantom credit. More conservative; less likely to inflate totals from forgotten/crashed sessions. Net improvement, not a regression.

---

## Sub-milestones

Each is its own commit on `refactor/task-as-entity`. Stop for Verse review at every boundary.

### S.1 — Schema migration + backfill (DB only)

- New migration v22 in `src-tauri/src/lib.rs`. Adds `worked_seconds INTEGER NOT NULL DEFAULT 0` to `time_entries`. Backfill closed rows from the wall-clock formula above.
- Zero application-code changes. The column exists but nothing reads it yet.
- **Verify:** migration applies cleanly in dev. Pick 3 random closed entries and confirm backfill matches the wall-clock math.
- **Stop. Verse reviews the SQL.**

### S.2 — Store seam (additive)

- Add `workedMs: number` to the active branch of `FocusState` alongside the existing wall-clock fields. Old fields stay populated for now.
- Add `tickFocus(deltaMs)` action.
- Loader migration shim per the §"Migration of in-flight state" section above.
- `selectFocusedTask` and other selectors unchanged.
- Wall-clock fields still authoritative for the live counter. `workedMs` gets written by the new tick path but isn't yet read.
- **Stop. Verse reviews.**

### S.3 — Tick + selector + render wire-up

- FocusMode tick effect calls `tickFocus(deltaMs)` at 1Hz with `Date.now()` deltas.
- Counter render reads `focus.workedMs + focus.priorElapsedMs`.
- `useFocusTick` becomes a `workedMs` subscription.
- PiP broadcast sources elapsed from `workedMs`.
- The seed effect at `FocusMode.tsx:372-394` deletes.
- `computeFocusElapsedMs` deletes (or stays one more milestone — defaulting to delete here for cleaner cuts).
- Wall-clock fields still on `FocusState` but no longer read by the UI.
- **Stop.** Run the test plan items 1–5. M2 pause symmetry tests must still pass. Verse reviews.

### S.4 — Action rewrites (dual-write seam)

**Rev 3 — Verse-required adjustment.** The naive S.4 ("stop writing wall-clock fields") creates a live correctness window: between S.4 and S.5, queries still read wall-clock-derived (`(end - start) - break_seconds`) but `pausedAccumMs` would no longer be feeding `break_seconds`, so any session paused during that window would over-credit worked time on stop. Worse than the dormant row-250 anomaly — a *live* bug.

S.4 keeps the wall-clock fields alive alongside the new `workedMs` writes. Dual-write is the seam:

- `togglePauseFocus` becomes a flag flip on `paused` + persist. **AND** continues to maintain `pausedAtMs` / `pausedAccumMs` exactly as before — the legacy pause accounting stays correct so `getBreakSeconds` (M2.4) still feeds `break_seconds` correctly on stop.
- `adjustFocusElapsed` writes `workedMs` directly **AND** keeps the legacy back-solve against `pausedAccumMs` so wall-clock-derived queries see the correct adjusted elapsed.
- `applyActualMs` adapts.
- `tickFocus` already only writes `workedMs` + `paused` flag; no wall-clock writes needed because `startedAt` was set once at session start and doesn't change.
- **Wall-clock fields stay populated.** Queries are still wall-clock-derived; they keep working.
- **Stop. Verse reviews.**

### S.5 — Atomic cutover (queries + stop-side write + drop wall-clock writes)

One commit. Nothing transitional. Five changes land together:

1. `stopTimeEntry` callers write `workedMs / 1000` to `worked_seconds` before calling `stopTimeEntry`.
2. Drop the paused-time portion of `getBreakSeconds` (Pomodoro break time stays).
3. Flip the eight worked-minutes queries to read `SUM(worked_seconds)`.
4. Stop writing wall-clock fields anywhere (`togglePauseFocus` drops the legacy pause accounting; `adjustFocusElapsed` drops the back-solve; `tickFocus` unchanged).
5. **One-time sweep** to backfill any rows closed via the legacy `stopTimeEntry` path between S.1 and S.5 (e.g., row 250 from the S.1 verification, plus any session the user stopped during S.2/S.3/S.4):
   ```sql
   UPDATE time_entries
   SET worked_seconds = MAX(
     0,
     CAST(ROUND((julianday(end_time) - julianday(start_time)) * 86400) AS INTEGER)
       - COALESCE(break_seconds, 0)
   )
   WHERE end_time IS NOT NULL AND worked_seconds = 0;
   ```
   Safe to run because the dual-write S.4 kept `break_seconds` accurate (it captured pause time as before). Wall − break = correct worked seconds for every row this sweep touches. The `worked_seconds = 0` predicate ensures we only fill rows that haven't been written yet — never clobbering a real backfill or a real stop-time write.
6. **Verify:** pick a few closed-via-this-codepath entries and compare `worked_seconds` to UI-displayed value. Run the sweep, then re-query: every closed row has a non-zero `worked_seconds` (modulo legitimately zero-worked sessions).
- **Stop. Verse reviews.**

### S.6 — Cleanup

- Remove `startedAt`, `pausedAtMs`, `pausedAccumMs` from `FocusState`. The persisted JSON still tolerates them on load (S.2 shim) but new persists omit them.
- Remove the loader migration shim once confident no users have pre-S.2 persisted state. (Or keep for one release cycle as defensive.)
- Mark `pause-on-relaunch.md`, `tick-effect-resilience.md`, and `pause-symmetry.md` rev 3's wall-clock sections with an `OBSOLETE under worked-seconds model` header. Don't delete the docs — historical context.
- Update `MEMORY.md`: mark `project_worked_seconds_simplification.md` as DONE rather than deferred. Mark `project_checkpoint_cadence.md` as N/A under the new model.
- **Stop. Verse reviews.**

### Capstone

Run the full test plan + M2 capstone tests 1–5, 7, 9 end-to-end. Report PASS/FAIL.

---

## Out of scope

- Per-task time-editing UI improvements. (Existing actual-time popover continues to work — `adjustFocusElapsed` adapts.)
- Reporting / billing changes beyond the worked-seconds query rewrites.
- Pomodoro `break_seconds` reform — Pomodoro break time still flows into the existing `break_seconds` column via M2.4's `totalBreakTimeRef`. Untouched.
- Background-throttling work. Tracked as a future concern if it materializes; not blocking this milestone.

---

## Constraints (non-negotiable, carry-forward from CLAUDE.md)

- Branch: `refactor/task-as-entity`. Never main.
- Schema: new migration only, never edit existing. `/docs/migration-discipline.md` compliant.
- Security: no new IPC, no new persisted secrets, no external calls. Local refactor.
- Budget: zero. No paid services touched.
- M1 + M2 entity work preserved. This refactor is strictly about how worked time is computed. The cross-screen single-source-of-truth invariants from M1/M2 stay intact.
