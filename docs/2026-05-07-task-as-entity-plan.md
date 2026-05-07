# Task as Entity — Refactor Plan

**Status:** Approved with revisions — proceeding to M1
**Rev 2 — incorporated Verse review 2026-05-07.** C-class rulings folded in. R1–R5 applied: `tasksByIdCache` naming + retirement DoD criterion (R1), PiP broadcast subscribes through composed selector (R2), per-row subscription is the default in M3.2 (R3), §3 dependency-chain preamble (R4), every milestone opens with a seam-only first commit (R5).
**Date:** 2026-05-07
**Author:** Terse
**Brief:** `docs/2026-05-07-task-as-entity.md`
**Folded design:** `docs/2026-05-07-pause-symmetry.md` (rev 2) lands as M2 with the `FocusState.task → FocusState.taskId` correction Verse called out.

---

## 0 — Recap of the brief

A task is a single entity, keyed by `id`, canonical in `appStore`. Screens are *views*. Three rules:

1. **Entities canonical, by ID, in the store.** No screen owns a copy of task data.
2. **One mount per cross-screen surface.** Singleton overlays live at the app shell.
3. **Cross-screen UX state lives in the store.** Local `useState` is reserved for hover, accordion, scroll position, and other state that genuinely dies with the screen.

Acceptance test for "is this state in the right place?": *if I navigate away and back, should it survive?* → store. *No?* → local.

---

## 1 — Audit

Walked every `useState` site in `src/pages/` and `src/components/`. Total: **235 sites** across 30 files (brief estimated ~265 — actual count is lower; same shape applies). Classified as:

- **A** — Genuinely local, keep as-is.
- **B** — Should be lifted to the store. Names target store field.
- **C** — Ambiguous, flag for Verse.

**Totals (rev 2 — post-Verse rulings):** A: 194 · B: 41 · C: 0 (was A: 191, B: 38, C: 6 in rev 1)

### `src/pages/DailyPlanner.tsx` (36)

| Line | Variable | Class | Note |
|---|---|---|---|
| 78 | `tasks` | B | `Task[]` for date → `tasksByDate[selectedDate]` |
| 79 | `projects` | A | Lookup table |
| 80 | `plannedMinutes` | A | Computed summary |
| 81 | `workedMinutes` | A | Computed summary |
| 82 | `dailyPlan` | B | Daily plan record (notes/budget) → `dailyPlanByDate[selectedDate]` |
| 83 | `workedMap` | B | `taskId → minutes` → `workedMinutesByTask` |
| 88 | `arrivedIds` | A | Animation trigger |
| 90 | `addedIds` | A | Animation trigger |
| 91 | `projectStats` | A | Local derived aggregates |
| 92 | `error` | A | Page-local banner |
| 99 | `showSlowSyncToast` | A | UI flag |
| 102 | `newTaskTitle` | A | Form draft |
| 103 | `newTaskEstimate` | A | Form draft |
| 104 | `newTaskProjectId` | A | Form draft |
| 105 | `newTaskHighPriority` | A | Form draft |
| 108 | `editingId` | B | Cross-screen if M3 lifts inline-edit → `editingTaskId` |
| 109 | `editTitle` | A | Inline edit draft |
| 110 | `editEstimate` | A | Inline edit draft |
| 111 | `editProjectId` | A | Inline edit draft |
| 112 | `editPriority` | A | Inline edit draft |
| 113 | `editNotes` | A | Inline edit draft |
| 116 | `expandedId` | A | Local accordion |
| 117 | `confirmDeleteId` | A | Local confirm UI |
| 118 | `dailyNotes` | B | Subset of `dailyPlan` → `dailyPlanByDate[selectedDate].notes` |
| 119 | `showDatePicker` | A | Popover open/close |
| 120 | `taskInputExpanded` | A | Local UI |
| 126 | `expandedProjectIds` | A | Local accordion |
| 127 | `unfinishedExpanded` | A | Local accordion |
| 128 | `unscheduledExpanded` | A | Local accordion |
| 129 | `rightPanelCollapsed` | A | localStorage-backed local pref; only this screen reads it (Verse rev 2 ruling) |
| 142 | `detailTask` | B | → `selectedTaskDetailId` (M1) |
| 143 | `showSummary` | B | → `summaryOverlayOpen` |
| 149 | `sidebarUnscheduled` | B | Pull-rail tasks → `sidebarTasks.unscheduled` (or compute from `tasksByDate` map) |
| 150 | `sidebarOverdue` | B | Pull-rail tasks → `sidebarTasks.overdue` |
| 151 | `unfinishedTasks` | B | Rollover backlog → `rolloverBacklog[selectedDate]` |
| 154 | `recentlyPulled` | A | 10s undo window, page-scoped |

### `src/pages/ProjectDetail.tsx` (31)

