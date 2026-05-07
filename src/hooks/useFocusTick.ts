import { useEffect, useState } from "react";
import { useAppStore } from "../stores/appStore";
import { computeFocusElapsedMs } from "../utils/focusElapsed";

/**
 * Returns the live elapsed milliseconds for the active focus session, or
 * `null` if no session is active (or the session is in preview mode —
 * preview has no startedAt, nothing to tick).
 *
 * Uses computeFocusElapsedMs so the returned value respects pause state:
 * while paused, the open-pause delta cancels the wall-clock advance and
 * the value freezes at the pause-time elapsed. The interval is also
 * paused while paused — no need to keep re-rendering with the same
 * frozen value once a tick a second.
 *
 * The interval is cleared on unmount and when focus ends, so there's no
 * leak when the user stops focusing or navigates away.
 */
export function useFocusTick(): number | null {
  const focus = useAppStore((s) => s.focus);
  const [now, setNow] = useState(() => Date.now());

  const isActive = focus?.mode === "active";
  const isPaused = isActive && focus.paused;

  useEffect(() => {
    if (!isActive || isPaused) return;
    // Tick at 1Hz. Cadence required by Verse for "live" to feel live;
    // performance is bounded by React.memo on TaskCard so only the focused
    // row re-renders per tick, not the entire list.
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isActive, isPaused]);

  if (!focus || focus.mode !== "active") return null;
  return computeFocusElapsedMs(focus, now);
}
