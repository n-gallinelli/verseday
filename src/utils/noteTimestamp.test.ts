import { describe, it, expect } from "vitest";
import { formatNoteTimestamp } from "./noteTimestamp";

// All Date args use local-time component constructors (logicalDayIso operates
// in local tz, matching the rest of the date suite).
describe("formatNoteTimestamp", () => {
  const now = new Date(2026, 5, 24, 14, 0); // Jun 24 2026, 2:00 PM

  it("same logical day → clock time at minute granularity", () => {
    const ms = new Date(2026, 5, 24, 14, 4).getTime();
    expect(formatNoteTimestamp(ms, now)).toBe("2:04 PM");
  });

  it("two stamps in the same minute format identically (so they collapse)", () => {
    const a = new Date(2026, 5, 24, 14, 4, 10).getTime();
    const b = new Date(2026, 5, 24, 14, 4, 55).getTime();
    expect(formatNoteTimestamp(a, now)).toBe(formatNoteTimestamp(b, now));
  });

  it("earlier day this year → short month/day, no year", () => {
    const ms = new Date(2026, 5, 23, 9, 30).getTime();
    expect(formatNoteTimestamp(ms, now)).toBe("Jun 23");
  });

  it("prior year → month/day with year", () => {
    const ms = new Date(2025, 5, 23, 9, 30).getTime();
    expect(formatNoteTimestamp(ms, now)).toBe("Jun 23, 2025");
  });

  it("after-midnight-before-3am counts as the previous logical day", () => {
    // 1:00 AM Jun 24 is still the Jun 23 logical day; from a Jun 24 afternoon
    // 'now' that's an earlier day → short date, not a clock time.
    const ms = new Date(2026, 5, 24, 1, 0).getTime();
    expect(formatNoteTimestamp(ms, now)).toBe("Jun 23");
  });
});
