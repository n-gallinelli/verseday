import { describe, it, expect } from "vitest";
import {
  resolveCommitmentMarkers,
  type CommitmentMarkerRow,
  type MarkerTaskFacts,
} from "./queries";

// Approach A — the weekly_plan_commitments row is a MARKER linking a backing
// "General task" to a (project, day) slot. A marker is valid only while its task
// still sits at exactly that slot; otherwise it's stale and gets pruned, so a
// General task rescheduled/deleted elsewhere unbinds cleanly (the derived cell
// sum stays correct independently).
const WEEK = [
  "2026-06-15",
  "2026-06-16",
  "2026-06-17",
  "2026-06-18",
  "2026-06-19",
]; // Mon..Fri

const facts = (
  entries: [number, MarkerTaskFacts][]
): Map<number, MarkerTaskFacts> => new Map(entries);

describe("resolveCommitmentMarkers", () => {
  it("keeps a marker whose task sits at exactly its (project, day)", () => {
    const rows: CommitmentMarkerRow[] = [
      { project_id: 7, day_offset: 2, task_id: 100 }, // Wed
    ];
    const { markers, stale } = resolveCommitmentMarkers(
      rows,
      facts([[100, { project_id: 7, date_scheduled: "2026-06-17" }]]),
      WEEK
    );
    expect(markers.get(7)?.get(2)).toBe(100);
    expect(stale).toEqual([]);
  });

  it("prunes a marker whose task was rescheduled to another day (unbind)", () => {
    const rows: CommitmentMarkerRow[] = [
      { project_id: 7, day_offset: 2, task_id: 100 }, // row says Wed
    ];
    const { markers, stale } = resolveCommitmentMarkers(
      rows,
      facts([[100, { project_id: 7, date_scheduled: "2026-06-18" }]]), // task now Thu
      WEEK
    );
    expect(markers.get(7)).toBeUndefined();
    expect(stale).toEqual([{ project_id: 7, day_offset: 2 }]);
  });

  it("prunes a marker whose task left the week entirely (rollover)", () => {
    const rows: CommitmentMarkerRow[] = [
      { project_id: 7, day_offset: 2, task_id: 100 },
    ];
    const { markers, stale } = resolveCommitmentMarkers(
      rows,
      facts([[100, { project_id: 7, date_scheduled: "2026-06-24" }]]), // next week
      WEEK
    );
    expect(markers.size).toBe(0);
    expect(stale).toHaveLength(1);
  });

  it("prunes when the task's project changed", () => {
    const rows: CommitmentMarkerRow[] = [
      { project_id: 7, day_offset: 2, task_id: 100 },
    ];
    const { markers, stale } = resolveCommitmentMarkers(
      rows,
      facts([[100, { project_id: 9, date_scheduled: "2026-06-17" }]]),
      WEEK
    );
    expect(markers.size).toBe(0);
    expect(stale).toHaveLength(1);
  });

  it("prunes a null-link row (task deleted → ON DELETE SET NULL) and an unscheduled task", () => {
    const rows: CommitmentMarkerRow[] = [
      { project_id: 7, day_offset: 0, task_id: null }, // SET NULL'd
      { project_id: 7, day_offset: 1, task_id: 200 }, // task unscheduled
    ];
    const { markers, stale } = resolveCommitmentMarkers(
      rows,
      facts([[200, { project_id: 7, date_scheduled: null }]]),
      WEEK
    );
    expect(markers.size).toBe(0);
    expect(stale).toEqual([
      { project_id: 7, day_offset: 0 },
      { project_id: 7, day_offset: 1 },
    ]);
  });

  it("resolves several valid markers across projects/days", () => {
    const rows: CommitmentMarkerRow[] = [
      { project_id: 7, day_offset: 0, task_id: 100 },
      { project_id: 7, day_offset: 4, task_id: 101 },
      { project_id: 9, day_offset: 2, task_id: 102 },
    ];
    const { markers, stale } = resolveCommitmentMarkers(
      rows,
      facts([
        [100, { project_id: 7, date_scheduled: "2026-06-15" }],
        [101, { project_id: 7, date_scheduled: "2026-06-19" }],
        [102, { project_id: 9, date_scheduled: "2026-06-17" }],
      ]),
      WEEK
    );
    expect(markers.get(7)?.get(0)).toBe(100);
    expect(markers.get(7)?.get(4)).toBe(101);
    expect(markers.get(9)?.get(2)).toBe(102);
    expect(stale).toEqual([]);
  });
});
