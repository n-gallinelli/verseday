# M3.2.b.3 — Weekly + Shutdown surfaces wire-up

**Status:** Awaiting Verse review
**Date:** 2026-05-08
**Author:** Terse
**Branch:** `refactor/m3-canonical-tasks`
**Predecessor:** M3.2.b.2 closed at `ec294a7`. Cross-screen rename test PASS.
**Type:** Third wire-up commit. Migrates the four remaining (B)-class screens onto the canonical store.

---

## Surface area

Four files, with mixed loading patterns:

| File | State | Current loader | Migration shape |
|---|---|---|---|
| `weekly-plan/PlanTab.tsx:56` | `tasks: Task[]` | `getTasksForWeek(monday, friday)` | `selectTaskIdsByWeek` + `tasksById` |
| `weekly-plan/ScheduleTab.tsx:479` | `weekTasks: Task[]` | `getTasksForWeek(monday, friday)` | `selectTaskIdsByWeek` + `tasksById` |
| `weekly-plan/ScheduleTab.tsx:481` | `allProjectTasks: Task[]` | `getAllTasksForProjectIds([...])` | hybrid SQL → ID list → canonical (cross-cutting query) |
| `weekly-plan/ScheduleTab.tsx:485` | `unscheduledUnassigned: Task[]` | `getUnscheduledTasks()` | hybrid SQL → ID list → canonical (cross-cutting query) |
| `weekly-plan/ScheduleTab.tsx:487` | `activeDragTask: Task \| null` | local | **stays local** — transient drag UI |
| `DailyShutdown.tsx:56` | `tasks: Task[]` | `getTasksForDate(selectedDate)` | `selectTaskIdsByDate` + `tasksById` |
| `WeeklyShutdown.tsx:266` | `completedThisWeek: Task[]` | `getTasksCompletedInWeek(monday, friday)` | hybrid SQL → ID list → canonical (`completed_at`-based query) |

---

## Why three patterns instead of one

The canonical-map pattern (selector + memoized resolution) works for any list whose semantics match an existing secondary index. We have indices for `taskIdsByDate / ByProject / ByWeek`. Reads that filter on those keys can flow through selectors.

But three of the lists in this milestone don't fit:
- **`allProjectTasks`** in ScheduleTab loads tasks across multiple project IDs (every active project). No secondary index for "tasks across these N projects" — would need a new selector that walks `tasksById` filtering by `project_id IN [...]`. Acceptable for the rare drag-from-project-rail use, but less efficient than the hybrid.
- **`unscheduledUnassigned`** in ScheduleTab loads tasks where `date_scheduled IS NULL AND project_id IS NULL`. No index for the conjunction; full scan over `tasksById` works but doesn't include tasks no screen has loaded yet.
- **`completedThisWeek`** in WeeklyShutdown uses a query semantic based on `completed_at` (when the task was marked done) rather than `date_scheduled`. A task scheduled for week X but completed in week Y belongs to week Y's shutdown — `taskIdsByWeek` doesn't capture that.

For these three, the hybrid pattern (Projects.tsx search precedent): keep the SQL query, prime the canonical map via `cacheTasks`, store IDs locally, render-resolve via `tasksById`. Subscribers get reactive updates on rename/edit; the SQL query stays authoritative for membership.

---

## Design

### `weekly-plan/PlanTab.tsx`

Direct selector subscription pattern, mirroring DailyPlanner's b.1 and ProjectDetail's b.2.

```tsx
const taskIds = useAppStore((s) => selectTaskIdsByWeek(s, selectedWeek));
const tasksById = useAppStore((s) => s.tasksById);
const tasks = useMemo(() => {
  const out: Task[] = [];
  for (const id of taskIds) {
    const t = tasksById.get(id);
    if (t) out.push(t);
  }
  return out;
}, [taskIds, tasksById]);
```

`loadData` calls `loadTasksForWeek(selectedWeek)`. Mutations:
- `updateTask` (db) → `updateTask` (store action) at the two existing call sites.
- `deleteTask` (db) → `deleteTaskAction` at the existing call site.

Direct-DB paths that stay (b.5 retirement): none expected — PlanTab's mutations are status, edit, delete only. Confirm during implementation.

### `weekly-plan/ScheduleTab.tsx`

Three lists, three patterns:

