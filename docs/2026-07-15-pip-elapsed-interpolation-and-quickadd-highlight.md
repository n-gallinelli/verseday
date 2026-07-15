# PiP work-elapsed interpolation + QuickAdd keyboard highlight

**Date:** 2026-07-15
**Author:** Terse
**Status:** BUILT on `fix/quickadd-focus-highlight-and-pip-2s` — PiP diff owed back to Verse before main; both owe eyes-on.

Two independent bugs, one branch.

## 1. PiP elapsed steps by 2s (Verse-APPROVED Option A)

**Symptom.** The focus pip's elapsed readout advances 41 → 43 → 45, refreshing
every ~2s. The total is accurate — worked time is not running fast.

**Root cause.** The 1 Hz work tick and the pip-state heartbeat both live in the
**main** window and drive the pip via `emit(PIP_STATE_EVENT)`. When the pip is
doing its job — floating while the user works in another app — the main window
is occluded and WebKit coalesces its background timers to ~2s. The tick credits
the right total (wall-clock delta), but the pip only *receives* a fresh value
every ~2s. (The break countdown was never afflicted: it derives locally each
force-tick from the absolute `breakEndsAt` anchor.)

**Fix — pip-local display interpolation.** The pip window is `alwaysOnTop` and
un-throttled, so it smooths its own display between emits:

- `src/utils/displayElapsed.ts` — pure `displayElapsed(elapsedMs, receivedAtMono,
  nowMono, frozen)`: running → `elapsedMs + max(0, nowMono − receivedAtMono)`;
  frozen (paused OR queued) → `elapsedMs` verbatim.
- `FocusPip.tsx` — a sync baseline `{ elapsedMs, receivedAt }` stamped inside the
  single `PIP_STATE_EVENT` listener (pip-window `performance.now()` only). A
  250ms local force-tick repaints while running work (`phase==="work" && !paused
  && !queued`). Render calls `displayElapsed(...)` in place of `state.elapsed`.

**Verse acceptance conditions (all met):** stamp minted only in the listener;
`performance.now()` compared only to `performance.now()` within the pip; freeze
on paused OR queued; delta clamped ≥ 0.

**Deviation flagged for ratification.** The baseline re-syncs only when `elapsed`
actually *changes*, not on literally every emit. A bare heartbeat/settle/ready
re-emits the same scalar; restamping `receivedAt` on those would drop the accrued
sub-emit interpolation and snap the readout backward (a visible stutter). The
guard stays entirely inside the single listener, so the "one place mints the
stamp" invariant holds; a real change in either direction still re-syncs (the
drift pull-back).

**Boundaries.** Display-only — never touches `workedMs` or the `worked_seconds`
checkpoint. No IPC-to-backend, no deps, no DDL, macOS-only.

**Tests.** 6 unit tests (running advances / throttled gap / paused frozen /
queued frozen / re-sync resets / delta clamp). Full suite green (160).

**Eyes-on owed.** Start a session, switch to another app so the main window is
occluded, watch the pip tick every 1s, and confirm the value still matches the
Focus screen on return (re-sync correctness).

## 2. QuickAdd project dropdown — keyboard highlight didn't follow focus

**Symptom.** In the Quick-Add bar, Tab opens the project list; arrowing moved the
hover tooltip ("the little expander") but the option highlight stayed on the
*selected* project, so nothing tracked the keyboard cursor.

**Root cause.** QuickAdd's dropdown is its own inline picker (not the shared
`ProjectPicker` — that consolidation is follow-up #79). Its option buttons carried
a highlight only for `projectId === p.id`, with **no `focus:` style**, unlike the
shared picker.

**Fix.** Added `focus:outline-none focus:ring-2 focus:ring-inset focus:ring-accent-blue`
to both the No-project and per-objective buttons (`QuickAdd.tsx`) — the same ring
the shared picker uses, layered over the existing selected-blue fill.
Presentational only.

**Eyes-on owed.** Tab into the picker, arrow through — the focused row shows a blue
inset ring that follows the cursor independent of selection.
