import { useEffect, useState, useRef, useReducer } from "react";
import { WebviewWindow, getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { currentMonitor } from "@tauri-apps/api/window";
import { emit, listen } from "@tauri-apps/api/event";
import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import VerseDayLogo from "./VerseDayLogo";
import { playBreakChime as playCalm, playBreakEndChime, playMeetingChime } from "../utils/sounds";
import { breakEndClock } from "../utils/breakClock";
import { BREAK_PROMPT } from "../utils/breakPromptLabels";
import { clampToFrame } from "../utils/pipClamp";
import { displayElapsed } from "../utils/displayElapsed";
import { PIP_STATE_EVENT, PIP_CMD_EVENT, PIP_READY_EVENT, PIP_CHIME_EVENT, PIP_MOVED_EVENT, PIP_HIGH_VIS_SCALE, pipBaseBoxForPhase, pipSizeForPhase, PIP_COMPLETE_FLOURISH_MS, type PipState, type PipChimeKind, type PipMovedPayload } from "../utils/pipEvents";

// ONE fixed pip size for every phase — the pip window never resizes (a constant
// size means declining a break can't shrink it, and there's no setSize docking
// jitter). Sized to the compact running/paused readout; the break prompt is
// tightened to fit. Lives in pipEvents.ts so window + content can't drift.

// Pip surface color — themed via --focus-pip-bg so the pip reads
// white in light mode and dark in night mode against the desktop.
const PIP_BG = "var(--focus-pip-bg)";


function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  // Hour+ uses "Xh Ym Zs" — the seconds counter stays visible so the
  // pip reads as a live indicator at every duration. Sub-hour stays
  // MM:SS for the same reason.
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m === 0
      ? `${h}h ${pad(seconds)}s`
      : `${h}h ${m}m ${pad(seconds)}s`;
  }
  return `${minutes}:${pad(seconds)}`;
}

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(minutes)}:${pad(seconds)}`;
}

function sendCommand(cmd: string) {
  void emit(PIP_CMD_EVENT, cmd);
}

async function focusMainWindow() {
  try {
    const main = await WebviewWindow.getByLabel("main");
    if (main) await main.setFocus();
  } catch {
    // silent
  }
}

// Raise VerseDay onto the Focus screen of the task the pip is timing: tell the
// main window to route (clearBrowse + setPage("focus")) and bring it forward.
function openFocusScreen() {
  sendCommand("openFocus");
  void focusMainWindow();
}

// handlePipMouseDown / handlePipBodyClick + the screen-space pointer-down
// position live INSIDE the component now (a useRef, not module globals) so a
// future second pip surface can't clobber a shared mutable. See pipDownRef.

const ICON_BTN ="w-8 h-8 rounded-full flex items-center justify-center cursor-pointer text-fg-faded hover:text-fg hover:bg-input-hover transition-colors flex-shrink-0";

/** Per-icon transform for the hover-reveal fan-out. `slot` is the
 *  distance from the pause button (0 = closest, 3 = farthest). When
 *  collapsed, each icon is translated rightward by `slot` icon-widths
 *  so all four icons stack at the pause position. On hover, they
 *  slide to translateX(0) with a stagger so the closest icon appears
 *  first — feels like icons unfurling out from behind the pause. */
const ICON_SLOT_PX = 32;
function fanOut(slot: number, expanded: boolean): React.CSSProperties {
  return {
    transform: expanded ? "translateX(0)" : `translateX(${slot * ICON_SLOT_PX}px)`,
    transition: "transform 240ms cubic-bezier(0.2, 0.8, 0.3, 1)",
    transitionDelay: expanded ? `${slot * 30}ms` : "0ms",
  };
}
const BTN_SECONDARY = "px-2.5 py-1 rounded-[6px] text-[11px] bg-overlay-hover text-fg-muted cursor-pointer hover:bg-overlay-pressed transition-colors";

// No state/heartbeat event for this long ⟹ the main window is gone (crash /
// closed without a clean teardown) → the pip self-closes. Comfortably above the
// 1s heartbeat cadence so a paused session (heartbeat-only) never trips it.
const LIVENESS_TIMEOUT_MS = 2500;

// Menu-bar height (logical px) reserved as a TOP inset when clamping the pip
// on-screen. The pip is alwaysOnTop, so it floats over the dock + side edges
// and stays grabbable there — the menu bar is the one true occluder (and
// exactly where a dragged-off pip died: parked at y=-68, above it).
const MENU_BAR_LOGICAL = 25;
// Wait for drag to settle before clamping — do NOT setPosition per onMoved
// frame during a startDragging loop (fights the OS drag). Clamp once movement
// stops; a transient off-edge mid-drag is fine, the pip is never LEFT off.
const PIP_CLAMP_SETTLE_MS = 110;

export default function FocusPip() {
  const [state, setState] = useState<PipState | null>(null);
  // CSS-driven hover (cursor over the right-edge hover wrapper while
  // the pip IS the key window). Drives the icon fan-out for in-app
  // hover.
  const [cssHovered, setCssHovered] = useState(false);
  // External hover (cursor over the pip's screen rect detected by the
  // Rust-side global mouseMoved monitor). Set true/false by edge-
  // triggered "pip-hover" events. Drives the fan-out when the pip
  // ISN'T key and DOM hover dispatch is suppressed by macOS.
  const [externallyHovered, setExternallyHovered] = useState(false);
  const expanded = cssHovered || externallyHovered;
  // High-visibility (larger + glowing) pip. The flag rides on PipState from the
  // main window — never read from the sql settings layer here (pipEvents forbids
  // pulling the db into the pip bundle). Drives the window-size pin, the content
  // scale, and the glow layer.
  const highVis = state?.highVisibility ?? false;
  const hasState = state != null;
  const lastSeenRef = useRef<number>(Date.now());
  // Transient acknowledgment text — shown for ~1.2s after the user
  // clicks Snooze ("5 more minutes") or No ("Continue working") on
  // the break prompt, so the click registers visually before the pip
  // flips back to its work view.
  const [pendingAck, setPendingAck] = useState<string | null>(null);
  const ackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirrors the last-seen phase so the state listener (bound once on mount)
  // can detect phase transitions without reading a stale `state` closure and
  // without running side effects inside the setState updater.
  const prevPhaseRef = useRef<PipState["phase"] | null>(null);

  // Work-elapsed interpolation baseline (Verse-APPROVED, display-only). The main
  // window's timers throttle to ~2s while it's occluded, so the pushed `elapsed`
  // only refreshes every ~2s; the un-throttled pip smooths the gap by adding the
  // monotonic time since it received the value (see displayElapsed). The stamp is
  // minted HERE in the pip window (never the main window — independent monotonic
  // origins). elapsedMs is retained only to detect a real change: a bare
  // heartbeat/settle/ready-reply re-emits the SAME scalar, and restamping
  // receivedAt on those would drop the sub-emit interpolation and snap the
  // readout backward — so we re-sync only when the authoritative value moves
  // (which is also exactly when we want the drift pull-back). -1 = never stamped.
  const elapsedSyncRef = useRef<{ elapsedMs: number; receivedAt: number }>({
    elapsedMs: -1,
    receivedAt: 0,
  });

  // ── Completion sequence (Option C — strike + hand-off) ──────────────
  // Clicking the checkmark plays a full-pip "officially done" takeover: the
  // finished task's title strikes through, a green check draws, then the panel
  // slides out — handing off to the next task, which slides in. The title is
  // SNAPSHOT at click time so the takeover keeps showing the task we just
  // finished even as the main window pushes the next task's state in the
  // background (we send "done" immediately, so the data write isn't delayed by
  // the animation). COMPLETE_MS must match the pipComplete keyframe duration.
  const [completing, setCompleting] = useState(false);
  // Ref mirror — the PIP_STATE_EVENT listener binds ONCE on mount, so it can't
  // read the live `completing` state; it reads this instead.
  const completingRef = useRef(false);
  completingRef.current = completing;
  // Set when a `null` teardown arrives mid-beat (advance mode with no next
  // task) — the beat's end timer closes the window rather than the listener
  // cutting the animation.
  const pendingCloseRef = useRef(false);
  const [completingTitle, setCompletingTitle] = useState("");
  const [slideInNext, setSlideInNext] = useState(false);
  const completeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slideInTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const COMPLETE_MS = PIP_COMPLETE_FLOURISH_MS;
  function completeWithFlourish() {
    if (completing) return; // guard double-fire
    // Snapshot the behavior at CLICK time so a mid-beat setting/heartbeat change
    // can't flip which action the end timer takes.
    const behavior = state?.completeBehavior ?? "advance";
    pendingCloseRef.current = false;
    setCompletingTitle(state?.taskTitle ?? "");
    setCompleting(true);
    sendCommand("done");
    if (completeTimerRef.current) clearTimeout(completeTimerRef.current);
    completeTimerRef.current = setTimeout(() => {
      // "close" mode (or a teardown that arrived mid-beat): the full COMPLETE_MS
      // beat has now played — even under reduced motion the panel rendered for
      // its duration — so this is never an instant vanish. Self-close; the main
      // window clears focus shortly after.
      if (behavior === "close" || pendingCloseRef.current) {
        getCurrentWebviewWindow().close().catch(() => {});
        return;
      }
      setCompleting(false);
      // Reset BOTH hover flags as part of the hand-off. The `completing`
      // takeover is a separate subtree with no hover region, so the
      // onMouseLeave that normally clears these never fired while it was
      // up — and Rust's global monitor is dormant while the pip is
      // frontmost, so it can't deliver the over=false edge either. Without
      // this, the next task paints with the icon strip fanned out. Batched
      // with setCompleting(false) so it lands collapsed in one frame.
      setCssHovered(false);
      setExternallyHovered(false);
      // By now the main window has pushed the next task into `state` (emitted on
      // "done"); slide it in. Cleared after the entrance so heartbeat-driven
      // state updates don't replay the slide.
      setSlideInNext(true);
      if (slideInTimerRef.current) clearTimeout(slideInTimerRef.current);
      slideInTimerRef.current = setTimeout(() => setSlideInNext(false), 340);
    }, COMPLETE_MS);
  }

  function flashAck(message: string, cmd: string) {
    if (ackTimerRef.current) clearTimeout(ackTimerRef.current);
    setPendingAck(message);
    sendCommand(cmd);
    ackTimerRef.current = setTimeout(() => {
      setPendingAck(null);
      ackTimerRef.current = null;
    }, 1200);
  }

  // Like flashAck but with NO command dispatch — for system-driven transient
  // text (e.g. "End of break" on the break→work transition). Reuses the same
  // pendingAck overlay + auto-clear.
  function flashMessage(message: string, ms: number) {
    if (ackTimerRef.current) clearTimeout(ackTimerRef.current);
    setPendingAck(message);
    ackTimerRef.current = setTimeout(() => {
      setPendingAck(null);
      ackTimerRef.current = null;
    }, ms);
  }

  // Screen-space pointer-down position, captured on mousedown so the body
  // click-to-focus can tell a real click from the tail of a window drag. MUST be
  // screen coords, NOT client: during a Tauri window drag the window follows the
  // cursor, so client x/y barely move — only screen x/y reveals the drag. A
  // per-instance ref (not a module global) so a second pip surface can't clobber it.
  const pipDownRef = useRef({ x: 0, y: 0 });

  // Drag handler: hold + drag anywhere on the pip (except buttons/inputs) to
  // reposition the window. Tauri's startDragging only kicks in on mouse motion,
  // so a pure click still triggers child onClick handlers like openFocusScreen.
  function handlePipMouseDown(e: React.MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.closest("button, a, input, select, textarea")) return;
    pipDownRef.current = { x: e.screenX, y: e.screenY };
    getCurrentWebviewWindow().startDragging().catch(() => {});
  }

  // Body click → Focus screen. 185d928 deliberately removed the original
  // pip-body onClick (it had no drag guard); this re-adds it WITH one, per Nick's
  // "whole pip body navigates" choice. Do not re-remove without that context:
  // buttons stopPropagation so they never reach here, and a click that moved the
  // window > a few screen px (a drag) is ignored.
  function handlePipBodyClick(e: React.MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.closest("button, a, input, select, textarea")) return;
    if (Math.abs(e.screenX - pipDownRef.current.x) > 5 || Math.abs(e.screenY - pipDownRef.current.y) > 5) return;
    openFocusScreen();
  }

  useEffect(() => {
    return () => {
      if (ackTimerRef.current) clearTimeout(ackTimerRef.current);
      if (completeTimerRef.current) clearTimeout(completeTimerRef.current);
      if (slideInTimerRef.current) clearTimeout(slideInTimerRef.current);
    };
  }, []);

  // Make the pip window's html+body transparent and clip overflow so the
  // rounded pill shows against the desktop instead of a rectangular bg.
  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.documentElement.style.overflow = "hidden";
    document.body.style.background = "transparent";
    document.body.style.overflow = "hidden";
    document.body.style.margin = "0";
  }, []);

  // Pin the window size to the high-visibility flag — but only ONCE state (and
  // thus the flag) has arrived. Pinning on bare mount would stomp FocusMode's
  // create-size with the default before the flag is known and flicker
  // shrink-then-grow on every high-vis open. FocusMode owns the create-size;
  // this is the belt-and-suspenders pin AND the live-toggle path — when the flag
  // flips (Settings toggle re-broadcasts state) this re-pins, and the resize
  // drives the onResized clamp below so a grown window can't spill off-screen.
  // Phase-aware: the meetingPrompt phase pins a taller window (its card doesn't
  // fit the resting 66px box); every other phase reverts to the resting size.
  // `state?.phase` in the deps drives the re-pin on enter AND on clear.
  useEffect(() => {
    if (!hasState) return;
    const size = pipSizeForPhase(state?.phase, highVis);
    getCurrentWebviewWindow()
      .setSize(new LogicalSize(size.width, size.height))
      .catch(() => {});
  }, [hasState, highVis, state?.phase]);

  // Keep the pip on-screen: clamp its position once a move SETTLES, so it can
  // never be dragged fully off an edge and lost (it died at y=-68 once). We do
  // NOT setPosition per onMoved frame — that fights the startDragging loop — so
  // the drag runs free and we rubber-band back only after it stops. Clamp math
  // is in physical px (monitor bounds are physical); the persisted point is
  // converted to LOGICAL px before emit (see below). setPosition only when the
  // clamped target differs by >1px, so
  // the resulting onMoved can't loop. If currentMonitor() is null we no-op
  // rather than clamp to a guessed frame (could fling the pip off the screen
  // it's actually on). Boundary NOT covered: a pip orphaned by a MONITOR
  // DISCONNECT fires no onMoved, so this won't auto-rescue that — different
  // failure class, out of scope.
  useEffect(() => {
    const win = getCurrentWebviewWindow();
    let unlisten: (() => void) | undefined;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

    // emitWhenUnmoved: drag/resize-driven clamps pass `true` so an in-frame
    // drag that needed no clamping still persists. The one-shot MOUNT clamp
    // passes `false`: it persists only when it actually moved the window (a
    // rescue or the default-spawn menu-bar nudge), so it can't race the
    // restore setPosition and overwrite a just-restored point with a stale
    // read of the default spawn spot.
    async function clampNow(emitWhenUnmoved: boolean) {
      try {
        const monitor = await currentMonitor();
        if (!monitor) return; // fail-safe: never clamp to a guessed frame
        const pos = await win.outerPosition();
        const size = await win.outerSize();
        const scale = monitor.scaleFactor;
        const target = clampToFrame(
          { x: pos.x, y: pos.y },
          { width: size.width, height: size.height },
          {
            x: monitor.position.x,
            y: monitor.position.y,
            width: monitor.size.width,
            height: monitor.size.height,
          },
          { top: Math.round(MENU_BAR_LOGICAL * scale), right: 0, bottom: 0, left: 0 },
        );
        const moved =
          Math.abs(target.x - pos.x) > 1 || Math.abs(target.y - pos.y) > 1;
        if (moved) {
          await win.setPosition(new PhysicalPosition(target.x, target.y));
        }
        // Persist the FINAL on-screen point as LOGICAL px (physical / this
        // monitor's scale → Cocoa global points, monitor-independent) so a
        // restore via LogicalPosition round-trips across displays of differing
        // scale. `scale` is currentMonitor()'s — the saved monitor's, not the
        // spawn monitor's.
        if (moved || emitWhenUnmoved) {
          emit(PIP_MOVED_EVENT, {
            x: target.x / scale,
            y: target.y / scale,
          } satisfies PipMovedPayload);
        }
      } catch {
        // best-effort — a clamp miss just leaves the pip where it is
      }
    }

    function scheduleClamp() {
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        void clampNow(true);
      }, PIP_CLAMP_SETTLE_MS);
    }

    let unlistenResized: (() => void) | undefined;
    (async () => {
      // A drag (onMoved) OR a high-visibility resize (onResized) can leave the
      // window off-screen; growing anchored at the top-left can spill off the
      // bottom/right edge. Both settle, then clamp once.
      unlisten = await win.onMoved(scheduleClamp);
      unlistenResized = await win.onResized(scheduleClamp);
      // One-shot clamp on mount: onMoved/onResized don't fire on creation, so a
      // restored same-day position (or the default spawn) is reconciled against
      // the REAL currentMonitor() here. Rescues a pip restored fully off-screen
      // — e.g. saved on a now-disconnected display — and also nudges the default
      // spawn clear of the menu-bar inset. Persists only if it actually moved
      // the window (emitWhenUnmoved=false) so it can't clobber a fresh restore.
      void clampNow(false);
    })();

    return () => {
      unlisten?.();
      unlistenResized?.();
      if (settleTimer) clearTimeout(settleTimer);
    };
  }, []);

  // Stage 4 — receive state over a Tauri event (was the verseday_pip_state
  // localStorage poll). The main window emits on change + a 1s heartbeat; a
  // `null` payload is a clean teardown (no session) → close. lastSeenRef tracks
  // the newest event; the liveness interval self-closes if the main window goes
  // silent (crash / close with no clean teardown) — replacing the old
  // verseday_focus blob orphan read.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<PipState | null>(PIP_STATE_EVENT, (e) => {
      lastSeenRef.current = Date.now();
      const next = e.payload;
      if (!next) {
        // Mid completion beat: the main window may null focus (close mode, or
        // advance with no next task) before our beat finishes. Don't close from
        // here — defer to the beat's end timer so the green-burst isn't cut.
        // completingRef (not `completing`) because this callback bound once on
        // mount and would otherwise read a permanently-stale value.
        if (completingRef.current) {
          pendingCloseRef.current = true;
          return;
        }
        prevPhaseRef.current = null;
        setState(null);
        getCurrentWebviewWindow().close().catch(() => {});
        return;
      }
      // Phase-transition VISUALS only. The chime is now fired by FocusMode (the
      // single decider) over PIP_CHIME_EVENT when it elects the pip as speaker —
      // so there's exactly one play, no dual-AudioContext flam, and no risk of a
      // broadcast-coalesced phase change dropping a cue here. The pip still owns
      // the "End of break" flash, driven off the live phase mirror (not the
      // setState updater) so it doesn't run inside a render.
      const prevPhase = prevPhaseRef.current;
      if (prevPhase && prevPhase === "break" && next.phase === "work") {
        flashMessage("End of break", 2000);
      }
      prevPhaseRef.current = next.phase;
      // Re-sync the work-elapsed interpolation baseline — but ONLY when the
      // authoritative scalar actually moved. This is the single place the stamp
      // is minted (Verse cond. 1); the guard is what keeps redundant heartbeat/
      // settle/ready re-emits (same elapsed) from resetting the baseline and
      // snapping the readout backward. A change in EITHER direction (advance, or
      // a smaller value on task-advance/new session) re-syncs.
      if (next.elapsed !== elapsedSyncRef.current.elapsedMs) {
        elapsedSyncRef.current = { elapsedMs: next.elapsed, receivedAt: performance.now() };
      }
      setState(next);
    })
      .then((un) => {
        unlisten = un;
        // Ask main to push current state — but only AFTER the listener is
        // registered, else a fast answer races ahead of it and is lost (the pip
        // would blank until the next heartbeat). Deterministic no-blank.
        void emit(PIP_READY_EVENT);
      })
      .catch(() => {});

    // Liveness — close if the main window has gone silent past the timeout.
    lastSeenRef.current = Date.now();
    const liveness = setInterval(() => {
      if (Date.now() - lastSeenRef.current > LIVENESS_TIMEOUT_MS) {
        getCurrentWebviewWindow().close().catch(() => {});
      }
    }, 1000);

    return () => {
      unlisten?.();
      clearInterval(liveness);
    };
  }, []);

  // Self-tick the break countdown off the pushed ANCHOR (breakEndsAt), so the
  // pip agrees with the full Focus screen to the same instant instead of
  // lagging/freezing on a stale scalar snapshot. This effect only forces a
  // re-render each second; the remaining time is (re)computed at render from
  // the live `state.breakEndsAt` — so there's no closure to go stale on
  // resume/extend (Verse), and no 0-flash from a not-yet-populated interval
  // value. Keyed on a STABLE boolean (not state identity), so the 1 Hz
  // heartbeat re-pushes don't tear down and recreate the interval every second.
  const [, forceTick] = useReducer((x: number) => x + 1, 0);
  const breakTicking = state?.phase === "break" && state?.breakEndsAt != null;
  useEffect(() => {
    if (!breakTicking) return;
    const id = setInterval(forceTick, 1000);
    return () => clearInterval(id);
  }, [breakTicking]);

  // Self-tick the work-elapsed readout so the interpolated seconds advance on
  // time even while the main window's emits are throttled to ~2s. Only runs
  // while actually counting (running work, not paused/queued) — the frozen
  // states render the pushed scalar and need no local clock. 250ms so a second
  // boundary is crossed within a quarter-second (smooth, and cheap on the
  // un-throttled pip). The displayed value is recomputed at render from the
  // live sync baseline + performance.now(); this effect only forces the paint.
  const elapsedTicking =
    state?.phase === "work" && !state?.paused && !state?.queued;
  useEffect(() => {
    if (!elapsedTicking) return;
    const id = setInterval(forceTick, 250);
    return () => clearInterval(id);
  }, [elapsedTicking]);

  // Play a chime when FocusMode (the single decider) elects the pip as speaker.
  // playCalm = descending break-offer, playBreakEndChime = ascending break-over;
  // both call ctx.resume() defensively. FocusMode guarantees exactly one play, so
  // the pip never double-fires against an engine-local play.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<PipChimeKind>(PIP_CHIME_EVENT, (e) => {
      if (e.payload === "start") playCalm();
      else if (e.payload === "end") playBreakEndChime();
      else if (e.payload === "meeting") playMeetingChime();
    })
      .then((un) => { unlisten = un; })
      .catch(() => {});
    return () => unlisten?.();
  }, []);

  // Listen for the Rust-side hover monitor. Edge-triggered events
  // (one per cursor-cross-the-pip-rect transition) flip
  // externallyHovered, which ORs with cssHovered to drive expanded.
  //
  // Residual behavior, intentional: NSEvent's global mouse monitor
  // only fires for events delivered to OTHER apps. While VerseDay is
  // frontmost (main window or pip), mouseMoved events route to us and
  // the monitor doesn't run, so we never get the over=false edge that
  // drives retraction. Result: drag-then-release-then-move-cursor-
  // away inside our app leaves icons visible until the user switches
  // focus to another app, at which point the next mouseMoved fires
  // our monitor, geometry says off-pip, edge fires, retraction
  // happens. Matches macOS HUD conventions (Spotlight, color picker,
  // font panel — they retract on context switch, not on within-app
  // cursor moves). Closing the gap would require adding a LOCAL
  // NSEvent monitor alongside the global one — doubles the surface
  // area for a nuance most users won't notice. Don't.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      try {
        unlisten = await getCurrentWebviewWindow().listen<{ over: boolean }>(
          "pip-hover",
          (evt) => {
            if (cancelled) return;
            setExternallyHovered(evt.payload.over);
            // When Rust's geometry check says the cursor is no longer
            // over the pip rect, force cssHovered false too. Rust's
            // NSEvent monitor reads NSWindow.frame() inline and is the
            // source of truth for "cursor is over the pip"; native
            // drags + click-to-make-key transitions can leave
            // WKWebView's tracking area desynced so the inner-div
            // mouseLeave doesn't always fire when cursor exits the
            // pip. If Rust says off-pip, neither hover state should
            // be true. The reverse asymmetry is intentional — Rust
            // saying over=true doesn't fake CSS hover, since cursor
            // can be over the pip rect but not over the sub-region
            // where the icon-fanout hover-zone actually lives.
            if (!evt.payload.over) {
              setCssHovered(false);
            }
          }
        );
      } catch {
        // No-op on failure — falls back to cssHovered alone.
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Every phase renders through one shell: a window-filling, centered wrapper
  // holding a fixed BASE-sized (220×66) box. In high-vis mode the box magnifies
  // uniformly (PIP_HIGH_VIS_SCALE) via `zoom` — so all phase layouts grow
  // together and the break-prompt height math stays valid in scaled units —
  // and a breathing blue accent ring hugs the card in the small transparent
  // halo margin. We use `zoom`, NOT `transform: scale()`: scale stretches the
  // already-rasterized 220×66 bitmap, which blurs the text and smears the
  // 0.5px border into a fuzzy ring. `zoom` re-lays-out and re-rasterizes at the
  // final size (WKWebView honors it), so glyphs, border, and glow stay crisp.
  // In normal mode the box equals the window, so the shell is a no-op
  // pass-through. The `card` must size to the box (w-full h-full) and keeps its
  // own drag region, bg, border, and rounding.
  function pipShell(card: React.ReactNode, withRing: boolean) {
    // Base CONTENT box (never the window dims — `zoom` scales this box). Phase-
    // aware so meetingPrompt renders in its taller box, matching the phase-aware
    // window pinned above; both read pipEvents' single source so they can't drift.
    const box = pipBaseBoxForPhase(state?.phase);
    return (
      <div className="w-full h-screen flex items-center justify-center overflow-hidden">
        <div
          className="relative"
          style={{
            width: box.width,
            height: box.height,
            zoom: highVis ? PIP_HIGH_VIS_SCALE : undefined,
          }}
        >
          {highVis && withRing && (
            <div
              aria-hidden
              className="pip-ring-layer animate-pip-ring absolute inset-0 pointer-events-none"
              style={{
                borderRadius: 18,
                // Crisp accent ring: 0 blur, 2px spread (×1.3 under the box's
                // zoom ≈ 2.6px) → a sharp blue outline hugging the pill, no
                // fuzz. Opacity breathes via .animate-pip-ring for a subtle
                // "alive" pulse. The small window halo (PIP_SIZE_LARGE) is just
                // enough for the ring to render outside the card un-clipped.
                boxShadow: "0 0 0 2px var(--pip-ring)",
              }}
            />
          )}
          {card}
        </div>
      </div>
    );
  }

  // ── COMPLETION TAKEOVER — full-pip "officially done" hand-off ─────────
  // Takes precedence over every phase: renders the SNAPSHOT of the task we
  // just finished (title struck through + green check), then slides out. Sits
  // before the null check so completing the last task still plays even if the
  // main window has already torn `state` down.
  if (completing) {
    return pipShell(
      <div
        data-tauri-drag-region
        className="select-none w-full h-full overflow-hidden animate-pip-complete"
        style={{
          background: PIP_BG,
          borderRadius: 18,
          border: "0.5px solid var(--focus-pip-border)",
          boxShadow: "var(--shadow-card)",
        }}
        onMouseDown={handlePipMouseDown}
      >
        <div className="flex flex-col justify-center h-full px-4">
          <div className="flex items-center gap-2">
            <span className="flex-1 min-w-0 text-[14px] font-medium text-fg-faded truncate leading-snug">
              {completingTitle}
            </span>
            {/* Green check + radiating ring burst — the app's shared "done"
                beat (daily rows + focus screen), replacing the pip-only
                strikethrough. The ring reuses .animate-task-done-burst (also
                in the reduced-motion list, so it no-ops there). Base 18px →
                ~1.75 scale clears the overflow-hidden rounded pill. */}
            <span className="relative flex-shrink-0 w-[18px] h-[18px] rounded-full bg-accent-green flex items-center justify-center animate-task-done">
              <span
                aria-hidden
                className="absolute inset-0 rounded-full border-2 border-accent-green animate-task-done-burst pointer-events-none"
              />
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 8.5l3.5 3.5 6.5-7" className="animate-check-draw" />
              </svg>
            </span>
          </div>
          <div className="text-[11px] font-medium text-accent-green-deep leading-snug mt-1">
            Done
          </div>
        </div>
      </div>,
      false,
    );
  }

  if (!state) {
    return null;
  }

  // ── ACK — transient feedback after a prompt-button click ──────────
  // Renders the acknowledgment text on the same pip footprint, calmly
  // confirming the choice before the underlying state.phase flips to
  // "work" and the regular task readout returns.
  if (pendingAck) {
    return pipShell(
      <div
        data-tauri-drag-region
        className="select-none flex items-center justify-center w-full h-full"
        style={{
          background: PIP_BG,
          borderRadius: 18,
          border: "0.5px solid var(--focus-pip-border)",
          boxShadow: "var(--shadow-card)",
        }}
        onMouseDown={handlePipMouseDown}
      >
        <span className="text-[13px] font-medium text-fg leading-tight">
          {pendingAck}
        </span>
      </div>,
      true,
    );
  }

  // ── BREAK PROMPT — warm sunset CTA + two readable links, fit to 220×66 ──
  // Action-over-state hierarchy: the expected action (Rest now) dominates as a
  // filled, cup-labeled primary; "In 5 min" and "Skip it" demote to plain text
  // links beneath it. Copy + order match the full Focus screen exactly (shared
  // BREAK_PROMPT labels) so the two surfaces can't drift. The fill is WARM, not
  // green — green is reserved for completed states; starting a break is an
  // action. PINNED to the light accent-orange hex (bg-[#A85E1E]/hover #94511A,
  // white text ≈ 4.8:1) in both themes rather than the --accent-orange token,
  // which lightens to #d68647 in dark and fails WCAG 1.4.3 behind white text —
  // same pin-not-token discipline the green CTA used. Both links are
  // text-fg-secondary at 12px. FocusMode owns the 30s auto-dismiss; the user is
  // never trapped.
  // ── MEETING-START PROMPT — "switch focus to the meeting that's starting?" ──
  // Outranks the break offer (FocusMode sets phase="meetingPrompt" over any
  // work/break/prompt). Title + time as a title/SUBTITLE stack (the time on its
  // own line, intentionally separated — not an inline bold→regular seam). The
  // primary is a WARM pill labelled "Go to meeting" ("focus" is a task-timer
  // concept, not obviously a meeting one) — fill PINNED #A85E1E (the light
  // --accent-orange; the token FLIPS to a lighter #d68647 in dark that fails AA
  // behind white, so we pin the AA-safe value in both themes — same pin-not-token
  // discipline as the break CTA). Extra gap above the button row for breathing
  // room under the heavier CTA. Title is external calendar data, plain text node.
  // FocusMode owns the auto-dismiss; the user is never trapped.
  if (state.phase === "meetingPrompt" && state.meetingPrompt) {
    return pipShell(
      <div
        data-tauri-drag-region
        className="select-none flex flex-col items-center justify-center gap-3 w-full h-full px-3 py-3"
        style={{
          background: PIP_BG,
          borderRadius: 18,
          border: "0.5px solid var(--focus-pip-border)",
          boxShadow: "var(--shadow-card)",
        }}
        onMouseDown={handlePipMouseDown}
      >
        <div className="flex flex-col items-center gap-0.5 max-w-full px-1">
          <div className="text-[12px] leading-tight font-medium text-fg truncate max-w-full">
            {state.meetingPrompt.title}
          </div>
          {state.meetingPrompt.startLabel && (
            <div className="text-[10px] leading-none text-fg-secondary">
              starting {state.meetingPrompt.startLabel}
            </div>
          )}
        </div>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => sendCommand("switchToMeeting")}
            className="px-3.5 py-1.5 rounded-full text-[12px] font-medium text-white bg-[#A85E1E] hover:bg-[#94511A] cursor-pointer transition-colors"
            title="Switch your focus timer to this meeting"
          >
            Go to meeting
          </button>
          <button
            onClick={() => sendCommand("dismissMeetingPrompt")}
            className="text-[12px] text-fg-secondary hover:text-fg cursor-pointer transition-colors leading-none"
            title="Keep my current focus"
          >
            Not now
          </button>
        </div>
      </div>,
      true,
    );
  }

  if (state.phase === "prompt") {
    return pipShell(
      <div
        data-tauri-drag-region
        className="select-none flex flex-col items-center justify-center gap-2 w-full h-full px-2.5 py-1.5"
        style={{
          background: PIP_BG,
          borderRadius: 18,
          border: "0.5px solid var(--focus-pip-border)",
          boxShadow: "var(--shadow-card)",
        }}
        onMouseDown={handlePipMouseDown}
      >
        {/* Primary uses the WARM sunset accent, not green — matches the full
            Focus screen; green is reserved for completed states. Fill PINNED to
            the light accent-orange hex in BOTH themes (NOT the --accent-orange
            token, which lightens to #d68647 in dark and fails white-text AA) —
            same pin-not-token discipline as the old green CTA. */}
        <button
          onClick={() => sendCommand("takeBreak")}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[13px] font-medium text-white bg-[#A85E1E] hover:bg-[#94511A] cursor-pointer transition-colors"
          title="Start a 5 min break"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 6.5h7.5v3.25A2.75 2.75 0 0 1 7.75 12.5h-2A2.75 2.75 0 0 1 3 9.75V6.5Z" />
            <path d="M10.5 7.25H12a1.5 1.5 0 0 1 0 3h-1.5" />
          </svg>
          {BREAK_PROMPT.restNow}
        </button>
        {/* Secondary line — same words as the full screen, condensed to fit. */}
        <div className="flex items-center justify-center gap-2 text-[12px] leading-none">
          <button
            onClick={() => flashAck("5 more minutes", "snooze5")}
            className="text-fg-secondary hover:text-fg cursor-pointer transition-colors"
            title="Remind me in 5 min"
          >
            {BREAK_PROMPT.inFiveMin}
          </button>
          <span className="text-fg-muted select-none" aria-hidden="true">·</span>
          <button
            onClick={() => flashAck("Break skipped", "noBreak")}
            className="text-fg-secondary hover:text-fg cursor-pointer transition-colors"
            title="No — keep working"
          >
            {BREAK_PROMPT.skipIt}
          </button>
        </div>
      </div>,
      true,
    );
  }

  // ── BREAK COUNTDOWN ────────────────────────────────────────────────
  if (state.phase === "break") {
    // Running break → derive remaining from the anchor at render (fresh every
    // forceTick second); paused/anchor-null → render the frozen pushed scalar.
    // Break-END stays FocusMode's authority — this clamps at 0 and waits for the
    // phase-change event to leave break; it never drives the transition (Verse).
    const breakRemainingMs =
      state.breakEndsAt != null
        ? Math.max(0, state.breakEndsAt - Date.now())
        : state.breakRemaining;
    const breakEndsLabel =
      state.breakEndsAt != null
        ? breakEndClock(state.breakEndsAt, 0)
        : breakEndClock(Date.now(), state.breakRemaining);
    return pipShell(
      <div
        data-tauri-drag-region
        className="px-3.5 w-full h-full flex items-center select-none overflow-hidden"
        style={{ background: PIP_BG, borderRadius: 18, boxShadow: "var(--shadow-card)" }}
        onMouseDown={handlePipMouseDown}
        onMouseEnter={() => setCssHovered(true)}
        // Clear cssHovered only — the Rust monitor owns externallyHovered
        // (mirrors active-phase hover semantics, no tug-of-war).
        onMouseLeave={() => setCssHovered(false)}
      >
        <div className="flex items-center gap-2.5 w-full">
          <div className="flex-1 min-w-0">
            {/* "BREAK" crossfades to the end time on hover. Two stacked spans
                in a relative box: "Break" stays in flow (defines height, no
                layout shift) and "ends H:MM" overlays it absolutely. */}
            <div className="relative mb-0.5 leading-none">
              <span
                className="block uppercase [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] transition-opacity duration-[180ms]"
                style={{ color: "var(--focus-break-label)", opacity: expanded ? 0 : 1 }}
              >
                Break
              </span>
              <span
                aria-hidden={!expanded}
                className="absolute inset-0 uppercase whitespace-nowrap [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] transition-opacity duration-[180ms]"
                style={{ color: "var(--focus-break-label)", opacity: expanded ? 1 : 0 }}
              >
                ends {breakEndsLabel}
              </span>
            </div>
            <div className="text-[20px] font-semibold tabular-nums text-accent-green-deep leading-none font-display" style={{ letterSpacing: "0.03em" }}>
              {formatCountdown(breakRemainingMs)}
            </div>
          </div>
          <button onClick={() => sendCommand("skipBreak")} className={BTN_SECONDARY}>
            End early
          </button>
        </div>
      </div>,
      true,
    );
  }

  // ── ACTIVE / PAUSED ────────────────────────────────────────────────
  // Hover model: only the right-edge "pause zone" triggers the icon
  // expansion — hovering anywhere else on the pip is just hover, not
  // a control reveal. Clicking the pip body itself does nothing —
  // only the explicit VerseDay logo button (in the icon strip)
  // focuses the main window. The hover zone widens when expanded so
  // a mouse moving leftward across the icons stays inside it.
  return pipShell(
    <div
      data-tauri-drag-region
      className="select-none overflow-hidden relative w-full h-full"
      style={{ background: PIP_BG, borderRadius: 18, border: "0.5px solid var(--focus-pip-border)", boxShadow: "var(--shadow-card)" }}
      onMouseDown={handlePipMouseDown}
      onClick={handlePipBodyClick}
    >
      <div className={`flex items-center gap-2 pl-4 pr-2 py-2 w-full h-full ${slideInNext ? "animate-pip-slide-in" : ""}`}>
        {/* Title + timer — purely informational. Fades on hover so the
            icon row can take the space without overlapping.
            pr-12 reserves space for the absolute-positioned pause
            button (w-9 + right-2 → ~44px from the right edge of the
            pip) so a long title truncates *before* the pause icon
            instead of running underneath it. */}
        <div
          className="flex-1 min-w-0 pr-12 transition-opacity duration-150"
          style={{ opacity: expanded ? 0 : 1, pointerEvents: expanded ? "none" : "auto" }}
        >
          <div className="text-[14px] font-medium text-fg truncate leading-snug">
            {state.taskTitle}
          </div>
          <div className="text-[12px] tabular-nums leading-snug flex items-center gap-1.5">
            <span className={state.paused ? "text-fg-faded" : "text-accent-green-deep"}>
              {formatTime(
                displayElapsed(
                  elapsedSyncRef.current.elapsedMs,
                  elapsedSyncRef.current.receivedAt,
                  performance.now(),
                  state.paused || state.queued,
                ),
              )}
            </span>
            <span className="text-fg-disabled">/</span>
            <span className="text-fg-faded">
              {state.estimatedMinutes != null && state.estimatedMinutes > 0
                ? formatTime(state.estimatedMinutes * 60000)
                : "—"}
            </span>
          </div>
        </div>

        {/* Hover-tracked region containing the icon strip + pause.
            Width is state-dependent: when collapsed, it covers only
            the right ~64px (just the pause-button area, so hovering
            the rest of the pip is purely informational + click-to-
            focus). When expanded, it widens to cover the icon strip
            so the cursor doesn't fall out of the hover region while
            sliding leftward across icons. Buttons inside stop click
            propagation so the outer focus-on-click doesn't fire. */}
        <div
          onMouseEnter={() => setCssHovered(true)}
          onMouseLeave={() => {
            // Clear BOTH hover sources. externallyHovered comes from the Rust
            // global mouse monitor, which goes dormant while VerseDay is
            // frontmost — so it can stay stuck `true` and keep the icons fanned
            // out. A real CSS mouseLeave is authoritative that the cursor left.
            setCssHovered(false);
            setExternallyHovered(false);
          }}
          className="absolute top-0 bottom-0 right-0 transition-[left] duration-150 ease-out"
          style={{ left: expanded ? 8 : 156 }}
        >
          {/* Icons fan out right-to-left from the pause when expanded.
              VerseDay logo sits at the far left as a click-to-focus
              shortcut + visual anchor. */}
          <div
            className="absolute left-0 right-11 top-0 bottom-0 flex items-center justify-end gap-0.5"
            style={{
              opacity: expanded ? 1 : 0,
              pointerEvents: expanded ? "auto" : "none",
              transition: "opacity 140ms ease-out",
            }}
          >
            <button
              onClick={(e) => { e.stopPropagation(); openFocusScreen(); }}
              className={ICON_BTN}
              title="Open VerseDay"
              style={fanOut(4, expanded)}
            >
              <VerseDayLogo size={18} />
            </button>

            <button
              onClick={(e) => { e.stopPropagation(); sendCommand("hidePip"); }}
              className={ICON_BTN}
              title="Hide mini timer"
              style={fanOut(3, expanded)}
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 8s2.4-4 6-4 6 4 6 4-2.4 4-6 4-6-4-6-4z" />
                <circle cx="8" cy="8" r="1.6" />
                <path d="M2.5 13.5L13.5 2.5" />
              </svg>
            </button>

            <button
              onClick={(e) => { e.stopPropagation(); sendCommand("stop"); }}
              className={ICON_BTN}
              title="Stop & save"
              style={fanOut(2, expanded)}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                <rect x="2" y="2" width="10" height="10" rx="1.5" />
              </svg>
            </button>

            {/* Complete — feedback lives in the full-pip completion takeover
                (strike + hand-off), not on this tiny button, so it stays a
                plain icon here. */}
            <button
              onClick={(e) => { e.stopPropagation(); completeWithFlourish(); }}
              className={ICON_BTN}
              title="Complete task"
              style={fanOut(1, expanded)}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--accent-green-deep)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 8.5l3.5 3.5 6.5-7" />
              </svg>
            </button>

            <button
              onClick={(e) => { e.stopPropagation(); sendCommand("takeBreak"); }}
              className={ICON_BTN}
              title="Take a break"
              style={fanOut(0, expanded)}
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 12h10" />
                <path d="M2 5h8v4a3 3 0 01-3 3H5a3 3 0 01-3-3V5z" />
                <path d="M10 6h1.5a2 2 0 010 4H10" />
              </svg>
            </button>
          </div>

          {/* Persistent pause/resume — pinned to the right edge of the
              hover wrapper. Inside the wrapper so its hit area is part
              of the hover region. */}
          <button
            onClick={(e) => { e.stopPropagation(); sendCommand(state.queued ? "start" : "pause"); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full flex items-center justify-center cursor-pointer text-fg-faded hover:text-fg hover:bg-input-hover transition-colors"
            title={state.queued ? "Start" : state.paused ? "Resume" : "Pause"}
          >
            {state.queued || state.paused ? (
              // Resume: a blue play triangle, outline only (optically centered —
              // nudged ~1px right since a triangle's mass sits left of center).
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--accent-blue)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" className="translate-x-px">
                <path d="M3 1v12l10-6z" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                <rect x="2" y="1" width="3.5" height="12" rx="1" />
                <rect x="8.5" y="1" width="3.5" height="12" rx="1" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* RUNNING-INDICATOR EXPERIMENT (revertible — see index.css block).
          A line that sweeps back and forth along the pip's bottom edge while
          the timer is actively counting (not paused, not a preview). Remove
          this block + the index.css experiment block to revert. */}
      {!state.paused && !state.queued && (
        <div
          className="run-sweep-track absolute left-3 right-3 bottom-[3px] h-[2px]"
          style={{ background: "var(--focus-pip-border)" }}
        >
          <div className="run-sweep-bar run-sweep-bar-wide" style={{ background: "#A8CFE5" }} />
        </div>
      )}
    </div>,
    true,
  );
}
