import { describe, it, expect } from "vitest";
import { workElapsedMs } from "./pomodoro";

const WORK_MS = 25 * 60 * 1000;
const SNOOZE_MS = 5 * 60 * 1000;

describe("workElapsedMs", () => {
  it("adds breakCarry to (raw - totalBreak)", () => {
    expect(workElapsedMs(1000, 200, 0)).toBe(800);
    expect(workElapsedMs(1000, 200, 500)).toBe(1300);
  });
});

// The regression guard for the break-prompt re-pop bug: an anchor set by a
// handler and the tick's work-elapsed must use the SAME formula, so
// currentCycleElapsed = workElapsed(tick) - anchor is independent of breakCarry.
// The OLD code anchored without breakCarry, so currentCycleElapsed jumped to
// ~breakCarry on the next tick and re-fired the prompt instantly.
describe("cycle anchor leaves no breakCarry leak (re-pop regression)", () => {
  // breakCarry large enough that the OLD bug would have re-fired immediately.
  const breakCarry = 40 * 60 * 1000;
  const totalBreak = 3 * 60 * 1000;
  // workedMs at the instant a handler runs (prompt just fired after a cycle).
  const rawAtHandler = 28 * 60 * 1000;
  // workedMs one tick (~1s) later, when the tick recomputes the cycle.
  const rawNextTick = rawAtHandler + 1000;

  it("Skip / decline (handleNoBreak): currentCycleElapsed ≈ 0, not ≈ breakCarry", () => {
    const anchor = workElapsedMs(rawAtHandler, totalBreak, breakCarry);
    const currentCycleElapsed = workElapsedMs(rawNextTick, totalBreak, breakCarry) - anchor;
    expect(currentCycleElapsed).toBe(1000); // just the 1s tick, no carry leak
    expect(currentCycleElapsed).toBeLessThan(WORK_MS); // would NOT re-fire
    // Prove the old hand-spelled formula (no breakCarry) would have re-fired.
    const buggyAnchor = rawAtHandler - totalBreak;
    const buggyCycle = workElapsedMs(rawNextTick, totalBreak, breakCarry) - buggyAnchor;
    expect(buggyCycle).toBeGreaterThanOrEqual(WORK_MS);
  });

  it("Snooze (handleSnooze): threshold is exactly SNOOZE_MS of work away", () => {
    const threshold = workElapsedMs(rawAtHandler, totalBreak, breakCarry) + SNOOZE_MS;
    // Not yet due one tick later...
    expect(workElapsedMs(rawNextTick, totalBreak, breakCarry)).toBeLessThan(threshold);
    // ...due after SNOOZE_MS more work, regardless of breakCarry.
    const rawAfterSnooze = rawAtHandler + SNOOZE_MS;
    expect(workElapsedMs(rawAfterSnooze, totalBreak, breakCarry)).toBeGreaterThanOrEqual(threshold);
  });

  it("Skip-break / natural break end: next cycle starts at ~0", () => {
    // After a break, totalBreak has grown; anchor + tick share the formula.
    const totalBreakAfter = totalBreak + 5 * 60 * 1000;
    const anchor = workElapsedMs(rawAtHandler, totalBreakAfter, breakCarry);
    const currentCycleElapsed = workElapsedMs(rawNextTick, totalBreakAfter, breakCarry) - anchor;
    expect(currentCycleElapsed).toBe(1000);
    expect(currentCycleElapsed).toBeLessThan(WORK_MS);
  });

  it("reset mode (breakCarry = 0) is byte-identical to the old formula", () => {
    expect(workElapsedMs(rawAtHandler, totalBreak, 0)).toBe(rawAtHandler - totalBreak);
  });
});
