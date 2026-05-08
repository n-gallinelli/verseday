# M3.2 — Canonical `tasksById` + retire `tasksByIdCache`

**Status:** Awaiting Verse review
**Date:** 2026-05-07
**Author:** Terse
**Branch:** `refactor/m3-canonical-tasks`
**Predecessor:** M3.1 (singleton overlays) closed at `7c2d820`. The branch name was always pointed at this milestone.
**Type:** The largest milestone of the entity-as-truth refactor. Lifts task data from per-screen `useState<Task[]>` to a store-owned canonical `Map<number, Task>`, retires the M1 transitional `tasksByIdCache`, and gives `TaskCard` per-row store subscriptions so a single-task mutation re-renders only the affected row.

---

## Why this milestone exists

Today, eight screens maintain their own `useState<Task[]>` (or equivalent — see audit). When the user renames a task in `TaskDetailOverlay`, the host writes to the DB and broadcasts `verseday:task-updated`; every screen with a listener refetches its full task list and rebuilds. That works but it's:

- **Wasteful:** every list rebuilds even though only one row changed.
- **Fragile:** screens that forget the listener silently drift. Drag-drop, quick-add, status toggles all need to re-query or risk staleness.
- **Spread out:** the source-of-truth concept is split — DB is durable truth, but in-memory truth is duplicated across N independent caches that converge on a custom event bus.

After M3.2 the store owns `tasksById: Map<number, Task>`. Every screen reads via selectors. A mutation updates one map entry; subscribers re-render automatically; the `verseday:task-*` event bus retires.

This is the milestone the original entity plan (`docs/2026-05-07-task-as-entity-plan.md` rev 2 §3) named M3.2, and it's the one that validates M1's selector pattern at scale.

---

## Surface area

### Per-screen task state today

Eight screens, ten relevant `useState` declarations:

| File | Local state | Notes |
|---|---|---|
| `DailyPlanner.tsx:80` | `tasks: Task[]` | The day's planned tasks |
| `DailyPlanner.tsx:147–149` | `sidebarUnscheduled / sidebarOverdue / unfinishedTasks: Task[]` | Sidebar buckets |
| `ProjectDetail.tsx:447` | `tasks: Task[]` | Tasks for the open project |
| `DailyShutdown.tsx:56` | `tasks: Task[]` | Tasks worked-on this day |
| `WeeklyShutdown.tsx:266` | `completedThisWeek: Task[]` | Completed-this-week roster |
| `Projects.tsx:99` | `matchingTasks: Task[]` | Search results in the project picker |
| `weekly-plan/PlanTab.tsx:56` | `tasks: Task[]` | Week's commitment list |
| `weekly-plan/ScheduleTab.tsx:479–485` | `weekTasks / allProjectTasks / unscheduledUnassigned / activeDragTask: Task[] / Task \| null` | Drag-drop schedule grid |

Plus the M1 transitional `tasksByIdCache: Map<number, Task>` in the store, which is currently primed by `cacheTasks(...)` calls scattered across these screens (and by `TaskDetailOverlayHost` on cache miss).

### Cross-screen sync today

Every screen above (except `Projects.tsx`'s search list — which doesn't subscribe) registers two listeners:

```ts
window.addEventListener("verseday:task-updated", refresh);
window.addEventListener("verseday:task-deleted", refresh);
```

…and `refresh` re-fetches the screen's full task slice from SQL. `TaskDetailOverlayHost` dispatches both events from `handleSave`, `handleToggle`, `handleSetWorkedMinutes`, `handleStartFocus`, `handleDelete`. Six listener registrations + dispatch from one centralized host = the current convergence story.

---

## What M3.2 retires

After this milestone, the following are gone:

1. **`tasksByIdCache: Map<number, Task>` in `appStore.ts`** — replaced by canonical `tasksById`.
2. **`cacheTasks(tasks: Task[])` action** — replaced by the new task-loading actions which write to `tasksById` directly.
3. **`verseday:task-updated` / `verseday:task-deleted` window event bus** — replaced by Zustand subscriptions. Six `addEventListener` blocks deleted; one event emitter site in `TaskDetailOverlayHost` deleted.
4. **All per-screen `useState<Task[]>` (and equivalents) listed above** — replaced by selector-based reads from `tasksById`.

