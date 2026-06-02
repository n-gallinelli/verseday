# Task Adders — Fix Plan (Terse → Verse review)

**Date:** 2026-06-02
**Author:** Terse
**Status:** AWAITING VERSE REVIEW — no code written yet
**Scope:** Two distinct "task adder" surfaces. Four defects. No DB schema changes / no migrations.

---

## 0. Context: there are TWO adders (don't conflate them)

| Adder | Where | How it renders | Estimate chips today |
|---|---|---|---|
| **QuickAdd overlay** | Global, `Cmd+Shift+A` | **Separate Tauri webview** (`window.location.hash === "#quick-add"`, App.tsx:67; Rust window label `"quick-add"`) | `15m / 30m / 1h / 2h` |
| **Daily Plan inline add row** | Bottom of Daily Plan | In the **main** webview | `0m / 15m / 30m / 45m / 1h / 90m` (DurationPicker) |

The single most important architectural fact: **QuickAdd is a separate webview.** Each Tauri webview is its own JS context with its own Zustand store instance. The canonical store (`tasksById` / `taskIdsByDate`) in the main window is **not** reachable from the QuickAdd window, and DOM `CustomEvent`s (e.g. `verseday:project-changed`) **do not cross webviews** (already documented in `src/utils/projectEvents.ts`). The only state genuinely shared across windows is **the SQLite DB**. So "tap into canonical data" here means: *both windows read the same DB through the same query/filter, and cross-window changes are announced via Tauri events* — not a shared in-memory store.

---

## Defect 1 — QuickAdd shows the wrong objectives

**Symptom (user):** the QuickAdd project list doesn't match the real objectives.

**Evidence:**
- `src/pages/QuickAdd.tsx:35` loads `getProjects()` → `getProjects(includeArchived = false)` returns `WHERE archived = 0` (queries.ts:109-117). This includes **completed-but-not-archived** objectives.
- The rest of the app filters those out via `activeObjectiveOptions(projects, selectedId)` (`src/utils/objectiveOptions.ts:15`), used by DailyPlanner (DailyPlanner.tsx:165) and TaskDetailOverlay (TaskDetailOverlay.tsx:407). QuickAdd does **not** use it → it surfaces objectives the rest of the app hides.
- QuickAdd renders a plain **color dot** (QuickAdd.tsx:337-340), not the objective's icon/emoji. Everywhere else uses `<ProjectGlyph>` (e.g. ProjectPicker.tsx:131), so the same objective *looks* different in QuickAdd.

**Root cause:** QuickAdd reuses neither the canonical active-objectives filter nor the canonical glyph renderer.

