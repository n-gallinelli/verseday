# Plan — Adjust "Actual" time on the focus screen when the clock isn't running

**Date:** 2026-06-11
**Author:** Terse
**Status:** PENDING Verse review
**Branch (proposed):** `feat/focus-edit-actual-preview`

## Problem

On the focus screen the user can only edit the **Actual** time while the
session is `active` (running or paused). When they first land on the screen the
focus is in **preview** mode (`focus.mode === "preview"`, `isQueued === true`) —
no `time_entry` row exists yet, the clock is not running, and the Actual numerals
are disabled. The user wants to adjust Actual in that state too.

`active` + paused already permits editing (session exists, `mode === "active"`),
so the only locked "not running" case is preview.

## Constraint / why it's not a one-liner

`applyActualMs` writes `session.workedMs` via `adjustFocusElapsed`. In preview
there is no session. So preview edits must persist a different way.

The store already has the right path: **`setTaskWorkedMinutesAction(taskId, minutes)`**
- writes the DB via `setManualWorkedMinutes` (insert adjustment on increase;
  delete+reinsert closed entries on decrease — existing behavior, same as the
  daily-planner manual edit),
- refreshes the canonical `workedByTaskId` index,
- calls `setFocusPriorElapsedMs(taskId, minutes*60_000)`, which patches
  `focusView.priorElapsedMs`. In preview `totalWorkedMs === focus.priorElapsedMs`,
  so the displayed number updates immediately.

No new DB function. **No DDL → no migration → no schema freeze concern.** $0 cost.

## Changes (all in `src/pages/FocusMode.tsx`)

1. **Pull the action** — add `setTaskWorkedMinutesAction` to the `useAppStore()`
   destructure (line ~116).

2. **`applyActualMs` (≈1286)** — branch on mode:
   - `active`: unchanged (`adjustFocusElapsed`, floored at `priorElapsedMs`).
   - `preview`: `setTaskWorkedMinutesAction(focus.taskId, round(max(0,targetMs)/60000))`.

3. **Actual button gate (≈1516–1531)** — enable in preview as well as active:
   replace the `isQueued || focus?.mode !== "active"` disable/cursor/title checks
   with "focus exists and not on break/prompt." Keep the existing faded color in
   preview (visual choice unchanged).

4. **Popover render (≈1550)** — render when `actualOpen && focus` (preview or
   active). Preview can't be on break/prompt, so no extra guard needed.

5. **`minMinutes` (≈1555)** — in preview the floor is `0` (priorElapsedMs is the
   whole editable total, not "earlier sessions"); in active keep
   `ceil(priorElapsedMs/60000)`.

6. **`onClear` (≈1565)** — preview clears to `0`; active keeps `priorElapsedMs`.

## Out of scope / unchanged

- Active-mode floor semantics (can't reduce below earlier sessions in the popover).
- Break / prompt sub-states (active-only; untouched).
- Pause/resume, tick, boot reconcile.

## Verification (per `feedback_self_validate` — no manual UI test unless needed)

- `tsc` / build clean.
- Code review of the diff.
- grep that no other caller of `applyActualMs` regresses.
