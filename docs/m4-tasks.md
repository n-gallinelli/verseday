# M4: Tasks CRUD — Decision Log

## Decisions
- Tasks now have full CRUD from the Daily Planner (edit, delete, not just add/toggle)
- Priority system: low/medium/high/urgent with color-coded dots
- Tasks link to both projects AND objectives
- Notes field on tasks (expandable inline, same pattern as objectives)
- Delete confirmation shows task title and warns about time entry cascade
- Cmd+Enter to save from edit mode, Escape to cancel (textareas need Cmd+Enter since Enter inserts newline)
- Create form expanded to two rows: title+estimate+add on top, project/objective/priority selectors below
- Edit and delete states reset on date navigation

## What was built
- Full task editing: title, project, objective, estimate, priority, notes
- Task deletion with confirmation and time entry cascade warning
- Priority dot (color-coded) displayed on each task card
- Objective name displayed on task cards (truncated with tooltip)
- Expandable notes per task
- New queries: updateTask, deleteTask
- createTask expanded with objectiveId, priority, notes params

## Verse M3 fixes also applied
- Safety comment on dynamic SQL builder in getObjectives
- Objectives require completion before deletion (matches project pattern)
- deleteInfo and editingId reset on filter changes in Objectives page

## What's next
- M5: Daily Planner enhancements — drag to reorder, hour budget editing, daily notes