**Proposed fix:**
1. Derive the list with the shared helper: `activeObjectiveOptions(getProjects(false), selectedId)` — identical to DailyPlanner. This makes the DB the single source of truth and removes the completed-objective drift by construction.
2. Render rows with `<ProjectGlyph>` + `useCustomIcons()` so emojis/custom icons match the main app.
3. Keep the existing refetch-on-focus (QuickAdd.tsx:79-91) — focus is the right trigger here since the window is hidden between uses and you must focus it to type. (DOM `onProjectChanged` can't help across webviews; focus-refetch is the correct cross-window equivalent.)

**Files:** `src/pages/QuickAdd.tsx` only. Reuses existing `src/utils/objectiveOptions.ts`, `src/components/ProjectGlyph.tsx`, `src/hooks/useCustomIcons.ts`.

---

## Defect 2 — QuickAdd task doesn't appear on the current day

**Symptom (user):** add a task in QuickAdd → it never shows on today's Daily Plan.

**Evidence:**
- QuickAdd inserts via the raw DB fn `createTask(...)` with `dateScheduled: todayString()` (QuickAdd.tsx:131-137), then `invoke("dismiss_quick_add")` (commands.rs:33) hides the window. **The row is written to the DB correctly.**
- The Daily Plan renders from the **main window's** canonical store: `selectTaskIdsByDate(s, selectedDate)` → `tasksById` (DailyPlanner.tsx:77-110). Nothing tells the main window's store that a row was inserted by the *other* webview.
- There is no main-window refresh trigger on QuickAdd submit (no Tauri `listen` for task creation; main window doesn't reload on regaining focus). So the task stays invisible until an unrelated reload (date change, app relaunch).

**Root cause:** cross-webview write with no cross-webview notification. The insert is real but the main window's store is never told to re-read.

**Proposed fix (the "overhaul" the user anticipated — it's modest):**
1. After a successful insert, QuickAdd emits a **Tauri global event**:
   `import { emit } from "@tauri-apps/api/event"; await emit("verseday:task-created", { date: todayString() });`
   (We already use this exact pattern: Rust `app.emit("system-resumed", ())` → JS `listen("system-resumed", …)` in App.tsx:176.)
2. In the **main window only**, register a listener (in the main branch of `App.tsx`, *after* the `#quick-add` early-return so it never mounts inside the QuickAdd webview):
   `listen("verseday:task-created", (e) => useAppStore.getState().loadTasksForDate(e.payload.date))`.
   `loadTasksForDate` replaces that date's bucket from DB truth (appStore.ts:1071) and DailyPlanner re-renders via its selector subscription. If the user is viewing that date, the task appears immediately; if not, it's already correct when they navigate there.
3. Emit **before** `dismiss_quick_add` (or right after; order doesn't matter — the event is independent of the window hide).

**Open question for Verse (Q-A):** scope of the refresh. Options:
- (a) `loadTasksForDate(date)` — minimal, makes the task appear. **Recommended.**
- (b) full `loadData()` equivalent — also refreshes worked-minutes/sidebar/notes. Heavier; unnecessary for a brand-new zero-worked task.
I propose (a). Flag if you want (b) for consistency.

**Files:** `src/pages/QuickAdd.tsx` (emit), `src/App.tsx` (listen, main-branch only). No Rust change required (JS-side global `emit` reaches all webviews).

---

## Defect 3 — QuickAdd estimate chips: replace `2h` with `5m`

**Symptom/ask (user):** offer a 5m estimate; replace the 2h one.

**Evidence:** `ESTIMATE_PRESETS` (QuickAdd.tsx:8-13) = `15m / 30m / 1h / 2h`.

**Proposed fix:** change the array to `5m / 15m / 30m / 1h` (drop `{label:"2h",value:120}`, add `{label:"5m",value:5}` at the front so it reads ascending). This also aligns with the app's default task estimate of 5m (Settings → Task defaults).

**Files:** `src/pages/QuickAdd.tsx` (one array). Toggle behavior (click active chip → clear) is unchanged.

---

## Defect 4 — Daily Plan add row collapses when you pick a project

**Symptom (user):** in the Daily Plan inline adder, selecting a project closes the whole adder; it should just select and stay open.

**Evidence:**
- The add row collapses on any outside `mousedown`: `handleClickOutside` → `setTaskInputExpanded(false)` when the target is not inside `taskInputRef` (DailyPlanner.tsx:299-307).
- `ProjectPicker` renders its dropdown through `createPortal(..., document.body)` (ProjectPicker.tsx:95-137). The option buttons live in `document.body`, **outside** `taskInputRef`. So clicking an option fires the document `mousedown` handler, which sees "outside" and collapses the adder.

**Root cause:** the click-outside collapse doesn't account for portaled popovers that logically belong to the add row.

**Proposed fix:** mark portaled picker popovers and exclude them from the collapse check.
1. Add a stable marker to the portal container(s), e.g. `data-portal-popover` on `ProjectPicker`'s portal `<div>` (and `DurationPicker`'s portal if it has one — DurationPicker.tsx also has a click-outside listener and likely portals; confirm during implementation and apply the same marker).
2. In `handleClickOutside`, ignore clicks within a marked popover:
   `if (taskInputRef.current && !taskInputRef.current.contains(t) && !(t as HTMLElement).closest("[data-portal-popover]")) setTaskInputExpanded(false);`

This keeps click-away-to-collapse working for genuine outside clicks while treating the picker dropdowns as part of the open adder. Pure additive guard; no behavior change to either picker.

**Files:** `src/pages/DailyPlanner.tsx` (the guard), `src/components/ProjectPicker.tsx` (marker), and `src/components/DurationPicker.tsx` (marker, if it portals).

---

## Security / architecture review notes (for Verse)

- **No DB schema change, no migration.** All four fixes are UI/event wiring. Migration-discipline doc untouched.
- **No new credentials / network / cost.** Calendar/AI surfaces not involved. Budget impact: zero.
- **Tauri event surface:** `verseday:task-created` is a fire-and-forget, in-process event carrying only a date string `{ date: "YYYY-MM-DD" }`. No PII, no task content crosses the boundary; the main window re-reads from the local DB it already owns. No new IPC command, no new capability/permission in `capabilities/`.
- **Listener placement risk:** the listener MUST be registered only in the main webview (after the `#quick-add` early return in App.tsx). If it mounted in the QuickAdd webview too, QuickAdd would needlessly call `loadTasksForDate` in its throwaway store — harmless but wasteful. Implementation will gate it in the main branch.
- **Cross-webview store is NOT introduced.** We are explicitly *not* lifting projects into a canonical `projectsById` store. That M5 deferral (see memory) wouldn't help here anyway — separate webviews can't share an in-memory store; the DB + Tauri events are the correct shared layer. Calling that out so we don't over-build.
- **`activeObjectiveOptions` reuse** keeps a single definition of "active objective" across QuickAdd, Daily Plan, and Task Detail — removes the drift class entirely rather than patching one symptom.

## Test plan

- `tsc --noEmit` + `eslint` clean on touched files.
- QuickAdd: open `Cmd+Shift+A` → project list matches Objectives screen (no completed objectives; emojis present). Add a task → it appears on today's Daily Plan without relaunch. `5m` chip present, `2h` gone; clicking `5m` then re-clicking clears it.
- Daily Plan add row: expand (`A`), open project picker, select an objective → row stays open with the objective selected; click genuinely outside → collapses as before. Repeat for DurationPicker's expanded popover.
- Regression: existing Daily Plan add (createTaskAction path) still works and still collapses on submit.

## Rollout

Per project rules: new branch, no main push. Build + reinstall to `/Applications/verseday.app` after Verse APPROVES. Awaiting **APPROVED / REJECTED** with reasons.
