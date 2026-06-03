import { describe, it, expect } from "vitest";
import {
  clampWorkedDelta,
  MAX_TICK_DELTA_MS,
  MAX_DIVERGENT_CREDIT_MS,
} from "./workedTime";

// #2 + #3 — clampWorkedDelta is pure; we assert its decision directly for each
// scenario. The wall delta (Date.now) and monotonic delta (performance.now)
// are passed explicitly: they AGREE when the machine was continuously awake and
// DIVERGE across a sleep (monotonic suspends) or a forward clock jump (monotonic
// unaffected). "agree" cases prove we keep real work (incl. throttled/occluded);
// "diverge" cases prove we drop only suspend/jump time — without relying on the
// racy OS resume event.

describe("clampWorkedDelta", () => {
  it("keeps a normal ~1s tick (clocks agree)", () => {
    expect(clampWorkedDelta(1000, 1000, false)).toBe(1000);
  });

  it("keeps a throttled/occluded catch-up below the backstop in full (clocks agree)", () => {
    // App Nap / hidden window / PiP can stretch a tick to tens of seconds while
    // the user works in another app; the machine was awake the whole time so
    // wall ≈ mono. 90s, agree → kept whole. (The case Verse previously blocked
    // regressing.)
    expect(clampWorkedDelta(90_000, 90_120, false)).toBe(90_000);
  });

  it("keeps an agree-case delta just under the backstop", () => {
    expect(clampWorkedDelta(MAX_TICK_DELTA_MS - 1, MAX_TICK_DELTA_MS - 1, false)).toBe(
      MAX_TICK_DELTA_MS - 1
    );
  });

  it("drops an agree-case span over the backstop (unexplained awake gap)", () => {
    expect(clampWorkedDelta(MAX_TICK_DELTA_MS, MAX_TICK_DELTA_MS, false)).toBe(
      MAX_TICK_DELTA_MS
    );
    expect(clampWorkedDelta(MAX_TICK_DELTA_MS + 1, MAX_TICK_DELTA_MS + 1, false)).toBe(0);
  });

  it("#2 — drops a SUB-cap sleep the old design credited (clocks diverge, monotonic frozen)", () => {
    // 2-minute lid-close: wall advanced 120s, monotonic frozen (~30ms of
    // boundary processing). Old code (120s < 300s, resume event lost the race)
    // credited 120s; cross-check credits ~the monotonic delta → ~0.
    expect(clampWorkedDelta(120_000, 30, false)).toBe(30);
  });

  it("#3 — drops a forward wall-clock jump, credits only the real awake second", () => {
    // NTP/manual jump of +1h while a normal 1s tick elapsed: wall +3_600_000,
    // monotonic +1000. Diverge → credit min(mono, wall) = 1000, jump discarded.
    expect(clampWorkedDelta(3_600_000, 1000, false)).toBe(1000);
  });

  it("drops a long sleep regardless of size (clocks diverge)", () => {
    // 2h sleep: wall +7_200_000, monotonic frozen (~50ms). → ~0.
    expect(clampWorkedDelta(2 * 60 * 60 * 1000, 50, false)).toBe(50);
  });

  it("caps a divergent credit to a few seconds (never bank a full divergent span)", () => {
    // Pathological: both clocks moved a lot but disagree. Credited monotonic is
    // over the divergent cap → dropped entirely.
    expect(clampWorkedDelta(20_000, MAX_DIVERGENT_CREDIT_MS + 1, false)).toBe(0);
    // Exactly at the cap is kept.
    expect(clampWorkedDelta(20_000, MAX_DIVERGENT_CREDIT_MS, false)).toBe(
      MAX_DIVERGENT_CREDIT_MS
    );
  });

  it("drops the span on an explicit OS resume, regardless of size (redundant backstop)", () => {
    expect(clampWorkedDelta(2 * 60 * 60 * 1000, 2 * 60 * 60 * 1000, true)).toBe(0);
    expect(clampWorkedDelta(1000, 1000, true)).toBe(0);
  });

  it("treats zero / negative deltas on either clock (skew, duplicate tick) as not worked", () => {
    expect(clampWorkedDelta(0, 0, false)).toBe(0);
    expect(clampWorkedDelta(-5000, 1000, false)).toBe(0);
    expect(clampWorkedDelta(1000, -5000, false)).toBe(0);
    expect(clampWorkedDelta(-5000, -5000, true)).toBe(0);
  });
});
