import type { Task, Project } from "../types";

export type AudienceKey = "cam" | "dan" | "nick";

export const AUDIENCES: Record<
  AudienceKey,
  { label: string; systemPrompt: string }
> = {
  cam: {
    label: "Cam",
    systemPrompt: `You write concise daily productivity summaries for a results-oriented manager (Enneagram Type 3 Achiever, secondary Type 6 Loyalist).

Style rules:
- Lead with accomplishments and measurable outcomes
- Use bullet points, not paragraphs
- Compare planned vs. delivered where data is available
- Flag risks or blockers honestly, paired with mitigation
- Keep tone warm but efficient — no filler
- Under 200 words`,
  },
  dan: {
    label: "Dan",
    systemPrompt: `You write bold daily productivity summaries for a direct, action-oriented leader (Enneagram Type 8 Challenger, secondary Type 7 Enthusiast).

Style rules:
- Be direct and confident — state outcomes plainly, no hedging
- Show momentum: what moved forward, what's next
- Mention team or organizational impact where relevant
- Frame setbacks as obstacles tackled, not problems to worry about
- Keep it short and energetic
- Under 200 words`,
  },
  nick: {
    label: "Nick (self)",
    systemPrompt: `You write reflective daily productivity summaries for someone who values insight and meaning (Enneagram Type 7 Enthusiast, secondary Type 5 Investigator, tertiary Type 4 Individualist).

Style rules:
- Frame the day as a narrative arc — what was the story?
- Draw out patterns, insights, or things learned
- Connect tasks to larger purpose or craft
- Note energy shifts and what sparked curiosity or deep work
- Be genuine and insightful, not corporate
- Under 250 words`,
  },
};

export interface ShutdownSummaryData {
  date: string;
  tasks: (Task & { workedMinutes: number; projectName: string | null })[];
  plannedMinutes: number;
  workedMinutes: number;
  mood: string | null;
  reflection: string | null;
}

export interface WeeklySummaryData {
  weekOf: string;
  totalWorkedMinutes: number;
  totalPlannedMinutes: number;
  projects: {
    name: string;
    completedCount: number;
    incompleteCount: number;
    workedMinutes: number;
  }[];
  completedCount: number;
  incompleteCount: number;
  mood: string | null;
  reflections: string | null;
  carryForward: string | null;
}

export interface PlanSummaryData {
  date: string;
  tasks: (Task & { projectName: string | null })[];
  totalPlannedMinutes: number;
  hourBudget: number;
  notes: string | null;
}

