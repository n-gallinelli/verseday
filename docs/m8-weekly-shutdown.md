# M8 — Weekly Shutdown

## What was built
An end-of-week ritual page with four sections:

1. **Shutdown checklist** — Fetches default items from `shutdown_checklist_items` table (seeded in migration 1). Completion state stored in `localStorage` keyed by `verseday_shutdown_checklist_{weekStartDate}`. Progress counter shows "X of Y complete". Checklist is a ritual guide — ticking items is ephemeral, not persisted to DB.

2. **Week in review** — Two-column layout:
   - **Completed** — Tasks with `status === 'done'` scheduled Mon–Fri of the week. Shows project color dot, title (strikethrough), and estimate.
   - **Incomplete** — Tasks with `status !== 'done'`. Each has a "→ Next week" button that reschedules to next Monday via `updateTaskDateScheduled()`. "Carry all →" button in the column header does this in bulk. Carried tasks show "Moved" badge and italic styling.

3. **Reflections** — Textarea auto-saved to `weekly_shutdowns.reflections` with 600ms debounce. Uses ref-based week tracking to avoid stale closure.

4. **Carry forward notes** — Textarea auto-saved to `weekly_shutdowns.incomplete_items` with 600ms debounce. Free-form notes about loose ends for next week.

## Layout
- Single-column scrollable layout (max-width 720px, centered)
- Top bar: week nav with prev/next arrows, "This week" badge
- No left/right split — simpler than WeeklyPlanner since shutdown is a sequential ritual

## Files created
- `src/pages/WeeklyShutdown.tsx` — Main page
- `docs/m8-weekly-shutdown.md` — This file

## Files modified
- `src/types/index.ts` — Added `ShutdownChecklistItem` interface
- `src/db/queries.ts` — Added `getWeeklyShutdown`, `upsertWeeklyShutdown`, `getShutdownChecklistItems`
- `src/App.tsx` — Import WeeklyShutdown, replace PlaceholderPage

## No schema changes
- `weekly_shutdowns` table already exists with `reflections` and `incomplete_items` columns
- `shutdown_checklist_items` table already exists with seed data
- Checklist completion = localStorage (ephemeral ritual state, not worth a migration)

## Decisions
- **Checklist state in localStorage, not DB** — The checklist is a ritual guide, not critical data. Reflections and carry-forward notes (the valuable parts) persist to SQLite. Avoids needing a junction table or new column.
- **Carry forward = reschedule to next Monday** — Simple and concrete. The task moves to next week's Monday, visible immediately in the weekly planner.
- **No "undo carry"** — Once carried, the task is rescheduled. User can navigate to next week's planner to adjust.
- **Single-column layout** — Shutdown is a sequential ritual (checklist → review → reflect → carry forward), not a multi-panel workspace like the weekly planner.
- **Week in review uses Mon–Fri only** — Consistent with the weekly planner calendar.
