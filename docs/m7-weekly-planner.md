# M7 — Weekly Planner

## What was built
A week-at-a-glance planning view with:
- **Week navigation** — prev/next week arrows, "This week" badge, "Today" jump button
- **Focus areas** — free-text textarea auto-saved via upsert to `weekly_plans` table
- **7-day columns** (Mon–Sun) — each shows tasks scheduled for that day with compact task cards
- **Cross-day drag-and-drop** — move tasks between day columns or to/from the unscheduled pool
- **Quick-add per day** — inline input at the bottom of each day column
- **Unscheduled tasks pool** — collapsible section showing tasks with no `date_scheduled`, filterable by project, limited to 50 results
- **Weekly notes** — collapsible textarea, auto-saved alongside focus areas
- **Per-day planned hours** — shown under each day header
- **Week total** — displayed in the header bar

## Verse review adjustments addressed

### 1. Cross-day drag-and-drop (multi-container @dnd-kit)
Used `DndContext` + `DragOverlay` + `useDroppable` for each container (7 day columns + unscheduled pool). Each column has its own `SortableContext`. Drag state tracks which container the item is over via `overContainerRef`. On `dragEnd`, the task's `date_scheduled` is updated to match the target container. This is the proper multi-container pattern, not the single-list pattern from DailyPlanner.

### 2. Compact WeeklyTaskCard (decoupled from useSortable)
Created `WeeklyTaskCard` — a new compact component that does NOT call `useSortable` internally. It shows: checkbox, priority dot, project dot, truncated title, and estimate. No drag handle, no Edit/Del/Start/Notes buttons. A separate `SortableTask` wrapper in WeeklyPlanner handles the dnd-kit integration. The `isDragOverlay` prop adds shadow + rotation for the drag preview.

### 3. getUnscheduledTasks() scoped and limited
- `LIMIT 50` on the query
- Includes tasks with `project_id IS NULL`
- Filterable by project via dropdown in the unscheduled section header
- Default shows all projects

### 4. Break time fix (M6 must-fix #3)
- **Migration 3**: Added `break_seconds INTEGER NOT NULL DEFAULT 0` to `time_entries`
- **stopTimeEntry()**: Now accepts optional `breakSeconds` param, persists to DB
- **FocusMode**: Passes `totalBreakTimeRef.current / 1000` on stop/done
- **getTotalWorkedMinutes()**: Subtracts `break_seconds / 60.0` from elapsed time
- **getWorkedMinutesForWeek()**: Same subtraction, grouped by `date_scheduled`

## Files created
- `src/pages/WeeklyPlanner.tsx` — main page (470+ lines)
- `src/components/WeeklyTaskCard.tsx` — compact task card
- `docs/m7-weekly-planner.md` — this file

## Files modified
- `src-tauri/src/lib.rs` — migration 3 (break_seconds)
- `src/db/queries.ts` — weekly plan queries, break_seconds in stopTimeEntry/getTotalWorkedMinutes, updateTaskDateScheduled
- `src/stores/appStore.ts` — selectedWeek + setSelectedWeek + mondayOfWeek helper
- `src/App.tsx` — import WeeklyPlanner, replace PlaceholderPage
- `src/pages/FocusMode.tsx` — pass break seconds on stop/done

## Decisions
- **No within-column reorder on weekly view** — moving between days is the primary interaction; within-day reorder is deferred to the daily planner
- **Quick-add creates with no project/priority** — keeps it fast; user can edit in daily planner
- **Unscheduled pool uses flex-wrap, not columns** — horizontal layout makes better use of the wide space under the 7 columns
- **Week anchored to Monday** — consistent with ISO 8601