---

## Design

### Store changes (`src/stores/appStore.ts`)

#### Canonical map + secondary indices

```ts
interface AppState {
  // ... existing fields ...

  /** Canonical store-owned task map. Replaces tasksByIdCache (M1
   *  transitional). Single source of truth for task data in-memory;
   *  DB is durable truth, this is the live mirror. */
  tasksById: Map<number, Task>;

  /** Secondary index: task IDs grouped by ISO date the task is scheduled
   *  for (NULL date_assigned tasks are NOT in this index). Maintained by
   *  loadTasksForDate / updateTask / deleteTask. */
  taskIdsByDate: Map<string, number[]>;

  /** Secondary index: task IDs grouped by project_id (NULL project tasks
   *  go under the synthetic key 0, but parents that need them filter in
   *  selectors). Maintained by loadTasksForProject / updateTask / deleteTask. */
  taskIdsByProject: Map<number, number[]>;

  /** Secondary index: task IDs grouped by ISO Monday of the week the
   *  task is scheduled in. Tasks span dates → derive on load using the
   *  same Monday rule the queries use. Used by ScheduleTab + PlanTab. */
  taskIdsByWeek: Map<string, number[]>;
}
```

**Why secondary indices?** The plan rev 2 spec'd `selectTaskIdsByDate(state, date)`. A function-args selector in Zustand subscribes the entire component to the *full state*, then re-derives. For a list of N tasks across M dates that's O(N) on every store change — fine for a few hundred tasks, expensive at thousands.

Maintaining secondary indices keeps reads O(1) per index lookup, at the cost of one Map mutation per task mutation. The tradeoff is worth it for the screens that read these (DailyPlanner, ScheduleTab) on every render.

For the per-row case (`selectTaskById(state, id)`) the read is already O(1) on the canonical `tasksById`, no secondary index needed.

#### Selectors

```ts
/** Per-row: returns one task or undefined. Stable identity — the same
 *  Map reference returns the same Task reference across renders unless
 *  the entry changed. */
export function selectTaskById(state: AppState, id: number): Task | undefined {
  return state.tasksById.get(id);
}

/** List-level: returns the ID array for a date. Same identity guarantee:
 *  unchanged loads return the same array reference. */
export function selectTaskIdsByDate(state: AppState, date: string): number[] {
  return state.taskIdsByDate.get(date) ?? EMPTY_ID_LIST;
}

/** List-level: ID array for a project. */
export function selectTaskIdsByProject(state: AppState, projectId: number): number[] {
  return state.taskIdsByProject.get(projectId) ?? EMPTY_ID_LIST;
}

/** List-level: ID array for a week (Monday ISO). */
export function selectTaskIdsByWeek(state: AppState, weekStart: string): number[] {
  return state.taskIdsByWeek.get(weekStart) ?? EMPTY_ID_LIST;
}

const EMPTY_ID_LIST: number[] = []; // module-level constant for stable empty

/** Reroute: same signature as M1, but reads tasksById instead of cache. */
export function selectTaskDetailTask(state: AppState): Task | null {
  const id = state.selectedTaskDetailId;
  if (id === null) return null;
  return state.tasksById.get(id) ?? null;
}

export function selectFocusedTask(state: AppState): Task | null {
  const f = state.focus;
  if (!f) return null;
  return state.tasksById.get(f.taskId) ?? null;
}
```

#### Actions

