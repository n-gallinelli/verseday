# M3.2.b.5 — Final cleanup: retire `cacheTasks`, the `verseday:task-*` bus, and SQL-direct mutation paths

**Status:** Awaiting Verse review
**Date:** 2026-05-08
**Author:** Terse
**Branch:** `refactor/m3-canonical-tasks`
**Predecessor:** M3.2.b.4 closed at `3a7f422` (Verse APPROVED).
**Type:** Largest M3 milestone by surface area. Three retirements in one atomic cleanup, on top of three new store actions added in an additive seam.

---

## What this milestone retires

1. **`cacheTasks` action and all callers.** Every screen that primed the canonical map via `cacheTasks(...)` now uses the appropriate store action (`loadTasksFor*`, `insertTask`, `updateTask`, etc.). The action declaration in `appStore.ts` deletes.

2. **`verseday:task-updated` and `verseday:task-deleted` bus.** Every `addEventListener` block across the migrated screens deletes. The two `dispatchEvent` calls in `TaskDetailOverlayHost` delete. The host's `refreshCache(id)` helper deletes (store actions already update the canonical map).

3. **Legacy SQL-direct mutation paths in screens:**
   - `pullTaskToDay` / `undoPull` (DailyPlanner) — date mutations through new store action.
   - `updateTaskDateScheduled` direct call in ScheduleTab drag-end — same.
   - `updateTaskSortOrders` direct calls in DailyPlanner + ProjectDetail drag-end — through new store action.
   - `createTask` direct calls (DailyPlanner quick-add, ScheduleTab `handleCreateForDate`, ProjectDetail, PlanTab) — through new store action that wraps SQL + canonical map insert.

4. **`TaskDetailOverlayHost`'s five SQL-direct mutation handlers.** The host has not yet been migrated through M3.2.b.1–b.4 — its five handlers still call db/queries functions directly:
   - `handleSave` → `updateTask` (db) → migrate to store `updateTask`
   - `handleToggle` → `setTaskStatusFromUI` (db) → migrate to store `setTaskStatus`
   - `handleDelete` → `deleteTask` (db) → migrate to store `deleteTaskAction`
   - `handleSetWorkedMinutes` → `setManualWorkedMinutes` (db) → migrate to store `setTaskWorkedMinutesAction`
   - `handleStartFocus` → `startTimeEntry` + `startFocus` (no task-data mutation; no migration needed)

   The host is the central mutation hub. Missing it would leave a major SQL-direct path live after b.5 supposedly retires them.

5. **Project-rail dup-flicker race (deferred from `47ab541`).** Closes naturally because all date mutations now route through `withTaskMutated`, which writes `tasksById` and the affected secondary indices atomically. The `sidebarUnscheduled`-bucket-filter race window goes away.

---

## What this milestone preserves

- `verseday:task-status-changed` (different event from -updated/-deleted). FocusMode listens for cross-surface auto-stop on done. Stays.
- The hybrid pattern (Projects search, ScheduleTab `allProjectTasks` / `unscheduledUnassigned`, WeeklyShutdown `completedThisWeek`). SQL stays authoritative for membership; bucket-filter memos stay.
- `loadData` calls inside post-mutation flows for non-canonical state (project stats, day summary, etc.). Those refresh non-task data; the task-data refresh now flows through canonical-map subscriptions automatically.

---

## New store actions (b.5.a — additive seam)

Three new actions land in a single additive commit. No callers wired yet; the cutover commit (b.5.b) wires them.

### `setTaskDateScheduled(id, date)`

```ts
setTaskDateScheduled: (id: number, date: string | null) => Promise<void>;
```

Wraps `updateTaskDateScheduled` SQL + `withTaskMutated` for canonical map + index transitions atomically. Failure path mirrors `updateTask`: refetch via `getTaskById`, write truth back, `console.error` with debug context.

Replaces all four current SQL-direct date-mutation call sites (DailyPlanner pull/undo, ScheduleTab drag-end).

### `setTaskSortOrders(bucket, orderedIds)` — bucket-explicit

```ts
setTaskSortOrders: (
  bucket:
    | { kind: "date"; date: string }
    | { kind: "project"; projectId: number },
  orderedIds: number[],
) => Promise<void>;
```

**Per Verse clarification:** bucket parameter is explicit, not inferred from task fields. The caller already has both pieces (it just did `arrayMove(...)` to compute `orderedIds` for a specific bucket); inference would be brittle.

