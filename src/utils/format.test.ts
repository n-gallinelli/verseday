import { describe, it, expect } from "vitest";
import { parseTimeFromTitle } from "./format";

// parseTimeFromTitle is the single source of truth for time-in-title parsing
// across every create/edit path (DailyPlanner, QuickAdd, ProjectDetail, PlanTab,
// TaskDetailOverlay). A parse is only valid when a real title remnant survives
// the strip — a bare duration is no-parse, so callers never produce a blank
// task.
describe("parseTimeFromTitle", () => {
  it("a bare ~token is no-parse (keeps the literal title, no estimate)", () => {
    expect(parseTimeFromTitle("~10")).toEqual({ cleanTitle: "~10", minutes: null });
  });

  it("a bare unit token (2h) is no-parse", () => {
    expect(parseTimeFromTitle("2h")).toEqual({ cleanTitle: "2h", minutes: null });
  });

  it("strips a real title remnant and returns the estimate (30m)", () => {
    expect(parseTimeFromTitle("Write report 30m")).toEqual({
      cleanTitle: "Write report",
      minutes: 30,
    });
  });

  it("parses the ~ shorthand when a title survives", () => {
    expect(parseTimeFromTitle("Email Bob ~10")).toEqual({
      cleanTitle: "Email Bob",
      minutes: 10,
    });
  });

  it("converts hours to minutes (1.5 hours → 90)", () => {
    expect(parseTimeFromTitle("Plan offsite 1.5 hours")).toEqual({
      cleanTitle: "Plan offsite",
      minutes: 90,
    });
  });

  it("a whitespace-only remnant is no-parse", () => {
    expect(parseTimeFromTitle("  ~10")).toEqual({ cleanTitle: "  ~10", minutes: null });
  });

  it("leaves a title with no duration untouched", () => {
    expect(parseTimeFromTitle("Call mom")).toEqual({ cleanTitle: "Call mom", minutes: null });
  });

  it("does not treat a bare trailing number (no unit) as an estimate", () => {
    expect(parseTimeFromTitle("Call Alex at 5")).toEqual({
      cleanTitle: "Call Alex at 5",
      minutes: null,
    });
  });
});
