# Daily screen — rail row click-split + fixed-width date label

**Author:** Terse
**Date:** 2026-07-10
**Status:** Verse-APPROVED (plan review), committed on `feat/daily-rail-open-and-date-arrow-width`
**Scope:** `src/pages/DailyPlanner.tsx` only. Presentational — no store/schema/logic.

## Change A — right-rail "Add to today" rows: split click targets
Previously the row title added the task to the day and a hover chevron opened
details. Inverted per Nick's request:
- **Title** (always visible) → `openTaskDetail(task.id)`. Tooltip now "Open details".
- **Add button** → `pullTaskToDay(task.id)`, reusing the blue "Add to {label}" pill.
- **Undo** (10s window) → real `<button>` calling `undoPull`.
- Removed the open-details chevron and its vestigial `stopPropagation`.
- Applied identically to the project-grouped section and the
  "Unscheduled & overdue" section.

### Decision — add button is PINNED (always-visible), not hover-revealed
Verse's recommendation, taken: add-to-day is now the rail's promoted primary
action and the rail's whole purpose is adding, so hiding it behind hover would
invert the visual priority (only titles visible at a glance). Counter-argument
(an always-on blue pill per row is noisier) is real but acceptable; hover-reveal
was correct only while add was secondary. **Undo is also always-visible** — a
time-boxed 10s reversal must never hide behind hover (Verse must-fix).

## Change B — date-nav arrows stop jumping
`formatDayHeader` uses `weekday: "long"`, so the `<h2>` label width varied by day
and pushed the next/prev arrows + Jump-to pill sideways when paging. Fix: fixed
`w-[156px] text-center` label. Width measured against the widest possible header
("Wednesday, May 30" = 145.3px at Figtree Variable 500/16px) with a small buffer,
no clipping. The day-column slide/fade animation is on `dayColumnRef`, not the
label, so it's unaffected.

## Verification
- `tsc --noEmit` + `vite build` clean.
- Label width font-measured (Figtree) across all 84 weekday×month combinations.
- Eyes-on owed at reinstall: title opens detail, add button adds, Undo visible
  without hover during the 10s window; page Mon↔Wed↔Fri and confirm arrows hold.
