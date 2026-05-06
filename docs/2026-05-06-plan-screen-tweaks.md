# Plan screen tweaks + Dashboard y-axis fix — 2026-05-06

Branch: `feat/plan-screen-tweaks`

Six small, mostly-independent changes the user requested in one shot.
Grouping them in one branch because they all touch the Plan tab (with one
unrelated Dashboard tweak) and are individually too small to justify
separate review cycles.

## Changes

### 1. Day columns extend to the bottom of the Plan panel

**Problem:** Day columns (Mon–Fri) on the Plan tab are sized to their
content (button + minutes input + chip rail), so the drop target for
drag-to-schedule is short. Users want a generous, full-height column
to drop into.

**Change:**
- `PlanProjectPanel.tsx` — body becomes a flex column. The "Open tasks"
  block stays content-sized; the "Time per day" block grows to fill the
  remaining vertical space (`flex-1 min-h-0`).
- `PlanDayStrip.tsx` — the day-strip wrapper itself becomes
  `h-full flex` so the column wrappers stretch. Each `DayButton`'s
  outer (droppable) `<div>` becomes `flex flex-col` and stretches via
  `h-full`. The header button + minutes input + chip rail keep their
  natural size at the top; an empty growing region beneath them
  carries the rest of the droppable area.

**Tradeoff:** When a project has many tasks scheduled to one day, the
chip rail can grow tall and push the empty region away — that's fine,
the *whole column* is still droppable.

### 2. Auto-add task estimate to day commitment on drag

**Status:** mostly-existing — `PlanTab.handleScheduleTask` already
transfers minutes between days when a task has a non-null
`estimated_minutes`.

**Gap:** Tasks created via `PlanTaskList.NewTaskRow` are persisted with
`estimatedMinutes: null`. Dragging them onto a day was a no-op for the
day's commitment, which surprised the user.

**Change:** In `PlanTab.handleScheduleTask`, if the dragged task has a
null/zero estimate, persist a default 30 minutes on the task itself (via
`updateTask`) before applying the commitment math. The chip then shows
"30m", and any later move transfers those 30 minutes correctly.

**Why persist on the task (not just bump the day):** the commitment
shouldn't drift from the chip's own visible estimate. If we only nudged
the day, moving the same task again would silently re-add 30m without
the chip ever showing why.

**30 vs other defaults:** matches `DEFAULT_MINUTES` in `PlanDayStrip`
(the value used when toggling a day on with `1`–`5`), so the screen has
one consistent "starter slot" length.

### 3. "Done with this project" → "Next project"

**Change:** `PlanProjectPanel.tsx` footer button label only. Behavior
unchanged — still calls `onMarkPlanned` which advances to the next
unplanned project via `nextUnplannedAfter`.

### 4. New "Done planning the week" footer action

**Change:** Adds a right-aligned button to the unreviewed-state footer.
On click:

- Iterates remaining unreviewed projects (`!statuses.has(p.id)`).
- For each: if it has ≥1 day committed (`commitments.get(id)?.size > 0`),
  mark **planned**; otherwise mark **skipped**.
- Single batch through new `PlanTab.markRemainingProjects()` that uses
  the existing `setWeeklyPlanProjectStatus` query, then updates state.
- After: `setSelectedId(null)` → `PlanWeekSummary` renders.

Disabled when nothing is unreviewed.

**Why auto-skip instead of "must have committed days":** the button
needs to be one click. Forcing the user to manually skip empty
projects defeats the purpose. Days can still be edited later via the
week summary (clicking back into a project re-opens it).

### 5. Click chip on Plan screen → open task detail

**Change:**
- Lift detail-task state into `PlanTab` (`detailTask`, `setDetailTask`).
- Pipe `onOpenDetail` through `PlanProjectPanel` → `PlanDayStrip` →
  `ScheduledTaskChip`. Chip's wrapper gets a click handler.
- Render `<TaskDetailOverlay>` at the bottom of `PlanTab`'s tree, with
  `onSave` calling `updateTask` then `reloadTasks(selectedId)`.

**Drag still works:** `@dnd-kit/core`'s `PointerSensor` is configured
with `activationConstraint: { distance: 5 }` in `PlanTab.dndSensors`. A
plain click (no movement past 5px) doesn't fire drag, so the click
handler runs. A drag past 5px suppresses the click. This same pattern
is already used by the unscheduled task list above.

### 6. Dashboard bar chart y-axis = 7h

**Change:** `Dashboard.BarChart` — replace the auto-derived
`yAxisMax = Math.ceil(maxMinutes / 60)` with a constant `7`. Bars
already cap at 100% via `Math.min(...)`, so over-7h days render flush
to the top edge (acceptable; the user picked 7h as the standard
working day budget).

Y-axis labels become `[7, 6, 4, 2, 0]` — the loop steps `0, 2, 4, 6`,
appends `7` (since the last label didn't equal `yAxisMax`), then
reverses.

## Non-goals

- No DB migration.
- No changes to `PlanWeekSummary` itself; it just gets entered earlier
  via the new bulk-done flow.
- No changes to ScheduleTab.

## Verse review — round 1 resolution

- **B1 (blocker)** — Plan-tab `<TaskDetailOverlay>` previously got only
  `onClose` + `onSave`, leaving Toggle/Delete/Start-focus inert. Wired up:
  `onToggle` (uses `updateTaskStatus` + reloadTasks), `onDelete`
  (deleteTask + state filter + close overlay), `onStartFocus` (mirrors
  `ProjectDetail.handleStartFocus`; previousPage = `"weekly"`),
  `onSetWorkedMinutes` (matches ScheduleTab).
- **B2 (blocker)** — y-axis label list in this doc corrected to
  `[7, 6, 4, 2, 0]`.
- **A1** — `markRemainingProjects` now writes status to state inside
  the loop after each successful DB write, so a partial failure leaves
  UI/DB in sync and a retry resumes from where it stopped.
- **A2** — verified `PlanTaskList` has no internal `overflow`/`scroll`
  rules, so the outer `overflow-y-auto` on the Open-tasks block is the
  only scroll container in that region — no nesting. Comment updated
  to record the check.
- **A3** — dropped the dashed borders on day columns. Active days keep
  the 4% project-color tint as the at-rest hint; drag-over still gets
  the blue ring. Quieter at rest, just as legible mid-drag.

## Risk / rollback

All changes are scoped to view files (`PlanTab`, `PlanProjectPanel`,
`PlanDayStrip`, `PlanTaskList` is untouched, `Dashboard`). Rollback =
revert the branch. Data persisted by change #2 (defaulted estimates)
is safe — it's the same field set everywhere else, just defaulted.
