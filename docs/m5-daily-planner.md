# M5: Daily Planner Enhancements — Decision Log

## Decisions
- Drag-to-reorder uses @dnd-kit (lightweight, zero-cost, MIT license) with optimistic UI updates
- Sort order persisted to DB immediately after drag — reverts on failure
- Hour budget is editable inline (click the number to edit, Enter/Escape to save/cancel)
- Budget validated: 0.5–24 hours, step 0.5
- Daily notes section is collapsible (hidden by default to keep planner focused)
- TaskCard extracted as standalone component with drag handle (braille dots ⠿)
- Priority dot changed to rounded-sm (square-ish) to distinguish from round project dot (Verse #4)
- createTask and updateTask refactored to object params (Verse #3)
- Added validatePriority() and validateTaskStatus() (Verse #1)
- Objective dropdown filters by selected project (Verse #2)
- Project change resets objective selection to prevent cross-links

## What was built
- Drag-to-reorder tasks with @dnd-kit (PointerSensor, 5px activation distance)
- Inline editable hour budget with validation
- Collapsible daily notes section with save button
- TaskCard component extracted from DailyPlanner
- updateTaskSortOrders query for batch sort order updates
- Verse M4 fixes: validators, object params, filtered objectives

## What's next
- M6: Pomodoro timer + start/stop tracking + daily time worked stat