```ts
interface AppState {
  // ...

  /** Load tasks for a specific date into tasksById and prime
   *  taskIdsByDate. Replaces per-screen getTasksForDate + setTasks +
   *  cacheTasks. */
  loadTasksForDate: (date: string) => Promise<void>;

  /** Load tasks for a project. */
  loadTasksForProject: (projectId: number) => Promise<void>;

  /** Load tasks for a week (Monday ISO). */
  loadTasksForWeek: (weekStart: string) => Promise<void>;

  /** Optimistic patch + DB write. Updates the canonical map and any
   *  affected secondary indices, then writes through to SQL. On
   *  failure: refetch the task to restore truth. */
  updateTask: (id: number, patch: UpdateTaskInput) => Promise<void>;

  /** Optimistic delete + DB write. */
  deleteTask: (id: number) => Promise<void>;

  /** Toggle task status (today ↔ done) with optimistic update. */
  setTaskStatus: (id: number, status: TaskStatus) => Promise<void>;

  /** Set manual worked minutes on a task. */
  setTaskWorkedMinutes: (id: number, minutes: number) => Promise<void>;

  /** Insert a freshly-created task into tasksById and the relevant
   *  secondary indices. Called by code paths that create tasks
   *  (quick-add, schedule-tab drag-create, etc.). */
  insertTask: (task: Task) => void;
}
```

**Note on `cacheTasks`:** retired entirely. The seam stage repurposes its body to write to `tasksById`, then wire-up replaces all callers with the appropriate `load*` action.

---

## Sub-milestones

This milestone is large enough to warrant a multi-stage cadence beyond the standard seam-then-wire-up. **Six commits**, each independently reviewable:

### M3.2.a — store seam (one commit)

- Add `tasksById`, `taskIdsByDate`, `taskIdsByProject`, `taskIdsByWeek` fields to the store with empty initial values.
- Add the selectors (`selectTaskById`, `selectTaskIdsBy*`) — pure functions, no callers yet.
- Add the new actions: `loadTasksForDate`, `loadTasksForProject`, `loadTasksForWeek`, `updateTask`, `deleteTask`, `setTaskStatus`, `setTaskWorkedMinutes`, `insertTask`. Each writes to `tasksById` and maintains the relevant secondary index.
- **Repurpose `cacheTasks(tasks)`** to write to `tasksById` instead of `tasksByIdCache`. Callers don't change yet.
- **Reroute `selectTaskDetailTask` and `selectFocusedTask`** to read from `tasksById`.
- **Delete the `tasksByIdCache` field** declaration. The two selectors that read it have been rerouted; the (sole) writer `cacheTasks` has been repurposed. No screen change is required because `cacheTasks` is still the API the screens call — they just don't know it now writes to a different map.
- Update doc comments in the FocusState declaration ("M3.2 reroutes to canonical tasksById" → "Resolved by selectFocusedTask reading tasksById").
- **Verify:** typecheck clean, build clean. App boots normally — `TaskDetailOverlayHost` resolves tasks from `tasksById`, focus screen renames still propagate, screens still maintain their local `tasks` arrays as before. The `verseday:task-*` events still fire and screens still listen.
- **Stop. Verse review.**

This is *technically* additive in behavior (reads work, writes work) but *non-additive in declaration* (one field deleted). Worth flagging up-front: this is the only commit in M3 that touches the field set non-additively.

### M3.2.b.1 — DailyPlanner wire-up (one commit)

Pilot screen. The most-trafficked surface, exercises the full pattern: list-level subscription via `selectTaskIdsByDate`, mutation via `updateTask`/`deleteTask`/`setTaskStatus`, optimistic UX preserved.

- DailyPlanner subscribes to `selectTaskIdsByDate(state, selectedDate)` for the main list and the corresponding sidebar buckets.
- Replace `getTasksForDate(...)` + `setTasks(...)` + `cacheTasks(...)` with `loadTasksForDate(selectedDate)` (idempotent — re-running is cheap and refreshes the index).
- Replace mutation paths (status toggle, drag-drop reorder, manual worked-minutes set, delete) with the new store actions.
- Drop the local `useState<Task[]>` declarations: `tasks`, `sidebarUnscheduled`, `sidebarOverdue`, `unfinishedTasks` (the last three become selector reads or local-derived from the canonical map).
- **Keep the `verseday:task-*` listener for now** — other screens still emit; the listener becomes a no-op when stores are the only writer, and we drop it in M3.2.b.5.
- **Stop. Verse review.**

### M3.2.b.2 — Project surfaces (one commit)

