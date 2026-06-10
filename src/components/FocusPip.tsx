import { useEffect, useState, useRef } from "react";
import { WebviewWindow, getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { currentMonitor } from "@tauri-apps/api/window";
import { emit, listen } from "@tauri-apps/api/event";
import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import VerseDayLogo from "./VerseDayLogo";
import { playBreakChime as playCalm } from "../utils/sounds";
import { clampToFrame } from "../utils/pipClamp";
import { PIP_STATE_EVENT, PIP_CMD_EVENT, PIP_READY_EVENT, PIP_SIZE, type PipState } from "../utils/pipEvents";

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

// Icon set for the break-prompt buttons. All three render at 16px,
// inherit currentColor from their parent button so theme + filled-vs-
// outlined treatments work without per-icon overrides.
function ThumbsUpIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 11v9H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3z" />
      <path d="M7 11l4-7a2 2 0 0 1 2 0c.7.4 1 1.2 1 2v3h4.5a2 2 0 0 1 2 2.3l-1.2 6a2 2 0 0 1-2 1.7H7" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

async function focusMainWindow() {
  try {
    const main = await WebviewWindow.getByLabel("main");
    if (main) await main.setFocus();
  } catch {
    // silent
  }
}

// Drag handler: hold + drag anywhere on the pip (except buttons/inputs) to
// reposition the window. Tauri's startDragging only kicks in on mouse motion,
// so a pure click still triggers child onClick handlers like focusMainWindow.
function handlePipMouseDown(e: React.MouseEvent) {
  const target = e.target as HTMLElement;
  if (target.closest("button, a, input, select, textarea")) return;
  getCurrentWebviewWindow().startDragging().catch(() => {});
}

const ICON_BTN = "w-8 h-8 rounded-full flex items-center justify-center cursor-pointer text-fg-faded hover:text-fg hover:bg-input-hover transition-colors flex-shrink-0";

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
  const lastSeenRef = useRef<number>(Date.now());
  // Transient acknowledgment text — shown for ~1.2s after the user
  // clicks Snooze ("5 more minutes") or No ("Continue working") on
  // the break prompt, so the click registers visually before the pip
  // flips back to its work view.
  const [pendingAck, setPendingAck] = useState<string | null>(null);
  const ackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Completion sequence (Option C — strike + hand-off) ──────────────
  // Clicking the checkmark plays a full-pip "officially done" takeover: the
  // finished task's title strikes through, a green check draws, then the panel
  // slides out — handing off to the next task, which slides in. The title is
  // SNAPSHOT at click time so the takeover keeps showing the task we just
  // finished even as the main window pushes the next task's state in the
  // background (we send "done" immediately, so the data write isn't delayed by
  // the animation). COMPLETE_MS must match the pipComplete keyframe duration.
  const [completing, setCompleting] = useState(false);
  const [completingTitle, setCompletingTitle] = useState("");
  const [slideInNext, setSlideInNext] = useState(false);
  const completeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slideInTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const COMPLETE_MS = 850;
  function completeWithFlourish() {
    if (completing) return; // guard double-fire
    setCompletingTitle(state?.taskTitle ?? "");
    setCompleting(true);
    sendCommand("done");
    if (completeTimerRef.current) clearTimeout(completeTimerRef.current);
    completeTimerRef.current = setTimeout(() => {
      setCompleting(false);
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

  // Pin the window to one size, ONCE on mount — never per phase. (The window is
  // also created at this size in FocusMode; this is a belt-and-suspenders set in
  // case anything reset it.) No phase dependency → no resize on phase change.
  useEffect(() => {
    getCurrentWebviewWindow()
      .setSize(new LogicalSize(PIP_SIZE.width, PIP_SIZE.height))
      .catch(() => {});
  }, []);

  // Keep the pip on-screen: clamp its position once a move SETTLES, so it can
  // never be dragged fully off an edge and lost (it died at y=-68 once). We do
  // NOT setPosition per onMoved frame — that fights the startDragging loop — so
  // the drag runs free and we rubber-band back only after it stops. All math in
  // physical px. setPosition only when the clamped target differs by >1px, so
  // the resulting onMoved can't loop. If currentMonitor() is null we no-op
  // rather than clamp to a guessed frame (could fling the pip off the screen
  // it's actually on). Boundary NOT covered: a pip orphaned by a MONITOR
  // DISCONNECT fires no onMoved, so this won't auto-rescue that — different
  // failure class, out of scope.
  useEffect(() => {
    const win = getCurrentWebviewWindow();
    let unlisten: (() => void) | undefined;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

    async function clampNow() {
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
        if (Math.abs(target.x - pos.x) > 1 || Math.abs(target.y - pos.y) > 1) {
          await win.setPosition(new PhysicalPosition(target.x, target.y));
        }
      } catch {
        // best-effort — a clamp miss just leaves the pip where it is
      }
    }

    (async () => {
      unlisten = await win.onMoved(() => {
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
          void clampNow();
        }, PIP_CLAMP_SETTLE_MS);
      });
    })();

    return () => {
      unlisten?.();
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
        setState(null);
        getCurrentWebviewWindow().close().catch(() => {});
        return;
      }
      setState((prev) => {
        if (prev && prev.phase !== next.phase) {
          if (next.phase === "prompt" || (prev.phase === "break" && next.phase === "work")) {
            playCalm();
          }
        }
        return next;
      });
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

  // ── COMPLETION TAKEOVER — full-pip "officially done" hand-off ─────────
  // Takes precedence over every phase: renders the SNAPSHOT of the task we
  // just finished (title struck through + green check), then slides out. Sits
  // before the null check so completing the last task still plays even if the
  // main window has already torn `state` down.
  if (completing) {
    return (
      <div
        data-tauri-drag-region
        className="select-none w-full h-screen overflow-hidden animate-pip-complete"
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
            <span className="relative flex-1 min-w-0 text-[14px] font-medium text-fg-faded truncate leading-snug">
              {completingTitle}
              <span
                aria-hidden
                className="absolute left-0 top-1/2 h-px bg-fg-faded animate-pip-strike pointer-events-none"
              />
            </span>
            <span className="flex-shrink-0 w-[18px] h-[18px] rounded-full bg-accent-green flex items-center justify-center">
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 8.5l3.5 3.5 6.5-7" className="animate-check-draw" />
              </svg>
            </span>
          </div>
          <div className="text-[11px] font-medium text-accent-green-deep leading-snug mt-1">
            Done
          </div>
        </div>
      </div>
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
    return (
      <div
        data-tauri-drag-region
        className="select-none flex items-center justify-center w-full h-screen"
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
      </div>
    );
  }

  // ── BREAK PROMPT — two compact rows, tightened to fit the 220×58 pip ──
  // Header row: centered "Ready for a break?" anchor at small weight.
  // Action row: three icon buttons (thumbs up / clock / x) — icon-only
  // keeps the pip uncluttered at this width; tooltips carry the
  // labels for accessibility. Filled green primary, outlined
  // secondary, outlined-faint tertiary mirror the full-screen
  // celebration's button hierarchy. FocusMode owns the 30s
  // auto-dismiss; the user is never trapped.
  if (state.phase === "prompt") {
    return (
      <div
        data-tauri-drag-region
        className="select-none flex flex-col justify-center w-full h-screen px-2.5 py-1.5"
        style={{
          background: PIP_BG,
          borderRadius: 18,
          border: "0.5px solid var(--focus-pip-border)",
          boxShadow: "var(--shadow-card)",
        }}
        onMouseDown={handlePipMouseDown}
      >
        <p className="text-[13px] font-medium text-fg text-center mb-1 leading-tight">
          Ready for a break?
        </p>
        <div className="flex items-center justify-center gap-2.5 flex-1">
          <button
            onClick={() => sendCommand("takeBreak")}
            className="w-6 h-6 rounded-full flex items-center justify-center text-white bg-accent-green-deep hover:opacity-90 cursor-pointer transition-opacity"
            title="Yes — take a 5 min break"
            aria-label="Take a 5 minute break"
          >
            <ThumbsUpIcon />
          </button>
          <button
            onClick={() => flashAck("5 more minutes", "snooze5")}
            className="w-6 h-6 rounded-full flex items-center justify-center text-fg-secondary border border-line-soft hover:border-line-strong hover:bg-overlay-hover cursor-pointer transition-colors"
            title="Remind me in 5 min"
            aria-label="Remind me in 5 minutes"
          >
            <ClockIcon />
          </button>
          <button
            onClick={() => flashAck("Break skipped", "noBreak")}
            className="w-6 h-6 rounded-full flex items-center justify-center text-fg-faded border border-line-hairline hover:text-fg-secondary hover:border-line-soft hover:bg-overlay-hover cursor-pointer transition-colors"
            title="No — keep working"
            aria-label="Decline break"
          >
            <CloseIcon />
          </button>
        </div>
      </div>
    );
  }

  // ── BREAK COUNTDOWN ────────────────────────────────────────────────
  if (state.phase === "break") {
    return (
      <div data-tauri-drag-region className="px-3.5 h-screen flex items-center select-none overflow-hidden" style={{ background: PIP_BG, borderRadius: 18 }} onMouseDown={handlePipMouseDown}>
        <div className="flex items-center gap-2.5 w-full">
          <div className="flex-1 min-w-0">
            <div className="uppercase [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] text-fg-faded mb-0.5">Break</div>
            <div className="text-[20px] font-medium tabular-nums text-accent-green-deep leading-none" style={{ letterSpacing: "-0.5px" }}>
              {formatCountdown(state.breakRemaining)}
            </div>
          </div>
          <button onClick={() => sendCommand("skipBreak")} className={BTN_SECONDARY}>
            End early
          </button>
        </div>
      </div>
    );
  }

  // ── ACTIVE / PAUSED ────────────────────────────────────────────────
  // Hover model: only the right-edge "pause zone" triggers the icon
  // expansion — hovering anywhere else on the pip is just hover, not
  // a control reveal. Clicking the pip body itself does nothing —
  // only the explicit VerseDay logo button (in the icon strip)
  // focuses the main window. The hover zone widens when expanded so
  // a mouse moving leftward across the icons stays inside it.
  return (
    <div
      data-tauri-drag-region
      className="select-none overflow-hidden relative h-screen"
      style={{ background: PIP_BG, borderRadius: 18, border: "0.5px solid var(--focus-pip-border)" }}
      onMouseDown={handlePipMouseDown}
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
              {formatTime(state.elapsed)}
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
              onClick={(e) => { e.stopPropagation(); focusMainWindow(); }}
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
    </div>
  );
}
