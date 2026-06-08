# Quick-Add click-away + shared objective tooltip + task→objective shortcut

**Date:** 2026-06-08
**Branch:** `feat/quickadd-dismiss-and-objective-tooltip` (based on the
objective-tooltip branch so the shared hook has a home)
**Author:** Terse
**Status:** Implemented — pending Verse review

Three small, related UX requests bundled together.

## 1. Quick-Add dismisses on click-away

**Want:** clicking outside the Quick-Add bar closes it.

Two distinct "outside" zones, handled separately:

- **Inside the window, outside the bar** (the transparent area around the
  bar — the window is a 760×400 transparent overlay): a `mousedown` whose
  target is not inside the card dismisses. Staged like Esc — an open
  objective dropdown closes first, the window on the next click. The
  dropdown is a DOM descendant of the card (absolute positioning doesn't
  change DOM containment), so clicking it never counts as "outside."
- **Outside the window entirely** (another app/window): handled by
  re-enabling **blur-dismiss**, which had been deliberately disabled.

### Why blur-dismiss was off, and how it's safe now

The prior code (and a long comment) disabled blur-dismiss because
borderless transparent always-on-top windows on macOS fire a **stray blur
the instant the global-shortcut chord (Cmd+Shift+A) is released** — the
window would appear and immediately vanish. A flat 250ms grace "didn't
always cover it."

New approach — **arm-then-dismiss**:
- Blur-dismiss starts **disarmed** on every show (`resetFields` clears it).
- It arms after a **450ms grace** from focus, OR immediately on a genuine
  interaction (a keystroke, or any `mousedown` inside the window via a
  capture-phase handler).
- A blur only dismisses **once armed** — so the chord-release blur (which
  lands within the grace, before any interaction) is ignored, while a real
  click on another app later dismisses.

Esc and re-pressing the shortcut still dismiss, unchanged.

## 2. Full-objective-name tooltip on Quick-Add

The objective dropdown rows truncate. Same styled hover tooltip that the
Daily Plan task-detail Objective dropdown got now appears here.

**Refactor:** the tooltip logic that lived inline in `ProjectPicker` is
extracted into a shared hook, `useObjectiveNameTooltip(iconsById)`
(`src/components/useObjectiveNameTooltip.tsx`), returning
`{ showTip, hideTip, tooltip }`. Both `ProjectPicker` and `QuickAdd` use
it, so the two surfaces can't drift. Behavior is unchanged for
ProjectPicker (portal to `document.body`, right-of-row with left-flip,
scroll/resize reposition, " - " qualifier split). In the Quick-Add webview
the portal targets that window's own `document.body` — correct, since each
Tauri webview is its own document.

## 3. "Open" shortcut from a task to its objective

**Want:** on the task detail, when an objective is attached, a small
button to jump to that objective's details page.

Added an optional `labelAction` slot to `PropertyRow` (rendered right of
the label). The Objective row passes an "Open ↗" link when `projectId` is
set; it calls `onClose()` (so the project-detail modal doesn't stack on
the task overlay) then `openProject(parseInt(projectId))` — the existing
store navigation action. Hidden when no objective is attached.

## Validation

- `tsc --noEmit`: clean.
- `npm run build` (vite production bundle): clean.
- Lint: changed files clean. (The repo's `npm run lint` baseline is
  already red project-wide with `react-hooks/exhaustive-deps` "rule not
  found" across many untouched files — a flat-config plugin-registration
  issue, pre-existing and unrelated.)
- No Rust/DB changes. No new deps, no network, no cost.

## Notes for Verse

- Blur-dismiss re-enables a behavior that was explicitly removed for a
  real bug; the arm-then-dismiss design is the safeguard. The 450ms grace
  is a heuristic — flag if you want it tied to a more deterministic signal
  than elapsed time.
- This branch is based on the objective-tooltip branch (not main) so it
  carries those commits too; shipping/merging order TBD with the calendar
  branch.