| Line | Variable | Class | Note |
|---|---|---|---|
| 446 | `project` | B | Canonical entity → `projectsById[selectedProjectId]` |
| 447 | `tasks` | B | `Task[]` → `tasksByProject[selectedProjectId]` |
| 448 | `workedMap` | B | → `workedMinutesByTask` |
| 449 | `projects` | A | Lookup table |
| 450 | `error` | A | Page-local banner |
| 451 | `showDone` | A | Local filter |
| 454 | `editName` | A | Auto-save draft |
| 455 | `editColor` | A | Auto-save draft |
| 456 | `editDescription` | A | Auto-save draft |
| 457 | `editStartDate` | A | Auto-save draft |
| 458 | `editTargetDate` | A | Auto-save draft |
| 459 | `editNotes` | A | Auto-save draft |
| 464 | `newTaskTitle` | A | Form draft |
| 465 | `newTaskEstimate` | A | Form draft |
| 466 | `newTaskHighPriority` | A | Form draft |
| 467 | `newTaskDate` | A | Form draft |
| 471 | `quickAddDate` | A | Local modal trigger |
| 474 | `editingTaskId` | B | → `editingTaskId` |
| 475 | `taskEditTitle` | A | Inline edit draft |
| 476 | `taskEditEstimate` | A | Inline edit draft |
| 477 | `taskEditPriority` | A | Inline edit draft |
| 478 | `taskEditNotes` | A | Inline edit draft |
| 479 | `taskEditDate` | A | Inline edit draft |
| 482 | `detailTask` | B | → `selectedTaskDetailId` |
| 488 | `activeDragTitle` | A | Drag overlay label |
| 491 | `confirmDeleteId` | A | Local confirm UI |
| 492 | `pendingDelete` | A | 5s undo, page-scoped |
| 497 | `confirmDeleteProject` | A | Local confirm UI |

(28 enumerated; 3 remaining are minor UI flags — confirmed A on inspection.)

### `src/pages/FocusMode.tsx` (24)

Folded into M2 design (`docs/2026-05-07-pause-symmetry.md` rev 2). Summary classification:

| Line | Variable | Class | Note |
|---|---|---|---|
| 85 | `bootStatus` | A | Boot phase |
| 86 | `bootError` | A | Boot error |
| 87 | `bootRetry` | A | Boot retry gate |
| 152 | `notes` | B | Drifts vs `TaskDetailOverlay`; tied to canonical task |
| 157 | `titleDraft` | A | Inline title edit |
| 162 | `plannedOpen` | A | Popover |
| 163 | `actualOpen` | A | Popover |
| 167 | `zoomKey` | A | Animation trigger |
| 178 | `elapsed` | A | Render-tick computed value via `computeFocusElapsedMs(focus, now)`; the store holds the inputs, the tick lives local (Verse rev 2 ruling) |
| 179 | `paused` | B | → `focus.paused` (M2) |
| 186 | `breakRemaining` | A | Pomodoro local |
| 187 | `breakDuration` | A | Pomodoro local |
| 188 | `prompt` | A | Break prompt UI |
| 231 | `settingsLoaded` | A | Boot gate |
| 232 | `WORK_DURATION_MS` | A | Loaded setting |
| 233 | `SHORT_BREAK_MS` | A | Loaded setting |
| 234 | `LONG_BREAK_MS` | A | Loaded setting |
| 235 | `SNOOZE_MS` | A | Loaded setting |
| 236 | `CYCLES_BEFORE_LONG_BREAK` | A | Loaded setting |
| 327 | (duplicate `elapsed` at body scope) | — | same site as 178 |
| 328 | (duplicate `paused`) | — | same site as 179 |
| 334 | `phase` | A | Pomodoro phase, FocusMode-only |
| 335 | `completedPomodoros` | A | Cycle counter |
| 336 | `completionBurst` | A | Animation trigger |

(Reset effect at `:177-190` and direct mutations at `:763-764` and `:1063` covered by pause-symmetry doc rev 2 surface-changes section.)

### `src/components/TaskDetailOverlay.tsx` (19)

| Line | Variable | Class | Note |
|---|---|---|---|
| 351 | `title` | A | Editable draft |
| 370 | `localStatus` | A | Toggle UI; commits via `onToggle` |
| 373 | `completionGlow` | A | Animation trigger |
| 383 | `notes` | B | Drifts vs `FocusMode.notes`; tied to canonical task |
| 384 | `estimate` | A | Editable draft |
| 385 | `projectId` | A | Editable draft |
| 386 | `priority` | A | Editable draft |
| 387 | `dateScheduled` | A | Editable draft |
| 388 | `dueDate` | A | Editable draft |
| 389 | `worked` | A | Editable draft |
| 390 | `dayBreakdown` | A | Read-only fetched summary |
| 391 | `openPopover` | A | Popover |
| 394 | `confirmingDelete` | A | Local confirm UI |
| 399 | `recurrenceFreq` | A | Editable draft |
| 400 | `recurrenceDay` | A | Editable draft |
| 401 | `recurrenceInterval` | A | Editable draft |
| 409 | `saveState` | A | Save status label |

(Plus 2 ref-via-state for popover positioning — confirmed A.)

### `src/pages/DailyShutdown.tsx` (13)

| Line | Variable | Class | Note |
|---|---|---|---|
| 60 | `tasks` | B | → `tasksByDate[selectedDate]` |
| 61 | `projects` | A | Lookup |
| 62 | `error` | A | Banner |
| 64 | `mood` | A | Auto-saved form field |
| 65 | `reflectionFields` | A | Auto-saved fields |
| 70 | `carriedIds` | A | Optimistic UI |
| 71 | `isShutdown` | A | UI flag |
| 72 | `showSunset` | B | → `sunsetOverlayOpen` |
| 73 | `highlightIds` | A | Highlight stars |
| 74 | `workedPerTask` | B | → `workedMinutesByTask` |
| 75 | `showSummary` | B | → `summaryOverlayOpen` |
| 76 | `step` | A | Two-step flow |
| 77 | `detailTask` | B | → `selectedTaskDetailId` |

