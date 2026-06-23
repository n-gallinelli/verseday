// Cross-webview channel between the main window and the focus PiP, over Tauri
// events (Stage 4 — replaced the localStorage verseday_pip_state /
// verseday_pip_cmd channels and the verseday_focus liveness read). Shared so the
// two sides can't drift on event names or the state shape.
export const PIP_STATE_EVENT = "verseday:pip-state"; // main → pip: PipState | null
export const PIP_CMD_EVENT = "verseday:pip-cmd"; // pip → main: command string
export const PIP_READY_EVENT = "verseday:pip-ready"; // pip → main: push state now
// pip → main: the settled, clamped window position {x, y} in LOGICAL px (Cocoa
// global points, monitor-independent) after a drag or resize. The main window
// owns persistence (the pip webview's sql capability isn't guaranteed), so the
// pip just reports and FocusMode writes pip.position.v2.
export const PIP_MOVED_EVENT = "verseday:pip-moved";
export interface PipMovedPayload { x: number; y: number; }
// main → pip: play a phase chime ("start" = descending break-offer, "end" =
// ascending break-over). FocusMode is the SINGLE decider; it fires this only
// when it elects the pip as the one speaker, so there's never a dual play.
export const PIP_CHIME_EVENT = "verseday:pip-chime";
export type PipChimeKind = "start" | "end";

// What the pip does after a task is completed from it. "advance" = roll to the
// next remaining task and keep the pip open (historical default); "close" =
// play the completion beat, then dismiss the pip. Defined here (a
// dependency-free shared module) so both webviews and the settings layer agree
// on the literal — focusSettings imports this TYPE rather than the reverse, so
// the pip bundle never pulls in the db/sql layer.
export type PipCompleteBehavior = "advance" | "close";

// Length of the pip's completion beat (FocusPip's COMPLETE_MS). Shared so the
// pip's self-close timing and the main window's delayed focus teardown can't
// drift apart.
export const PIP_COMPLETE_FLOURISH_MS = 850;

// ONE pip window size for every phase — the pip never resizes (declining a break
// can't shrink it; no setSize churn). Shared so the window-creation size
// (FocusMode) and the content's pinned size (FocusPip) can't drift. Height is set
// by the break prompt — its tallest phase (no header): py-1.5 container (12px) +
// Start-break button row (~28px) + gap-2 (8px) + "+5 min · Skip" sub-row (~12px)
// ≈ 60px floor; 66 leaves ~6px slack so the cluster isn't jammed to the borders.
// The running/paused view is shorter and centers in the remaining space.
export const PIP_SIZE = { width: 220, height: 66 };

// High-visibility mode: the SAME card content scaled uniformly by
// PIP_HIGH_VIS_SCALE inside a slightly larger window. The crisp accent ring is
// a box-shadow drawn OUTSIDE the card, so it clips at the window bounds — the
// window just needs a few px of transparent margin for the ring (+ breathe) to
// render un-clipped. 220×66 × 1.3 ≈ 286×85.8; +~7.1px halo each side → 300×100
// (ring spread is 2px × 1.3 ≈ 2.6px, so 7.1px clears it). Both the window-creation
// size (FocusMode) and the content pin (FocusPip) read these so the two sides can't
// drift — same discipline as PIP_SIZE.
export const PIP_HIGH_VIS_SCALE = 1.3;
export const PIP_SIZE_LARGE = { width: 300, height: 100 };

/** The pip window size for a given high-visibility flag. */
export function pipSizeFor(highVisibility: boolean): { width: number; height: number } {
  return highVisibility ? PIP_SIZE_LARGE : PIP_SIZE;
}

export interface PipState {
  elapsed: number;
  paused: boolean;
  phase: "work" | "break" | "prompt";
  breakRemaining: number;
  taskTitle: string;
  estimatedMinutes: number | null;
  // The session is queued (preview, not yet started). The pip stays alive across
  // the roll-to-next-task; its primary button starts the session.
  queued: boolean;
  // What to do when the user completes this task from the pip. The main window
  // pushes the live setting so the pip can decide its post-beat action
  // (slide-in-next vs self-close) deterministically, without racing on IPC
  // arrival timing.
  completeBehavior: PipCompleteBehavior;
  // High-visibility mode: render the larger, gently-glowing pip. Rides on
  // PipState (not read from the sql layer in the pip bundle, which pipEvents
  // forbids) so the main window stays the single source of truth and a live
  // Settings toggle reaches the pip on the next broadcast.
  highVisibility: boolean;
}
