// Cross-webview channel between the main window and the focus PiP, over Tauri
// events (Stage 4 — replaced the localStorage verseday_pip_state /
// verseday_pip_cmd channels and the verseday_focus liveness read). Shared so the
// two sides can't drift on event names or the state shape.
export const PIP_STATE_EVENT = "verseday:pip-state"; // main → pip: PipState | null
export const PIP_CMD_EVENT = "verseday:pip-cmd"; // pip → main: command string
export const PIP_READY_EVENT = "verseday:pip-ready"; // pip → main: push state now

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
}