### `src/pages/weekly-plan/PlanTab.tsx` (10)

| Line | Variable | Class | Note |
|---|---|---|---|
| 52 | `projects` | A | Lookup |
| 53 | `statuses` | B | Entity data keyed by week → `weekStatusesByWeek[selectedWeek]` (M3.2; Verse rev 2 ruling) |
| 56 | `commitments` | B | Entity data keyed by week → `weekCommitmentsByWeek[selectedWeek]` (M3.2; Verse rev 2 ruling) |
| 59 | `tasks` | B | → `tasksByWeek[selectedWeek]` |
| 60 | `selectedId` | A | Local selection |
| 61 | `loading` | A | Page-local |
| 62 | `error` | A | Banner |
| 66 | `toggleSignal` | A | Animation/transition |
| 74 | `dragTaskTitle` | A | Drag overlay label |
| 78 | `detailTask` | B | → `selectedTaskDetailId` |

### `src/pages/weekly-plan/ScheduleTab.tsx` (12)

| Line | Variable | Class | Note |
|---|---|---|---|
| 168 | `expanded` | A | Local accordion |
| 479 | `weekTasks` | B | → `tasksByWeek[selectedWeek]` |
| 480 | `projects` | A | Lookup |
| 481 | `allProjectTasks` | B | → `tasksByProject` map |
| 485 | `unscheduledUnassigned` | B | Derive from `tasksByWeek` + filter |
| 486 | `error` | A | Banner |
| 487 | `activeDragTask` | A | Drag overlay |
| 490 | `pendingMove` | A | Optimistic move undo |
| 499 | `detailTask` | B | → `selectedTaskDetailId` |
| 507 | `dayModalDate` | A | Local modal trigger |
| 510 | `carryForwardNotes` | A | Local UI |
| 511 | `carryForwardDismissed` | A | Local UI |

### `src/pages/weekly-plan/PlanTaskList.tsx` (3)

| Line | Variable | Class | Note |
|---|---|---|---|
| 51 | `draft` | A | Inline edit draft |
| 52 | `savedAt` | A | Auto-save UI marker |
| 127 | `draft` | A | Inline-add draft |

### `src/pages/weekly-plan/PlanDayStrip.tsx` (3)

| Line | Variable | Class | Note |
|---|---|---|---|
| 72 | `confirmingClear` | A | Local confirm UI |
| 170 | `editing` | A | Inline-edit toggle |
| 171 | `draft` | A | Inline-edit draft |

### `src/pages/weekly-plan/PlanFridayBanner.tsx` (1)

| Line | Variable | Class | Note |
|---|---|---|---|
| 35 | `dismissed` | A | Banner local |

### `src/pages/Projects.tsx` (12)

| Line | Variable | Class | Note |
|---|---|---|---|
| 82 | `projects` | B | Canonical → `projects` map in store |
| 83 | `statsMap` | A | Computed |
| 86 | `error` | A | Banner |
| 87 | `filter` | A | Local filter |
| 91 | `viewMode` | A | Local view pref (localStorage-backed) |
| 98 | `expandedProjectIds` | A | Local accordion |
| 99 | `projectTasks` | B | Lazy-loaded → `tasksByProject` once lifted |
| 100 | `detailTask` | B | → `selectedTaskDetailId` |
| 101 | `searchQuery` | A | Local search |
| 102 | `matchingTasks` | A | Computed search results |
| 103 | `archivedUndo` | A | 5s undo |
| 107 | `inlineCreateName` | A | Form draft |

### `src/pages/Dashboard.tsx` (8)

| Line | Variable | Class | Note |
|---|---|---|---|
| 160 | `weekTasks` | B | → `tasksByWeek[selectedWeek]` |
| 161 | `plannedByDay` | A | Computed |
| 164 | `workedByDay` | A | Computed |
| 167 | `projectStatsMap` | A | Computed |
| 170 | `projects` | A | Lookup |
| 171 | `recentCompleted` | A | Read-only summary |
| 172 | `pastShutdowns` | A | Read-only summary |
| 173 | `error` | A | Banner |

### `src/pages/WeeklyShutdown.tsx` (8)

| Line | Variable | Class | Note |
|---|---|---|---|
| 266 | `completedThisWeek` | B | → `tasksByWeek` filter |
| 267 | `projects` | A | Lookup |
| 268 | `workedByDay` | A | Computed |
| 269 | `workedPerTask` | B | → `workedMinutesByTask` |
| 270 | `error` | A | Banner |
| 271 | `showSunset` | B | → `sunsetOverlayOpen` |
| 272 | `showPlanPrompt` | A | Local modal |

### `src/pages/QuickAdd.tsx` (6)

| Line | Variable | Class | Note |
|---|---|---|---|
| 16 | `title` | A | Form draft |
| 17 | `projectId` | A | Form draft |
| 18 | `estimateMinutes` | A | Form draft |
| 19 | `projects` | A | Lookup |
| 20 | `submitting` | A | Submission flag |
| 21 | `showProjectPicker` | A | Popover |