**`weekTasks`** — direct selector pattern (same as PlanTab):
```tsx
const weekTaskIds = useAppStore((s) => selectTaskIdsByWeek(s, selectedWeek));
const weekTasks = useMemo(/* resolve via tasksById */, [weekTaskIds, tasksById]);
```

**`allProjectTasks`** — hybrid pattern. The query (`getAllTasksForProjectIds`) takes a project ID array and returns all their tasks. Used for the "drag tasks from any project into the week grid" feature.

```tsx
const [allProjectTaskIds, setAllProjectTaskIds] = useState<number[]>([]);
// In loadData:
const t = await getAllTasksForProjectIds(activeProjectIds);
cacheTasks(t);
setAllProjectTaskIds(t.map((x) => x.id));
// Rendered via memo + tasksById.get(id)
```

**`unscheduledUnassigned`** — hybrid pattern. Same shape as `allProjectTasks`.

**`activeDragTask`** — stays as `useState<Task | null>`. This is transient drag-preview state (the chip following the cursor); not durable task data, not a candidate for canonical store. The Verse rev-2 audit flagged it as B-class but on inspection it's pure UI ephemera. Leaving local is correct.

Mutations:
- `setTaskStatusFromUI` → `setTaskStatus` (store action) at the toggle site.
- `deleteTask` (db) → `deleteTaskAction` at the existing call site.
- `getTasksForWeek` calls embedded in mutation handlers (post-action refresh) → `loadTasksForWeek(selectedWeek)`.

The drag-drop date assignment path uses `updateTaskDateScheduled` (db direct) followed by a refetch. Stays as-is for b.3; b.5 routes through a store action.

### `DailyShutdown.tsx`

Direct selector pattern. The migration is small — `tasks: Task[]` is the only list state, no mutations originate from this screen (DailyShutdown is read-mostly with a separate `is_highlight` toggle path).

```tsx
const dayTaskIds = useAppStore((s) => selectTaskIdsByDate(s, selectedDate));
const tasks = useMemo(/* resolve via tasksById */, [dayTaskIds, tasksById]);
```

`loadData` calls `loadTasksForDate(selectedDate)`. The `setHighlightIds` derivation runs from `tasks` (filtered by `is_highlight`) — re-evaluates on every render of the memo, which is correct.

`is_highlight` toggle: keeps its existing direct DB query (separate concern from canonical map task data). M3.5 cleanup territory if we want to move it; out of scope here.

### `WeeklyShutdown.tsx`

Hybrid pattern because of the `completed_at`-based query semantic.

```tsx
const [completedTaskIds, setCompletedTaskIds] = useState<number[]>([]);
// In loadData:
const completed = await getTasksCompletedInWeek(monday, friday);
cacheTasks(completed);
setCompletedTaskIds(completed.map((t) => t.id));
const completedThisWeek = useMemo(/* resolve via tasksById */, [completedTaskIds, tasksById]);
```

A rename of a task in the detail overlay flows back to the WeeklyShutdown row immediately (via the `tasksById` subscription). A task whose `status` flips to/from `done` mid-shutdown WON'T add/remove itself from the list until the next loadData refresh — same as today's behavior.

No mutations originate from WeeklyShutdown.

---

## Sub-milestones

Single commit covering all four files. Diff estimate: similar to b.2's 116-insert / 54-delete shape.

If the diff balloons during implementation, split:
- M3.2.b.3.a — PlanTab + ScheduleTab (the weekly tab pair)
- M3.2.b.3.b — DailyShutdown + WeeklyShutdown

Heads-up to Verse before splitting.

---

## Risks & concerns

