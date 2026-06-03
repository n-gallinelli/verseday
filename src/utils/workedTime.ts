/**
 * Worked-time clamp (sleep / lid-close / clock-jump inflation guard).
 *
 * Background: the focus tick feeds the elapsed span since the last tick into
 * `tickFocus`, which adds it to `workedMs` unbounded. A suspended interval
 * (laptop asleep, lid closed) would otherwise add the entire wall-clock gap on
 * the first tick after wake — a 5-minute task could read 2h after a 2h sleep.
 * A forward wall-clock jump (NTP correction, manual clock change) inflates the
 * same way.
 *
 * #2 + #3 (P2) — the previous design relied on an OS `system-resumed` event to
 * distinguish "machine slept" from "app occluded but user working." That event
 * arrives over an async emit→listen channel and can lose the race against the
 * first post-wake tick (or be dropped), so a SUB-cap sleep (and any forward
 * clock jump) slipped through and got credited as worked. The fix replaces the
 * racy event with a SYNCHRONOUS wall-vs-monotonic clock cross-check evaluated
 * in the tick itself:
 *
 *   - `Date.now()` (wall) advances through machine sleep AND jumps on an NTP /
 *     manual clock change.
 *   - `performance.now()` (monotonic) is SUSPENDED during machine sleep and is
 *     unaffected by wall-clock jumps — it only counts real, awake elapsed time.
 *
 * When the two AGREE (within a small tolerance) the machine was continuously
 * awake for the span, so the wall delta is real worked time — kept in full,
 * INCLUDING a throttled/occluded catch-up (App Nap, hidden window, PiP), which
 * is a protected first-class case. When they DIVERGE the span crossed a sleep
 * or a clock jump; we credit only the monotonic (awake) delta, capped to a few
 * seconds so a divergent tick can never bank more than a tick's worth. The OS
 * resume flag is kept purely as a redundant backstop, no longer the primary
 * signal.
 */

/** Agree-case backstop — a continuously-awake span larger than this is treated
 *  as an (un-detected) suspend gap and contributes zero. 5 min: well above any
 *  plausible throttle catch-up, so it cannot discard real occluded-but-working
 *  time; well below any real sleep span. */
export const MAX_TICK_DELTA_MS = 300_000;

/** Wall and monotonic deltas within this of each other count as "agree" — the
 *  machine was awake the whole span. Sized above normal scheduling jitter. */
export const CLOCK_DIVERGENCE_TOLERANCE_MS = 1000;

/** When the clocks diverge (sleep / clock jump), the credited monotonic delta
 *  is capped to this — a divergent tick should never bank more than ~a tick's
 *  worth of work. */
export const MAX_DIVERGENT_CREDIT_MS = 4000;

/**
 * Decide how much of a tick span counts as worked time.
 *
 * @param wallDeltaMs     `Date.now()` ms since the previous tick
 * @param monoDeltaMs     `performance.now()` ms since the previous tick
 * @param resumeJustFired true if an OS resume was signalled since the last tick
 * @returns the ms to add to workedMs (0 means "this span was not worked")
 */
export function clampWorkedDelta(
  wallDeltaMs: number,
  monoDeltaMs: number,
  resumeJustFired: boolean
): number {
  // Clock skew / duplicate tick on either clock → not worked.
  if (wallDeltaMs <= 0 || monoDeltaMs <= 0) return 0;
  // Redundant backstop: an explicit OS wake drops the span regardless.
  if (resumeJustFired) return 0;

  const diverged =
    Math.abs(wallDeltaMs - monoDeltaMs) > CLOCK_DIVERGENCE_TOLERANCE_MS;

  if (diverged) {
    // Sleep (monotonic suspended → small monoDelta) or forward wall jump
    // (monoDelta ≈ a normal tick). Either way the real awake time is the
    // monotonic delta, never the inflated wall delta. Cap it to a few seconds.
    const awake = Math.min(monoDeltaMs, wallDeltaMs);
    return awake > MAX_DIVERGENT_CREDIT_MS ? 0 : awake;
  }

  // Clocks agree → continuously awake. Wall delta is real worked time; keep it
  // (incl. throttled/occluded catch-up) up to the agree-case backstop.
  if (wallDeltaMs > MAX_TICK_DELTA_MS) return 0;
  return wallDeltaMs;
}