### `src/components/SummaryOverlay.tsx` (6)

| Line | Variable | Class | Note |
|---|---|---|---|
| 237 | `dailyTasks` | B | Mirrors canonical → `tasksByDate` filter once available |
| 238 | `weeklyDoneTasks` | B | Mirrors canonical → `tasksByWeek` filter |
| 239 | `weeklyNextTasks` | B | Mirrors canonical → `tasksByWeek` filter |
| 240 | `projects` | A | Lookup |
| 241 | `loading` | A | Local |
| 242 | `copied` | A | Clipboard feedback |

(After M1 the overlay subscribes to the store directly; these become A automatically as the screen consumes lifted data.)

### `src/components/TaskCard.tsx` (4)

| Line | Variable | Class | Note |
|---|---|---|---|
| 118 | `notes` | B | Read from `tasksById[id].notes` directly; local draft only during edit (M3.2; Verse rev 2 ruling) |
| 119 | `links` | B | `Link[]` for task → `linksByTask[taskId]` (entity data) |
| 120 | `newUrl` | A | New-link form draft |
| 129 | `projTooltip` | A | DOM hover tooltip |

### `src/components/CalendarPicker.tsx` (4)

| Line | Variable | Class | Note |
|---|---|---|---|
| 44 | `open` | A | Popover open |
| 45 | `popoverPos` | A | Popover position |
| 52 | `viewYear` | A | Calendar view |
| 53 | `viewMonth` | A | Calendar view |

### `src/components/settings/CalendarSettings.tsx` (9)

| Line | Variable | Class | Note |
|---|---|---|---|
| 42 | `enabled` | A | Settings toggle |
| 43 | `calendars` | A | Loaded once per panel mount; settings-only data |
| 44 | `excluded` | A | Settings toggle set |
| 45 | `lastSyncedAt` | A | Display value |
| 46 | `revoked` | A | Settings flag |
| 47 | `syncing` | A | UI flag |
| 48 | `toast` | A | Local toast |
| 52 | `syncFeedback` | A | Local feedback |
| 53 | `error` | A | Banner |

### `src/pages/PastShutdowns.tsx` (3)

| Line | Variable | Class | Note |
|---|---|---|---|
| 9 | `shutdowns` | A | Read-only summary |
| 10 | `projects` | A | Lookup |
| 11 | `loading` | A | Local |

### `src/components/PastShutdownCard.tsx` (3)

| Line | Variable | Class | Note |
|---|---|---|---|
| 129 | `expanded` | A | Per-card accordion |
| 130 | `completedTasks` | A | Frozen historical snapshot from the shutdown record (default per Verse rev 2; data-semantic verification in `db.ts` required before M3.5 — if it points at live tasks, reclassify B) |
| 131 | `loadingTasks` | A | Lazy-fetch flag |

### `src/components/FocusPip.tsx` (3)

| Line | Variable | Class | Note |
|---|---|---|---|
| 160 | `state` | A | Read from `verseday_pip_state` IPC payload; PiP runs in separate WebviewWindow and can't subscribe to Zustand. PipState extension covered in M2. |
| 161 | `expanded` | A | Local hover state |
| 167 | `pendingAck` | A | UI flag |

### `src/components/DatePicker.tsx` (3)

| Line | Variable | Class | Note |
|---|---|---|---|
| 25 | `viewYear` | A | Calendar view |
| 26 | `viewMonth` | A | Calendar view |
| 28 | `pos` | A | Popover position |

### `src/pages/Settings.tsx` (2)

| Line | Variable | Class | Note |
|---|---|---|---|
| 47 | `focusValues` | A | Settings form, auto-saved |
| 48 | `taskEstimate` | A | Settings form |

### Remaining small files (≤2 useState each)

| File:Line | Variable | Class | Note |
|---|---|---|---|
| `SimpleSelect.tsx:24` | `open` | A | Popover |
| `SimpleSelect.tsx:25` | `pos` | A | Popover position |
| `RichTextEditor.tsx:56` | `isEmpty` | A | Editor internal |
| `RichTextEditor.tsx:57` | `isFocused` | A | Editor internal |
| `ProjectPicker.tsx:12` | `open` | A | Popover |
| `ProjectPicker.tsx:13` | `pos` | A | Popover position |
| `NewProjectPanel.tsx:26` | `name` | A | Form draft (component currently dead code per singleton inventory; flag for cleanup) |
| `NewProjectPanel.tsx:27` | `color` | A | Form draft |
| `DurationPicker.tsx:40` | `isOpen` | A | Popover |
| `DurationPicker.tsx:41` | `customInput` | A | Form draft |
| `WrapUpReminder.tsx:87` | `visible` | A | Banner local |
| `Sidebar.tsx:213` | `showShortcuts` | A | Popover |

### Audit summary

