import { describe, it, expect } from "vitest";
import { bucketWorkedByLocalDay } from "./queries";
import { localDateIso } from "../utils/dates";

// #7 — worked-minutes must bucket by the LOCAL calendar day, not the UTC
// instant of start_time. start_times are built from local wall-clock times so
// these assertions are tz-independent (the local day round-trips through the
// UTC instant; the OLD `date(start_time)` SQL would split an evening session
// onto the next UTC day east of UTC).
const at = (y: number, mo: number, d: number, h: number, mi: number) =>
  new Date(y, mo - 1, d, h, mi, 0).toISOString();

describe("#7 worked-minutes local-day bucketing", () => {
  it("buckets a late-evening session on its LOCAL day, not the UTC next-day", () => {
    const rows = [{ start_time: at(2026, 6, 2, 22, 30), worked_seconds: 1800 }]; // Jun 2, 10:30pm local
    const out = bucketWorkedByLocalDay(rows);
    expect(out).toEqual([{ date: "2026-06-02", minutes: 30 }]);
    expect(out[0].date).toBe(localDateIso(new Date(rows[0].start_time)));
  });

  it("sums entries on the same local day (incl. late-night) and splits across days", () => {
    const rows = [
      { start_time: at(2026, 6, 2, 9, 0), worked_seconds: 600 }, // Jun 2 morning
      { start_time: at(2026, 6, 2, 23, 0), worked_seconds: 1200 }, // Jun 2 late night (local)
      { start_time: at(2026, 6, 3, 8, 0), worked_seconds: 300 }, // Jun 3 morning
    ];
    expect(bucketWorkedByLocalDay(rows)).toEqual([
      { date: "2026-06-02", minutes: 30 }, // 600 + 1200 = 1800s = 30m, both on Jun 2 local
      { date: "2026-06-03", minutes: 5 }, // 300s = 5m
    ]);
  });

  it("drops sub-minute days (rounds to 0)", () => {
    expect(bucketWorkedByLocalDay([{ start_time: at(2026, 6, 2, 12, 0), worked_seconds: 20 }])).toEqual([]);
  });
});
