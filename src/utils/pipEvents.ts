// Cross-webview channel between the main window and the focus PiP, over Tauri
// events (Stage 4 — replaced the localStorage verseday_pip_state /
// verseday_pip_cmd channels and the verseday_focus liveness read). Shared so the
// two sides can't drift on event names or the state shape.
export const PIP_STATE_EVENT = "verseday:pip-state"; // main → pip: PipState | null
export const PIP_CMD_EVENT = "verseday:pip-cmd"; // pip → main: command string
export const PIP_READY_EVENT = "verseday:pip-ready"; // pip → main: push state now

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
// by the break prompt — its tallest phase: header (~16px) + mb-1 (4px) + 24px
// button row + py-1.5 (12px) ≈ 56px floor; 58 leaves ~2px slack. The running/
// paused view is shorter and centers in the remaining space.
export const PIP_SIZE = { width: 220, height: 58 };

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
}