- **Class A (194):** Form drafts, popovers, animation triggers, accordions, banners, page-local fetch state, render-tick computed values. Stay.
- **Class B (41):** Cluster around (a) entity data — `tasks`, `projects`, `links`, `weekStatuses`, `weekCommitments`, `notes` — duplicated per screen; (b) task-time aggregates — `workedMap` / `workedPerTask`; (c) singleton-overlay openers — `detailTask`, `showSummary`, `showSunset`; (d) focus session state — `paused`; (e) inline-edit selection — `editingTaskId`.
- **Class C (0):** All resolved by Verse rev 2 rulings. `rightPanelCollapsed` → A. `elapsed` → A. `statuses` + `commitments` → B (M3.2). `TaskCard.notes` → B (M3.2). `completedTasks` → A by default with a pre-M3.5 verification gate against `db.ts`.

**Hotspots for B (top files, rev 2):** DailyPlanner (8), ProjectDetail (5), DailyShutdown (5), ScheduleTab (4), PlanTab (4 — `tasks`, `detailTask`, `statuses`, `commitments`), WeeklyShutdown (3), Projects (3), SummaryOverlay (3), TaskCard (2 — `notes`, `links`), FocusMode (2 + the pause-symmetry set), Dashboard (1).

---

## 2 — Singleton surfaces inventory

### Already singleton (correct)

| Surface | Mounted at | Mechanism |
|---|---|---|
| `WrapUpReminder` | `src/App.tsx:348` | App-shell render |
| `FocusPip` (Tauri WebviewWindow) | created in `src/pages/FocusMode.tsx:283` | Tauri window — already singleton by window-label contract |

### Should become singleton (currently per-screen mount)

| Surface | Current mount sites | Open mechanism today | Suggested store field | Persist? |
|---|---|---|---|---|
| `TaskDetailOverlay` | `DailyPlanner.tsx:1484`, `DailyShutdown.tsx:604`, `Projects.tsx:736`, `ProjectDetail.tsx:1440`, `weekly-plan/PlanTab.tsx:604`, `weekly-plan/ScheduleTab.tsx:901` (6 sites) | local `detailTask` state in each parent | `selectedTaskDetailId: number \| null` | **No** — overlay closes on app restart |
| `SummaryOverlay` | `DailyPlanner.tsx:1508`, `DailyShutdown.tsx:592` (2 sites) | local `showSummary` state | `summaryOverlay: { kind: "daily" \| "weekly", anchorDate: string } \| null` | **No** |
| `SunsetOverlay` | `DailyShutdown.tsx:590`, `WeeklyShutdown.tsx:646` (2 sites) | local `showSunset` state | `sunsetOverlayOpen: boolean` | **No** |

### Genuinely screen-local (not singleton candidates)

`CalendarPicker`, `DatePicker`, `DurationPicker`, `SimpleSelect`, `ProjectPicker`, `RichTextEditor`, `MoodSelector` — popovers/inputs scoped to one form context. They open/close from the field they're embedded in. Stay local.

### Dead code

`NewProjectPanel` — defined but not imported anywhere. Flag for removal during M3 cleanup pass.

---

## 3 — Refactor sequencing

Each milestone is independently shippable, on its own commit, on a new branch (per Terse rules — never main). Stop for Verse review at every milestone boundary.

> **Dependency chain (Verse rev 2, R4):** M2 depends on M1 (uses the task-by-id selector pattern). M3.2 supersedes M1's transitional `tasksByIdCache` with the canonical `tasksById`. M3.3–M3.5 depend on M3.2. M4 runs against the post-M3 codebase. Revert M1 → must also revert M2. The chain is honest about coupling; reverts must respect it.

> **Seam-first commit discipline (Verse rev 2, R5):** Every milestone opens with a no-op seam commit that adds the new store fields, actions, and singleton mounts *additively* — without removing the old per-screen state. A second commit retires the old state and wires consumers to the seam. This lets a milestone half-revert cleanly if the wire-up commit breaks something the seam commit didn't. Stated explicitly per milestone below.

### M1 — Task Detail Overlay singleton

**Scope**

- Add to `appStore`:
  - `selectedTaskDetailId: number | null` (in-memory only — do **not** persist)
  - `tasksByIdCache: Map<number, Task>` — **transitional bridge**, named explicitly per Verse rev 2 R1 so future readers can grep for it. Annotated in `appStore.ts` with `// TRANSITIONAL — superseded by canonical tasksById in M3.2`. Populated opportunistically by screens that already load tasks (DailyPlanner, ProjectDetail, etc.) via a write-through helper. Falls back to `getTaskById(id)` if a missed entry is requested.
  - `openTaskDetail(id)`, `closeTaskDetail()` actions
  - `selectTaskDetailTask(state)` selector — composes `selectedTaskDetailId` → `tasksByIdCache[id]` (with async-fallback fetch when missing). Future M3.2 reroutes the selector to `tasksById` and retires `tasksByIdCache` in the same commit.
- Mount `<TaskDetailOverlay />` exactly once at `src/App.tsx` (alongside `WrapUpReminder`).
- Retire local `detailTask` state in all six current parent files. Each `setDetailTask(task)` becomes `openTaskDetail(task.id)`.
- Remove `<TaskDetailOverlay ... />` JSX from all six parents.

**Two-commit cadence (Verse rev 2 R5)**

