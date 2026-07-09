# Shutdown closes the Focus PiP

**Date:** 2026-07-08
**Status:** Built, Verse-APPROVED (plan). Awaiting final eyes-on.

## Problem

After shutting down the day, the always-on-top Focus PiP kept floating over the
sunset/quote screen. Shutting down is a definitive "done for the day" signal, so
the PiP should disappear.

## Root cause

The shutdown flow and the PiP were completely decoupled. Both shutdown paths only
called `openSunsetOverlay()` (which just flips `sunsetOverlayOpen`); nothing
touched the focus session. The PiP window is gated entirely on an active focus
session (`FocusMode.tsx` mounts on `!!session`; the keyed cleanup closes the PiP
window when the session goes null), so it survived shutdown.

## Fix

End the active focus session at the moment shutdown is committed, reusing the
existing teardown rather than force-closing the window from the shutdown screen.

- `endActiveFocusSession()` (`appStore.ts`) is a guarded no-op when nothing is
  running and, when a session exists, calls `stopFocusedSessionForTask` — the
  same commit path as Done/Stop. This closes the open `time_entry` row (single
  source of truth) so it doesn't dangle across the shutdown boundary and get
  reconciled on next boot. Nulling the session collapses the FocusMode mount
  condition and its cleanup closes the PiP window. No new window management.

Two touch points:

1. **`DailyShutdown.tsx` `completeShutdown()`** — `await endActiveFocusSession()`
   after the save-failure early-return, right before `openSunsetOverlay()` (don't
   end the session if the reflection upsert throws and we bail).
2. **`WeeklyShutdown.tsx` `markShutdownComplete()`** — `void endActiveFocusSession()`
   at the single choke point routed through by every confirmation path
   (`finalizeShutdown`, `handleSkipPlan`, and the deferred-sunset
   `handlePlanNextWeek`). DRY: one line covers every path, including "plan next
   week." Fire-and-forget is safe — `stopFocusedSessionForTask` try/catches both
   commit and refresh and never throws.

## Decisions

- **End, not pause.** Shutdown is definitive; an open time_entry row would
  otherwise dangle. Committing via `stopFocusedSessionForTask` matches Done/Stop.
- **`breakSeconds=0` accepted.** If the user shuts down mid-break, that final
  session's `break_seconds` audit column is dropped (same as the inline
  DailyPlanner caller). Audit-only, and the break is abandoned at shutdown.
- **No DDL, no migration, no runtime cost, no new deps.**

## Eyes-on owed

- Shut down with a live (running, not just paused) focus session → PiP should
  vanish as the quote appears.
- Weekly "Plan next week" path → PiP should vanish at confirmation, not linger
  into the planner. (Weekly path leaves the PiP up until the async commit
  resolves — a beat longer than daily's `await`; negligible.)
