# Focus Screen — Single Screen, Two States

Date: 2026-05-06
Branch: `feat/focus-screen-unified`

## What changes

The pre-focus picker (`FocusLanding`) is deleted. The sidebar Focus icon now navigates directly to the immersive Focus screen (`focus`). The screen handles task selection itself: if there is no active session, it auto-starts the next queued task on mount.

Net user-visible behavior: identical to today (icon click → session running on the top remaining task), one screen fewer.

## Milestones

- **M1+M2 (this commit):** routing + auto-start. Combined because landing M1 alone leaves the focus icon pointed at a screen that renders nothing without a session — broken intermediate state.
- **M3:** layout rewrite per the brief — title, notes, ring, timer, three buttons in `stop · complete · pause/play` order (revised from the brief's `pause/play · stop · complete`), Complete tinted green. **Project pill dropped** from the brief (focus screens are task-only by standing preference).
- **M4:** pulse ring (two rings, ~0.4 s offset, fade outward).
- **M6:** polish + verify.
- **M5 (Pomodoro removal): cut.** Timer behavior stays as-is.

## Decisions made in this milestone

### Why M1 and M2 collapsed into one milestone

The original plan separated routing (M1) from auto-start (M2). But once the Focus icon points at `setPage("focus")`, the existing `currentPage === "focus" && focus` gate in App.tsx falls through — the user would see a blank screen until M2 landed. Combining keeps the branch in a shippable state at every milestone boundary.

### Auto-start lives in FocusMode, not in the icon click handler

Two reasonable places to put "load + start session": the click handler (icon) or the screen itself (FocusMode mount effect). FocusMode wins because:

- ⌘0, F-with-no-tasks, and the sidebar icon all enter the same way — one boot path covers all three.
- An error during start needs a UI surface to show the error and retry. The icon click can't render UI; the screen can.
- Future entry points (e.g. a "go to focus" link from a notification) inherit the same boot logic for free.

### Boot states: `starting | empty | error`, no `idle` UI

`idle` exists as an internal kick-off gate but never renders — the effect transitions to `starting` synchronously in the same tick. So the user only ever sees one of the three meaningful states.

`starting` shows a small "Starting…" line with the focus identity glyph, intentionally not the empty-day copy. The truth is "we're spinning up your task," not "you have no tasks." Misreading this as "empty" was N1 from Verse's review.

`empty` reuses `getEmptyDayMessage()` — same time-of-day buckets the deleted FocusLanding used. No need to re-author copy.

`error` is its own state, not a fall-through to `empty`. "We couldn't start a session" is meaningfully different from "you have nothing to start." Retry button + back-to-plan escape hatch. This was N2.

### Boot kick-off gated by ref, not state

First version had `bootStatus !== "idle"` as the kick-off guard with `bootStatus` in the effect deps. Subtle bug: setting `bootStatus → "starting"` triggered a re-render → effect cleanup ran → `cancelled = true` → in-flight async boot bailed before calling `startFocus`. The user would be stuck on "Starting…" forever.

Fixed by switching the gate to `bootStartedRef` (a ref) and adding a separate `bootRetry` counter that the retry handler bumps. The ref guard is independent of render, so the in-flight boot survives the re-render that `setBootStatus("starting")` triggers.

### Task ordering

`getTasksForDate(today)` already orders by `sort_order` — same as the Schedule tab in DailyPlanner. "First remaining task" = `tasks.filter(t => t.status !== "done")[0]`. No new query needed, and it matches whatever order the user has dragged things into on the Schedule tab.

### `previousPage` for the auto-started session

The deleted FocusLanding hardcoded `"focus_landing"` as the previousPage so Stop would return there. With FocusLanding gone, the auto-start uses the previous entry on `pageHistory` (the page the user was on before clicking Focus), falling back to `"daily"`. This means Stop returns the user to wherever they came from instead of always to a now-nonexistent landing.

## Files touched

- Delete: `src/pages/FocusLanding.tsx`
- Modify: `src/App.tsx`, `src/pages/FocusMode.tsx`, `src/pages/DailyPlanner.tsx` (comment), `src/components/Sidebar.tsx`, `src/stores/appStore.ts`, `src/types/index.ts`

### No project pill

The brief asked for a small project pill (green dot + name) above the task title. The user countermanded this when the work approached M3, reaffirming a standing preference: focus surfaces are task-only. Dropped the project pill from FocusMode (it was still rendering from the pre-existing tinted-pill code) along with the `getProjectById` import, the `Project` type import, and the load-project effect. Saved as a feedback memory so future briefs touching focus surfaces won't re-introduce project context by default.

## Salvage from the stash

`git stash@{0}` ("wip: pre-unification ripple+pill") contains a partial ripple/pill rework on `main`. Conceptually adjacent to M4 but lower salvage value once M4 lands two-ring pulse. Keep stashed for reference; reach for it if M4 needs a starting point for opacity/scale curves.

## What's not done yet

M3 (layout), M4 (pulse ring), M6 (polish). Stopping here for Verse review.
