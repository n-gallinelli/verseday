import { describe, it, expect } from "vitest";
import { withTaskMutated, withTaskInserted } from "./appStore";
import { mondayOfWeek } from "../utils/dates";
import type { Task } from "../types";

// P6 — rollover + calendar-sync reconcile invariants. Both flow through the
// pure index reducers: rolloverTasksAction reconciles each moved task via
// withTaskMutated (old date → today, or → null when expired); a synced
// calendar row lands via the normal insert (calendar tasks aren't templates,
// so they index by date). These pin "no stale bucket" + "calendar task is in
// the canonical indices, not just one screen's local list."

type S = Parameters<typeof withTaskMutated>[0];
const wk = (d: string) => mondayOfWeek(new Date(d + "T00:00:00"));

function task(over: Partial<Task> = {}): Task {
  return {
    id: 1, title: "T", project_id: null, date_scheduled: null,
    recurrence: null, recurrence_source_id: null, external_source: null, ...over,
  } as unknown as Task;
}

const PAST = "2026-05-26";
const TODAY = "2026-06-02";

describe("P6 rollover reconcile — leaves no stale bucket", () => {
  it("rolling past→today clears the old date+week buckets and populates today's", () => {
    const before = task({ id: 1, date_scheduled: PAST });
    const s = {
      tasksById: new Map<number, Task>([[1, before]]),
      taskIdsByDate: new Map([[PAST, [1]]]),
      taskIdsByWeek: new Map([[wk(PAST), [1]]]),
      taskIdsByProject: new Map(),
    } as unknown as S;
    const next = withTaskMutated(s, before, { ...before, date_scheduled: TODAY });
    expect(next.taskIdsByDate!.get(PAST) ?? []).not.toContain(1); // gone from old date
    expect(next.taskIdsByWeek!.get(wk(PAST)) ?? []).not.toContain(1); // gone from old week
    expect(next.taskIdsByDate!.get(TODAY)).toContain(1); // present today
    expect(next.taskIdsByWeek!.get(wk(TODAY))).toContain(1); // present in today's week
  });

  it("expiring a task (→ null) clears its date+week buckets entirely", () => {
    const before = task({ id: 2, date_scheduled: PAST });
    const s = {
      tasksById: new Map<number, Task>([[2, before]]),
      taskIdsByDate: new Map([[PAST, [2]]]),
      taskIdsByWeek: new Map([[wk(PAST), [2]]]),
      taskIdsByProject: new Map(),
    } as unknown as S;
    const next = withTaskMutated(s, before, { ...before, date_scheduled: null });
    expect(next.taskIdsByDate!.get(PAST) ?? []).not.toContain(2);
    expect(next.taskIdsByWeek!.get(wk(PAST)) ?? []).not.toContain(2);
  });
});

describe("P6 calendar sync — synced task lands in the canonical indices", () => {
  it("a calendar task (external_source set, recurrence null) indexes by its date", () => {
    const cal = task({ id: 9, date_scheduled: TODAY, external_source: "calendar" });
    const s = {
      tasksById: new Map<number, Task>(),
      taskIdsByDate: new Map(),
      taskIdsByWeek: new Map(),
      taskIdsByProject: new Map(),
    } as unknown as S;
    const next = withTaskInserted(s, cal);
    expect(next.tasksById!.get(9)).toBeTruthy(); // in tasksById
    expect(next.taskIdsByDate!.get(TODAY)).toContain(9); // in the date index
    expect(next.taskIdsByWeek!.get(wk(TODAY))).toContain(9);
  });
});
