import { describe, it, expect } from "vitest";
import { reduceProjectDeleted, selectActiveObjectiveOptions } from "./appStore";
import type { Project, Task } from "../types";

// Canonical project model invariants (P3). The delete-orphan sweep is the
// exact divergence the canonical-data audit flagged: deleting a project must
// clear project_id on its tasks (mirroring the DB's ON DELETE SET NULL) and
// drop them from taskIdsByProject — no task left pointing at a dead project.
// Pure reducers/selectors are tested directly; the minimal state is cast to
// the selector/reducer's param type (they only read the maps below).

type ReducerState = Parameters<typeof reduceProjectDeleted>[0];

function proj(id: number, name: string, over: Partial<Project> = {}): Project {
  return {
    id, name, color: "#8aa5c4", archived: 0, description: null,
    start_date: null, target_date: null, notes: null, sort_order: null,
    completed: 0, priority: 0, icon: null, custom_icon_id: null,
    created_at: "2026-01-01T00:00:00Z", ...over,
  };
}
function task(id: number, projectId: number | null): Task {
  return { id, project_id: projectId, date_scheduled: null } as unknown as Task;
}

describe("P3 delete-orphan sweep (reduceProjectDeleted)", () => {
  it("removes the project and clears project_id on ITS tasks only", () => {
    const state = {
      projectsById: new Map<number, Project>([
        [1, proj(1, "Alpha")],
        [2, proj(2, "Beta")],
      ]),
      tasksById: new Map<number, Task>([
        [10, task(10, 1)],
        [11, task(11, 1)],
        [12, task(12, 2)],
      ]),
      taskIdsByProject: new Map<number, number[]>([
        [1, [10, 11]],
        [2, [12]],
      ]),
      taskIdsByDate: new Map(),
      taskIdsByWeek: new Map(),
    } as unknown as ReducerState;

    const next = reduceProjectDeleted(state, 1);

    // project 1 gone, project 2 intact
    expect(next.projectsById!.has(1)).toBe(false);
    expect(next.projectsById!.has(2)).toBe(true);
    // project 1's tasks orphaned (project_id null); project 2's task untouched
    expect(next.tasksById!.get(10)!.project_id).toBeNull();
    expect(next.tasksById!.get(11)!.project_id).toBeNull();
    expect(next.tasksById!.get(12)!.project_id).toBe(2);
    // taskIdsByProject no longer lists the orphaned tasks under project 1;
    // project 2's slice is intact
    expect(next.taskIdsByProject!.get(1) ?? []).not.toContain(10);
    expect(next.taskIdsByProject!.get(1) ?? []).not.toContain(11);
    expect(next.taskIdsByProject!.get(2)).toEqual([12]);
  });

  it("is a no-op on projects with no tasks (and a missing project)", () => {
    const state = {
      projectsById: new Map<number, Project>([[1, proj(1, "Alpha")]]),
      tasksById: new Map<number, Task>(),
      taskIdsByProject: new Map<number, number[]>(),
      taskIdsByDate: new Map(),
      taskIdsByWeek: new Map(),
    } as unknown as ReducerState;

    expect(reduceProjectDeleted(state, 1).projectsById!.has(1)).toBe(false);
    // deleting an id not in the map: project map unchanged, no throw
    expect(reduceProjectDeleted(state, 999).projectsById!.has(1)).toBe(true);
  });
});

describe("P3 selectActiveObjectiveOptions parity", () => {
  const state = {
    projectsById: new Map<number, Project>([
      [1, proj(1, "Zebra")],
      [2, proj(2, "Apple")],
      [3, proj(3, "Done", { completed: 1 })],
      [4, proj(4, "Archived", { archived: 1 })],
    ]),
  } as unknown as ReducerState;

  it("returns active (archived=0 && !completed), name-sorted", () => {
    const out = selectActiveObjectiveOptions(state, "");
    expect(out.map((p) => p.id)).toEqual([2, 1]); // Apple before Zebra; Done+Archived excluded
  });

  it("retains the current selection even if completed/archived", () => {
    const out = selectActiveObjectiveOptions(state, "3"); // a completed project
    expect(out.map((p) => p.id)).toEqual([2, 1, 3]); // active first, current appended
  });
});
