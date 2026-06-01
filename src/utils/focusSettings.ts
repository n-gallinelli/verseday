import { getSetting, setSetting } from "../db/queries";

// Focus / Pomodoro preferences (key-value settings, mirrors calendar/settings).

const KEY_BREAK_CONTINUITY = "focus.break_continuity";

export type BreakContinuity = "reset" | "continue";

/** "continue" mode keeps the break cycle running across task switches / short
 *  pauses; it only resets after an idle/paused gap of at least this long. */
export const BREAK_CONTINUITY_GAP_MS = 2 * 60 * 1000; // 2 minutes

/** Default "reset" — the historical per-task behavior, so nothing changes
 *  unless the user opts into "continue". */
export async function getBreakContinuity(): Promise<BreakContinuity> {
  return (await getSetting(KEY_BREAK_CONTINUITY)) === "continue"
    ? "continue"
    : "reset";
}

export async function setBreakContinuity(mode: BreakContinuity): Promise<void> {
  await setSetting(KEY_BREAK_CONTINUITY, mode);
}

/**
 * Pure decision used by FocusMode on a session (re)start (task switch or
 * resume-from-pause): should the break cycle CONTINUE (carry its accrued work)
 * rather than reset?
 *
 * - "reset" mode → never continue (reset every task, the historical behavior).
 * - "continue" mode → continue only if the idle gap since the last active tick
 *   is under the threshold; a gap >= threshold (walked away / paused a while)
 *   resets the cycle.
 */
export function shouldContinueBreakCycle(
  mode: BreakContinuity,
  gapMs: number,
  thresholdMs: number = BREAK_CONTINUITY_GAP_MS,
): boolean {
  return mode === "continue" && gapMs < thresholdMs;
}
