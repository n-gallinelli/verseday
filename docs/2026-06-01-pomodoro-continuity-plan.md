# Pomodoro break-continuity setting — Terse Plan

**Date:** 2026-06-01
**Status:** PLAN — awaiting Verse review. No code until APPROVED.

## Today's behavior (confirmed in code)
The break/pomodoro timer is **per task-session**. The reset effect at
`FocusMode.tsx:253-265` is keyed on `focus?.taskId` and zeroes
`workCycleStartRef`, `totalBreakTimeRef`, `completedPomodoros`, phase, etc.; a
new session's `focus.workedMs` also starts at 0. So finishing a task and
starting another **always resets** the cycle — you never carry the 23 minutes
from task A toward task B's break.

## What Nick wants
A **setting** toggling between:
- **Reset on task change** (current behavior) — default.
- **Continue across short gaps** — the break clock keeps running across task
  switches *unless* you've been paused / not focused on any task for **≥ ~2
  minutes**, in which case it resets. A < 2-min gap continues the cycle.

## Design

### 1. The accumulator (the core change)
Because `focus.workedMs` resets per session, "continue" needs a counter that
**survives task switches**. Introduce a persisted break-cycle accumulator in
the store (module-level, like the P0-1 resume flag — not React state):
- `breakCycleWorkedMs` — worked time accrued toward the *current* break cycle.
- `lastFocusActiveAt` — timestamp of the last active (running) tick.

The focus tick (already clamped per P0-1) increments `breakCycleWorkedMs` by the
same clamped delta while active, and stamps `lastFocusActiveAt = now`. The break
prompt fires when `breakCycleWorkedMs >= WORK_DURATION_MS` (replacing the
per-session `currentCycleElapsed` comparison). Taking a break resets it to 0
(same point `totalBreakTimeRef` is bumped today).

### 2. Reset rule (mode-gated) — replaces the blanket taskId reset
On session (re)start — task change, or resume from pause — decide whether to
reset `breakCycleWorkedMs`:
- **Reset mode:** always reset to 0 (today's behavior; the `taskId` effect).
- **Continue mode:** reset to 0 **only if** `now - lastFocusActiveAt >= GAP_MS`
  (idle/paused gap exceeded); otherwise keep accruing. Covers both "switched
  tasks quickly" (continue) and "walked away / paused ≥2 min" (reset), which is
  exactly Nick's ask — pause counts because `lastFocusActiveAt` only advances
  while actively ticking.

`GAP_MS` = **2 min**, a documented constant. (Could become its own setting
later; the ask is the mode toggle, so I'll keep the threshold fixed unless you
want it exposed.)

`completedPomodoros` (drives long-break-every-4) follows the same reset rule so
the cycle count stays coherent.

### 3. The setting
- Storage: reuse `getSetting`/`setSetting` (DB key-value). New module
  `src/utils/focusSettings.ts` (mirrors `calendar/settings.ts`): key
  `focus.break_continuity`, values `"reset"` | `"continue"`, default `"reset"`
  (preserves current behavior for anyone who doesn't touch it).
- UI: a toggle in `Settings.tsx` — "Pomodoro across tasks: Reset each task /
  Continue (reset after 2 min idle)". Label copy TBD, I'll match the page's
  existing setting rows.
- FocusMode reads the setting on mount and refreshes on a `verseday:settings-
  changed` (or re-reads when the focus screen mounts) — I'll match however
  Settings currently notifies (grep during build; if there's no notifier, read
  on focus-session start, which is when it matters).

## Scope / risk
- The pomodoro/break/snooze machinery is fiddly; the change is **additive** —
  swap the *source* of "worked toward break" (session-derived → persisted
  accumulator) and the *reset trigger* (always → mode-gated). Break/snooze/long-
  break/phase logic stays. Default mode = today's behavior, so no behavior
  change unless the user flips the switch.
- ⚠️ This touches focus-time UX (not worked-time *data* — no DB schema, no
  time_entries change). Static validation (tsc/build) + a small pure unit test
  for the reset-decision helper (`shouldResetBreakCycle(mode, gapMs)` and the
  accumulate/threshold logic) to lock the 2-min boundary. No money cost.

## Open question for Verse
- Threshold: fixed 2-min constant, or expose it as a second setting (number
  input)? I recommend **fixed 2 min** now (matches the ask; less UI surface),
  revisit if Nick wants to tune it.
- Default mode: **reset** (zero behavior change for existing usage). OK?
