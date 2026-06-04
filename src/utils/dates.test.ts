import { describe, it, expect } from "vitest";
import { logicalDayIso } from "./dates";

// logicalDayIso — the 3am-boundary "logical day" backing the day-rollover
// reset (docs/2026-06-04-shutdown-day-rollover-reset.md). Times between
// midnight and the cutoff belong to the previous calendar day, so a late-night
// shutdown reopened before 3am still reads as the same day. Dates are
// constructed with local-time component args (new Date(y, m, d, h)) because
// logicalDayIso operates entirely in local tz.
describe("logicalDayIso (3am boundary)", () => {
  it("01:00 → previous calendar day", () => {
    expect(logicalDayIso(new Date(2026, 5, 4, 1, 0))).toBe("2026-06-03");
  });

  it("03:00 → same day (boundary is inclusive of the cutoff hour)", () => {
    expect(logicalDayIso(new Date(2026, 5, 4, 3, 0))).toBe("2026-06-04");
  });

  it("09:00 → same day", () => {
    expect(logicalDayIso(new Date(2026, 5, 4, 9, 0))).toBe("2026-06-04");
  });
});
