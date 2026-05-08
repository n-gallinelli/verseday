# R.1 — Right Sidebar Rebuild Design

**Status:** Awaiting Verse review
**Date:** 2026-05-08
**Author:** Terse
**Branch:** `refactor/right-sidebar-rebuild`
**Predecessor:** Brief at `docs/2026-05-08-right-sidebar-rebuild-brief.md` (commit `b770d60`).
**Type:** First milestone of the rebuild. Pure design — no code lands here. Sub-milestones R.2 (selectors + actions), R.3 (component rebuild), R.4 (polish + edges) follow this approval.

---

## Nick's answers folded in

The 7 brief-gate questions:

| # | Question | Answer |
|---|---|---|
| 1 | Overdue threshold | **3+ days overdue** (`date_scheduled <= today - 3 days`) |
| 2 | Project ordering | **Most recently touched** — proxy: `max(task.created_at)` across the project's open tasks |
| 3 | Task ordering within project | **Most recently created** (`created_at DESC`) |
| 4 | dailyNotes | **Not in the sidebar today.** Nothing to move. |
| 5 | Project-stats list | **Fully gone.** No progress bars, no percent-complete. |
| 6 | Empty state | **Quiet empty space.** No copy. |
| 7 | Drag-drop | **Click-only with 10s undo.** No drag affordance. |

---

## Surface — what the new sidebar renders

220px-wide collapsible right rail. Replaces the entire current right-panel JSX in `DailyPlanner.tsx` (project list with progress bars, "Task backlog" rail, "Unscheduled" orphan rail, plus their bucket-filter logic).

### Top section — projects with unscheduled open tasks

For each project that has at least one task matching `date_scheduled IS NULL AND status != 'done'`:
- **Project header row** (collapsed-by-default): caret + 6px color dot + project name (truncated) + task count.
- **Expanded** (click header to toggle): the project's unscheduled open tasks, ordered by `created_at DESC`.
- A project with zero unscheduled open tasks does NOT appear.
- **Project ordering:** by `max(task.created_at)` across each project's open tasks, descending. Most-recently-touched project at the top.

### Bottom section — orphans + overdue

A single mixed list (one section, no internal sub-headers — the design call from the brief). Renders:
- **Orphans:** `project_id IS NULL AND date_scheduled IS NULL AND status != 'done'`
- **Overdue:** `date_scheduled <= (today - 3 days) AND status != 'done'`, with a **14-day floor** to keep ancient stale tasks from flooding the list (mirrors the current `getSidebarTasks` cap; sanity belt).

Order within the section: **overdue first** (sorted by `date_scheduled DESC` — most-recently-overdue first, since those are the most likely re-schedule candidates), **then orphans** (sorted by `created_at DESC`, newest at the top of their group). Verse-confirmed during R.1 review.

Section header row: caret + label + count. Collapsed by default. (Same chrome as project headers above.)

### Shared row chrome

