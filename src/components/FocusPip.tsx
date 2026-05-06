import { useEffect, useState, useRef } from "react";
import { WebviewWindow, getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { LogicalSize } from "@tauri-apps/api/dpi";

// Compact baseline for work/break readouts. The prompt phase grows
// 20px taller (a small bump, NOT the original 320×140 popup) so the
// "Break?" header and three pills can sit in two rows without
// cramping. Width is pinned at 220 across phases so the pip stays
// pip-shaped.
const PIP_SIZE_COMPACT = { width: 220, height: 68 };
const PIP_SIZE_PROMPT = { width: 220, height: 88 };

const PIP_STATE_KEY = "verseday_pip_state";
const PIP_CMD_KEY = "verseday_pip_cmd";

interface PipState {
  elapsed: number;
  paused: boolean;
  phase: "work" | "break" | "prompt";
  breakRemaining: number;
  taskTitle: string;
  estimatedMinutes: number | null;
}

function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
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
  localStorage.setItem(PIP_CMD_KEY, cmd);
}

function playCalm() {
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;
    const notes = [261.63, 329.63, 392.0];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + i * 0.2);
      gain.gain.linearRampToValueAtTime(0.2, now + i * 0.2 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.2 + 0.8);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.2);
      osc.stop(now + i * 0.2 + 0.8);
    });
    setTimeout(() => ctx.close(), 2000);
  } catch {
    // silent
  }
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
const BTN_SECONDARY = "px-2.5 py-1 rounded-[6px] text-[11px] bg-overlay-hover text-fg-muted cursor-pointer hover:bg-overlay-pressed transition-colors";

const FOCUS_STORAGE_KEY = "verseday_focus";
const ORPHAN_TIMEOUT_MS = 2000;