1. **`taskIdsByWeek` propagation correctness** — confirmed by 968cbcd. After a rename in DailyPlanner's inline edit, PlanTab subscribed to `selectTaskIdsByWeek(today's-week)` should re-render with the new title. Same cross-screen test shape as b.2.

2. **`allProjectTasks` size.** `getAllTasksForProjectIds(activeProjectIds)` could return many tasks for a user with lots of projects. SQL has `LIMIT 500`. The hybrid pattern caps in-memory storage at the SQL limit. Profiler check after b.4 if it becomes a hotspot.

3. **`unscheduledUnassigned` and `allProjectTasks` overlap.** Both can include the same task (an unscheduled, unassigned task is in both lists). Render dedupes on display (different sections, no shared rows). After my migration, the same task shows up in both `allProjectTaskIds` and `unscheduledUnassignedIds` — `tasksById.get(id)` returns the same Task ref to both consumers. Acceptable.

4. **`is_highlight` toggle on DailyShutdown** is the only mutation that doesn't flow through the canonical-task-data API. It mutates a single column directly. The detail-overlay host's `verseday:task-updated` broadcast covers consistency; the toggle's own emit is the existing pattern. Out of scope for b.3; M3.5 cleanup decides whether to consolidate.

5. **`activeDragTask` was on rev-2's lift list.** Defending the keep-local decision: it's set on `handleDragStart`, cleared on `handleDragEnd`, lives only during the drag gesture, drives only the `<DragOverlay>` chip. Lifting to store would create cross-screen visibility for what is purely a single-component UI state. No.

6. **No DB or schema change. No IPC. No security surface. Zero budget.**

---

## Cross-screen verification

Same Verse-required test as b.2, expanded:

1. **Rename in DailyPlanner inline edit → ScheduleTab task chip updates.**
   - Edit a task scheduled for a date in the current week.
   - Navigate to Weekly Plan → Schedule.
   - Pass: the chip in the day cell shows the new title without manual refresh.
   - This exercises 968cbcd's `loadTasksForDate` propagating to `taskIdsByWeek`.

2. **Rename in DailyPlanner inline edit → PlanTab list updates.**
   - Same setup. Navigate to Weekly Plan → Plan.
   - Pass: the row in the plan list shows the new title.

3. **Rename in DailyPlanner → DailyShutdown row updates.**
   - Edit a task scheduled for a date already in past or current shutdown window.
   - Navigate to Daily Shutdown for that date.
   - Pass: the row title updates without refresh.

4. **Mark a task done on DailyPlanner → WeeklyShutdown's `completedThisWeek` shows it.**
   - This tests the hybrid pattern. The `setTaskStatusAction` updates `tasksById` to status="done", but `completedTaskIds` is set by the SQL query result. After a status change, WeeklyShutdown needs to refetch via the `verseday:task-updated` listener — which it has.
   - Pass: navigate to WeeklyShutdown for the current week, the task appears in completed list.

5. **Per-file checks:**
   - PlanTab: edit a row inline → saves, list re-renders with new title. Delete a row → vanishes. Status toggle → reflected.
   - ScheduleTab: drag a task to a day → date_scheduled updates. Status toggle on a chip → reflected.
   - DailyShutdown: navigate to past dates → tasks load. Highlight toggle → still works.
   - WeeklyShutdown: navigate to past weeks → completed lists load.

---

## Out of scope (deferred)

- Per-row TaskCard subscription (`taskId` prop) → M3.2.b.4.
- Retiring `cacheTasks` and the `verseday:task-*` bus → M3.2.b.5.
- Legacy SQL-direct paths (`updateTaskDateScheduled` in ScheduleTab drag, `is_highlight` toggle) → M3.2.b.5 retires SQL-direct date paths; `is_highlight` may stay or move in M3.5.
- `workedPerTask` time totals in DailyShutdown / WeeklyShutdown → M3.3.
- ESLint guardrail → M4.

---

## Constraints

- Branch: `refactor/m3-canonical-tasks`. Never main.
- No schema change, no migration. `/docs/migration-discipline.md` compliant by absence.
- No security surface, no new IPC, no new persisted secrets.
- Budget: zero.
- All prior milestone invariants preserved.

---

## Open questions for Verse

1. **`activeDragTask` keep-local rationale.** Confirming the rev-2 audit's B-class flag was incorrect on closer look. Acceptable to defend locally?
2. **`is_highlight` toggle path.** Out of scope for b.3; flag for M3.5 review or leave as a permanent direct-DB toggle.
3. **Single commit vs split.** Default single. Split into `b.3.a` (PlanTab + ScheduleTab) and `b.3.b` (DailyShutdown + WeeklyShutdown) only if the diff balloons — heads-up before splitting.
4. **`completedThisWeek` reactivity edge case.** A task whose status flips from done → todo mid-shutdown view stays in the rendered list until the next refresh (the ID is in `completedTaskIds` until refetch). Acceptable, matches today's behavior, b.5 closes this when the bus retires.