- **Row height ~28px**, single line, title truncated.
- **Click → pull-to-day.** Adds the task to `selectedDate` (DailyPlanner's currently-viewed date). Routes through `setTaskDateScheduledAction(taskId, selectedDate)` (the post-M3.2.b.5 store action).
- **Recent-state styling for 10s after pull.** `bg-accent-blue/[0.07]`, `text-fg-faded`, `Undo` label replaces the row's normal hover icon. Click again within 10s → `setTaskDateScheduledAction(taskId, prevDate)` (undo). Auto-clears after 10s via existing `recentlyPulled` Map + setTimeout pattern (precedent: DailyPlanner's `pullTaskToDay` / `undoPull` plumbing — keep the existing local state mechanism, just point it at the new sidebar's clicks).
- **Hover-revealed chevron-right icon (right edge)** opens the detail overlay for that task. `e.stopPropagation()` so it doesn't trigger pull-to-day. Mirror of the backlog-rail-pullable affordance landed at `75a6d9e`.

### Empty states

- **No projects with unscheduled tasks AND no orphans/overdue:** rail body empty. Just the collapse handle remains. No copy.
- **Top section empty but bottom non-empty:** top section doesn't render at all (no header, no whitespace placeholder). Bottom section sits at the top of the rail body.
- **Top section non-empty but bottom empty:** top section renders normally; bottom section's header doesn't render.

### Collapse / reveal

Existing collapse mechanism preserved (220px ↔ 28px, `localStorage` persistence at `dailyPlanner.rightPanelCollapsed`). The collapse toggle's chrome stays as-is; only the rail's INNER content changes.

---

## Data wiring — post-M3 architecture

### New SQL helper

```ts
// src/db/queries.ts
export async function getSidebarPoolTasks(today: string): Promise<Task[]> {
  const db = await getDb();
  const overdueCutoff = subDays(today, 3); // ISO of today - 3
  const hardFloor = subDays(today, 14);     // ISO of today - 14
  return db.select(
    `SELECT * FROM tasks
       WHERE status != 'done'
         AND external_dismissal_reason IS NULL
         AND (
           date_scheduled IS NULL
           OR (date_scheduled <= $1 AND date_scheduled >= $2)
         )
       LIMIT 200`,
    [overdueCutoff, hardFloor]
  );
}
```

A single query replaces `getSidebarTasks`'s two separate selects. Returns a flat list; the rail's grouping happens in selectors. Includes `external_dismissal_reason IS NULL` because calendar-imported tasks aren't user-managed and shouldn't appear in the rail (matches existing behavior).

The result represents the rail's full membership pool. Anything not in this result set won't appear in the rail regardless of canonical-map state.

### New store action

```ts
// src/stores/appStore.ts (interface + impl)
loadSidebarPool: () => Promise<void>;
```

Body: `await getSidebarPoolTasks(todayString())` → `primeTasks(result)`. The hybrid-pattern primer (renamed from `cacheTasks` in M3.2.b.5.a). No secondary-index propagation needed — these tasks live in the rail's own selector-derived view, which scans `tasksById` directly with the predicate filters below.

Failure path: `console.error` and leave the rail empty. The rail's selector returns the prior canonical-map state, which may be stale but won't crash.

DailyPlanner calls `loadSidebarPool()` from its existing `loadData()` flow (alongside `loadTasksForDate(selectedDate)`).

**Reactivity note** (Verse R.1 review): once primed, the rail's reactivity flows through canonical-map subscriptions automatically. The new selectors filter `tasksById` by bucket semantics (`date_scheduled === null` etc.); `setTaskDateScheduled` / `createTaskAction` / `deleteTaskAction` propagate via `withTaskMutated` / `withTaskInserted` / `withTaskRemoved` so a pulled task disappears from the rail's filter the instant the canonical write lands. `loadSidebarPool` is therefore essentially a one-shot primer on mount — re-running it on every `loadData` call is mostly redundant but harmless. **Do not** add a "first-time-only" gate; the simplest call site is the right one, and over-engineering it would add an idempotency contract the action doesn't need.

### New selectors

```ts
// src/stores/appStore.ts

/** Map of projectId → ordered Task[], for projects that have at
 *  least one unscheduled open task. Tasks within each entry are
 *  ordered by created_at DESC. Projects whose ID doesn't appear
 *  in the map have zero unscheduled-open tasks. Caller renders
 *  the map's keys in their own order (this selector returns the
 *  raw map; the component memoizes the project-ordering pass). */
export function selectUnscheduledTasksByProject(
  state: AppState,
): Map<number, Task[]>;

/** Flat list of (orphans + overdue 3+ days back, 14-day floor)
 *  that the bottom section renders. Sorted: orphans first, then
 *  overdue by date_scheduled DESC. */
export function selectOrphanAndOverdueTasks(
  state: AppState,
  today: string,
): Task[];
```

Both scan `tasksById` and apply predicate filters. The bucket-filter pattern from M3.2.b.5 (Verse-required at hybrid sites) — re-validate membership against current canonical state at the selector call site, so a status flip / date change drops the task from the rail immediately without waiting for the next `loadSidebarPool()` refresh.

`selectUnscheduledTasksByProject` filter: `t.date_scheduled === null && t.status !== "done" && t.project_id !== null`.
`selectOrphanAndOverdueTasks` filter: union of orphan and overdue predicates with the 14-day floor.

### Project ordering selector

Project ordering ("most recently touched") needs the project list itself — we already have `projects: Project[]` in DailyPlanner state. The component derives ordering as:

```tsx
const projectOrder = useMemo(() => {
  const tasksByProject = selectUnscheduledTasksByProject(state);
  // For each project that appears in tasksByProject, find max
  // task.created_at across its open tasks. Sort projects DESC by
  // that timestamp.
  const entries: Array<{ projectId: number; maxCreatedAt: string }> = [];
  for (const [projectId, tasks] of tasksByProject) {
    const max = tasks.reduce(
      (acc, t) => (t.created_at > acc ? t.created_at : acc),
      "",
    );
    entries.push({ projectId, maxCreatedAt: max });
  }
  entries.sort((a, b) => (a.maxCreatedAt < b.maxCreatedAt ? 1 : -1));
  return entries.map((e) => e.projectId);
}, [tasksByProject]);
```

In-component memo, not a store selector — it depends on the rail's specific tasks, not a globally useful slice.

### Pull-to-day mechanism

Reuses DailyPlanner's existing `pullTaskToDay` / `undoPull` flow, which post-M3.2.b.5.b already routes through `setTaskDateScheduledAction`. The rail's row click triggers a thin wrapper:

```tsx
async function handlePull(task: Task) {
  const prevDate = task.date_scheduled;
  await setTaskDateScheduledAction(task.id, selectedDate);
  // recentlyPulled state machine + 10s setTimeout: identical to
  // DailyPlanner's existing pull-from-rail handlers. Keep the
  // pattern, just bind it to the new rail's clicks.
}
```

The `recentlyPulled` state already exists in DailyPlanner. The new rail integrates with it directly — no new state machine, no parallel implementation.

### Cross-screen reactivity

Post-M3, this is automatic:
- Task renamed in detail overlay → `updateTask` writes `tasksById` → rail's selector re-evaluates → row re-renders with new title.
- Task marked done → `setTaskStatus` writes `tasksById` → bucket filter (`status !== "done"`) drops it from the rail.
- Task pulled to a day → `setTaskDateScheduledAction` writes `tasksById` + indices → rail's filter (`date_scheduled === null`) drops it; recently-pulled state shows it in `Undo` styling for 10s.
- New task created elsewhere with `date_scheduled === null` → `createTaskAction` writes `tasksById` + indices → rail's selector picks it up. (Note: only if `loadSidebarPool` was called recently enough that the new ID is in canonical.)

---

## Sub-milestones

### R.2 — Selectors + actions (additive seam)

- Add `getSidebarPoolTasks` SQL helper to `db/queries.ts`.
- Add `loadSidebarPool` action to `appStore.ts`.
- Add `selectUnscheduledTasksByProject` and `selectOrphanAndOverdueTasks` selectors to `appStore.ts`.
- Existing UI unchanged. The new selectors aren't wired anywhere yet; the new SQL helper isn't called.
- Verify: tsc clean, build clean. App boots normally.
- **Stop. Verse review.**

### R.3 — Sidebar component rebuild

- Replace the right-panel JSX in `DailyPlanner.tsx` (the entire `{rightPanelCollapsed ? ... : <existing rail>}` body) with the new two-section component.
- DailyPlanner's `loadData` calls `loadSidebarPool()` alongside the existing `loadTasksForDate(selectedDate)`.
- Drop the existing rail's local state: `expandedProjectIds`, `unfinishedExpanded`, `unscheduledExpanded`, `sidebarUnscheduledIds`, `sidebarOverdueIds`, `unfinishedTaskIds` and their associated derivations. (`recentlyPulled` stays — same UX rhythm, new bindings.)
- Drop the imports that go with it: `getSidebarTasks`, `getUnfinishedRolloverTasks` (if the rebuild fully replaces backlog).
- **Stop. Verse review.**

### R.4 — Polish + edge cases

- Empty-state rendering verification (top empty / bottom empty / both empty).
- Long-list scroll handling (the rail body scrolls vertically when content overflows).
- Animations: row entrance/exit, recent-state fade-in, project-header expand/collapse.
- Keyboard nav: arrow up/down, enter to pull, esc to cancel a pending undo.
- Profiler check: rail re-renders only when `tasksById` or its scoped subset changes.
- **Stop. Verse review.**

---

## Risks & concerns

1. **`loadSidebarPool` `LIMIT 200` ceiling.** A user with >200 unscheduled+overdue tasks would get truncation. 200 is generous (current `getSidebarTasks` is 50+50=100). Profiler check during R.4; bump if it hits in practice.

2. **Project ordering by `max(task.created_at)` is a proxy, not a true "touched" timestamp.** We don't track per-task update timestamps. A project whose oldest tasks are very old but whose user is actively editing them would rank low. Verse R.1 review flagged this as track-for-R.3-verification: if the rail's project order feels surprising during testing, candidates to swap to are `max(task.updated_at)` (renames/reschedules), `project.updated_at`, or `max(time_entries.start_time)` for the project's tasks (recently-worked). Don't pre-tune. Ship the simplest proxy; eyeball during R.3 testing.

3. **Bucket filter at the selector is a scan of `tasksById`.** O(N) per selector call. With memoization it runs once per `tasksById` change. For typical N (hundreds of tasks), sub-millisecond. If profiler shows hot paths, the fix is a maintained index — but given the rail's narrow scope, scanning is fine.

4. **Cross-screen new task with `date_scheduled === null`.** If the user creates an orphan task on, say, ProjectDetail, it appears in `tasksById` via `createTaskAction`'s `withTaskInserted`. The rail's selector picks it up automatically. ✓

5. **Stale rail entries between pulls.** A task pulled in this window: rail renders it with `Undo` styling for 10s, then `recentlyPulled` clears, the bucket filter would already exclude it (date_scheduled is now today, not null), so it disappears cleanly. No flicker because the bucket-filter exclusion fires the instant `setTaskDateScheduledAction` writes `tasksById`.

6. **No DB schema change. No migration. No IPC. No security surface. Zero budget.**

---

## Out of scope (deferred)

- Per-task update timestamps (would enable a true "most recently touched" rather than the create-time proxy). Future enhancement; not a sidebar-rebuild blocker.
- Drag-drop interaction (Nick's #7: click-only).
- The 14-day overdue floor → user-configurable. Hardcoded for now.
- The sidebar's collapse-state UX (the 28px collapsed state's chrome). Stays as-is.
- Animation polish, keyboard nav → R.4.

---

## Constraints

- Branch: `refactor/right-sidebar-rebuild`. Never main directly.
- No DB schema change, no migration. (`getSidebarPoolTasks` is a read-only helper.)
- No security surface, no new IPC, no new persisted secrets.
- Budget: zero.
- Architecturally clean: post-M3 store API only. No legacy SQL paths in the component. No `cacheTasks` / `primeTasks` calls outside the load action's body. No `verseday:task-*` listeners.

---

## Verse review confirmations (R.1)

All four open questions resolved during the heads-up review:

1. **14-day floor: keep.** Matches existing `getSidebarTasks` behavior. The rail is for active pull-to-day; older tasks belong to Projects/ProjectDetail.
2. **Single mixed list: yes.** Sort order is **overdue first, then orphans** (Verse's call — corrected from my initial draft's orphans-first ordering).
3. **R.3 single commit.** Component rebuild + JSX surgery is one atomic visual change. Heads-up before splitting if the diff balloons.
4. **`loadSidebarPool` inside `loadData`.** Parallel fetch via `Promise.all`. No first-time-only gate — canonical reactivity covers the redundancy.

Track-for-R.3-verification:
- Project ordering proxy (`max(task.created_at)`) might rank surprising results. If the order feels off during R.3 testing, swap to `max(task.updated_at)` / `project.updated_at` / `max(time_entries.start_time)` per the alternatives in Risk #2.
