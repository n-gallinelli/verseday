import { describe, it, expect } from "vitest";
import { withTaskMutated, selectTemplates } from "./appStore";
import type { Task } from "../types";

// P4 template index transition. A task becoming a recurring TEMPLATE
// (recurrence set, recurrence_source_id null — and the DB nulls date_scheduled)
// must drop out of EVERY list index (date/week/project), even though only
// `recurrence` changed; ceasing must put it back. This is the index-design
// invariant Verse gated the design on. withTaskMutated is the pure reducer.

type MutState = Parameters<typeof withTaskMutated>[0];

function task(over: Partial<Task> = {}): Task {
  return {
    id: 1, title: "T", project_id: null, date_scheduled: null,
    recurrence: null, recurrence_source_id: null, ...over,
  } as unknown as Task;
}

function baseState(t: Task): MutState {
  // A normal task (id 1) scheduled on a date + assigned to project 5, present
  // in all three indices; plus a sibling (id 2, project 5) so we can see the
  // index slice keeps the sibling.
  return {
    tasksById: new Map<number, Task>([[1, t], [2, { ...task({}), id: 2, project_id: 5 } as Task]]),
    taskIdsByDate: new Map([["2026-06-02", [1]]]),
    taskIdsByWeek: new Map([["2026-06-01", [1]]]),
    taskIdsByProject: new Map([[5, [1, 2]]]),
  } as unknown as MutState;
}

describe("P4 template index transition (withTaskMutated)", () => {
  const normal = { ...task({}), id: 1, project_id: 5, date_scheduled: "2026-06-02" } as Task;

  it("becoming a template drops it from date/week/project indices (sibling kept)", () => {
    const s = baseState(normal);
    // DB nulls date_scheduled when recurrence is set; project_id stays.
    const tmpl = { ...normal, recurrence: "FREQ=DAILY", date_scheduled: null } as Task;
    const next = withTaskMutated(s, normal, tmpl);

    expect(next.taskIdsByDate!.get("2026-06-02") ?? []).not.toContain(1);
    expect(next.taskIdsByWeek!.get("2026-06-01") ?? []).not.toContain(1);
    expect(next.taskIdsByProject!.get(5) ?? []).not.toContain(1); // pollution prevented
    expect(next.taskIdsByProject!.get(5)).toContain(2); // sibling untouched
    // still in the map, now surfaced as a template
    const after = { ...s, ...next } as MutState;
    expect(selectTemplates(after).map((t) => t.id)).toContain(1);
  });

  it("ceasing to be a template re-enters the project index", () => {
    // Start from a template (recurrence set, not in indices), then clear it.
    const tmpl = { ...task({}), id: 1, project_id: 5, recurrence: "FREQ=DAILY", date_scheduled: null } as Task;
    const s = {
      tasksById: new Map<number, Task>([[1, tmpl]]),
      taskIdsByDate: new Map(),
      taskIdsByWeek: new Map(),
      taskIdsByProject: new Map(), // template not indexed
    } as unknown as MutState;
    const revived = { ...tmpl, recurrence: null } as Task; // project_id 5 retained, still no date
    const next = withTaskMutated(s, tmpl, revived);

    expect(next.taskIdsByProject!.get(5) ?? []).toContain(1); // back in the project index
    const after = { ...s, ...next } as MutState;
    expect(selectTemplates(after).map((t) => t.id)).not.toContain(1); // no longer a template
  });
});
