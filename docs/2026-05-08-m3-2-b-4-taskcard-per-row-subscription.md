# M3.2.b.4 — TaskCard per-row subscription

**Status:** Awaiting Verse review
**Date:** 2026-05-08
**Author:** Terse
**Branch:** `refactor/m3-canonical-tasks`
**Predecessor:** M3.2.b.3 closed at `f0b20eb`. Verse APPROVED with calibration notes on the heads-up rule.
**Type:** Smallest milestone of the M3.2 chunk. Single-component refactor to land per-row store subscription on the one cross-screen task-row component that exists today.

---

## Why TaskCard only

The rev-2 plan said *"per-row subscription is mandatory"* across "DailyPlanner main list, ProjectDetail task list, ScheduleTab grid, Dashboard week summary." That directive assumed `TaskCard` was a shared abstraction reused across those screens. It isn't.

Today's reality (verified via `grep`):
- `TaskCard` is imported and rendered **only** by `DailyPlanner.tsx`.
- `ProjectDetail.tsx` renders task rows via an inline `tasks.map(...)` block with bespoke JSX.
- `weekly-plan/ScheduleTab.tsx` renders task chips via a sibling `DraggableTaskRow` component.
- `weekly-plan/PlanTab.tsx` delegates to `PlanTaskList.tsx` which has its own row JSX.

Extracting those inline / sibling rows into a shared per-row-subscription component is a *component-shape consolidation*, not an entity-data-subscription milestone. Different concern, different milestone, not bundled here.

The Profiler payoff at the other screens is also speculative post-b.3:
- All four parents now read ID lists from selectors and resolve via `tasksById.get(id)` in memos.
- React's reconciliation + stable Task refs from the canonical map already shortcut unchanged children.
- Their inline row JSX bodies are cheaper than `TaskCard`'s (no Pomodoro tick, no focused-row branch, no animation triggers).

If a non-DailyPlanner screen later shows real Profiler pain on tasksById churn, address it as a targeted optimization. Don't pre-bundle.

The cross-screen "don't put Task in component props" guardrail is **M4's ESLint rule** — a constraint that catches future drift via lint, not via a refactor that touches working code.

---

## What this milestone does

Convert `TaskCard` from a parent-pushes-task pattern to a per-row-pulls-task pattern.

**Before** (`DailyPlanner.tsx:1262`):
```tsx
<TaskCard task={t} project={projectMap.get(t.project_id ?? -1)} ... />
```
TaskCard receives the full `Task` object. Memo compares `prev.task !== next.task` to decide whether to re-render. When the parent re-renders (which happens on every `tasksById` change post-b.1), every child TaskCard re-evaluates its memo comparator — the focused row re-renders for the live tick; other rows bail out via memo if their `task` ref is unchanged.

**After:**
```tsx
<TaskCard taskId={t.id} project={projectMap.get(t.project_id ?? -1)} ... />
```
TaskCard receives just the id. Internally subscribes via `useAppStore((s) => selectTaskById(s, taskId))`. When a single task mutates, only THAT row's subscription fires; the parent's render pipeline still re-runs, but each non-affected TaskCard memo passes (taskId unchanged, no other prop change) and skips its render body.

The win: a rename in `TaskDetailOverlay` writes one entry in `tasksById`. Today, parent re-renders feed every TaskCard memo a fresh closure but the task ref is unchanged for unaffected rows so they bail. Post-b.4: same outcome for unaffected rows + the affected row's render body runs *because of its own subscription*, not because the parent passed a new task.

The behavioral difference is small in steady-state — the wins surface clearly in two cases:
1. **High-frequency parent renders** (e.g. `liveElapsedMs` ticking at 1Hz) — only the focused row's render body runs; non-focused rows skip the comparator and the render body via stable taskId.
2. **Cross-surface mutations** that don't go through the parent's loadData refetch (the post-b.5 world). The row-level subscription is the read path that survives bus retirement.

