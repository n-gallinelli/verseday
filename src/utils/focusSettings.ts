import { getSetting, setSetting } from "../db/queries";
import { logicalDayIso } from "./dates";
import type { PipCompleteBehavior } from "./pipEvents";

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

// ── PiP "on task complete" behavior ─────────────────────────────────────────
const KEY_PIP_COMPLETE = "pip.complete_behavior";

/** Same-window signal (Settings page → the persistent FocusMode mount) so a
 *  toggle applies to the next completion without an app restart. Dispatched as
 *  a window CustomEvent with `detail: PipCompleteBehavior`. */
export const PIP_COMPLETE_BEHAVIOR_CHANGED_EVENT =
  "verseday:pip-complete-behavior-changed";

/** Default "advance" — preserves the historical roll-to-next-task behavior;
 *  the user opts into "close". */
export async function getPipCompleteBehavior(): Promise<PipCompleteBehavior> {
  return (await getSetting(KEY_PIP_COMPLETE)) === "close" ? "close" : "advance";
}

export async function setPipCompleteBehavior(
  v: PipCompleteBehavior,
): Promise<void> {
  await setSetting(KEY_PIP_COMPLETE, v);
}

// ── PiP high-visibility (larger + glowing) ──────────────────────────────────
const KEY_PIP_HIGH_VIS = "pip.high_visibility";

/** Same-window signal (Settings page → the persistent FocusMode mount) so the
 *  toggle takes effect on the live pip without an app restart. Dispatched as a
 *  window CustomEvent with `detail: boolean`. */
export const PIP_HIGH_VIS_CHANGED_EVENT = "verseday:pip-high-vis-changed";

/** Default OFF — the historical compact pip; high-visibility is opt-in. */
export async function getPipHighVisibility(): Promise<boolean> {
  return (await getSetting(KEY_PIP_HIGH_VIS)) === "1";
}

export async function setPipHighVisibility(v: boolean): Promise<void> {
  await setSetting(KEY_PIP_HIGH_VIS, v ? "1" : "0");
}

// ── PiP window position (same-day persistence) ──────────────────────────────
const KEY_PIP_POSITION = "pip.position";

/** The pip remembers where it was last dragged WITHIN a logical day (3am
 *  boundary — matches the app's rollover and the focus screen's today-only
 *  policy). A new logical day returns null so the pip spawns at its default
 *  spot. Stored as PHYSICAL screen px so it round-trips through
 *  PhysicalPosition with no logical/physical drift. */
export async function getPipPosition(): Promise<{ x: number; y: number } | null> {
  const raw = await getSetting(KEY_PIP_POSITION);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { x?: unknown; y?: unknown; day?: unknown };
    if (parsed.day !== logicalDayIso()) return null; // previous day → default spot
    if (typeof parsed.x !== "number" || typeof parsed.y !== "number") return null;
    return { x: parsed.x, y: parsed.y };
  } catch {
    return null; // corrupt value → default spot
  }
}

export async function savePipPosition(x: number, y: number): Promise<void> {
  await setSetting(
    KEY_PIP_POSITION,
    JSON.stringify({ x, y, day: logicalDayIso() }),
  );
}