export default function FocusPip() {
  const [state, setState] = useState<PipState | null>(null);
  const [expanded, setExpanded] = useState(false);
  const orphanStartRef = useRef<number | null>(null);

  // Make the pip window's html+body transparent and clip overflow so the
  // rounded pill shows against the desktop instead of a rectangular bg.
  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.documentElement.style.overflow = "hidden";
    document.body.style.background = "transparent";
    document.body.style.overflow = "hidden";
    document.body.style.margin = "0";
  }, []);

  // Resize per phase. Compact for work/break, slightly taller for
  // the prompt to give Break? + three pills room. Watch for jitter
  // if the user docks the pip to the bottom of the screen — Tauri's
  // setSize anchors to the top, so a 20px height bump grows
  // downward.
  useEffect(() => {
    if (!state) return;
    const target =
      state.phase === "prompt" ? PIP_SIZE_PROMPT : PIP_SIZE_COMPACT;
    getCurrentWebviewWindow()
      .setSize(new LogicalSize(target.width, target.height))
      .catch(() => {});
  }, [state?.phase]);

  useEffect(() => {
    function load() {
      try {
        const raw = localStorage.getItem(PIP_STATE_KEY);
        if (raw) {
          orphanStartRef.current = null;
          setState((prev) => {
            const parsed = JSON.parse(raw) as PipState;
            if (prev && prev.phase !== parsed.phase) {
              if (parsed.phase === "prompt" || (prev.phase === "break" && parsed.phase === "work")) {
                playCalm();
              }
            }
            return parsed;
          });
        } else {
          setState(null);
          // Orphan self-close: if no PiP state and no focus state for 2+ seconds, close
          const focusRaw = localStorage.getItem(FOCUS_STORAGE_KEY);
          if (!focusRaw) {
            if (orphanStartRef.current === null) {
              orphanStartRef.current = Date.now();
            } else if (Date.now() - orphanStartRef.current >= ORPHAN_TIMEOUT_MS) {
              try {
                getCurrentWebviewWindow().close().catch(() => {});
              } catch {
                // silent
              }
            }
          } else {
            orphanStartRef.current = null;
          }
        }
      } catch {
        setState(null);
      }
    }
    load();
    const interval = setInterval(load, 200);
    return () => clearInterval(interval);
  }, []);

  function handleMouseEnter() {
    setExpanded(true);
  }

  function handleMouseLeave() {
    setExpanded(false);
  }

  if (!state) {
    return null;
  }

  // ── BREAK PROMPT — two rows, fits in 220×88 ────────────────────────
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
        className="select-none flex flex-col w-full h-full px-2.5 py-2"
        style={{
          background: "var(--focus-pip-bg)",
          borderRadius: 18,
          border: "0.5px solid var(--focus-pip-border)",
          boxShadow: "var(--shadow-card)",
        }}
        onMouseDown={handlePipMouseDown}
      >
        <p className="text-[13px] font-medium text-fg text-center mb-2 leading-tight">
          Ready for a break?
        </p>
        <div className="flex items-center justify-center gap-2.5 flex-1">
          <button
            onClick={() => sendCommand("takeBreak")}
            className="w-7 h-7 rounded-full flex items-center justify-center text-white bg-accent-green-deep hover:opacity-90 cursor-pointer transition-opacity"
            title="Yes — take a 5 min break"
            aria-label="Take a 5 minute break"
          >
            <ThumbsUpIcon />
          </button>
          <button
            onClick={() => sendCommand("snooze5")}
            className="w-7 h-7 rounded-full flex items-center justify-center text-fg-secondary border border-line-soft hover:border-line-strong hover:bg-overlay-hover cursor-pointer transition-colors"
            title="Remind me in 5 min"
            aria-label="Remind me in 5 minutes"
          >
            <ClockIcon />
          </button>
          <button
            onClick={() => sendCommand("noBreak")}
            className="w-7 h-7 rounded-full flex items-center justify-center text-fg-faded border border-line-hairline hover:text-fg-secondary hover:border-line-soft hover:bg-overlay-hover cursor-pointer transition-colors"
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
      <div data-tauri-drag-region className="px-3.5 py-2.5 select-none overflow-hidden" style={{ background: "var(--focus-pip-bg)", borderRadius: 18 }} onMouseDown={handlePipMouseDown}>
        <div className="flex items-center gap-2.5">
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

  // ── ACTIVE / PAUSED — hover swaps the whole pip to controls ────────
  return (
    <div
      data-tauri-drag-region
      className="select-none overflow-hidden relative"
      style={{ background: "var(--focus-pip-bg)", borderRadius: 18, border: "0.5px solid var(--focus-pip-border)" }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseDown={handlePipMouseDown}
    >
      {/* Resting layer — task name + timer. Always rendered; the
          control overlay sits on top during hover so this content
          is fully covered (no peek-through behind the icons). */}
      <div className="flex items-center gap-2 pl-4 pr-2.5 py-2.5 w-full h-full">
        <div className="flex-1 min-w-0">
          <div
            className="text-[14px] font-medium text-fg truncate cursor-pointer hover:text-accent-blue transition-colors leading-snug"
            onClick={focusMainWindow}
          >
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
      </div>

      {/* Hover overlay — covers the entire pip when expanded so the
          timer + title behind it are fully obscured (no visible
          numerals peeking through the icons). Fades in/out on hover.
          Order right-to-left: Pause (most-used) → Break → Complete →
          Stop → Hide. */}
      <div
        className="absolute inset-0 flex items-center justify-end gap-0.5 px-2 transition-opacity duration-150"
        style={{
          background: "var(--focus-pip-bg)",
          opacity: expanded ? 1 : 0,
          pointerEvents: expanded ? "auto" : "none",
        }}
      >
        {/* Hide pip — closes the mini window for the rest of this
            focus session. Re-appears next session. */}
        <button onClick={() => sendCommand("hidePip")} className={ICON_BTN} title="Hide mini timer">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 8s2.4-4 6-4 6 4 6 4-2.4 4-6 4-6-4-6-4z" />
            <circle cx="8" cy="8" r="1.6" />
            <path d="M2.5 13.5L13.5 2.5" />
          </svg>
        </button>

        <button onClick={() => sendCommand("stop")} className={ICON_BTN} title="Stop & save">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            <rect x="2" y="2" width="10" height="10" rx="1.5" />
          </svg>
        </button>

        <button onClick={() => sendCommand("done")} className={ICON_BTN} title="Complete task">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--accent-green-deep)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 8.5l3.5 3.5 6.5-7" />
          </svg>
        </button>

        <button onClick={() => sendCommand("requestBreak")} className={ICON_BTN} title="Take a break">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 12h10" />
            <path d="M2 5h8v4a3 3 0 01-3 3H5a3 3 0 01-3-3V5z" />
            <path d="M10 6h1.5a2 2 0 010 4H10" />
          </svg>
        </button>

        <button
          onClick={() => sendCommand("pause")}
          className="w-9 h-9 rounded-full flex items-center justify-center cursor-pointer text-fg-faded hover:text-fg hover:bg-input-hover transition-colors flex-shrink-0"
          title={state.paused ? "Resume" : "Pause"}
        >
          {state.paused ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="var(--accent-blue)">
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
  );
}
