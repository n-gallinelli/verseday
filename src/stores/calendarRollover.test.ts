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
    id: 1, title: "T", project_id: null, date_scheduled: null, sort_order: 0,
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

// ── Ordered index insertion: new tasks land in sort_order position ──────────
// The daily/project/week lists render in raw index-array order, so the array
// must stay ordered the way loadTasksFor* (ORDER BY ... sort_order) would build
// it. createTask gives a new row sort_order = MIN(existing) - 1 (→ top);
// recurring instances are 999 (→ bottom); calendar imports are 0.
describe("withTaskInserted keeps buckets in sort_order order", () => {
  // A date bucket pre-populated at sort_order 0, 2, 4 (ids 10, 11, 12).
  function seeded(): S {
    const t10 = task({ id: 10, date_scheduled: TODAY, sort_order: 0 });
    const t11 = task({ id: 11, date_scheduled: TODAY, sort_order: 2 });
    const t12 = task({ id: 12, date_scheduled: TODAY, sort_order: 4 });
    return {
      tasksById: new Map<number, Task>([[10, t10], [11, t11], [12, t12]]),
      taskIdsByDate: new Map([[TODAY, [10, 11, 12]]]),
      taskIdsByWeek: new Map([[wk(TODAY), [10, 11, 12]]]),
      taskIdsByProject: new Map(),
    } as unknown as S;
  }

  it("a new task (sort_order = MIN-1) lands at the FRONT of the day", () => {
    const next = withTaskInserted(seeded(), task({ id: 20, date_scheduled: TODAY, sort_order: -1 }));
    expect(next.taskIdsByDate!.get(TODAY)).toEqual([20, 10, 11, 12]);
  });

  it("a recurring instance (sort_order 999) lands LAST", () => {
    const next = withTaskInserted(seeded(), task({ id: 21, date_scheduled: TODAY, sort_order: 999 }));
    expect(next.taskIdsByDate!.get(TODAY)).toEqual([10, 11, 12, 21]);
  });

  it("a calendar import (sort_order 0) lands among the zeros, NOT last", () => {
    const next = withTaskInserted(seeded(), task({ id: 22, date_scheduled: TODAY, sort_order: 0, external_source: "calendar" }));
    // Ties land after the existing 0 (stable), still ahead of sort_order>0.
    expect(next.taskIdsByDate!.get(TODAY)).toEqual([10, 22, 11, 12]);
  });

  it("a mid sort_order splices into the middle", () => {
    const next = withTaskInserted(seeded(), task({ id: 23, date_scheduled: TODAY, sort_order: 3 }));
    expect(next.taskIdsByDate!.get(TODAY)).toEqual([10, 11, 23, 12]);
  });

  it("WEEK bucket orders by (date, sort_order) — a later-date negative sort does NOT jump ahead of an earlier date", () => {
    const mon = "2026-06-01"; // Monday
    const wed = "2026-06-03";
    const t30 = task({ id: 30, date_scheduled: mon, sort_order: 0 });
    const t31 = task({ id: 31, date_scheduled: wed, sort_order: 0 });
    const s = {
      tasksById: new Map<number, Task>([[30, t30], [31, t31]]),
      taskIdsByDate: new Map([[mon, [30]], [wed, [31]]]),
      taskIdsByWeek: new Map([[wk(mon), [30, 31]]]),
      taskIdsByProject: new Map(),
    } as unknown as S;
    // New Wednesday task at sort_order -1: front of WED, but still after MON.
    const next = withTaskInserted(s, task({ id: 32, date_scheduled: wed, sort_order: -1 }));
    expect(next.taskIdsByWeek!.get(wk(mon))).toEqual([30, 32, 31]); // NOT [32, 30, 31]
  });

  it("missing-from-map ids sort to the end (no NaN compare)", () => {
    // id 99 is in the index array but absent from tasksById (transient gap).
    const s = {
      tasksById: new Map<number, Task>(),
      taskIdsByDate: new Map([[TODAY, [99]]]),
      taskIdsByWeek: new Map([[wk(TODAY), [99]]]),
      taskIdsByProject: new Map(),
    } as unknown as S;
    const next = withTaskInserted(s, task({ id: 50, date_scheduled: TODAY, sort_order: 5 }));
    // 50 (real key) sorts ahead of 99 (missing → +∞); no throw / NaN.
    expect(next.taskIdsByDate!.get(TODAY)).toEqual([50, 99]);
  });
});

// ── Moves must also land in sort_order position (withTaskMutated) ────────────
describe("withTaskMutated reschedules into sort_order position", () => {
  it("a task rescheduled into a populated day lands by sort_order, not appended", () => {
    const t40 = task({ id: 40, date_scheduled: TODAY, sort_order: 0 });
    const t41 = task({ id: 41, date_scheduled: TODAY, sort_order: 2 });
    // 42 lives on PAST with sort_order 1; reschedule keeps that sort_order.
    const before = task({ id: 42, date_scheduled: PAST, sort_order: 1 });
    const s = {
      tasksById: new Map<number, Task>([[40, t40], [41, t41], [42, before]]),
      taskIdsByDate: new Map([[TODAY, [40, 41]], [PAST, [42]]]),
      taskIdsByWeek: new Map([[wk(TODAY), [40, 41]], [wk(PAST), [42]]]),
      taskIdsByProject: new Map(),
    } as unknown as S;
    const next = withTaskMutated(s, before, { ...before, date_scheduled: TODAY });
    expect(next.taskIdsByDate!.get(TODAY)).toEqual([40, 42, 41]); // spliced, not [40,41,42]
    expect(next.taskIdsByDate!.get(PAST) ?? []).not.toContain(42); // left old bucket
  });
});
