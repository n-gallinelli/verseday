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
export type PipChimeKind = "start" | "end" | "meeting";

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

// ── PiP sizing — TWO distinct families, from ONE source of truth ───────────
// (1) BASE CONTENT BOX (per phase): what the shell renders (FocusPip pipShell),
//     then magnifies by PIP_HIGH_VIS_SCALE via `zoom`. The shell reads THIS,
//     never the window dims — reading the window size would double-scale.
// (2) WINDOW size: equals the box in normal mode; in high-vis it's box×scale
//     plus a transparent halo so the breathing accent ring (a box-shadow drawn
//     OUTSIDE the zoomed box) renders un-clipped. Derived from the base box via
//     windowFor() so window and content can never drift.
//
// Resting/focus/break box height (66) is set by the break prompt, the tallest of
// those phases (no header): py-1.5 (12px) + button row (~28px) + gap-2 (8px) +
// "+5 min · Skip" sub-row (~12px) ≈ 60px floor; 66 leaves ~6px slack. The
// running/paused view is shorter and centers in the remaining space.
export const PIP_SIZE = { width: 220, height: 66 };

// meetingPrompt is TALLER than the resting box: meeting title + "starting …" +
// a full button row don't fit in 66 (the button clips against the bottom edge).
// 90 gives the cluster real breathing room (content ≈ 86 with py-3) plus a hair
// of sub-pixel slack. Meeting-only — break/focus keep 66 (smallest blast radius).
export const PIP_SIZE_MEETING = { width: 220, height: 90 };

export const PIP_HIGH_VIS_SCALE = 1.3;
// Transparent margin (per side, logical px) between the zoomed box and the window
// edge so the ring (spread 2px × 1.3 ≈ 2.6px) clears un-clipped. 7.1 reproduces
// the original 220×66→300×100 window and holds for ANY base box.
const PIP_RING_HALO = 7.1;

/** Window size for a base box + high-vis flag. Box in normal mode; box×scale +
 *  halo in high-vis. The single derivation the window pin reads — and, via the
 *  base box, what the shell reads — so the two sides can never drift. */
function windowFor(
  box: { width: number; height: number },
  highVisibility: boolean,
): { width: number; height: number } {
  if (!highVisibility) return { width: box.width, height: box.height };
  return {
    width: Math.round(box.width * PIP_HIGH_VIS_SCALE + 2 * PIP_RING_HALO),
    height: Math.round(box.height * PIP_HIGH_VIS_SCALE + 2 * PIP_RING_HALO),
  };
}

/** The BASE CONTENT BOX for a phase — the shell renders this box, then zooms. */
export function pipBaseBoxForPhase(phase?: string): { width: number; height: number } {
  return phase === "meetingPrompt" ? PIP_SIZE_MEETING : PIP_SIZE;
}

/** High-vis halo window for the resting box (300×100). Derived, not hardcoded. */
export const PIP_SIZE_LARGE = windowFor(PIP_SIZE, true);

/** The pip WINDOW size for a high-visibility flag (resting box — create-size). */
export function pipSizeFor(highVisibility: boolean): { width: number; height: number } {
  return windowFor(PIP_SIZE, highVisibility);
}

/** The pip WINDOW size for a phase + high-visibility flag (phase-aware box). */
export function pipSizeForPhase(
  phase: string | undefined,
  highVisibility: boolean,
): { width: number; height: number } {
  return windowFor(pipBaseBoxForPhase(phase), highVisibility);
}

/** Payload for the "switch focus to a starting meeting" prompt. Title is
 *  external calendar data — the pip renders it as a plain React text node
 *  (never innerHTML). `startLabel` is a pre-formatted clock string (e.g.
 *  "2:00 PM") built on the main side so the pip bundle stays date-lib-free. */
export interface PipMeetingPrompt {
  title: string;
  startLabel: string;
  externalId: string;
}

export interface PipState {
  elapsed: number;
  paused: boolean;
  phase: "work" | "break" | "prompt" | "meetingPrompt";
  /** Frozen remaining-break scalar. Authoritative ONLY when `breakEndsAt` is
   *  null (paused / off-break) — the pip renders it verbatim then. While a
   *  break RUNS, the pip ignores this and self-ticks off `breakEndsAt`. */
  breakRemaining: number;
  /** Absolute wall-clock instant the running break ends (epoch ms), or null
   *  when paused / not on break. This is the ANCHOR: shipping it (not just the
   *  pre-computed scalar) lets the pip run its own 1 Hz clock and agree with
   *  the full Focus screen to the same instant — no snapshot lag / freeze /
   *  minute-boundary label disagreement. */
  breakEndsAt: number | null;
  /** Set only while `phase === "meetingPrompt"`; null otherwise. */
  meetingPrompt: PipMeetingPrompt | null;
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
