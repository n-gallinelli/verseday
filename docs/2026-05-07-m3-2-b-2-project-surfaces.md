# M3.2.b.2 — Project surfaces wire-up (`Projects.tsx`, `ProjectDetail.tsx`)

**Status:** Awaiting Verse review
**Date:** 2026-05-07
**Author:** Terse
**Branch:** `refactor/m3-canonical-tasks`
**Predecessor:** M3.2.b.1 closed at `47ab541`; index-maintenance fix at `968cbcd` (Verse APPROVED).
**Type:** Second wire-up commit. Mirrors M3.2.b.1's pattern on the two project surfaces.

---

## Surface area

### `ProjectDetail.tsx`
- Local state `tasks: Task[]` (`useState` at :447) + `setTasks` mutations.
- Loaded via `getTasksForProject(selectedProjectId, showDone)` (:506, :527).
- Mutations: `setTaskStatusFromUI` (:831), `updateTask` (:889, :1281), `deleteTask` (:561, :915, :923), `updateTaskSortOrders` via drag-drop (:982-986), `updateTaskDateScheduled` via the calendar drag-drop pattern, `createTask` for project-scoped task creation.
- `verseday:task-updated/-deleted` listener (:576-580) calls `loadProjectData()`.

### `Projects.tsx`
- Local state `matchingTasks: Task[]` (:99) populated from `searchTasksByTitle(q)` (:151) on each keystroke.
- The search hits SQL (`SELECT * FROM tasks WHERE title LIKE $1 ... LIMIT 25`) and returns matches across the entire DB — including tasks not yet in the canonical map.
- `verseday:task-updated/-deleted` listener (:134-138) re-runs the search on remote changes.
- No mutations originate here — search results are click-to-open-detail.

---

## Design

### `ProjectDetail.tsx` — main task list

Mirror DailyPlanner's M3.2.b.1 pattern.

```tsx
const taskIds = useAppStore((s) => selectTaskIdsByProject(s, selectedProjectId));
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

`showDone` toggle becomes a **render-time filter** rather than a load-time arg:

```tsx
const visibleTasks = useMemo(
  () => (showDone ? tasks : tasks.filter((t) => t.status !== "done")),
  [tasks, showDone],
);
```

This requires loading **all** project tasks (including done) into the canonical map so the toggle works without re-querying. Implementation: `loadTasksForProject(projectId, includeDone = true)` is called once per project; the `includeDone` flag is dropped from the load call signature. The action passes `true` to the underlying `getTasksForProject(projectId, true)` SQL helper.

**Open question for Verse:** alternative is to keep `loadTasksForProject(projectId)` returning `includeDone = false` and add a separate `loadTasksForProjectIncludingDone` action. Cleaner separation, but doubles the SQL surface. The toggle-becomes-render-filter approach is what DailyPlanner does for status (the day's load returns everything; render filters). Going with that for consistency.

### `ProjectDetail.tsx` — mutation paths

| Action | Today | After M3.2.b.2 |
|---|---|---|
| Toggle status | `setTaskStatusFromUI(id, status)` | `setTaskStatus(id, status)` (store action) |
| Save edit | `updateTask({...})` (db) | `updateTask({...})` (store action) |
| Delete | `deleteTask(id)` (db) | `deleteTaskAction(id)` (store action) |
| Drag-drop reorder | optimistic `setTasks(reordered)` + `updateTaskSortOrders` | `updateTaskSortOrders` (db) + `loadTasksForProject(id)` refresh — same pattern as DailyPlanner's b.1 drag |
| Calendar drag (date assign) | `updateTask({...dateScheduled})` (db, in calendar-drag handler at :1281) | `updateTask({...})` (store action) — covers date moves cleanly via `withTaskMutated` |
| Create task | `createTask({...})` (db) | unchanged — direct DB then `loadTasksForProject` refresh |

Drag-drop reorder loses optimistic ordering in this commit (same trade-off as DailyPlanner b.1). dnd-kit's drop animation covers the brief gap.

### `Projects.tsx` — `matchingTasks`

The search needs to return tasks regardless of whether they're loaded into the canonical map. A pure full-scan over `tasksById` would only find tasks already loaded — a behavioral regression (tasks on dates/projects no screen has visited would be invisible to search).

**Hybrid approach:** keep the SQL query, store the results as IDs, render via `tasksById.get(id)`:

```tsx
const [matchingTaskIds, setMatchingTaskIds] = useState<number[]>([]);
const tasksById = useAppStore((s) => s.tasksById);

useEffect(() => {
  const q = searchQuery.trim();
  if (!q) {
    setMatchingTaskIds([]);
    return;
  }
  searchTasksByTitle(q)
    .then((results) => {
      cacheTasks(results); // primes canonical map
      setMatchingTaskIds(results.map((t) => t.id));
    })
    .catch(() => setMatchingTaskIds([]));
}, [searchQuery]);

