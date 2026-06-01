import { describe, it, expect } from "vitest";
import { clampWorkedDelta, MAX_TICK_DELTA_MS } from "./workedTime";

// P0-1 runtime check (Branch A). The "fake clock" here is just the delta we
// feed in — clampWorkedDelta is pure, so we assert its decision directly for
// each scenario the brief and Verse called out. These cases stand in for the
// live hidden-window measurement Nick declined: (normal) and (throttled) prove
// we keep real work; (resume) and (backstop) prove we drop only suspend gaps.

describe("clampWorkedDelta", () => {
  it("keeps a normal ~1s tick (don't lose real seconds)", () => {
    expect(clampWorkedDelta(1000, false)).toBe(1000);
  });

  it("keeps a throttled-but-working delta below the cap in full (the regression Verse blocked)", () => {
    // App Nap / hidden-window throttle can stretch a tick to tens of seconds
    // while the user works in another app. 90s, no resume signal → kept whole.
    expect(clampWorkedDelta(90_000, false)).toBe(90_000);
  });

  it("keeps a delta just under the cap", () => {
    expect(clampWorkedDelta(MAX_TICK_DELTA_MS - 1, false)).toBe(
      MAX_TICK_DELTA_MS - 1
    );
  });

  it("drops the span on an explicit OS resume, regardless of size (the core bug)", () => {
    // 2h sleep with the resume signal having won the race against this tick.
    expect(clampWorkedDelta(2 * 60 * 60 * 1000, true)).toBe(0);
    // Even a tiny delta is dropped if a resume was just signalled.
    expect(clampWorkedDelta(1000, true)).toBe(0);
  });

  it("drops a huge delta even if the resume event lost the race / was missed (backstop net)", () => {
    // 2h delta, resume flag NOT yet set (async emit→listen lost to the tick,
    // or the wake event dropped) → the backstop still discards it.
    expect(clampWorkedDelta(2 * 60 * 60 * 1000, false)).toBe(0);
    // Exactly at the cap is kept; one ms over is dropped.
    expect(clampWorkedDelta(MAX_TICK_DELTA_MS, false)).toBe(MAX_TICK_DELTA_MS);
    expect(clampWorkedDelta(MAX_TICK_DELTA_MS + 1, false)).toBe(0);
  });

  it("treats zero / negative deltas (clock skew, duplicate tick) as not worked", () => {
    expect(clampWorkedDelta(0, false)).toBe(0);
    expect(clampWorkedDelta(-5000, false)).toBe(0);
    expect(clampWorkedDelta(-5000, true)).toBe(0);
  });
});
