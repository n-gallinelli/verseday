import { describe, it, expect } from "vitest";
import {
  buildSummaryDigest,
  formatSummaryDigest,
  buildSummaryPrompt,
  AUDIENCE_DIRECTIVES,
  type SummaryTask,
  type SummaryProject,
} from "./summary";

const projects: SummaryProject[] = [
  { id: 1, name: "Pricing Revamp", description: "lift conversion on the paid tiers" },
  { id: 2, name: "Onboarding", description: null },
];

const tasks: SummaryTask[] = [
  { id: 10, title: "Ship new pricing page", project_id: 1 },
  { id: 11, title: "A/B test checkout copy", project_id: 1 },
  { id: 12, title: "Welcome email sequence", project_id: 2 },
  { id: 13, title: "Inbox triage", project_id: null },
];

const worked = new Map<number, number>([
  [10, 120], // 2h
  [11, 30],
  [12, 45],
  [13, 15],
]);

describe("buildSummaryDigest", () => {
  it("groups by project with correct per-group + total counts", () => {
    const d = buildSummaryDigest({ startIso: "2026-06-01", endIso: "2026-06-07", tasks, projects, workedByTaskId: worked });
    expect(d.isEmpty).toBe(false);
    expect(d.totalCount).toBe(4);
    expect(d.totalMinutes).toBe(210);
    expect(d.groups.map((g) => g.name)).toEqual(["Pricing Revamp", "Onboarding", "No objective"]);
    expect(d.groups[0]).toMatchObject({ projectId: 1, goal: "lift conversion on the paid tiers", totalMinutes: 150, count: 2 });
    expect(d.groups[0].tasks.map((t) => t.title)).toEqual(["Ship new pricing page", "A/B test checkout copy"]);
  });

  it("null/since-deleted project_id → 'No objective'; archived project (passed in) keeps its group", () => {
    const withArchived: SummaryProject[] = [...projects, { id: 9, name: "Legacy Migration", description: "wind-down" }];
    const d = buildSummaryDigest({
      startIso: "2026-06-01",
      endIso: "2026-06-07",
      tasks: [
        { id: 1, title: "loose", project_id: null },
        { id: 2, title: "deleted-proj", project_id: 999 },
        { id: 3, title: "archived-proj", project_id: 9 },
      ],
      projects: withArchived,
      workedByTaskId: new Map([[1, 5], [2, 10], [3, 20]]),
    });
    const legacy = d.groups.find((g) => g.projectId === 9);
    expect(legacy?.name).toBe("Legacy Migration");
    const none = d.groups.find((g) => g.projectId === null);
    expect(none?.count).toBe(2); // null + since-deleted 999
  });

  it("missing worked entry → 0; empty flagged", () => {
    expect(
      buildSummaryDigest({ startIso: "2026-06-01", endIso: "2026-06-07", tasks: [{ id: 7, title: "x", project_id: 1 }], projects, workedByTaskId: new Map() }).groups[0].tasks[0].workedMinutes,
    ).toBe(0);
    expect(
      buildSummaryDigest({ startIso: "2026-06-01", endIso: "2026-06-07", tasks: [], projects, workedByTaskId: new Map() }).isEmpty,
    ).toBe(true);
  });
});

describe("formatSummaryDigest — period-dependent header / footer / empty-state", () => {
  const weekly = buildSummaryDigest({ startIso: "2026-06-01", endIso: "2026-06-07", tasks, projects, workedByTaskId: worked });
  const daily = buildSummaryDigest({ startIso: "2026-06-04", endIso: "2026-06-04", tasks, projects, workedByTaskId: worked });

  it("WEEK: 'Week of' header + 'Week total:' footer", () => {
    const text = formatSummaryDigest(weekly, "week");
    expect(text).toContain("Week of Jun 1–Jun 7");
    expect(text).toContain("## Pricing Revamp — lift conversion on the paid tiers");
    expect(text).toContain("- Ship new pricing page (2h)");
    expect(text).toContain("## Onboarding\n"); // null goal → no em-dash
    expect(text).toContain("Week total: 3h 30m · 4 tasks");
    expect(text).not.toContain("Day total:");
  });

  it("DAY: weekday header + 'Day total:' footer (the required label fix)", () => {
    const text = formatSummaryDigest(daily, "day");
    expect(text).toContain("Thursday, Jun 4");
    expect(text).toContain("Day total: 3h 30m · 4 tasks");
    expect(text).not.toContain("Week total:");
    expect(text).not.toContain("Week of");
  });

  it("empty-state wording varies by period", () => {
    const empty = buildSummaryDigest({ startIso: "2026-06-04", endIso: "2026-06-04", tasks: [], projects, workedByTaskId: new Map() });
    expect(formatSummaryDigest(empty, "day")).toContain("Nothing was completed today.");
    const emptyWeek = buildSummaryDigest({ startIso: "2026-06-01", endIso: "2026-06-07", tasks: [], projects, workedByTaskId: new Map() });
    expect(formatSummaryDigest(emptyWeek, "week")).toContain("Nothing was completed this week.");
  });
});

describe("buildSummaryPrompt — period verb + grounding + audience", () => {
  const weekly = buildSummaryDigest({ startIso: "2026-06-01", endIso: "2026-06-07", tasks, projects, workedByTaskId: worked });
  const daily = buildSummaryDigest({ startIso: "2026-06-04", endIso: "2026-06-04", tasks, projects, workedByTaskId: worked });

  it("WEEK prompt: weekly verb + Dan directive + grounding + embedded digest", () => {
    const p = buildSummaryPrompt("dan", weekly, "week");
    expect(p).toContain("Write a weekly rundown of our efforts this week,");
    expect(p).toContain(AUDIENCE_DIRECTIVES.dan);
    expect(p).toContain("This week's completed work:");
    expect(p).toContain("do not invent metrics or overstate impact.");
    expect(p).toContain("## Pricing Revamp");
  });

  it("DAY prompt: today verb + today's-work line + Cam directive", () => {
    const p = buildSummaryPrompt("cam", daily, "day");
    expect(p).toContain("Write a rundown of our efforts today,");
    expect(p).toContain("Today's completed work:");
    expect(p).toContain(AUDIENCE_DIRECTIVES.cam);
    expect(p).not.toContain("weekly rundown");
  });
});