export function buildShutdownUserPrompt(data: ShutdownSummaryData): string {
  const highlights = data.tasks.filter((t) => t.is_highlight);
  const completed = data.tasks.filter((t) => t.status === "done");
  const incomplete = data.tasks.filter((t) => t.status !== "done");

  const formatTask = (
    t: (typeof data.tasks)[0],
    opts: { includeWorked?: boolean; includeProject?: boolean } = {}
  ): string => {
    const { includeWorked = true, includeProject = true } = opts;
    const parts = [`- ${t.title}`];
    if (includeProject && t.projectName) parts.push(`[${t.projectName}]`);
    if (includeWorked && t.workedMinutes > 0)
      parts.push(`(${t.workedMinutes}m worked)`);
    if (t.estimated_minutes)
      parts.push(`(est: ${t.estimated_minutes}m)`);
    return parts.join(" ");
  };

  const sections: string[] = [
    `Date: ${data.date}`,
    `Time: ${Math.round(data.workedMinutes)}m worked / ${data.plannedMinutes}m planned`,
  ];

  if (data.mood) sections.push(`Mood: ${data.mood}`);

  if (highlights.length > 0) {
    sections.push(
      `\nHighlights:\n${highlights.map((t) => formatTask(t)).join("\n")}`
    );
  }

  if (completed.length > 0) {
    // Group completed tasks by project so the model can emit a Done
    // section with each project as a sub-heading, tasks listed under.
    // Project name moves to the heading; we drop it from the per-task
    // lines via includeProject:false to avoid redundancy.
    const groups = new Map<string, typeof completed>();
    for (const t of completed) {
      const key = t.projectName ?? "(No project)";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(t);
    }
    const projectBlocks = Array.from(groups.entries())
      .map(([projectName, tasks]) => {
        const taskLines = tasks
          .map((t) => formatTask(t, { includeProject: false }))
          .join("\n");
        return `${projectName}:\n${taskLines}`;
      })
      .join("\n\n");
    sections.push(
      `\nCompleted (${completed.length}) — grouped by project:\n${projectBlocks}`
    );
  }

  if (incomplete.length > 0) {
    sections.push(
      `\nDid not finish (${incomplete.length}) — flat list:\n${incomplete
        .map((t) => formatTask(t, { includeWorked: false }))
        .join("\n")}`
    );
  }

  if (data.reflection) {
    sections.push(`\nReflection: ${data.reflection}`);
  }

  return (
    "Write a productivity summary for this day. Use the data below.\n\n" +
    "Structure (use these exact section labels, in this order):\n" +
    `1. Header: "Daily summary — ${data.date}"\n` +
    "2. \"Tasks completed today\" — group by project (project name as a " +
    "sub-heading, tasks listed under it).\n" +
    "3. \"Didn't get to\" — flat list of tasks not completed today, no " +
    "project grouping.\n\n" +
    sections.join("\n")
  );
}

export function buildPlanUserPrompt(data: PlanSummaryData): string {
  const formatTask = (t: (typeof data.tasks)[0]): string => {
    const parts = [`- ${t.title}`];
    if (t.projectName) parts.push(`[${t.projectName}]`);
    if (t.estimated_minutes) parts.push(`(${t.estimated_minutes}m)`);
    if (t.priority === "high" || t.priority === "urgent")
      parts.push(`⚡ ${t.priority}`);
    return parts.join(" ");
  };

  const sections: string[] = [
    `Date: ${data.date}`,
    `Hour budget: ${data.hourBudget}h`,
    `Total estimated: ${data.totalPlannedMinutes}m`,
  ];

  if (data.tasks.length > 0) {
    sections.push(
      `\nPlanned tasks (${data.tasks.length}):\n${data.tasks.map(formatTask).join("\n")}`
    );
  }

  if (data.notes) {
    sections.push(`\nDaily notes: ${data.notes}`);
  }

  return (
    "Write a plan overview for this day that I can share. Use the data below.\n\n" +
    sections.join("\n")
  );
}

export function buildWeeklySummaryUserPrompt(data: WeeklySummaryData): string {
  const sections: string[] = [
    `Week of: ${data.weekOf}`,
    `Total time: ${Math.round(data.totalWorkedMinutes)}m worked / ${data.totalPlannedMinutes}m planned`,
    `Tasks: ${data.completedCount} completed, ${data.incompleteCount} still open`,
  ];

  if (data.mood) sections.push(`Mood: ${data.mood}`);

  if (data.projects.length > 0) {
    const projectLines = data.projects.map((p) => {
      const parts = [`- ${p.name}`];
      parts.push(`(${p.completedCount} done, ${p.incompleteCount} open)`);
      if (p.workedMinutes > 0) parts.push(`— ${Math.round(p.workedMinutes)}m worked`);
      return parts.join(" ");
    });
    sections.push(`\nProject progress:\n${projectLines.join("\n")}`);
  }

  if (data.reflections) {
    sections.push(`\nReflection: ${data.reflections}`);
  }

  if (data.carryForward) {
    sections.push(`\nCarry forward: ${data.carryForward}`);
  }

  return (
    "Write a weekly productivity summary. Focus on overall project progress and themes, not individual tasks. Use the data below.\n\n" +
    sections.join("\n")
  );
}
