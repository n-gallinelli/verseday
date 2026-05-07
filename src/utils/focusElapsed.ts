import type { FocusState } from "../stores/appStore";

// Single source of truth for "what's the user's on-screen elapsed time?"
// — used by FocusMode's tick loop, the PiP state broadcast, and the Daily
// Plan's live pill (M2.2 / M2.3 wire-ups). Type-narrowed to active mode
// because preview has no startedAt.
//
// Math (verified by Verse rev 3 review):
//   running:  now - startedAt - pausedAccumMs               + priorElapsedMs
//   paused:   now - startedAt - pausedAccumMs - openPause   + priorElapsedMs
//             where openPause = now - pausedAtMs
//   While paused, the (now − pausedAtMs) terms cancel and the displayed
//   elapsed equals the value at the moment of pause. Holds across app
//   relaunch — wall-clock now drops out of the result.
export function computeFocusElapsedMs(
  focus: Extract<FocusState, { mode: "active" }>,
  now: number,
): number {
  const openPause =
    focus.paused && focus.pausedAtMs !== null ? now - focus.pausedAtMs : 0;
  return (
    now - focus.startedAt - focus.pausedAccumMs - openPause + focus.priorElapsedMs
  );
}
