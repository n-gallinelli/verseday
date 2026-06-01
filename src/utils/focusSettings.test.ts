import { describe, it, expect } from "vitest";
import {
  shouldContinueBreakCycle,
  BREAK_CONTINUITY_GAP_MS,
} from "./focusSettings";

describe("shouldContinueBreakCycle", () => {
  it("reset mode never continues (historical per-task behavior)", () => {
    expect(shouldContinueBreakCycle("reset", 0)).toBe(false);
    expect(shouldContinueBreakCycle("reset", 1000)).toBe(false);
    expect(shouldContinueBreakCycle("reset", 10 * 60 * 1000)).toBe(false);
  });

  it("continue mode carries the cycle for a short gap", () => {
    expect(shouldContinueBreakCycle("continue", 0)).toBe(true);
    expect(shouldContinueBreakCycle("continue", 30_000)).toBe(true); // 30s
    expect(shouldContinueBreakCycle("continue", BREAK_CONTINUITY_GAP_MS - 1)).toBe(true);
  });

  it("continue mode resets once the gap reaches the threshold (2 min)", () => {
    expect(shouldContinueBreakCycle("continue", BREAK_CONTINUITY_GAP_MS)).toBe(false);
    expect(shouldContinueBreakCycle("continue", BREAK_CONTINUITY_GAP_MS + 1)).toBe(false);
    expect(shouldContinueBreakCycle("continue", 5 * 60 * 1000)).toBe(false);
  });

  it("threshold is 2 minutes", () => {
    expect(BREAK_CONTINUITY_GAP_MS).toBe(120_000);
  });
});