- `Projects.tsx`: `matchingTasks` (search-result list — reads from canonical, derives matches via `useMemo`).
- `ProjectDetail.tsx`: `tasks` → `selectTaskIdsByProject(state, selectedProjectId)`.
- Mutation paths through new store actions.
- **Stop. Verse review.**

### M3.2.b.3 — Weekly + shutdown surfaces (one commit)

- `weekly-plan/PlanTab.tsx`: `tasks` → `selectTaskIdsByWeek`.
- `weekly-plan/ScheduleTab.tsx`: `weekTasks`, `allProjectTasks`, `unscheduledUnassigned` → selectors. `activeDragTask` stays local — it's transient drag UI state, not a candidate for store lift.
- `DailyShutdown.tsx`: `tasks` → selector.
- `WeeklyShutdown.tsx`: `completedThisWeek` → selector (with status="done" filter applied client-side via `useMemo`).
- **Stop. Verse review.**

### M3.2.b.4 — TaskCard per-row subscription (one commit)

- `TaskCard` props change: instead of receiving a full `Task`, receives `taskId: number`.
- Inside, `const task = useAppStore((s) => selectTaskById(s, taskId));` — per-row subscription.
- All TaskCard call sites in the four migrated screen groups updated to pass `taskId` instead of the full task.
- **Result:** a rename in `TaskDetailOverlay` writes one entry in `tasksById`; only that row's `TaskCard` re-renders; the parent list does not. Validated via React Profiler before claiming PASS — small per-row commit, easy to verify.
- **Stop. Verse review.**

### M3.2.b.5 — Event-bus + cache cleanup (one commit)

- Delete `cacheTasks` from the store and remove every remaining caller (search expects zero hits in `src/` outside the store after this commit).
- Delete the `verseday:task-updated` and `verseday:task-deleted` `addEventListener` blocks across the six screens.
- Delete the two `dispatchEvent("verseday:task-*")` sites in `TaskDetailOverlayHost`.
- Update the host's mutation handlers — they now call store actions (`updateTask` etc.) which already update the canonical map; the explicit `refreshCache(id)` call goes away.
- **Stop. Verse review.**

---

## Risks & concerns

1. **Map identity churn.** Every `set` on a Zustand-owned `Map` creates a new Map reference. Per-row subscribers re-evaluating `selectTaskById` will return the same `Task` reference if the underlying entry didn't change — but they re-run the lookup. For a few thousand tasks that's fine; if it becomes a hotspot, switch to `useShallow` on the parent ID-list subscription only.

2. **`taskIdsByDate` invalidation on `date_assigned` change.** When `updateTask` patches `date_assigned`, the secondary index needs to remove the task from the old date and add it to the new one. The `updateTask` action does this; tested in M3.2.a's verification step.

3. **Optimistic update rollback.** `updateTask` writes to the canonical map first, then DB. On DB failure: refetch the task and write the truth back. This is a richer error model than today's "DB write, then dispatch event, screens refetch on event"; no user-visible bugs expected from the change, but it's worth verifying that DB-failure paths still surface errors to the user (currently many catch silently — that pattern carries over, not regressed).

4. **The TaskCard `taskId` prop change is API-breaking inside the codebase.** Every call site updates in M3.2.b.4. If a site is missed, TypeScript catches it (since the prop type changed). The grep checks in the verify step also catch any stragglers.

5. **`activeDragTask: Task | null` in `ScheduleTab`.** This is genuinely screen-local — it's the live drag preview, not durable task state. Stays as `useState`. Plan rev 2 audit flagged it as B-class, but on closer look it's transient UI; staying local is correct.

6. **No DB or schema change. No migration. No IPC. No security surface. Zero budget.** Pure in-memory restructure plus listener cleanup.

---

## Test plan

### After M3.2.a

1. App boots; focus screen renders the focused task correctly (resolves via rerouted selector).
2. Open `TaskDetailOverlay` on any task from any screen — title, notes, project, worked-minutes display correctly.
3. Rename a task in the overlay; confirm the change propagates everywhere it currently propagates today (every screen with a `verseday:task-updated` listener still re-fetches and re-renders).
4. `git grep "tasksByIdCache"` returns zero hits in `src/`.
5. typecheck + build green.

