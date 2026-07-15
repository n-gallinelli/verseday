// Pip work-elapsed display interpolation (Verse-APPROVED, display-only).
//
// The main window pushes an authoritative `elapsedMs` on each PIP_STATE_EVENT.
// When that window is occluded (the pip doing its job — floating while the user
// works in another app), WebKit coalesces its background timers to ~2s, so the
// pip only RECEIVES a fresh value every ~2s → a 2s-stepping readout. The pip
// window is alwaysOnTop and un-throttled, so it smooths the gap locally by
// adding the monotonic time elapsed since it received the value. Every change
// re-syncs `elapsedMs`/`receivedAt`, so drift is bounded to one emit interval
// and the main window stays authoritative.
//
// This is DIFFERENT from the break countdown (which counts toward a fixed
// wall-clock anchor `breakEndsAt`): work-elapsed has no fixed end and must
// FREEZE on pause, so it's a relative interpolation off a monotonic stamp.
//
// Invariants (Verse acceptance conditions):
//  - `receivedAtMono` and `nowMono` are BOTH performance.now() minted in the
//    PIP window — never mix a stamp from the main window (independent origins).
//  - Frozen (paused OR queued/preview) → return the pushed scalar verbatim.
//  - The delta is clamped >= 0 as cheap insurance (performance.now() is
//    monotonic and "can't" go backward, but clamp anyway).
export function displayElapsed(
  elapsedMs: number,
  receivedAtMono: number,
  nowMono: number,
  frozen: boolean,
): number {
  if (frozen) return elapsedMs;
  return elapsedMs + Math.max(0, nowMono - receivedAtMono);
}