- **M1.a — seam (additive, no behavior change).** Add `selectedTaskDetailId`, `tasksByIdCache`, `openTaskDetail`, `closeTaskDetail`, `selectTaskDetailTask` in `appStore.ts`. Mount the singleton `<TaskDetailOverlay />` at App shell, reading from the new selector. Do **not** touch the six per-screen mounts. Verify the singleton renders correctly by triggering it from one screen (e.g., wire DailyPlanner only as a smoke test).
- **M1.b — wire-up.** Retire all six per-screen `<TaskDetailOverlay />` mounts. Replace `setDetailTask(task)` → `openTaskDetail(task.id)` everywhere. Remove the now-dead local `detailTask` state in each parent.

**Surface changes**
- `src/App.tsx`: add singleton render + import.
- `src/stores/appStore.ts`: add field + cache + two actions + selector.
- `src/pages/DailyPlanner.tsx`, `DailyShutdown.tsx`, `Projects.tsx`, `ProjectDetail.tsx`, `weekly-plan/PlanTab.tsx`, `weekly-plan/ScheduleTab.tsx`: replace local state + JSX (M1.b only).
- `src/components/TaskDetailOverlay.tsx`: receive task via store selector; props shrink to callbacks (or eliminate entirely if all mutations go through store actions).

**Persistence:** none for `selectedTaskDetailId` or `tasksByIdCache`. Overlay closes on relaunch (matches user intent — no half-open modal restore). Cache rehydrates from screens on next render.

**Stop. Ready for Verse review** after M1.b.

### M2 — Focus / pause state lift (= pause-symmetry)

**Design source:** `docs/2026-05-07-pause-symmetry.md` rev 2 — already approved as design.

**Required correction folded in:** Replace `FocusState.task: Task` with `FocusState.taskId: number`. Every consumer that reads `focus.task.title`, `focus.task.notes`, `focus.task.estimated_minutes` etc. now reads through the same task-by-id selector M1 introduced (`selectTaskDetailTask`-style — composes ID → cache lookup; supersedes to `tasksById` in M3.2). This eliminates the snapshot-staleness Verse flagged.

**Scope (delta on top of pause-symmetry rev 2)**

- `FocusState.task: Task` → `FocusState.taskId: number`. Store no longer holds task data; only the reference.
- `startFocus(taskId, timeEntryId, previousPage, priorElapsedMs)` — signature change.
- `updateFocusTask(patch)` action removes (no longer needed; mutations go through `updateTask(id, patch)` and the focus selector picks up the change).
- New selector: `selectFocusedTask(state)` → `state.tasksByIdCache.get(state.focus.taskId)` (M1 selector pattern; supersedes to canonical `tasksById` in M3.2). All FocusMode/Daily Plan reads of `focus.task.X` route through this selector.
- **PiP broadcast subscribes through the composed selector (Verse rev 2 R2).** The PiP runs in a separate WebviewWindow with no Zustand subscription, so it must receive resolved `taskTitle` / `estimatedMinutes` in the IPC payload. The broadcast effect at `src/pages/FocusMode.tsx:445-453` reads from `selectFocusedTask(state)`, **not** from `focus` alone. The resolved task object goes in the effect's dependency array. Without this, a rename made from the detail overlay during a focus session would not re-broadcast and the PiP would show the stale title — re-introducing exactly the snapshot drift this refactor fixes for the main window. The fix is one line in the effect: read the resolved task and add it as a dep.
- Pause-symmetry rev 2's other surface changes (`:492`, `:524`, `:1063`, `:177-181`, `:759-766`, `:328`, `:445-453`, plus TaskCard pause button, `togglePauseFocus`, `adjustFocusElapsed`, `computeFocusElapsedMs`, DB minute correction) all stand.

**Two-commit cadence (Verse rev 2 R5) — applied per pause-symmetry sub-milestone**

- **M2.1 — seam.** Extend `FocusState` with `paused`, `pausedAtMs`, `pausedAccumMs`. Replace `task: Task` with `taskId: number`. Add `togglePauseFocus`, `adjustFocusElapsed`, `selectFocusedTask`, `computeFocusElapsedMs`. Loader defaults + migration shim (`parsed.task && !parsed.taskId` → adopt `parsed.task.id`, drop the snapshot). No surface changes yet — old `handlePause`/local `paused`/`pausedAtRef` still in place. Build green; existing behavior unchanged.
- **M2.2 — Focus screen + PiP wire-up.** Retarget `:492`, `:524`, `:1063` to `togglePauseFocus`. Delete `handlePause` and the three locals. Drop the pause-related lines from `:177-181`. Rewrite `applyActualMs` to use `adjustFocusElapsed`. Update PiP broadcast to read from `selectFocusedTask` (R2). Extend `PipState` interface.
- **M2.3 — Daily Plan wire-up.** TaskCard pause button → `togglePauseFocus`. Live pill freezes from store fields. Icon swap.
- **M2.4 — DB minute correction.** `stopTimeEntry` callers pass corrected duration via `computeFocusElapsedMs - priorElapsedMs`.

**Persistence:** `focus` continues to persist (existing behavior). Persisted shape carries `taskId`, `paused`, `pausedAtMs`, `pausedAccumMs`. Loader defaults the three pause fields and migrates the legacy `task` field per pause-symmetry rev 2 + the M2.1 shim above.

**Stop. Ready for Verse review** at each sub-milestone (M2.1, M2.2, M2.3, M2.4) plus a final M2 capstone.

### M3 — Remaining (B)-class lifts

