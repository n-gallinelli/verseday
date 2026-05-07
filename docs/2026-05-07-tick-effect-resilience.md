# Tick Effect Resilience — Post-Resume Counter Stalls at 0:00

**Status:** Rev 2 — Verse-approved design. Awaiting M2.5.1 implementation commit.
**Decision:** Split — tick-fix lands first as M2.5.1, then pause-on-relaunch as a separate single-commit milestone. (Verse rationale: every commit green; conceptually distinct concerns; better commit-message provenance.)
**Date:** 2026-05-07
**Author:** Terse
**Branch:** `refactor/task-as-entity`. Pause-on-relaunch implementation stashed during M2.5.1 work.
**Type:** Bug fix uncovered by pause-on-relaunch test plan. Architecturally a follow-up to M2.5; functionally a blocker for pause-on-relaunch closeout.

---

## Failure observed

User ran the rev 2 pause-on-relaunch test plan (a–e). Results:

| Test | Result | Notes |
|---|---|---|
| (a) running → quit → relaunch frozen at last-checkpoint value | **PASS** | Counter shows the right frozen value after auto-pause. Cosmetic quirk: checkpoints don't align to 30s wall-clock boundaries (separate concern, see §"Out of scope"). |
| (b) running → quit → relaunch → resume → stop | **FAIL** | After clicking Resume, counter stays at `0:00` for 10+ seconds. Pause button correctly shows "Pause" (state is running), but `elapsed` doesn't tick up. |
| (c) freshly-started → quit-before-checkpoint → relaunch | Blocked | Same root cause as (b). |
| (d) already-paused → quit → relaunch | **FAIL** | Same — counter doesn't tick after Resume. |
| (e) >4h orphan path | (not yet run) | |

User-reported facts confirmed via Q&A:
- Worked ≥30s without manual pause/resume during the running phase
- Auto-pause display at relaunch was `0:00` (not the worked value)
- After Resume, counter stays at `0:00` for 10+ seconds — does not tick at all

## Diagnosis

The `0:00` pre-Resume value points to one of two things:

1. **Case B fired** (`time_entries.end_time` was NULL, so `pausedAtMs = startedAt`, freezing display at 0). Possible if no checkpoint completed during the user's session — under React's dev mode + Strict Mode + HMR, the 30s checkpoint interval can be repeatedly restarted before firing.
2. **Real bug elsewhere**.

Either way, the more important failure is post-Resume: **the counter doesn't tick at all**. The math says `elapsed` should grow by ~200ms per tick, reaching `0:01` within 1 second. The fact that it stays at `0:00` for 10+ seconds means the 200ms `setInterval` body is not firing `setElapsed` with growing values.

### Root cause hypothesis: M2.5 seed + getWorkElapsed dep loop, exacerbated by the case-B post-resume math

The tick effect at `src/pages/FocusMode.tsx:393` looks like:

```ts
useEffect(() => {
  if (!focus || focus.mode !== "active") return;
  // M2.5 seed (added during M2 capstone prep)
  setElapsed(computeFocusElapsedMs(focus, Date.now()) - focus.priorElapsedMs);
  const interval = setInterval(() => {
    if (focus.paused) return;
    const now = Date.now();
    const total = computeFocusElapsedMs(focus, now);
    const raw = total - focus.priorElapsedMs;
    setElapsed(raw);
    /* … pomodoro logic, including line 444's getWorkElapsed() call … */
  }, 200);
  return () => clearInterval(interval);
}, [focus, phase, completedPomodoros, breakDuration, getWorkElapsed]);
```

with

```ts
const getWorkElapsed = useCallback(() => {
  return elapsed - totalBreakTimeRef.current;
}, [elapsed]);
```

The dep loop:

1. Tick fires → `setElapsed(raw)` → `elapsed` changes
2. `getWorkElapsed` `useCallback` reference changes (deps include `elapsed`)
3. Tick effect deps changed → cleanup → `clearInterval` → re-run
4. **Re-run executes the M2.5 seed line synchronously** → `setElapsed(seed)`
5. New `setInterval` scheduled

