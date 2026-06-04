import { describe, it, expect } from "vitest";
import {
  buildWeeklyDigest,
  formatDigest,
  buildPrompt,
  AUDIENCE_DIRECTIVES,
  type SummaryTask,
  type SummaryProject,
} from "./weeklySummary";

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

describe("buildWeeklyDigest", () => {
  it("groups by project with correct per-group + week totals", () => {
    const d = buildWeeklyDigest({ startIso: "2026-06-01", endIso: "2026-06-07", tasks, projects, workedByTaskId: worked });
    expect(d.isEmpty).toBe(false);
    expect(d.totalCount).toBe(4);
    expect(d.totalMinutes).toBe(210); // 120+30+45+15

    // Ordered by worked time desc; "No objective" last.
    expect(d.groups.map((g) => g.name)).toEqual(["Pricing Revamp", "Onboarding", "No objective"]);

    const pricing = d.groups[0];
    expect(pricing.projectId).toBe(1);
    expect(pricing.goal).toBe("lift conversion on the paid tiers");
    expect(pricing.totalMinutes).toBe(150);
    expect(pricing.count).toBe(2);
    // tasks sorted by worked desc
    expect(pricing.tasks.map((t) => t.title)).toEqual(["Ship new pricing page", "A/B test checkout copy"]);
  });

  it("buckets null project_id, and a since-deleted project_id not in the map, into 'No objective'", () => {
    // The caller passes archived projects too, so archived tasks DON'T land
    // here (see the dedicated test below). 999 stands for a since-deleted
    // project — genuinely unattributed, so it falls to "No objective".
    const t: SummaryTask[] = [
      { id: 1, title: "loose task", project_id: null },
      { id: 2, title: "deleted-proj task", project_id: 999 }, // 999 not in the projects map
    ];
    const d = buildWeeklyDigest({
      startIso: "2026-06-01",
      endIso: "2026-06-07",
      tasks: t,
      projects,
      workedByTaskId: new Map([[1, 5], [2, 10]]),
    });
    expect(d.groups).toHaveLength(1);
    expect(d.groups[0].name).toBe("No objective");
    expect(d.groups[0].projectId).toBeNull();
    expect(d.groups[0].count).toBe(2);
    expect(d.groups[0].totalMinutes).toBe(15);
  });

  it("an archived project (passed in by the caller) keeps its own grouping, not 'No objective'", () => {
    const withArchived: SummaryProject[] = [
      ...projects,
      { id: 9, name: "Legacy Migration", description: "wind-down work" }, // archived, still passed in
    ];
    const d = buildWeeklyDigest({
      startIso: "2026-06-01",
      endIso: "2026-06-07",
      tasks: [{ id: 50, title: "close out legacy ticket", project_id: 9 }],
      projects: withArchived,
      workedByTaskId: new Map([[50, 20]]),
    });
    expect(d.groups).toHaveLength(1);
    expect(d.groups[0].name).toBe("Legacy Migration");
    expect(d.groups[0].projectId).toBe(9);
  });

  it("treats a missing worked entry as 0", () => {
    const d = buildWeeklyDigest({
      startIso: "2026-06-01",
      endIso: "2026-06-07",
      tasks: [{ id: 7, title: "untimed", project_id: 1 }],
      projects,
      workedByTaskId: new Map(),
    });
    expect(d.totalMinutes).toBe(0);
    expect(d.groups[0].tasks[0].workedMinutes).toBe(0);
  });

  it("flags an empty week", () => {
    const d = buildWeeklyDigest({ startIso: "2026-06-01", endIso: "2026-06-07", tasks: [], projects, workedByTaskId: new Map() });
    expect(d.isEmpty).toBe(true);
    expect(d.totalCount).toBe(0);
    expect(d.groups).toHaveLength(0);
  });
});

describe("formatDigest", () => {
  it("renders week range, per-project headings/goals/bullets and totals", () => {
    const d = buildWeeklyDigest({ startIso: "2026-06-01", endIso: "2026-06-07", tasks, projects, workedByTaskId: worked });
    const text = formatDigest(d);
    expect(text).toContain("Week of Jun 1–Jun 7");
    expect(text).toContain("## Pricing Revamp — lift conversion on the paid tiers");
    expect(text).toContain("- Ship new pricing page (2h)");
    expect(text).toContain("Total: 2h 30m · 2 tasks");
    expect(text).toContain("## Onboarding\n"); // no goal → no em-dash
    expect(text).toContain("## No objective");
    expect(text).toContain("Week total: 3h 30m · 4 tasks");
  });

  it("renders a grounded quiet-week line when empty", () => {
    const d = buildWeeklyDigest({ startIso: "2026-06-01", endIso: "2026-06-07", tasks: [], projects, workedByTaskId: new Map() });
    expect(formatDigest(d)).toContain("Nothing was completed this week.");
  });
});

describe("buildPrompt", () => {
  const d = buildWeeklyDigest({ startIso: "2026-06-01", endIso: "2026-06-07", tasks, projects, workedByTaskId: worked });

  it("embeds the Dan directive + the digest", () => {
    const p = buildPrompt("dan", d);
    expect(p).toContain(AUDIENCE_DIRECTIVES.dan);
    expect(p).not.toContain(AUDIENCE_DIRECTIVES.cam);
    expect(p).toContain("This week's completed work:");
    expect(p).toContain("## Pricing Revamp"); // digest embedded
    expect(p).toContain("do not invent metrics or overstate impact.");
  });

  it("swaps to the Cam directive", () => {
    const p = buildPrompt("cam", d);
    expect(p).toContain(AUDIENCE_DIRECTIVES.cam);
    expect(p).not.toContain(AUDIENCE_DIRECTIVES.dan);
  });
});
