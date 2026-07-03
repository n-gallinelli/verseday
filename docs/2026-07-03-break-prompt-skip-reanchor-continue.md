# Break prompt re-fires instantly after Skip → task switch (continue mode)

**Date:** 2026-07-03
**Branch:** `fix/break-prompt-skip-reanchor-continue`
**File:** `src/pages/FocusMode.tsx` (one file, no DDL, $0)

## Symptom

With the break-cycle setting on **"continue"**: finish a work cycle → break prompt
appears → click **"Skip it"** → start another task a couple seconds later → the
break prompt fires again *immediately* on the new task.

## Root cause

The prompt fires when `currentCycleElapsed = workElapsed − workCycleStart ≥ WORK_DURATION_MS`.

- `handleNoBreak` ("Skip it") correctly re-anchors `workCycleStartRef` to the current
  work-elapsed, so `currentCycleElapsed` resets to ~0 — **on that task**.
- The `[focus?.taskId]` reset effect then discards that anchor on the switch: it sets
  `workCycleStart = 0` and seeded the carry with `breakCarryRef = lastWorkElapsedRef`
  — the **absolute** work-elapsed of the old task (≥ WORK_DURATION after a completed
  cycle).
- First tick on the new task: `workElapsed = 0 (fresh raw) + carry(~25m)`,
  `workCycleStart = 0` → `currentCycleElapsed ≈ 25m ≥ threshold` → prompt fires.

`focus.workedMs` (`raw`) starts at 0 on a fresh start/switch (prior worked time lives
in the separate `priorElapsedMs`), so the *only* way `we` starts large is the carry.
Default "reset" mode is unaffected (carry = 0).

## Fix

Carry only **current-cycle progress** (`lastWorkElapsed − priorCycleStart`), and only
when the **prior phase was work**. Both the outgoing `workCycleStart` and the outgoing
`phase` are captured before the effect's resets wipe them; phase is read via a
`phaseRef` mirror because the effect's deps are `[focus?.taskId]` (the closed-over
`phase` would be stale).

```ts
const priorCycleStart = workCycleStartRef.current;
const priorPhase = phaseRef.current;
// ...existing resets (workCycleStartRef → 0, setPhase("work"), etc.)...
if (shouldContinueBreakCycle(breakContinuityRef.current, gapMs)) {
  breakCarryRef.current =
    priorPhase === "work"
      ? Math.max(0, lastWorkElapsedRef.current - priorCycleStart)
      : 0;
} else {
  breakCarryRef.current = 0;
  setCompletedPomodoros(0);
}
```

### Why the phase gate (Verse-required)

Switching **at a prompt or during a break** leaves `workCycleStart` pointing at the
completed cycle's start and `lastWorkElapsed` frozen ~25m above it → carry ≈ 25m would
re-fire the prompt instantly (and double-count, since `completedPomodoros` was already
bumped when the prompt showed). Gating on `priorPhase === "work"` means the
`max(0, …)` branch only runs where `currentCycleElapsed < WORK_DURATION`, so it can
never re-arm the prompt by itself. A clamp-to-`WORK_DURATION−1s` was rejected — it only
delays the spurious prompt by a second.

## Scenarios verified (against the tick math)

| Prior state on task A | switch to B | carry | Result |
|---|---|---|---|
| 23m into a fresh cycle, no skip | within 2m | 23m | Break lands 2m into B (intended, unchanged) |
| Cycle done → **Skip it** | within 2m | ~0 | Fresh 25m on B (**bug fixed**) |
| At the prompt (didn't answer) | within 2m | 0 | Fresh 25m on B (**hole closed**) |
| Mid-break | within 2m | 0 | Fresh 25m on B (**hole closed**) |
| any | ≥ 2m gap | 0 | Cycle resets (unchanged) |
| any, "reset" mode | any | 0 | Cycle resets (unchanged) |

## Validation

`tsc --noEmit` clean. Verified by tracing the six scenarios above through the 1 Hz
tick's threshold check; no runtime UI test required (pure timing-ref logic).

## Verse

Plan REJECTED rev1 (phase-gate required for the mid-break/mid-prompt hole) →
incorporated → re-sent for code review.
