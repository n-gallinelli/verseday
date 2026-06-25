import { describe, it, expect } from "vitest";
import { formatNoteTimestamp } from "./noteTimestamp";

// All Date args use local-time component constructors (logicalDayIso operates
// in local tz, matching the rest of the date suite).
describe("formatNoteTimestamp", () => {
  const now = new Date(2026, 5, 24, 14, 0); // Jun 24 2026, 2:00 PM

  it("time first, then weekday + date, minute granularity", () => {
    const ms = new Date(2026, 5, 24, 14, 4).getTime();
    expect(formatNoteTimestamp(ms, now)).toBe("2:04 PM · Wed, Jun 24");
  });

  it("two stamps in the same minute format identically (minute granularity)", () => {
    const a = new Date(2026, 5, 24, 14, 4, 10).getTime();
    const b = new Date(2026, 5, 24, 14, 4, 55).getTime();
    expect(formatNoteTimestamp(a, now)).toBe(formatNoteTimestamp(b, now));
  });

  it("earlier day this year → time · weekday, month/day, no year", () => {
    const ms = new Date(2026, 5, 23, 9, 30).getTime();
    expect(formatNoteTimestamp(ms, now)).toBe("9:30 AM · Tue, Jun 23");
  });

  it("prior year → time · weekday, month/day with year", () => {
    const ms = new Date(2025, 5, 23, 9, 30).getTime();
    expect(formatNoteTimestamp(ms, now)).toBe("9:30 AM · Mon, Jun 23, 2025");
  });

  it("after-midnight-before-3am counts as the previous logical day", () => {
    // 1:00 AM Jun 24 is still the Jun 23 logical day, so the date reads Jun 23
    // even though the clock time is 1:00 AM.
    const ms = new Date(2026, 5, 24, 1, 0).getTime();
    expect(formatNoteTimestamp(ms, now)).toBe("1:00 AM · Tue, Jun 23");
  });
});