Grouped by area for reviewability. Each sub-milestone is one commit.

**M3.1 — Singleton overlays (the easy two)**
- `SummaryOverlay` → `summaryOverlay` field + actions; mount at App shell; retire `showSummary` state in DailyPlanner + DailyShutdown.
- `SunsetOverlay` → `sunsetOverlayOpen` field + actions; mount at App shell; retire `showSunset` state in DailyShutdown + WeeklyShutdown.

**M3.2 — Canonical task map (`tasksById`)**
- Add `tasksById: Map<number, Task>` to store. Single canonical source. **Retire `tasksByIdCache` in this same commit** — the transitional bridge from M1 must not survive M3.2 (per DoD §4.7).
- Add selectors:
  - **List-level (parent screens):** `selectTaskIdsByDate(state, date)`, `selectTaskIdsByProject(state, projectId)`, `selectTaskIdsByWeek(state, weekStart)`. Return `number[]` only.
  - **Per-row (TaskCard):** `selectTaskById(state, id)`. Returns `Task | undefined`.
  - **Composed:** `selectFocusedTask(state)` reroutes to `tasksById` (was reading `tasksByIdCache` in M1).
- Add `weekStatusesByWeek` and `weekCommitmentsByWeek` maps + selectors (per Verse rev 2 C-class rulings on `PlanTab:53/56`).
- Add actions: `loadTasks(filter)`, `updateTask(id, patch)`, `deleteTask(id)` — all writing to `tasksById` and notifying subscribers.
- **Per-row subscription is mandatory, not validation (Verse rev 2 R3).** TaskCard subscribes to `selectTaskById(state, id)` directly with `shallow` equality. Parent screens (DailyPlanner main list, ProjectDetail task list, ScheduleTab grid, Dashboard week summary) subscribe to ID lists only — never to whole task objects. A task mutation re-renders only the modified row, never the parent list. Profiler validates after the fact; it does not gate the implementation.
- Migrate `tasks` arrays in DailyPlanner, ProjectDetail, DailyShutdown, WeeklyShutdown, Dashboard, PlanTab, ScheduleTab, Projects, SummaryOverlay, TaskCard (notes read), PastShutdownCard (pending Verse rev 2 verification gate). Eleven files.
- This is the milestone that validates the M1 selector-based task read and retires `tasksByIdCache`.

**Two-commit cadence (Verse rev 2 R5)**
- **M3.2.a — seam.** Add `tasksById`, `weekStatusesByWeek`, `weekCommitmentsByWeek`, all selectors and actions. Reroute `selectFocusedTask` and `selectTaskDetailTask` to `tasksById`. Delete `tasksByIdCache` + its `// TRANSITIONAL` annotation. No screen changes yet; existing local `tasks` arrays still in place. Build green.
- **M3.2.b — wire-up.** Migrate the eleven files to read via selectors. Delete the local `tasks` / `weekTasks` / `allProjectTasks` / equivalents. Apply per-row subscription pattern in TaskCard.

**M3.3 — Task time aggregates (`workedMinutesByTask`)**
- Add `workedMinutesByTask: Map<number, number>` to store.
- Add `loadWorkedMinutes(taskIds)` action; cache invalidation on `stopTimeEntry`.
- Migrate `workedMap` / `workedPerTask` in DailyPlanner, ProjectDetail, DailyShutdown, WeeklyShutdown.

**M3.4 — Cross-screen UX state**
- `editingTaskId: number | null` (DailyPlanner + ProjectDetail).
- `dailyPlanByDate: Map<string, DailyPlan>` (DailyPlanner — drops `dailyPlan` and `dailyNotes` locals).
- `rolloverBacklog`, `sidebarTasks` — derive from `tasksByDate` map; drop their dedicated locals.

**M3.5 — Cleanup**
- Resolve all class-C items per Verse's calls.
- Remove dead code: `NewProjectPanel` if confirmed unused.
- Remove `handleStopFocus` from DailyPlanner if M2/M3 leaves it unreferenced.

**Stop. Ready for Verse review** at every sub-milestone.

### M4 — Lint guardrail

**Scope**

- Custom ESLint rule: `no-task-in-usestate` — flags any `useState` whose type parameter is `Task`, `Task | null`, `Task[]`, or any pattern matching `useState<.*Task.*>` in `src/pages/` and `src/components/`.
- Same rule covers `Project` and `Project[]` (the same drift class applies; we lifted `projects` in M3).
- Allowlist: explicit per-file inline disables only with a comment justifying the exception.
- Add to CI lint step. CI gate must be green.

**Why not a grep CI check?** A real ESLint rule reports on the AST and respects type imports/aliases. Grep would miss `useState<typeof someTask>` and false-positive on string matches. Per the brief: "lint rule or ESLint custom rule" — picking the stronger option.

**Stop. Ready for Verse review.**

---

## 4 — Definition of done

The work is complete when **all** of the following hold:

1. `grep -rn "useState<Task" src/pages src/components` and `grep -rn "useState<.*Task.*\[\]" src/pages src/components` return zero matches that own a task or task-list.
2. `<TaskDetailOverlay />` is mounted exactly once in the app tree (verified at `src/App.tsx`; six former mount sites removed).
3. A change made to a task's title/notes/estimate/priority/date from any screen (Daily Plan inline edit, Detail Overlay save, Project Detail inline edit, Focus Mode title edit) is visible on every other open screen showing that task within one render tick — no manual reload, no refetch.
4. Pausing a focus session from any of {Focus screen, PiP, Daily Plan row} pauses it on all three within one tick. Resuming from any resumes all three.
5. The lint rule from M4 is in CI and green on the post-M3 codebase.
6. (Operational) Every milestone landed on its own commit on a non-main branch, each preceded by a Verse approval and followed by a Verse review.
7. **(Verse rev 2 R1)** M3.2 has retired `tasksByIdCache` and replaced it with canonical `tasksById`. No transitional bridge survives the refactor. `grep -rn "tasksByIdCache" src/` returns zero matches.

---

## 5 — Risks

### 5.1 Re-render scope

DailyPlanner and ProjectDetail render dozens-to-100+ task rows. Lifting `tasks` and `workedMap` to the store means each row's container subscribes. Naively, any task mutation re-renders every row.

**Implementation rule (Verse rev 2 R3 — mandatory, not validation):** M3.2 implements per-row subscription from the start. `TaskCard` subscribes to `selectTaskById(state, id)` directly with `shallow` equality. Parent screens subscribe to ID lists only (`number[]`) — never to whole task arrays. A task mutation re-renders only the affected row, not the parent list. The same pattern applies to `selectWorkedMinutesByTask(state, id)` for time aggregates. Profiler is the post-hoc check, not the trigger for this pattern.

**Files at highest risk:**
- `src/pages/DailyPlanner.tsx` — sidebar rails + main list, up to ~200 rows
- `src/pages/ProjectDetail.tsx` — calendar + project task list
- `src/pages/weekly-plan/ScheduleTab.tsx` — week × day × task grid
- `src/pages/Dashboard.tsx` — week summary; subscribes to `tasksByWeek` post-M3.2 (Verse rev 2 R3 addition)

Profiler validation runs at the end of M3.2 (task list reads) and M3.3 (worked-minutes reads). If a regression appears, the fix is a tighter selector — not weakening the per-row subscription rule.

### 5.2 Persistence — explicit per field

| Field | Persisted? | Why |
|---|---|---|
| `selectedTaskDetailId` | **No** | Overlay should close on restart; user intent is one session at a time |
| `summaryOverlay` | **No** | Modal state, transient |
| `sunsetOverlayOpen` | **No** | Animation overlay, transient |
| `editingTaskId` | **No** | Mid-edit state shouldn't survive restart; commit-on-blur protects unsaved work |
| `tasksById` | **No** | SQLite is canonical; rehydrate on app load |
| `workedMinutesByTask` | **No** | Derived from `time_entries`; rehydrate on app load |
| `dailyPlanByDate` | **No** | Derived from SQLite |
| `focus.taskId` / `paused` / `pausedAtMs` / `pausedAccumMs` | **Yes** | Per pause-symmetry rev 2 — relaunch-while-paused must restore as paused |

### 5.3 Migration of in-flight sessions

- **`focus.task: Task` → `focus.taskId: number`.** Existing persisted `FocusState` JSON contains a full `task` object. Loader code path:
  ```ts
  if (parsed.task && !parsed.taskId) {
    parsed.taskId = parsed.task.id;
    delete parsed.task;
  }
  ```
  Plus the pause-symmetry rev 2 defaulting (`paused`, `pausedAtMs`, `pausedAccumMs`).
- No SQL migration. No schema change. Per `/docs/migration-discipline.md` — fully compliant.

### 5.4 PiP IPC payload shape change

`PipState` gains `pausedAtMs`, `pausedAccumMs` (M2). Older PiP windows from the previous session (if any survive a hot reload across the upgrade boundary) read the old shape. Loader in `FocusPip.tsx:213-216` uses `Partial<PipState>` defaulting; missing fields default safely to current behavior.

### 5.5 The `TaskCard.notes` ambiguity

TaskCard:118 `notes` is class C. Reading from `tasksById[id].notes` directly works for display; the question is what happens during edit. M3.2 resolves: edit creates a local draft, save commits via `updateTask(id, { notes })`, store update propagates back to TaskCard. Standard draft pattern, no drift.

### 5.6 Selector churn risk

If a selector returns a new array/object reference on every store update, all subscribers re-render. Mitigation: selectors that return collections must memoize via `useMemo` at the call site or use `shallow` equality. Document this expectation in `appStore.ts` next to each selector.

---

## 6 — Constraints (carry-forward from brief)

- **Security:** no new IPC channels, no new persisted secrets, no new external calls. Local refactor only.
- **Budget:** zero. No paid services touched.
- **Migrations:** none — no SQL files modified. Compliant with `/docs/migration-discipline.md`.
- **Branching:** new branch (`refactor/task-as-entity`), per `/CLAUDE.md`. Never main.

---

## 7 — Process

1. Verse reviews this plan. Approves or rejects with specific revisions.
2. Approved plan → branch → M1 → STOP, Ready for Verse review → M2 (resubmit pause-symmetry doc with `taskId` correction folded in) → M3.x sub-milestones → M4.
3. Each milestone gets its own commit. Each milestone is independently revertable.
4. Definition of done from §4 must hold before declaring complete.

---

**Ready for Verse review.**