Action body:
1. Build the SQL update payload internally: `orderedIds.map((id, i) => ({ id, sortOrder: i }))`.
2. Call `updateTaskSortOrders` SQL.
3. Update each affected task's `sort_order` field in `tasksById` (so per-row subscribers see the new order).
4. Replace the relevant secondary index slice (`taskIdsByDate[date]` or `taskIdsByProject[projectId]`) with `orderedIds`.
5. Failure path: refetch the bucket via `loadTasksForDate(date)` or `loadTasksForProject(projectId)`. The load action's primary-slice replacement restores SQL truth.

Replaces DailyPlanner + ProjectDetail drag-end calls.

### `createTaskAction(input) → Promise<number>`

```ts
createTaskAction: (input: CreateTaskInput) => Promise<number>;
```

**Per Verse clarification:** return-valued-with-side-effects is the right shape. Mirrors `stopFocus(): Page` precedent (side effect + return). Quick-add and drag-create both need the new id immediately. Don't over-engineer with a `lastCreatedTaskId` store field or callback wiring.

Action body:
1. Call `createTask` SQL — returns the new id.
2. Fetch the new row via `getTaskById(id)`.
3. Apply `withTaskInserted(state, task)` — writes `tasksById` and propagates to date/project/week indices.
4. Return the id.
5. Failure path: SQL error rejects; caller's catch fires. No optimistic write to roll back since the row didn't get into the canonical map.

Replaces DailyPlanner `handleAddTask`, ScheduleTab `handleCreateForDate`, ProjectDetail task creation, PlanTab task creation.

---

## b.5.b — Cutover scope

### Screen migrations (mutation paths)

| File | Direct call → Store action |
|---|---|
| `DailyPlanner.tsx` `handleAddTask` | `createTask` → `createTaskAction` |
| `DailyPlanner.tsx` `pullTaskToDay` / `undoPull` | `updateTaskDateScheduled` → `setTaskDateScheduled` |
| `DailyPlanner.tsx` `handleDragEnd` | `updateTaskSortOrders` → `setTaskSortOrders({ kind: "date", date: selectedDate }, ...)` |
| `DailyPlanner.tsx` `toggleTask` (the wasDone sort-order bump) | `updateTaskSortOrders` → `setTaskSortOrders` |
| `ProjectDetail.tsx` task creation | `createTask` → `createTaskAction` |
| `ProjectDetail.tsx` `handleDragEnd` | `updateTaskSortOrders` → `setTaskSortOrders({ kind: "project", projectId: selectedProjectId }, ...)` |
| `ProjectDetail.tsx` calendar-drag (`onSetDate`) | `updateTaskDateScheduled` → `setTaskDateScheduled` |
| `weekly-plan/PlanTab.tsx` `handleAddTask` | `createTask` → `createTaskAction` |
| `weekly-plan/PlanTab.tsx` `handleScheduleTask` | already routes through store `updateTask` post-b.3 — confirm no leftover `updateTaskDateScheduled` |
| `weekly-plan/ScheduleTab.tsx` `handleCreateForDate` | `createTask` → `createTaskAction` |
| `weekly-plan/ScheduleTab.tsx` `handleDragEnd` | `updateTaskDateScheduled` → `setTaskDateScheduled` |
| `weekly-plan/ScheduleTab.tsx` `undoMove` | `updateTaskDateScheduled` → `setTaskDateScheduled` |

### `TaskDetailOverlayHost.tsx` — central mutation hub migration

**This is the single largest deletion in b.5.b** — the host has not been migrated yet. Five handlers, four of which mutate task data:

| Handler | Direct call → Store action |
|---|---|
| `handleSave(updates)` | `updateTask(updates)` (db) → `updateTask(updates)` (store) |
| `handleToggle(t)` | `setTaskStatusFromUI(t.id, nextStatus)` → `setTaskStatus(t.id, nextStatus)` |
| `handleDelete(taskId)` | `deleteTask(taskId)` (db) → `deleteTaskAction(taskId)` |
| `handleSetWorkedMinutes(id, minutes)` | `setManualWorkedMinutes(id, minutes)` → `setTaskWorkedMinutesAction(id, minutes)` |
| `handleStartFocus(t)` | unchanged — `startTimeEntry` + `startFocus`. No task-data mutation. |

After migration, the host's `refreshCache(id)` helper has no callers and deletes. The two `dispatchEvent` calls (`verseday:task-updated`, `verseday:task-deleted`) delete because store actions already wrote to canonical map; subscribers re-render via `tasksById` reactivity.

### Bus retirement

