import { describe, it, expect } from "vitest";
import { breakEndClock } from "./breakClock";

// Dates built with local-time component args so getHours/getMinutes are
// deterministic in the runner's tz (same approach as dates.test.ts).
describe("breakEndClock", () => {
  it("adds the remaining break to now (the mockup case: 2:39 + 3m → 2:42)", () => {
    const now = new Date(2026, 5, 4, 14, 39, 0).getTime();
    expect(breakEndClock(now, 3 * 60 * 1000)).toBe("2:42");
  });

  it("rolls the hour over", () => {
    const now = new Date(2026, 5, 4, 14, 59, 0).getTime();
    expect(breakEndClock(now, 2 * 60 * 1000)).toBe("3:01");
  });

  it("renders midnight and noon hours as 12", () => {
    expect(breakEndClock(new Date(2026, 5, 4, 23, 58).getTime(), 5 * 60 * 1000)).toBe("12:03");
    expect(breakEndClock(new Date(2026, 5, 4, 11, 58).getTime(), 5 * 60 * 1000)).toBe("12:03");
  });

  it("treats a negative/zero remaining as ending now", () => {
    const now = new Date(2026, 5, 4, 9, 5, 0).getTime();
    expect(breakEndClock(now, 0)).toBe("9:05");
    expect(breakEndClock(now, -1000)).toBe("9:05");
  });
});
