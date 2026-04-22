# Unfinished Task Rollover

## Date
2026-03-25

## Summary
Tasks that aren't finished automatically roll forward to the next day, for up to 4 consecutive days. After that they get unscheduled. A dedicated sidebar section shows all rolling tasks.

## Rollover behavior
- When the daily planner loads **for today only**, `rolloverUnfinishedTasks()` runs before fetching tasks
- Any task scheduled before today that isn't done and has `rollover_count < 4` gets moved to today
- `original_date` is set on first rollover (preserves where the task was originally scheduled)
- `rollover_count` increments each day the task rolls
- On the 5th missed day (`rollover_count >= 4`), the task is unscheduled (`date_scheduled = null`) and falls into the existing Unscheduled bucket
- Recurring task instances are excluded from rollover (`recurrence_source_id IS NULL`)
- Rollover does NOT fire when navigating to past/future dates — only for today

## Unfinished Tasks sidebar section
- Always visible in the right panel of the daily planner, positioned at ~66% down (flex spacer above)
- Powered by `getUnfinishedRolloverTasks()` — a dedicated query fetching all undone tasks with `rollover_count` 1–4, regardless of current `date_scheduled`
- Shows task names with amber day badge (e.g. "2d") indicating how long the task has been rolling
- Count badge in the section header when tasks exist
- Expanded by default
- Clickable — opens the task detail overlay
- When empty, shows "All caught up"
- Sits above the existing Unscheduled section

## Schema
Migration v11 adds to `tasks`:
- `original_date TEXT` — the date the task was first scheduled before any rollovers
- `rollover_count INTEGER NOT NULL DEFAULT 0` — how many days the task has been rolled forward

## Files changed
- `src-tauri/src/lib.rs` — migration v11
- `src/types/index.ts` — added `original_date` and `rollover_count` to Task interface
- `src/db/queries.ts` — added `rolloverUnfinishedTasks()` and `getUnfinishedRolloverTasks()`
- `src/pages/DailyPlanner.tsx` — rollover call in loadData (guarded to today), unfinished sidebar section, state management