const matchingTasks = useMemo(() => {
  const out: Task[] = [];
  for (const id of matchingTaskIds) {
    const t = tasksById.get(id);
    if (t) out.push(t);
  }
  return out;
}, [matchingTaskIds, tasksById]);
```

This mirrors DailyPlanner's sidebar pattern: cross-cutting query produces an ID list, render resolves via canonical map. A rename in the detail overlay flows back to `matchingTasks` via the `tasksById` subscription without re-querying SQL.

**Note re Verse's design suggestion:** Verse proposed "derive from `tasksById` via useMemo with the search-string filter" — pure full scan. I'm proposing the SQL-then-IDs hybrid because pure-memory scan would silently miss tasks not yet loaded by any screen. Open to swapping if Verse considers the limitation acceptable (and the simpler implementation a worthwhile trade-off).

### Both files — `verseday:task-*` listeners

Stay in place. Other screens still emit; M3.2.b.5 retires the bus.

---

## Sub-milestones

Single commit. Both files migrate together — they share the project-tasks domain and one is meaningless without the other for the cross-screen test.

If the diff balloons during implementation, I'll split into:
- M3.2.b.2.a — ProjectDetail
- M3.2.b.2.b — Projects search

Heads-up to Verse before splitting.

---

## Risks & concerns

1. **`loadTasksForProject` signature change.** Action currently calls `getTasksForProject(projectId)` with default `includeDone = false`. Design changes call to `getTasksForProject(projectId, true)`. Other callers (none yet) would also see this behavior shift. Acceptable — there are no other callers; ProjectDetail is the only consumer.

2. **Canonical map size growth.** Loading every project's tasks (including done) into `tasksById` is a one-time cost per project visit. SQL `LIMIT 500` caps the worst case. For users with many archived projects this could grow the map noticeably. Profiler check after b.4's per-row subscription lands; not blocking b.2.

3. **Search-result freshness.** Hybrid pattern means rename of a task that matched a recent search will re-render the search row immediately (canonical-map subscription). Search-string change re-runs the SQL query. Trade-off: a task whose title was renamed to suddenly NOT match the query will still appear in `matchingTaskIds` until the next search runs. Acceptable — matches today's behavior.

4. **Drag reorder loses optimism.** Same as b.1. dnd-kit's drop animation is the user-facing affordance during the DB roundtrip.

5. **No DB or schema change. No IPC. No security surface. Zero budget.**

---

## Cross-screen verification

Verse-required test that exercises `968cbcd`'s index propagation:

1. Open DailyPlanner for today.
2. Inline-edit a task's title (one whose `project_id` is non-null).
3. Navigate to that task's Project Detail page **for the first time this session**.
4. **Pass criteria:** the new title appears in ProjectDetail's task list without manual refresh.

The mechanism: DailyPlanner's `loadTasksForDate(today)` populated `tasksById` AND propagated to `taskIdsByProject[task.project_id]` (per `968cbcd`). The inline edit hit `updateTask` (store action) which patched `tasksById` directly. ProjectDetail subscribes to `selectTaskIdsByProject(state, selectedProjectId)` + `tasksById` → re-renders with the patched task. No `loadTasksForProject` call needed because the index is already populated.

If this test fails, suspect `968cbcd`'s propagation in `loadTasksForDate` or the new `selectTaskIdsByProject` subscription wiring.

Additional checks per file:

**ProjectDetail:**
- Toggle status on a task → list reorders, status persists across screen reload.
- Delete a task → vanishes from list immediately.
- Save inline edit → row updates in place.
- `showDone` toggle → completed tasks appear/hide without re-querying.
- Drag-drop reorder → new order persists across screen reload.
- Calendar drag a task to a date → date_scheduled updates; task appears in DailyPlanner for that date (cross-screen via canonical map).

**Projects:**
- Type a search query → matching tasks appear under matching projects.
- Click a search result → detail overlay opens.
- Rename the task in the detail overlay → search-result row re-renders with new title.

---

## Out of scope (deferred)

- Per-row TaskCard subscription (`taskId` prop) → M3.2.b.4.
- Retiring `cacheTasks` and the `verseday:task-*` bus → M3.2.b.5.
- The legacy SQL-direct paths (`updateTaskDateScheduled` for calendar drag, `createTask`, `updateTaskSortOrders`) → M3.2.b.5 retires them by routing through store actions.
- `workedMap: Map<number, number>` per-task time totals → M3.3.
- ESLint guardrail → M4.

---

## Constraints

- Branch: `refactor/m3-canonical-tasks`. Never main.
- No schema change, no migration. `/docs/migration-discipline.md` compliant by absence.
- No security surface, no new IPC, no new persisted secrets.
- Budget: zero.
- M1 + M2 + M3.1 + M3.2.a + M3.2.b.1 invariants preserved.

---

## Open questions for Verse

1. **`loadTasksForProject` `includeDone` default.** Going with `includeDone = true` (load all, filter at render). Alternative is a parameterized action signature. Preference?
2. **`Projects.tsx` search pattern.** Hybrid SQL → IDs → canonical (proposed) vs pure full-scan over `tasksById` (your suggestion). I read the latter as silently missing unloaded tasks; flagging for confirmation.
3. **Single commit vs split.** Default is single; willing to split into 2.a (ProjectDetail) + 2.b (Projects) if the diff is too large to review at once.
