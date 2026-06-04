import { describe, it, expect } from "vitest";
import { assertReschedulable, CalendarRescheduleError } from "./rescheduleGuard";

// Mirrors the rollover integrity test's intent at the manual-reschedule
// chokepoint: a calendar-imported task is rejected; everything else is allowed.
// updateTaskDateScheduled (queries.ts) calls this with the row's external_source
// before any merge/skip/update side effect, so a calendar row can't be re-dated.
describe("assertReschedulable", () => {
  it("rejects a calendar-imported task", () => {
    expect(() => assertReschedulable("calendar")).toThrow(CalendarRescheduleError);
  });

  it("allows a normal task (external_source null)", () => {
    expect(() => assertReschedulable(null)).not.toThrow();
  });

  it("allows undefined external_source (no row / non-external)", () => {
    expect(() => assertReschedulable(undefined)).not.toThrow();
  });

  it("only 'calendar' is blocked — any other source value is allowed", () => {
    // 'calendar' is the only external_source the app writes today; guard is
    // exact-match so a future external source isn't silently frozen.
    expect(() => assertReschedulable("import")).not.toThrow();
  });
});
