# Plan: Extend break with +5 / +10 from the break screen

**Date:** 2026-06-26
**Author:** Terse
**Status:** SUPERSEDED by `2026-06-26-break-controls.md` (extend folded into the
combined break-controls plan together with the confirm-end + overtime behavior).

## Goal

From the full-screen BREAK surface, let the user add time to the *current* break
with **+5 min** and **+10 min** buttons. Repeated taps stack (+10 twice = +20),
so a short break can be stretched to, e.g., 25 min for a shower.

## How breaks work today (relevant facts)

In `src/pages/FocusMode.tsx`:
- State: `breakDuration` (target ms) and `breakRemaining` (display ms); ref
  `breakStartRef.current` = `Date.now()` at break start (`:727`, `:733`,
  `handleTakeBreak` `:1389`).
- The 1s tick recomputes every second (`:843`+):
  `remaining = breakDuration − (now − breakStartRef.current)`; when
  `remaining <= 0` it flips `phase` to `"work"`, accounts the break time, and
  fires the end chime **once** at that single transition.
- `BreakScreen` (`:2112`) is presentational — props `taskTitle`, `remainingMs`,
  `onSkip`. It shows `formatCountdown(remainingMs)` and "ends {clock}" derived
  from `remainingMs`.
- The PiP reads the same `breakRemaining`, rebroadcast every tick over
  `PIP_STATE_EVENT` (`:1018`+), so it tracks any change automatically.

**Key consequence:** because the countdown is a *fresh derivation* from
`breakDuration` each tick, extending the break is simply **increasing
`breakDuration`**. Everything downstream (BreakScreen countdown, "ends" label,
PiP countdown, the `remaining<=0` end trigger, the single end-chime) flows from
that one value — no rescheduling, no chime double-fire, no timestamp math.

## Proposed change

### 1. New handler in FocusMode

```ts
// Extend the in-progress break by `addMs`. Only breakDuration changes:
// breakStartRef stays put, so the next tick recomputes remaining against the
// larger target. Cumulative by construction (each tap adds to the current
// duration). The end-chime still fires once, just later.
function handleExtendBreak(addMs: number) {
  if (phase !== "break") return;          // guard: only meaningful mid-break
  setBreakDuration((d) => d + addMs);
  setBreakRemaining((r) => r + addMs);    // instant UI bump; tick reconciles
}
```

Named constants beside the existing break settings:
```ts
const EXTEND_SMALL_MS = 5 * 60 * 1000;
const EXTEND_LARGE_MS = 10 * 60 * 1000;
```

### 2. BreakScreen gains an `onExtend` prop

```ts
function BreakScreen({ taskTitle, remainingMs, onExtend, onSkip }: {
  taskTitle: string;
  remainingMs: number;
  onExtend: (addMs: number) => void;
  onSkip: () => void;
}) { … }
```

UI: a quiet row of two ghost/outline pills **above** the existing "End early"
button (kept distinct so extend vs end don't blur). Calm, on-surface styling
consistent with the zen break aesthetic:

```
        ┌──────────┐  ┌──────────┐
        │  +5 min  │  │ +10 min  │      ← subtle, secondary
        └──────────┘  └──────────┘

              End early                 ← unchanged
```

Clicking a pill calls `onExtend(EXTEND_SMALL_MS | EXTEND_LARGE_MS)`; the hero
countdown and "ends …" line jump up immediately and keep ticking down from the
new value.

### 3. Wire it at the render site (~`:1830`)

```diff
  <BreakScreen
    taskTitle={task.title}
    remainingMs={breakRemaining}
+   onExtend={handleExtendBreak}
    onSkip={handleSkipBreak}
  />
```

## Why this is safe / correct

- **Cumulative for free** — functional `setBreakDuration(d => d + addMs)` stacks
  taps; +10 twice = +20.
- **No chime issues** — the end chime fires only at the `remaining<=0`
  transition; pushing the target out just delays that one fire. No reschedule,
  no double-fire.
- **PiP stays in sync** — it renders from `breakRemaining`, rebroadcast each
  tick; the extension shows on the pip within ≤1s with no extra code.
- **Pause-safe** — pause/resume adjusts `breakStartRef`; extend touches only
  `breakDuration`, so the two are independent and compose correctly.
- **Accounting intact** — `handleSkipBreak`/natural-end account elapsed from
  `breakStartRef`; `break_seconds` (audit column) naturally reflects the longer
  break.

## Decisions taken (not asking)

- **No upper cap.** Stacking is the whole point; user controls it via taps.
- **+5 / +10 only** (matches the request); no custom-minutes input.
- **Break screen only.** The PiP already reflects the new remaining; I'm not
  adding extend buttons to the tiny pip surface this round (can follow up if
  wanted).
- **No persistence change.** Break state is ephemeral today (lost on reload);
  this feature doesn't change that — out of scope.

## Scope / risk

- Two presentational additions + one ~4-line handler in `FocusMode.tsx`. No new
  deps, no IPC, no DB, no migration, nothing that costs money.
- Atomic, revertible in one commit; no flag.
- New feature branch off `main`, not `main`.

## Verification

- `tsc` + `tauri build --debug` → run the `.app` bundle.
- Eyes-on: start a break → tap +10 twice → countdown jumps +20 and "ends" label
  updates; let it tick; confirm PiP countdown matches; confirm end chime fires
  once at the (extended) end; confirm "End early" still ends immediately.