This loop existed pre-M2.5 too (the deps array hasn't changed), but pre-M2.5 there was no seed line — `setElapsed` was *only* called inside the interval body. The first `setElapsed` happened after the 200ms interval first-fire, so the loop didn't trigger until the interval had a chance to grow `elapsed` past `0`.

Post-M2.5, the seed line executes `setElapsed` synchronously **inside the effect body** before `setInterval` starts. For the case-B-after-resume scenario the seed value is `0` (math: `computeFocusElapsedMs - priorMs = 0` at the moment of resume because `pausedAccumMs = resumeTime - startedAt` and `now ≈ resumeTime`). The interval then has 200ms to fire, but every state update from the *interval* triggers a re-run that re-seeds before the next interval can fire.

In React 18 dev + Strict Mode, the cleanup → re-run cycle happens within ~1ms. The 200ms interval is consistently cleared before it can fire. `elapsed` stays pinned at whatever value the seed last computed — which, immediately after resume in case B, is `0`.

### Why test (a) passed

In test (a) the session is paused-on-relaunch but never resumed during the test. The interval body's `if (focus.paused) return;` early-returns on every tick anyway, so the loop is harmless: `elapsed` is set once by the seed (correct frozen value) and stays put. The bug only surfaces when the interval needs to drive `elapsed` upward.

### Why pre-M2.5 worked

Pre-M2.5 didn't have the seed line. The first `setElapsed` happened at t+200ms, *after* the interval's first fire. By then the cleanup-restart loop is already running but each loop produces a slightly-larger `elapsed` value via the interval, so the counter visibly ticks. Post-M2.5, the seed clobbers the interval's contribution before the re-render commits.

## Proposed fix

Two-part change to `src/pages/FocusMode.tsx`:

### Part 1 — Move the seed into its own effect, deps `[focus]` only

The seed exists to handle the relaunch-while-paused case (M2.5 — counter must show the frozen value, not `0`). It only needs to fire on focus *identity* change, not on every dep churn:

```ts
// Re-seed elapsed when the focus session changes (start, swap, pause toggle).
// Handles the relaunch-while-paused case where the tick interval's
// `if (focus.paused) return` would otherwise leave elapsed at the useState default.
useEffect(() => {
  if (!focus || focus.mode !== "active") return;
  setElapsed(computeFocusElapsedMs(focus, Date.now()) - focus.priorElapsedMs);
}, [focus]);
```

### Part 2 — Drop `getWorkElapsed` from the tick effect deps; delete it entirely

On closer inspection, `getWorkElapsed` had only **one** call site (line 444, the break-end branch), and that site was **already dead code**:

```ts
workCycleStartRef.current = getWorkElapsed() + (breakDuration - (breakDuration + remaining));
// Recalculate: set workCycleStart to current workElapsed after accounting for break
const newWorkElapsed = raw - totalBreakTimeRef.current;
workCycleStartRef.current = newWorkElapsed;  // ← overwrites the line above
```

The "Recalculate" comment confirms the original author knew the line above was being clobbered. No render-side readers exist either (verified by grep). Cleanest fix: delete the `useCallback`, delete the dead line, drop the dep. The remaining branch becomes:

```ts
} else if (phase === "break") {
  const breakElapsed = now - breakStartRef.current;
  const remaining = breakDuration - breakElapsed;
  setBreakRemaining(remaining);

  if (remaining <= 0) {
    totalBreakTimeRef.current += breakDuration;
    workCycleStartRef.current = raw - totalBreakTimeRef.current;
    setPhase("work");
    setBreakRemaining(0);
    playChime();
  }
}
```

Tick effect deps simplify to `[focus, phase, completedPomodoros, breakDuration]`.

Together with Part 1, these eliminate the seed-vs-interval race:

- The seed runs once per focus identity change, not on every tick re-render.
- The tick effect's deps no longer churn on `elapsed` updates, so the interval gets its full 200ms first-fire window.

## Risks & concerns

- **Closure staleness in pomodoro logic.** The tick effect's interval body now reads `phase`, `completedPomodoros`, `breakDuration`, `totalBreakTimeRef.current` from closure. `phase` and `completedPomodoros` and `breakDuration` are still in deps, so the interval re-fires when they change (cleanup + restart). `totalBreakTimeRef` is a ref — reads always see current value. Same correctness as pre-fix.
- **Interaction with `applyActualMs`.** The actual-time popover calls `setElapsed(desiredElapsed)` directly (line 815). The seed effect doesn't fire (focus reference unchanged), so the manual edit isn't immediately overwritten. Next tick computes `raw` from `focus.pausedAccumMs` (which `adjustFocusElapsed` updated to back-solve the desired value). Counter resumes from the user-edited value. Unchanged from pre-fix behavior.
- **Strict Mode double-invocation.** Both effects use idempotent operations (setElapsed with the same input gives the same output; clearInterval + setInterval is balanced). Double-mount in dev is benign.
- **No security surface.** Refactor only.
- **No DB or schema change.** No migration touched.

## Verification plan

After the fix, re-run the rev 2 pause-on-relaunch test plan (a–e) end-to-end:

| Test | Pre-fix | Expected post-fix |
|---|---|---|
| (a) | PASS | PASS (unchanged) |
| (b) | FAIL — stays at 0:00 | PASS — counter ticks from frozen value (case A) or from 0 (case B) and visibly grows |
| (c) | Blocked | PASS — display stays near 0:00 pre-Resume; counter ticks up after Resume (case-B trade-off, expected) |
| (d) | FAIL | PASS — counter ticks from manual-pause value |
| (e) | Not run | PASS — orphan path clears focus |

Plus a regression check on the M2 capstone Test #7 (already-paused relaunch shows correct frozen value) since this touches the M2.5 seed.

## Out of scope

- **Checkpoint cadence alignment** (test (a) cosmetic quirk — checkpoints fire at 0:53, 1:23, …, not 0:30, 1:00, 1:30). Pre-existing issue caused by `setInterval` starting at non-aligned moments and restarting on every focus change. Not blocking pause-on-relaunch closeout. Worth a follow-up using `setTimeout` chained with `Math.ceil(now / 30000) * 30000` snap, plus a refactor to keep the interval running across pause/resume (fire-but-skip-during-paused rather than tear-down/rebuild). Defer until pause-on-relaunch + this fix land.
- **Pre-Resume value being `0:00` in test (b).** May be case B (no checkpoint completed in the user's session). Diagnostic in dev console: after starting a session and waiting 30s, run `localStorage.getItem("verseday_focus")`, then quit. If `pausedAtMs` after relaunch equals `startedAt`, case B fired. The pause-on-relaunch design accepts case B as a lossy fallback ("loses up to 30s of credit"). If the user expects no loss for a 30s+ session, that's a checkpoint reliability concern (see above), not this fix's scope.

## Implementation footprint

Single file: `src/pages/FocusMode.tsx`. Two effect blocks restructured. Net diff: ~+15 / -8 lines. Lands as M2.5.1 — its own commit, separate from pause-on-relaunch.
