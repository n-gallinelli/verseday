# Weekly Plan — unified header

Branch: `polish/shutdown-alignment-spacing` (continuing)

## Problem
Weekly Plan stacked two header rows: a centered Plan/Schedule tab toggle
(in `WeeklyPlanner`) and a per-tab week-nav row (compact in `PlanTab`,
hero-style in `ScheduleTab`). Two rows of vertical space for what's
conceptually one header.

## Decision
Lift the week navigator into `WeeklyPlanner` so it sits on the **same
line** as the tab toggle. Adopted PlanTab's compact pattern (← → arrows
+ "Mon DD – Mon DD" label + "this week" pill / "Jump to this week"
link) — that's the styling the user said reads best.

Layout: `[arrows] [date] [pill]  …  [Plan|Schedule]` (toggle pushed
right with `ml-auto`).

## Files
- `src/pages/WeeklyPlanner.tsx` — added `formatWeekLabel` helper, wired
  `selectedWeek`/`setSelectedWeek` from store, owns `changeWeek` and
  `isThisWeek`. `TabToggle` collapsed to just the pill (outer row
  centering moved to the unified container).
- `src/pages/weekly-plan/PlanTab.tsx` — deleted the duplicate
  week-nav block + `formatWeekLabel` + `changeWeek`. Removed
  now-unused `localDateIso`/`mondayOfWeek` imports.
- `src/pages/weekly-plan/ScheduleTab.tsx` — deleted the hero header
  (22px title + nav row), `formatWeekHeader`, `changeWeek`,
  `isThisWeek`, `getMondayOfWeek` import, and `setSelectedWeek` from
  the destructure. Kept the **Planned Xh** stat as a thin right-aligned
  line above the body — it's schedule-specific and didn't belong in
  the shared header.

## Verification
- `tsc --noEmit` clean.
- Manual: arrows + jump + pill all behave as before, just on the same
  row as the tab toggle. Switching tabs preserves selected week.
