/**
 * P0-1 — worked-time clamp (sleep / lid-close inflation guard).
 *
 * Background: the focus tick feeds `delta = Date.now() - lastTickRef` into
 * `tickFocus`, which adds it to `workedMs` unbounded. A suspended interval
 * (laptop asleep, lid closed) adds the entire wall-clock gap on the first
 * tick after wake — a 5-minute task could read 2h after a 2h sleep.
 *
 * The fix has two layers (see docs/2026-06-01-stability-hardening-plan.md,
 * Branch A):
 *
 *  1. PRIMARY — an OS resume signal (`NSWorkspaceDidWakeNotification`, bridged
 *     to JS as the `system-resumed` event). It fires ONLY on a real machine
 *     wake and is NEVER raised by App Nap / timer throttling, so it cleanly
 *     separates "machine was asleep" (drop the span) from "app was occluded
 *     but the user was working" (keep the span — the throttled tick must catch
 *     up). When a resume was just signalled, the next tick's delta is dropped.
 *
 *  2. BACKSTOP — `MAX_TICK_DELTA_MS`. The resume event arrives over the async
 *     emit→listen channel, so it can lose the race against the first post-wake
 *     tick; the event could also be dropped. The backstop discards any delta
 *     larger than the cap regardless. It is sized FAR above any plausible
 *     throttle interval (WKWebView aligns hidden-page timers to ~1s — our
 *     cadence — and App Nap coalescing is seconds-to-~1min) so it can never
 *     discard real occluded-but-working time; it only catches an unexplained
 *     multi-minute gap, where discarding is the safe choice.
 */

/** Backstop cap — deltas larger than this are treated as an (un-signalled)
 *  suspend gap and contribute zero worked time. 5 min: ~5× the worst-case
 *  App Nap coalescing interval, so it cannot discard a throttled-but-working
 *  delta; well below any real sleep span. */
export const MAX_TICK_DELTA_MS = 300_000;

/**
 * Decide how much of a raw tick delta counts as worked time.
 *
 * @param deltaMs         wall-clock ms since the previous tick
 * @param resumeJustFired true if an OS resume was signalled since the last tick
 * @returns the ms to add to workedMs (0 means "this span was not worked")
 */
export function clampWorkedDelta(
  deltaMs: number,
  resumeJustFired: boolean
): number {
  if (deltaMs <= 0) return 0; // clock skew / duplicate tick
  if (resumeJustFired) return 0; // explicit OS wake → drop the suspended span
  if (deltaMs > MAX_TICK_DELTA_MS) return 0; // missed/lost-race wake → net catches it
  return deltaMs; // normal tick, or throttle catch-up below the cap → keep in full
}
