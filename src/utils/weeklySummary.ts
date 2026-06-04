// Weekly Summary → Claude-prompt export (pure core).
//
// Turns a week's completed work into (a) a grouped digest and (b) a
// Claude-ready prompt = audience preamble + digest, for clipboard paste into
// Claude Desktop. No API, no key, no network — the UI only copies text.
//
// Everything here is pure and unit-tested (weeklySummary.test.ts). The UI in
// WeeklyShutdown.tsx feeds it completed tasks + worked minutes + projects and
// copies the assembled prompt.

import { formatHoursMinutes } from "./format";
import { formatMonthDay } from "./dates";

export type SummaryAudience = "dan" | "cam";

// Minimal input shapes — structural subsets of Task / Project, so the UI can
// pass real tasks/projects straight through, and tests can build plain literals.
export interface SummaryTask {
  id: number;
  title: string;
  project_id: number | null;
}
export interface SummaryProject {
  id: number;
  name: string;
  description: string | null;
}

export interface DigestTask {
  title: string;
  workedMinutes: number;
}
export interface DigestGroup {
  /** project id, or null for the catch-all "No objective" group */
  projectId: number | null;
  name: string;
  goal: string | null; // Project.description — the "why"
  tasks: DigestTask[];
  totalMinutes: number;
  count: number;
}
export interface WeeklyDigest {
  startIso: string;
  endIso: string;
  groups: DigestGroup[];
  totalMinutes: number;
  totalCount: number;
  isEmpty: boolean;
}

const NO_OBJECTIVE = "No objective";

/**
 * Group a week's completed tasks by project/objective with worked-time totals.
 * The caller passes ALL projects including archived, so an archived objective
 * still groups under itself (archived ≠ unattributed). "No objective" is for a
 * genuinely null project_id (or the rare since-deleted project not in the map).
 * Groups are ordered by worked time (desc), ties by name; "No objective" always
 * sorts last. Tasks within a group sort by worked time (desc), ties by title.
 */
export function buildWeeklyDigest(args: {
  startIso: string;
  endIso: string;
  tasks: SummaryTask[];
  projects: SummaryProject[];
  workedByTaskId: Map<number, number>;
}): WeeklyDigest {
  const { startIso, endIso, tasks, projects, workedByTaskId } = args;
  const projById = new Map(projects.map((p) => [p.id, p]));

  // Bucket by a stable key: the real project id, or "none" for the catch-all.
  const buckets = new Map<number | "none", DigestGroup>();
  for (const t of tasks) {
    const proj = t.project_id != null ? projById.get(t.project_id) : undefined;
    const key: number | "none" = proj ? proj.id : "none";
    let g = buckets.get(key);
    if (!g) {
      g = {
        projectId: proj ? proj.id : null,
        name: proj ? proj.name : NO_OBJECTIVE,
        goal: proj ? proj.description : null,
        tasks: [],
        totalMinutes: 0,
        count: 0,
      };
      buckets.set(key, g);
    }
    const worked = workedByTaskId.get(t.id) ?? 0;
    g.tasks.push({ title: t.title, workedMinutes: worked });
    g.totalMinutes += worked;
    g.count += 1;
  }

  for (const g of buckets.values()) {
    g.tasks.sort((a, b) => b.workedMinutes - a.workedMinutes || a.title.localeCompare(b.title));
  }

  const groups = [...buckets.values()].sort((a, b) => {
    // "No objective" always last.
    const aNone = a.projectId === null;
    const bNone = b.projectId === null;
    if (aNone !== bNone) return aNone ? 1 : -1;
    return b.totalMinutes - a.totalMinutes || a.name.localeCompare(b.name);
  });

  const totalMinutes = groups.reduce((s, g) => s + g.totalMinutes, 0);
  const totalCount = groups.reduce((s, g) => s + g.count, 0);

  return { startIso, endIso, groups, totalMinutes, totalCount, isEmpty: totalCount === 0 };
}

/** "Week of Jun 2–Jun 8" */
export function formatWeekRange(startIso: string, endIso: string): string {
  return `Week of ${formatMonthDay(startIso)}–${formatMonthDay(endIso)}`;
}

/**
 * The human-readable digest body (the {DIGEST} embedded in the prompt). Empty
 * weeks render a single grounded line so the prompt still produces a graceful
 * "quiet week" note rather than inviting invention.
 */
export function formatDigest(digest: WeeklyDigest): string {
  const header = formatWeekRange(digest.startIso, digest.endIso);
  if (digest.isEmpty) {
    return `${header}\n\nNothing was completed this week.`;
  }
  const blocks = digest.groups.map((g) => {
    const heading = g.goal ? `## ${g.name} — ${g.goal}` : `## ${g.name}`;
    const bullets = g.tasks.map((t) => `- ${t.title} (${formatHoursMinutes(t.workedMinutes)})`).join("\n");
    const total = `Total: ${formatHoursMinutes(g.totalMinutes)} · ${g.count} ${g.count === 1 ? "task" : "tasks"}`;
    return `${heading}\n${bullets}\n${total}`;
  });
  const weekTotal = `Week total: ${formatHoursMinutes(digest.totalMinutes)} · ${digest.totalCount} ${
    digest.totalCount === 1 ? "task" : "tasks"
  }`;
  return `${header}\n\n${blocks.join("\n\n")}\n\n${weekTotal}`;
}

// ── Prompt wording (Nick tunes this) ────────────────────────────────────────
// Tone directives, not raw Enneagram labels.
export const AUDIENCE_DIRECTIVES: Record<SummaryAudience, string> = {
  dan: "for Dan — bottom-line impact and decisiveness; lead with outcomes and momentum, cut process detail, punchy and confident.",
  cam: "for Cam — visible achievement and reliable momentum; frame as wins delivered and progress you can count on, polished and positive.",
};

export const AUDIENCE_LABELS: Record<SummaryAudience, string> = { dan: "Dan", cam: "Cam" };

/** Builds the full prompt: preamble (with the audience directive) + the digest. */
export function buildPrompt(audience: SummaryAudience, digest: WeeklyDigest): string {
  const directive = AUDIENCE_DIRECTIVES[audience];
  return [
    `Write a weekly rundown of our efforts this week, ${directive} Tie what we completed back to the impact and the why — what each effort moved forward and why it matters. Keep it sharp and succinct. Ground everything strictly in the completed work below; do not invent metrics or overstate impact.`,
    "",
    "This week's completed work:",
    formatDigest(digest),
  ].join("\n");
}
