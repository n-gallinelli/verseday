import { useEffect, useState, useRef } from "react";
import { WebviewWindow, getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

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
const BTN_PRIMARY = "px-2.5 py-1 rounded-[6px] text-[11px] bg-accent-blue text-fg-on-accent cursor-pointer hover:bg-accent-blue-hover transition-colors";
const BTN_SECONDARY = "px-2.5 py-1 rounded-[6px] text-[11px] bg-overlay-hover text-fg-muted cursor-pointer hover:bg-overlay-pressed transition-colors";

function ProgressBar({ elapsed, estimatedMinutes }: { elapsed: number; estimatedMinutes: number | null }) {
  const elapsedMin = elapsed / 60000;

  if (estimatedMinutes && estimatedMinutes > 0) {
    const pct = Math.min((elapsedMin / estimatedMinutes) * 100, 100);
    const isOver = elapsedMin > estimatedMinutes;
    return (
      <div className="h-[3px] w-full bg-overlay-hover">
        <div
          className="h-full transition-all duration-500"
          style={{
            width: `${isOver ? 100 : pct}%`,
            backgroundColor: isOver ? "var(--accent-danger)" : "var(--accent-blue)",
            opacity: isOver ? 0.6 : 0.45,
          }}
        />
      </div>
    );
  }

  // No estimate — slow, faint pulsing bar
  return (
    <div className="h-[3px] w-full bg-overlay-hover overflow-hidden">
      <div
        className="h-full bg-accent-blue rounded-full"
        style={{
          width: "30%",
          animation: "pipPulse 5s ease-in-out infinite",
        }}
      />
      <style>{`
        @keyframes pipPulse {
          0%, 100% { transform: translateX(-100%); opacity: 0.18; }
          50% { transform: translateX(233%); opacity: 0.32; }
        }
      `}</style>
    </div>
  );
}

const FOCUS_STORAGE_KEY = "verseday_focus";
const ORPHAN_TIMEOUT_MS = 2000;

export default function FocusPip() {
  const [state, setState] = useState<PipState | null>(null);
  const [expanded, setExpanded] = useState(false);
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
    setExpanded(true);
  }

  function handleMouseLeave() {
    collapseTimerRef.current = setTimeout(() => setExpanded(false), 2000);
  }

  useEffect(() => {
    return () => {
      if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
    };
  }, []);

  if (!state) {
    return null;
  }

  // ── BREAK PROMPT ───────────────────────────────────────────────────
  if (state.phase === "prompt") {
    return (
      <div className="px-3.5 py-2.5 select-none overflow-hidden cursor-grab active:cursor-grabbing" style={{ background: "var(--focus-pip-bg)", borderRadius: 18 }} onMouseDown={handlePipMouseDown}>
        <p className="text-[13px] font-medium text-fg text-center mb-2.5">
          Ready for a break?
        </p>
        <div className="flex gap-1.5 justify-center mb-2">
          <button onClick={() => sendCommand("takeBreak")} className={BTN_PRIMARY}>
            Take a break
          </button>
          <button onClick={() => sendCommand("snooze5")} className={BTN_SECONDARY}>
            In 5 min
          </button>
          <button onClick={() => sendCommand("snooze10")} className={BTN_SECONDARY}>
            In 10 min
          </button>
        </div>
        <div className="text-[11px] text-fg-disabled tabular-nums text-center">
          {formatTime(state.elapsed)}
        </div>
      </div>
    );
  }

  // ── BREAK COUNTDOWN ────────────────────────────────────────────────
  if (state.phase === "break") {
    return (
      <div className="px-3.5 py-2.5 select-none overflow-hidden cursor-grab active:cursor-grabbing" style={{ background: "var(--focus-pip-bg)", borderRadius: 18 }} onMouseDown={handlePipMouseDown}>
        <div className="flex items-center gap-2.5">
          <div className="flex-1 min-w-0">
            <div className="uppercase [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] text-fg-faded mb-0.5">Break</div>
            <div className="text-[20px] font-medium tabular-nums text-accent-green-bright leading-none" style={{ letterSpacing: "-0.5px" }}>
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

  // ── ACTIVE / PAUSED — horizontal expand ────────────────────────────
  return (
    <div
      className="select-none overflow-hidden flex flex-col cursor-grab active:cursor-grabbing"
      style={{ background: "var(--focus-pip-bg)", borderRadius: 18, border: "0.5px solid var(--focus-pip-border)" }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseDown={handlePipMouseDown}
    >
      {/* Main row — content anchored right, controls expand leftward */}
      <div className="flex items-center flex-1 min-h-0">
        {/* Task name + timer — always visible */}
        <div className="flex items-center gap-2 pl-4 pr-2.5 py-2.5 flex-1 min-w-0">
          <div className="flex-1 min-w-0">
            <div
              className="text-[14px] font-medium text-fg truncate cursor-pointer hover:text-accent-blue transition-colors leading-snug"
              onClick={focusMainWindow}
            >
              {state.taskTitle}
            </div>
            <div className="text-[12px] tabular-nums leading-snug flex items-center gap-1.5">
              <span className={state.paused ? "text-fg-faded" : "text-accent-green-bright"}>
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

          {/* Expanded controls — slide in from right, appear to left of play/pause */}
          <div
            className="flex items-center gap-0.5 overflow-hidden flex-shrink-0 transition-all duration-150"
            style={{
              maxWidth: expanded ? "180px" : "0px",
              opacity: expanded ? 1 : 0,
              paddingRight: expanded ? "4px" : "0px",
            }}
          >
            {/* Complete */}
            <button onClick={() => sendCommand("done")} className={ICON_BTN} title="Complete task">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--accent-green-deep)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 8.5l3.5 3.5 6.5-7" />
              </svg>
            </button>

            {/* Stop */}
            <button onClick={() => sendCommand("stop")} className={ICON_BTN} title="Stop & save">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                <rect x="2" y="2" width="10" height="10" rx="1.5" />
              </svg>
            </button>

            {/* Break */}
            <button onClick={() => sendCommand("requestBreak")} className={ICON_BTN} title="Take a break">
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 12h10" />
                <path d="M2 5h8v4a3 3 0 01-3 3H5a3 3 0 01-3-3V5z" />
                <path d="M10 6h1.5a2 2 0 010 4H10" />
              </svg>
            </button>
          </div>

          {/* Play/pause — always anchored to right edge */}
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

      {/* Progress bar — flush bottom, no border-radius */}
      <ProgressBar elapsed={state.elapsed} estimatedMinutes={state.estimatedMinutes} />
    </div>
  );
}
