# Pip timer updates every 2s (not 1s) — fix plan

**Date:** 2026-06-10
**Author:** Terse
**Status:** PLAN — awaiting Verse review (no code written)

## Symptom
The focus pip's elapsed readout advances 41 → 43 → 45 — refreshing every
~2s, skipping odd seconds — while a session runs.

## It is NOT a timing bug (data-confirmed)
Live session 343: started 15:03:39Z, observed 15:45:46Z (real elapsed
2527s), `worked_seconds = 2517` → **1.0×**. Worked time is accurate; the
counter is not running fast or double-counting. The problem is purely the
pip's **display refresh cadence**.

## Root cause (WebKit background-timer throttling)
The timer tick (FocusMode.tsx:632, `setInterval` 1000ms) and the pip-state
heartbeat (FocusMode.tsx:822, `setInterval` 1000ms) both run in the **main**
window and drive the pip via `emit(PIP_STATE_EVENT)`. The pip just renders
what it receives.

When the pip is doing its job — floating while the user works in **another
app** — the main window is occluded, so WebKit throttles its background
timers (≈1s clamp, coalesced to ~2s for an occluded window). The tick uses
a wall-clock delta (`Date.now() - lastTickAt`), so firing every ~2s still
credits the right amount (hence accurate total), but the pip only receives
a fresh value every ~2s → the 2s-step display.

The **pip** window is alwaysOnTop and never occluded, so ITS timers are not
throttled — that's the lever.

## Proposed fix — pip-local display interpolation (Option A)
Make the pip smooth its own display between the (possibly throttled) state
emits, while keeping the received state as the source of truth:
- On each `PIP_STATE_EVENT`, store `{ elapsedMs, paused, queued }` plus a
  monotonic stamp `receivedAt = performance.now()`.
- Render `displayElapsed = paused || queued ? elapsedMs
  : elapsedMs + (performance.now() - receivedAt)`.
- Run a small local interval (~250–500ms) in the pip purely to force the
  re-render so the displayed second advances on time. The pip is not
  throttled, so this stays smooth.
- Every emit RE-SYNCS `elapsedMs`/`receivedAt`, so interpolation can't
  drift more than one emit interval (≤~2s) and the main window stays
  authoritative. Display-only — the pip never writes time, so there is no
  worked-time/data risk.
- Freeze while `paused` (show the frozen `elapsedMs`); preview/`queued`
  shows the static prior time (no interpolation).
- Break countdown (`breakRemaining`) has the same choppiness; interpolate
  it too (count DOWN) or leave as-is — flagging for Verse (lower priority,
  it's a coarse mm:ss).

### Why not other options
- Drive updates from a Rust (non-throttled) timer → heavier, new IPC for no
  extra correctness over A.
- Run the main-window tick in a Web Worker (less throttled) → bigger change
  to the authoritative timekeeping path; riskier than a display-only smooth.

## Risk / boundary
- If the pip window itself were ever throttled (occluded — it's alwaysOnTop,
  so it shouldn't be), interpolation degrades back to today's behavior, not
  worse.
- No change to the authoritative workedMs / DB checkpoint path; this only
  changes what the pip paints between emits.

## Validation
- Extract `displayElapsed(elapsedMs, receivedAtMono, nowMono, paused)` as a
  pure fn + unit tests (running advances; paused frozen; re-sync resets),
  mirroring nextSelected / clampToFrame.
- Eyes-on: start a session, switch to another app so the main window is
  occluded, watch the pip — it should tick every 1s, and the value must
  still match the focus screen on return (re-sync correctness).

Scope: macOS only. No DB / DDL. No deps.
