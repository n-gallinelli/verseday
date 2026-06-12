# PiP "on task complete" behavior — setting + close-with-feedback plan

**Date:** 2026-06-12
**Author:** Terse
**Status:** PLAN — awaiting Verse review (no code written yet)

## Context

Today, completing a task from the mini timer (PiP) always **advances to the
next remaining task and keeps the PiP open** (`handleDone` →
`previewFocus(next)`). Nick wants this to be a **user choice**:

- **Stay open** → advance to the next task (current behavior), or
- **Close** → finish the task and dismiss the PiP.

Additional requirement: when the **Close** option is active, the PiP must not
vanish instantly — it should play a brief **visual completion beat** (the
existing green-burst "Done" flourish) and *then* close.

No DB schema change (uses the existing key-value `settings` table). No new
window/IPC surface — reuses the existing `PIP_STATE_EVENT` channel and the
PiP's existing `completeWithFlourish` animation.

---

## Design

### 1. New setting (`src/utils/focusSettings.ts`)
Add alongside the existing break-continuity helpers (same pattern):

```ts
const KEY_PIP_COMPLETE = "pip.complete_behavior";
export type PipCompleteBehavior = "advance" | "close";

// Default "advance" — preserves today's behavior; user opts into "close".
export async function getPipCompleteBehavior(): Promise<PipCompleteBehavior> {
  return (await getSetting(KEY_PIP_COMPLETE)) === "close" ? "close" : "advance";
}
export async function setPipCompleteBehavior(v: PipCompleteBehavior): Promise<void> {
  await setSetting(KEY_PIP_COMPLETE, v);
}
```

### 2. Settings UI (`src/pages/Settings.tsx`)
Add a segmented control mirroring the existing **Break continuity** row
(Settings.tsx:241-269):

- Label: **"When you finish a task in the mini timer"**
- Options: `Next task` (advance) | `Close`
- Description flips with the selection (e.g. "Advances to your next task and
  keeps the timer open" / "Plays a quick 'done' beat, then closes the timer").
- State loaded on mount via `getPipCompleteBehavior()`; `onChange` calls
  `setPipCompleteBehavior(v)` **and** dispatches a window event so the live
  (persistent) FocusMode mount picks it up without an app restart:
  `window.dispatchEvent(new CustomEvent("verseday:pip-complete-behavior-changed", { detail: v }))`.

### 3. Propagate to FocusMode + PiP
The PiP must know the behavior at completion time so it can decide its
post-flourish action deterministically (no reliance on IPC arrival timing).

- **`pipEvents.ts`** — add `completeBehavior: PipCompleteBehavior` to the
  `PipState` interface, and export the event-name constant
  `PIP_COMPLETE_BEHAVIOR_CHANGED_EVENT = "verseday:pip-complete-behavior-changed"`.
- **`FocusMode.tsx`** —
  - Hold the behavior in a ref, loaded on mount (new effect, next to the
    break-continuity load at line 601) and updated on the
    `verseday:pip-complete-behavior-changed` window event.
  - Include `completeBehavior: behaviorRef.current` in the emitted `PipState`
    (the builder at lines 802-810).

### 4. PiP completion action (`src/components/FocusPip.tsx`)
In `completeWithFlourish` (lines 136-160), the post-flourish timer branches on
`state?.completeBehavior`:

- **"advance"** (default): existing path — `setSlideInNext(true)` etc. (main
  has already pushed the next task into `state`).
- **"close"**: `getCurrentWebviewWindow().close()` — the PiP dismisses itself
  *after* its own ~850ms green-burst beat. This satisfies the
  "visual feedback instead of disappearing instantly" requirement by reusing
  the exact animation that already plays on completion.

Harden the `PIP_STATE_EVENT` `null` handler (lines 263-270): if a `null`
arrives while `completing` is true (`completingRef`), ignore it — the flourish
timer owns the close so the beat is never cut. (Cheap insurance; main also
delays teardown per §5.)

### 5. FocusMode `handleDone` branch (`FocusMode.tsx:1145-1224`)
After the **mark-done gate** (the existing `doneCommitted` check) and
post-done reconcile/backfill:

- **behavior === "advance"** → unchanged (find next remaining → `previewFocus`,
  or `stopFocus()` if none).
- **behavior === "close"** → **do not advance**; tear down focus, but **delay
  it so the PiP flourish can play**:
  ```ts
  await useAppStore.getState().loadWorkedMinutes([completedTaskId]);
  // Let the pip play its ~850ms "done" beat before we null focus (which
  // closes the pip window). The pip self-closes at the end of its flourish;
  // this just clears the main-window focus/session state.
  setTimeout(() => stopFocus(), PIP_COMPLETE_FLOURISH_MS); // ~900ms (> COMPLETE_MS 850)
  ```
  `PIP_COMPLETE_FLOURISH_MS` lives next to `COMPLETE_MS` (shared so they can't
  drift). During the delay the heartbeat keeps emitting the completed task's
  state; the PiP ignores it (it's in the `completing` takeover). Reduced-motion
  users still get the static "Done" panel for the duration, then close.

---

## Files touched
- `src/utils/focusSettings.ts` — new get/set helpers + type.
- `src/utils/pipEvents.ts` — `PipState.completeBehavior` field + event constant.
- `src/pages/Settings.tsx` — segmented control row + load/persist/dispatch.
- `src/pages/FocusMode.tsx` — behavior ref (load + live event), include in
  `PipState`, branch `handleDone`.
- `src/components/FocusPip.tsx` — branch `completeWithFlourish`; `null`-guard
  while completing.

No DDL. No new files. No new Tauri command/window.

## Verification
- `tsc --noEmit` + `vite build` clean.
- Code-reasoning pass on the complete→close race (per self-validate discipline).
- Eyes-on (Nick, mid-session — rebuild quits the app): set **Close**, complete
  a task from the PiP → green beat plays (~0.85s) → PiP closes, no flicker, no
  stale next-task frame; Today shows the task done with worked time. Set
  **Next task**, complete → advances and stays open (unchanged). Toggle the
  setting mid-session and confirm the next completion respects it without a
  restart.

## Risk / notes
- The `completeBehavior` flows over `PipState`; default `"advance"` keeps every
  existing path byte-for-byte unless the user opts in.
- The "close" teardown delay is the one timing-coupled spot — flagged for
  eyes-on. The PiP self-close (not the delayed main teardown) is what the user
  sees, so a slightly-off delay degrades gracefully (pip already gone).