### After each M3.2.b.N

For each migrated screen group: rename / status-toggle / delete a task and confirm the visible list updates without manual page refresh. Per-row TaskCard validation deferred to M3.2.b.4.

### After M3.2.b.5

1. `git grep "cacheTasks"` returns zero hits in `src/`.
2. `git grep "verseday:task-"` returns zero hits in `src/`.
3. End-to-end: create a task in QuickAdd, see it appear in DailyPlanner (same date) and ScheduleTab (same week) without a manual refresh. Rename it in the overlay; both screens re-render the affected row only (verify in React Profiler).
4. Delete the task; both screens lose it.

---

## Out of scope (carry-forward)

- `workedMinutesByTask` lift → M3.3.
- `editingTaskId`, `dailyPlanByDate`, `rolloverBacklog`, `sidebarTasks` → M3.4.
- `weekStatusesByWeek` and `weekCommitmentsByWeek` (PlanTab-specific) → M3.4 (originally bundled with M3.2 in plan rev 2; deferred here to keep M3.2 scope focused on the task-as-truth pattern).
- ESLint custom rule (M4).
- M3.5 cleanup (dead `handleStopFocus`, `closeOrphanedTimeEntries` ordering).

---

## Constraints

- Branch: `refactor/m3-canonical-tasks`. Never main.
- Never push branch without explicit user request.
- No schema change, no migration. `/docs/migration-discipline.md` compliant by absence.
- No security surface, no new IPC, no new persisted secrets.
- Budget: zero.
- M1 + M2 + M3.1 invariants preserved: `TaskDetailOverlay` singleton, `FocusState.taskId` canonical, pause-symmetry across all surfaces, worked-seconds counter as source of truth, `Summary`/`Sunset` overlay singletons.

---

## Verse review additions (2026-05-07)

Folded in alongside the original test plan. APPROVED with the following:

- **Mutation failure path is a hard requirement, not aspirational.** Every new action's doc comment must state: on DB write failure, (a) refetch the task and write truth back to the canonical map, (b) surface the error to the user (banner / toast / at minimum `console.error` with debug context). The host's silent-catch pattern is a known weakness — don't propagate it. New actions improve on it.
- **M3.2.a verification — explicit `date_assigned` index test.** Rename a task's `date_assigned` via the overlay; confirm it disappears from the old day's list and appears on the new day's list, no manual refetch. Make this test explicit, not implicit. This is the case index-maintenance bugs hide in.
- **M3.2.b.5 end-to-end addition.** Drag-drop a task to a different day while its `TaskDetailOverlay` is open in another surface; save from the overlay. The optimistic update + index maintenance + DB write + selector subscription chain should all converge. Surfaces order-of-operations bugs in `updateTask`.
- **Doc-comment update for the rerouted selectors.** `selectFocusedTask` and `selectTaskDetailTask` are no longer "transitional cache + fallback" — they're canonical reads. Update their doc comments accordingly in M3.2.a.

---

## Open questions for Verse

1. **Six-commit cadence acceptable?** Rev-2 plan said two commits (seam + wire-up); I'm proposing five wire-up sub-commits because eleven files in one commit is too risky. If you want fewer commits, I can collapse Project + Weekly groups, or land the cache cleanup alongside the last migration.
2. **`cacheTasks` repurposing during the seam.** Is repurposing-then-retiring the right call, or should M3.2.a delete `cacheTasks` and force the seam commit to also touch the screen call sites? My read: repurposing keeps the seam tight, and dropping callers in M3.2.b.5 is a clean concentrated cleanup. Open to going the other way.
3. **Secondary indices vs. function-args selectors.** I'm proposing maintained indices for performance + stable references. If you'd rather start with function-args selectors and add indices only when profiler shows hot spots, I can swap.
4. **Optimistic mutation pattern.** New action surface (`updateTask`, etc.) writes optimistically. Today's pattern is DB-then-broadcast. Risk-acceptable to switch, or do you want a non-optimistic seam first that mirrors current behavior, then optimize?