---

## Design

### Prop change

```ts
interface TaskCardProps {
  // BEFORE: task: Task;
  taskId: number;
  // ... all other props unchanged
  project: Project | undefined;
  onToggle: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (id: number) => void;
  onToggleNotes: (id: number) => void;
  onStart?: (task: Task) => void;
  onOpenDetail?: (task: Task) => void;
  expandedNotes: boolean;
  showProject?: boolean;
  workedMinutes?: number;
  justArrived?: boolean;
  justAdded?: boolean;
  liveElapsedMs?: number;
  isFocused?: boolean;
  isPaused?: boolean;
  onOpenProject?: (projectId: number) => void;
}
```

Callbacks that today receive a `Task` argument continue to do so — the parent has the task in its derived list, can grab it, and pass it. The component's *prop* shape changes; the callback signatures don't (preserving DailyPlanner's existing handlers).

### Internal subscription

```tsx
function TaskCardImpl({ taskId, project, ... }: TaskCardProps) {
  const task = useAppStore((s) => selectTaskById(s, taskId));
  const togglePauseFocus = useAppStore((s) => s.togglePauseFocus);

  // Null-handling: see §"Edge cases" below.
  if (!task) return null;

  // ... rest of render body unchanged, references `task` as before.
}
```

`selectTaskById` is the per-row selector added in M3.2.a. Returns `Task | undefined`. The subscription is shallow-equality stable: same Map reference + same id returns the same Task ref unless that entry was rewritten.

### Memo comparator update

```ts
function taskCardPropsEqual(prev: TaskCardProps, next: TaskCardProps): boolean {
  if (prev.liveElapsedMs !== next.liveElapsedMs) return false;
  if (prev.isFocused !== next.isFocused) return false;
  if (prev.isPaused !== next.isPaused) return false;
  // BEFORE: if (prev.task !== next.task) return false;
  if (prev.taskId !== next.taskId) return false;
  if (prev.project !== next.project) return false;
  if (prev.expandedNotes !== next.expandedNotes) return false;
  if (prev.showProject !== next.showProject) return false;
  if (prev.workedMinutes !== next.workedMinutes) return false;
  if (prev.justArrived !== next.justArrived) return false;
  if (prev.justAdded !== next.justAdded) return false;
  return true;
}
```

`taskId` (a primitive `number`) replaces `task` (a `Task` ref). Functional-prop identity short-circuit (the existing comment block) stays — DailyPlanner still passes inline arrows; the comparator still ignores them.

When does the memo comparator fire? When the parent re-renders. With the new comparator:
- Parent re-renders for any reason → comparator runs for every TaskCard
- For a non-focused, non-changed row: every primitive prop is unchanged, `taskId` is unchanged, comparator returns `true` → memo skip. Row's render body does NOT run.
- For a focused row during a `liveElapsedMs` tick: `liveElapsedMs` differs → comparator returns `false` → row re-renders. Same as today.
- For a row whose task data changed (rename, status flip, etc.): the comparator MIGHT return `true` (taskId hasn't changed!), BUT the row's INTERNAL `useAppStore` subscription has a different return value → React re-renders the row anyway because the store hook is a new dependency change.

That last case is the architectural inversion: the memo comparator is no longer responsible for "this row's data changed." The store hook is. The comparator only guards against parent-driven re-renders that don't affect this row.

### Edge case: `selectTaskById` returns undefined

Three windows where the parent's `taskIds` list contains an id that `tasksById` doesn't:

1. **Mid-delete:** `deleteTaskAction` removes from `tasksById` AND removes from `taskIdsByDate` in one atomic `set`. There's no window where one is updated and the other isn't — `withTaskRemoved` is an atomic state patch. **No null-handling needed for this case.**

2. **Mid-load:** `loadTasksForDate` *replaces* the date index entry with the SQL-ordered IDs. Inside the same `set`, every loaded task is written to `tasksById`. Atomic — no window. **No null-handling needed.**

3. **Direct-DB legacy paths (b.5 territory):** `pullTaskToDay`, `updateTaskDateScheduled` (ScheduleTab drag), `updateTaskSortOrders`, `createTask`. These hit DB then call `loadData` (fire-and-forget). The canonical map updates after `loadTasksFor*` resolves. During the gap, the parent's `taskIds` (selector) still reflects pre-write state. So the parent doesn't have a "ghost id" pointing at a missing canonical entry — it's the OLD state that's still consistent.

   The exception: `cacheTasks` band-aids (`a81c1a1` reverted; not in the codebase). If a future code path adds an id to a secondary index without writing the matching `tasksById` entry, this would surface. **Defensive `if (!task) return null;` keeps TaskCard from crashing if it ever happens.** Cheap, no UX cost (the row would be blank for a frame; React would re-render when the task lands).

The `if (!task) return null` defense is a one-line guard. Worth it.

### Sortable id stays the same

`useSortable({ id: task.id })` becomes `useSortable({ id: taskId })`. dnd-kit identifies sortables by id; passing the primitive directly is cleaner than the deferred `task.id` access.

### `focusedTaskId` and `liveElapsedMs` props stay parent-pushed

The focused-row tick:
- `useFocusTick()` runs in DailyPlanner, returns `liveElapsedMs` once per second when a focus session is active.
- DailyPlanner passes `liveElapsedMs={t.id === focusedTaskId ? focusElapsedMs : undefined}` only to the focused row.
- TaskCard's render body branches on `isFocused` for the live-pill display.

This stays as-is. The focused-row prop pattern is parent-pushes because:
- The "which row is focused" info already lives in the parent's render closure (`focus?.taskId`).
- Passing `liveElapsedMs` only to the focused row keeps non-focused rows' memos from invalidating per second.
- Moving the subscription into TaskCard would mean every row subscribes to `useFocusTick` → every row re-renders per second → defeats the memo. Don't.

The `isFocused` and `isPaused` props are similarly parent-derived from `focus` and stay as-is.

---

## Sub-milestones

Single commit. Diff is small (<50 lines):
- `src/components/TaskCard.tsx` — prop type, destructure, internal hook, comparator, sortable id, null-guard.
- `src/pages/DailyPlanner.tsx:1262` — `task={t}` → `taskId={t.id}`.

If the diff balloons during implementation (e.g. a hidden type leak forces wider edits), heads-up before splitting.

---

## Risks & concerns

1. **Null-guard during render.** `if (!task) return null;` means a row briefly disappears if the task is removed from canonical map while still referenced in the parent's id list. After audit (§"Edge cases"), the only way that happens is via legacy SQL-direct paths that haven't refreshed the index yet — and the parent's id list reflects pre-write state in those cases, so the case is theoretical. Defensive guard remains; no UX-visible window expected.

2. **Memo comparator depends on `taskId` primitive equality.** A bug where the parent passes `taskId={NaN}` or a stale id would silently fail (memo would always pass). Caught by TypeScript (`number`) and React's runtime if the id ever resolved to undefined. Trust the type system; don't over-engineer.

3. **Internal subscription invalidates on tasksById churn.** Every task mutation produces a new `tasksById` Map ref. Every TaskCard's `useAppStore((s) => selectTaskById(s, taskId))` re-runs its selector. Selector returns same Task ref if entry is unchanged. Zustand short-circuits on referential equality. Net: no extra renders. **But:** the *selector function* runs for every TaskCard on every store change. ~30 TaskCards × store change = 30 selector invocations per change. Each is one Map.get — O(1). Negligible. Profile in step 3 below.

4. **DnD-kit and key collision.** The list's `<SortableContext items={taskIds}>` uses primitive number ids; each TaskCard's `useSortable({ id: taskId })` matches. No change from today's behavior.

5. **No DB or schema change. No IPC. No security surface. Zero budget.**

---

## Test plan

### Static checks (autonomous)

- `npx tsc --noEmit` — clean. The prop type change forces every call site to update; misses surface as TS errors.
- `npx vite build` — clean.
- `git grep "task=\\{" src/pages/DailyPlanner.tsx` — zero hits (the one TaskCard call site is now `taskId={...}`).
- `git grep "<TaskCard" src/` — only the migrated DailyPlanner site.

### Runtime correctness (reasoned from code)

- Status toggle from a row → memo comparator's `taskId` matches, store hook returns updated task, render body runs, status flips visually.
- Inline edit save → store updateTask updates tasksById, target row's hook returns new title, render shows it.
- Delete → store deleteTaskAction removes from canonical map AND from taskIdsByDate atomically; selector subscription returns no-id-in-list (filtered before TaskCard renders), TaskCard never sees undefined for a real delete.
- Drag reorder → SortableContext + useSortable use primitive ids; no behavioral change.

### Profiler validation (the milestone's payoff — Verse-required)

Manual, but I can run it autonomously: open Tauri dev, install React DevTools (already in the project's dev dependencies if Profiler tab is available; otherwise, use console.count instrumentation as a proxy).

**Procedure:**
1. Open DailyPlanner with ~10+ tasks visible.
2. Start a focus session on one task → liveElapsedMs ticks at 1Hz.
3. Capture Profiler flamegraph for ~5 seconds:
   - **Before b.4** (current `task` prop): focused row re-renders per tick; every other row evaluates the memo comparator and bails.
   - **After b.4** (taskId prop): same outcome — focused row re-renders, non-focused rows bail.
   - **Net difference here:** ~zero. The pre-b.4 memo already worked correctly for tick avoidance.

4. Rename a task via the detail overlay:
   - **Before b.4**: TaskDetailOverlayHost broadcasts `verseday:task-updated` → DailyPlanner's listener calls `loadData()` → `loadTasksForDate` updates `tasksById` → DailyPlanner re-renders → every TaskCard memo gets a new closure but the `task` ref for unchanged rows is the same `tasksById.get(id)` value (NEW: same as in b.4 — they bail).
   - **After b.4**: same outcome at the parent level. The renamed row's internal hook returns a new task; React re-renders that row. Non-renamed rows: comparator passes (taskId same, primitives same), memo skip.
   - **Net difference:** the `verseday:task-updated → loadData` refetch is unchanged. The architectural payoff is that **once b.5 retires the refetch and the canonical map is the only update path, the per-row subscription is what makes the row update correctly.** That payoff doesn't surface until b.5 ships.

5. Status flip from inline checkbox:
   - Same shape. Today: parent re-renders, target row memo bails (task ref differs because status changed). Post-b.4: target row's internal hook fires the re-render. Same render-body invocation count.

**What I'm proving with the Profiler:** behavioral parity, not a new performance win. The win in b.4 is *architectural* — preparing the read path for b.5's bus retirement. Document the result honestly; don't claim a win that doesn't measurably exist today.

If the Profiler shows the renamed row re-renders >1× or non-renamed rows re-render at all, that's a bug to investigate.

---

## Out of scope (deferred)

- Standardizing `DraggableTaskRow` (ScheduleTab) / inline row JSX (ProjectDetail) / `PlanTaskList` rows under a shared per-row-subscription component → component-shape consolidation milestone, not in M3.
- Retiring `cacheTasks` and the `verseday:task-*` bus → M3.2.b.5.
- ESLint rule that bans `Task` (or `Task[]`) in component props → M4.

---

## Constraints

- Branch: `refactor/m3-canonical-tasks`. Never main.
- No DB or schema change, no migration.
- No security surface, no new IPC, no new persisted secrets.
- Budget: zero.
- All prior milestone invariants preserved.

---

## Open questions for Verse

None. The narrow-scope decision was already aligned. Heads-up before commit per the discipline rule.
