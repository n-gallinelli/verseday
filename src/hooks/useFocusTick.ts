import { useEffect, useState } from "react";
import { useAppStore } from "../stores/appStore";

/**
 * Returns the live elapsed milliseconds for the active focus session, or
 * `null` if no session is active (or the session is in preview mode —
 * preview has no startedAt, nothing to tick).
 *
 * Computed from `focus.startedAt` (an absolute timestamp) plus
 * `focus.priorElapsedMs` so the value is correct on remount and after
 * page navigation — there's no per-tick accumulation that could drift,
 * just `Date.now() - startedAt + priorElapsedMs` evaluated each tick.
 *
 * The interval is cleared on unmount and when focus ends, so there's no
 * leak when the user stops focusing or navigates away.
 */
export function useFocusTick(): number | null {
  const focus = useAppStore((s) => s.focus);
  const [now, setNow] = useState(() => Date.now());

  const isActive = focus?.mode === "active";

  useEffect(() => {
    if (!isActive) return;
    // Tick at 1Hz. Cadence required by Verse for "live" to feel live;
    // performance is bounded by React.memo on TaskCard so only the focused
    // row re-renders per tick, not the entire list.
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isActive]);

  if (!focus || focus.mode !== "active") return null;
  return now - focus.startedAt + focus.priorElapsedMs;
}
