import { useAppStore } from "../stores/appStore";

/**
 * Returns the live elapsed milliseconds for the active focus session, or
 * `null` if no session is active (or the session is in preview mode —
 * preview has no time entry, nothing to tick).
 *
 * S.3 — passive subscription to `focus.workedMs + focus.priorElapsedMs`.
 * The bumping is done by FocusMode's tick effect calling tickFocus
 * once per second; subscribers re-render via Zustand. No interval here,
 * no derivation math, no Date.now() reads. Pause is handled by the
 * tickFocus action — when paused, workedMs stops growing, so the value
 * naturally freezes for every subscriber without per-hook gating.
 */
export function useFocusTick(): number | null {
  const focus = useAppStore((s) => s.focus);
  if (!focus || focus.mode !== "active") return null;
  return focus.workedMs + focus.priorElapsedMs;
}
