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

## M3 + M4 (combined commit)

Combined because M3 (layout) and M4 (pulse) share the same SVG stack — tuning them in one pass avoids a second round of fiddling with the same z-ordering.

### Decisions

**Title.** 28px semibold → 24px medium. The ring + timer numerals are the screen's anchor; the title sits quieter under them. `mb-6` → `mb-5` to bring the notes closer.

**Work-time progress arc.** Previously the colored arc only rendered during break; the work phase showed a static green ring. Brief wanted the arc to fill clockwise as time accumulates, which now happens (`progress = totalWorkedMs / estimatedMs`, capped at 100% via `Math.min`, hidden if no estimate). Same SVG slot as the break countdown — only one of the two ever renders. No-estimate tasks get an empty arc; the pulse rings carry the "session is live" signal regardless of whether the estimate produces visible progress.

Overflow handling: capped at 100%, no color change past the cap. Treating "over the estimate" as a separate visual problem; flagged for later.

**Complete button tint.** Added `bg-accent-green-bright/10` default fill, `bg-accent-green-bright/20` hover. Border kept, size kept (w-12 vs siblings' w-10). The fill gives the button visual weight without making it shouty — it sits between the ghost-style Stop/Pause and a fully-saturated CTA.

**Pulse rings.** Two `<div>` wrappers each containing a circle stroke matching the main ring (7px). Both use the same `focusPulseRipple` keyframe (opacity 0.45 → 0, scale 1 → 1.22, 2.4s ease-out infinite); the second carries `.focus-pulse-ring-delayed` for an `animation-delay: 0.4s`. Single keyframe + two delay values per Verse's note.

Hidden when paused (the wrapper divs are not rendered) — absence of motion is the paused-state signal.

Hidden during prompt phase: the existing `{!isPrompting && (...)}` wrapper around the timer block already handles this, since BreakCelebration replaces the entire ring during prompt. No new conditional needed.

**Dead CSS removed.** `timer-pulse` keyframe + `.timer-circle-ring`/`.timer-circle-ring.paused` classes (the main ring no longer pulses on its own — the pulse is its own dedicated layer now). Old `focusGlowPulse` + `focusGlowFadeOut` + `.focus-glow-layer` replaced by the new pulse-ring keyframe.

The 5-minute fade-out (`focusGlowFadeOut`) was deliberately not carried forward. Its purpose was calming the screen on long sessions; the new ripple is already gentle (peak opacity 0.45, fades to 0 within each cycle), so a global fade-out would just kill the heartbeat.

**`prefers-reduced-motion` fallback.** Pulse animation drops; rings render at static opacity 0.25 so the ring stack still visually exists.

### Stash @{0}

Sanity-checked the stash's opacity/scale curves before tuning. Stash had one ring at opacity 0.55 → 0, scale 1 → 1.18, single keyframe — close to but not identical to what M4 wanted. Final values (0.45 → 0, scale 1 → 1.22) are slightly punchier on travel, slightly softer on peak, optimized for the dual-ring composition. Did not copy-paste from the stash.

## What's not done yet

M6 (manual verify in `npm run tauri dev`). Stopping here for Verse review.