Six screens drop their `addEventListener` blocks:
- `DailyPlanner.tsx`
- `ProjectDetail.tsx`
- `Projects.tsx`
- `weekly-plan/PlanTab.tsx`
- `weekly-plan/ScheduleTab.tsx`
- `DailyShutdown.tsx`
- `WeeklyShutdown.tsx`

(That's 7. Counting `Projects.tsx` and the two weekly-plan tabs as separate files, with `WeeklyShutdown.tsx` also clearing its listener for the same reason.)

The `loadData` callback inside each listener stays as a function in the file (some are still called in other places, e.g. on date change). What goes is the `addEventListener`/`removeEventListener` plumbing.

The two `dispatchEvent` calls in `TaskDetailOverlayHost` delete (covered above).

### `cacheTasks` retirement

Every remaining caller flips to a store action:
- Hybrid-pattern primes (`Projects.tsx` search results, `ScheduleTab.tsx` `allProjectTasks` / `unscheduledUnassigned`, `WeeklyShutdown.tsx` `completedThisWeek`) — these still need to prime canonical map after their SQL queries return. Either keep `cacheTasks` as a tiny utility for hybrid primes (renamed for clarity, e.g. `primeTasks`) OR add an exported helper `primeCanonicalTasks(tasks: Task[])` that uses `withTaskInserted` semantics.
- DailyPlanner sidebar (`getSidebarTasks` results) — same hybrid case; same primer.
- DailyPlanner `pendingDetailTask` consumption — replace with the store's `insertTask` (already added in M3.2.a) since we have the full task.

**Decision (heads-up to Verse):** keep a `primeCanonicalTasks` helper for the hybrid pattern. Rename `cacheTasks` → `primeCanonicalTasks` to make its purpose explicit. The hybrid-pattern callers stay; the legacy "I'm a screen migrating that primes the cache while keeping local state" callers go away. Cleaner than deleting and re-introducing under a different name. *Open to alternative: delete `cacheTasks` entirely and have hybrid primes write to canonical via a new dedicated `primeHybridTasks` action.*

The `cacheTasks` declaration may end up renamed rather than fully deleted depending on Verse's call.

After cutover: `git grep "cacheTasks"` returns zero hits in `src/` (or only the renamed action's declaration).

---

## Sub-milestones

**Two commits:**

### b.5.a — Additive seam
- Add `setTaskDateScheduled`, `setTaskSortOrders`, `createTaskAction` to `appStore.ts`.
- Each with explicit failure-path doc comments (Verse req from M3.2.a).
- No screen changes. No callers wired yet.
- Verify: tsc clean, build clean. App boots. Existing flows unchanged because the new actions are dormant.
- **Stop. Verse review.**

### b.5.b — Cutover + retirement
- Migrate all SQL-direct mutation sites to the new store actions (12 screen sites + 4 host handlers).
- Drop 6+ `verseday:task-updated/-deleted` listener blocks.
- Drop 2 `dispatchEvent` calls + the `refreshCache` helper in `TaskDetailOverlayHost`.
- Drop or rename `cacheTasks` (decision pending Verse).
- Verify (autonomous): grep gates listed in the test plan below all return zero hits.
- **Stop. Verse review.**

---

## Risks & concerns

1. **`setTaskSortOrders` index-slice replacement under a stale view.** If the user reorders day X's tasks while the canonical map's `taskIdsByDate[X]` was last loaded under different filtering (e.g. before a task moved INTO day X via another path), the action's slice replacement might exclude tasks that are SQL-truth-visible but absent from `orderedIds`. Mitigation: `setTaskSortOrders` only writes the slice the caller specified. The caller passes `orderedIds` as the COMPLETE ordered list for the bucket — same shape DailyPlanner / ProjectDetail use today. If the caller's list is incomplete, that's a pre-existing bug, not introduced here.

2. **`createTaskAction`'s post-insert `getTaskById` round-trip.** Adds one DB read on every task creation (vs. today's just-the-INSERT). Fast (indexed PK lookup, sub-millisecond on local SQLite), but worth flagging. Alternative: have the action receive the new task struct via SQL `RETURNING *`, but that requires touching the SQL helper. Sticking with the round-trip — small cost, no helper change.

3. **`TaskDetailOverlayHost` is now mid-tier complexity.** Today it owns inline handlers + DOM dispatches; post-b.5 it's purely action-call orchestration. Removing the `refreshCache` helper is satisfying — its job (keep canonical map in sync) is now the action's responsibility. Net simpler.

4. **`cacheTasks` rename vs delete.** Open question for Verse (above). Either is defensible. Renaming is less code churn (callers don't change, just the action name); deleting forces hybrid-primes to use a different action which is more explicit but more invasive.

5. **Bus listener removal — non-task-data refresh paths.** Some screens use the verseday bus to refresh non-task data (project stats, daily-plan totals, etc.). Audit during b.5.b: confirm that the listener's `loadData` call covers ONLY task-data refetch (in which case removal is safe — canonical reactivity covers it) OR that non-task data refetch needs to move to a different trigger (e.g. focus-on-mount, route change, etc.).

6. **No DB or schema change. No IPC. No security surface. Zero budget.**

---

## Test plan

### Static checks (autonomous after b.5.b)

- `git grep "verseday:task-updated\|verseday:task-deleted" src/` — zero hits.
- `git grep "addEventListener.*verseday:task-" src/` — zero hits.
- `git grep "from.*db/queries.*deleteTask\|setTaskStatusFromUI\|updateTaskDateScheduled\|updateTaskSortOrders\|setManualWorkedMinutes" src/pages/ src/components/` — zero hits (the SQL helpers stay in `db/queries.ts` but no screen/component imports them directly).
- `git grep "cacheTasks" src/` — zero hits if deleted; one declaration site if renamed to `primeCanonicalTasks`.
- `git grep "createTask\b" src/pages/ src/components/` — zero hits (callers use `createTaskAction`).
- tsc clean, vite build clean.

### Runtime correctness (reasoned from code)

- Every mutation flows through a store action that updates `tasksById` and the appropriate indices atomically.
- Subscribers (every migrated screen + TaskCard) receive the canonical update via Zustand reactivity.
- No bus event = no double refetch, no double-render.

### M3 capstone (manual, but minimum-friction)

After b.5.b lands, one full sweep across the app to confirm M3 ships clean:

1. **Rename a task in detail overlay.** Visible in: DailyPlanner main + sidebar, ProjectDetail list, ScheduleTab calendar chip, PlanTab project rail, DailyShutdown row, WeeklyShutdown row (if completed). All update without manual refresh.
2. **Status flip via row checkbox** (DailyPlanner). Other screens reflect the new status (where they show that task).
3. **Delete via detail overlay.** Row vanishes from every screen showing it.
4. **Drag-reorder** (DailyPlanner main list, ProjectDetail). New order persists.
5. **Drag-to-day** (ScheduleTab, PlanTab project rail). Date_scheduled updates; task moves on the calendar.
6. **Pull-to-day** (DailyPlanner sidebar / project rail / backlog rail). Task lands on the selected date.
7. **Quick-add** (DailyPlanner top input, ScheduleTab day cell, ProjectDetail). New task appears immediately.
8. **Project-rail dup-flicker fix** (Verse-deferred from `47ab541`). After pull, the row appears in the project rail's recent-state styling ONCE. No duplicate. The architectural payoff finally surfaces.

If anything in 1–8 fails, that's the bug to fix before merging M3.

---

## Out of scope (parked for M3.5)

- `is_highlight` toggle on DailyShutdown — currently direct-DB; either consolidate into a store action or accept the divergence permanently.
- `closeOrphanedTimeEntries` ordering vs `restoreFocus` — call-order audit.
- Dead `handleStopFocus` in DailyPlanner — confirm unreferenced after b.5; delete.
- `verseday:task-status-changed` event — kept, FocusMode-specific cross-surface auto-stop. Possible consolidation into a `selectFocusedTask().status === "done"` subscription, but that's a separate concern.

---

## Constraints

- Branch: `refactor/m3-canonical-tasks`. Never main.
- No DB or schema change, no migration.
- No security surface, no new IPC, no new persisted secrets.
- Budget: zero.
- All prior milestone invariants preserved. After b.5.b, the canonical store is the single mutation surface for task data; the bus is gone for task-data; SQL-direct paths in screens are gone.

---

## Open question for Verse

**`cacheTasks` rename vs delete.** Renaming to `primeCanonicalTasks` keeps the hybrid-pattern primes' API stable (caller passes the SQL result, action writes to `tasksById`); deleting forces hybrid primes through a different action (e.g. `insertTask` per row, or a new `primeHybridTasks`). Renaming is less invasive; deleting forces every prime path through the same action shape as the load* actions. Mild preference for renaming — less code churn, makes the hybrid pattern's "I'm priming, not loading" intent explicit.

Open to either — flag direction for b.5.b implementation.
