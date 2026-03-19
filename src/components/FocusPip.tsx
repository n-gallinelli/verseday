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

const ICON_BTN = "w-8 h-8 rounded-full flex items-center justify-center cursor-pointer text-black/35 hover:text-[#2c2a35] hover:bg-black/[0.06] transition-colors flex-shrink-0";
const BTN_PRIMARY = "px-2.5 py-1 rounded-[6px] text-[11px] bg-[#7B9ED9] text-white cursor-pointer hover:bg-[#6889c4] transition-colors";
const BTN_SECONDARY = "px-2.5 py-1 rounded-[6px] text-[11px] bg-black/[0.05] text-black/40 cursor-pointer hover:bg-black/[0.09] transition-colors";

function ProgressBar({ elapsed, estimatedMinutes }: { elapsed: number; estimatedMinutes: number | null }) {
  const elapsedMin = elapsed / 60000;

  if (estimatedMinutes && estimatedMinutes > 0) {
    const pct = Math.min((elapsedMin / estimatedMinutes) * 100, 100);
    const isOver = elapsedMin > estimatedMinutes;
    return (
      <div className="h-[3px] w-full bg-black/[0.06]">
        <div
          className="h-full transition-all duration-500"
          style={{
            width: `${isOver ? 100 : pct}%`,
            backgroundColor: isOver ? "#D85A30" : "#7B9ED9",
          }}
        />
      </div>
    );
  }

  // No estimate — pulsing bar
  return (
    <div className="h-[3px] w-full bg-black/[0.06] overflow-hidden">
      <div
        className="h-full bg-black/[0.08]"
        style={{
          width: "30%",
          animation: "pipPulse 3s ease-in-out infinite",
        }}
      />
      <style>{`
        @keyframes pipPulse {
          0%, 100% { transform: translateX(-100%); opacity: 0.4; }
          50% { transform: translateX(233%); opacity: 0.8; }
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
      <div className="bg-[#f5f4f0] px-3.5 py-2.5 select-none overflow-hidden" style={{ borderRadius: 12 }}>
        <p className="text-[13px] font-medium text-[#2c2a35] text-center mb-2.5">
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
        <div className="text-[11px] text-black/20 tabular-nums text-center">
          {formatTime(state.elapsed)}
        </div>
      </div>
    );
  }

  // ── BREAK COUNTDOWN ────────────────────────────────────────────────
  if (state.phase === "break") {
    return (
      <div className="bg-[#f5f4f0] px-3.5 py-2.5 select-none overflow-hidden" style={{ borderRadius: 12 }}>
        <div className="flex items-center gap-2.5">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-[0.06em] text-black/25 mb-0.5">Break</div>
            <div className="text-[20px] font-medium tabular-nums text-[#5DCAA5] leading-none" style={{ letterSpacing: "-0.5px" }}>
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
      className="bg-[#f5f4f0] select-none overflow-hidden flex flex-col"
      style={{ borderRadius: 12, border: "0.5px solid rgba(0,0,0,0.08)" }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Main row — content anchored right, controls expand leftward */}
      <div className="flex items-center flex-1 min-h-0">
        {/* Task name + timer — always visible */}
        <div className="flex items-center gap-2 px-3 py-2 flex-1 min-w-0">
          <div className="flex-1 min-w-0">
            <div
              className="text-[14px] font-medium text-[#2c2a35] truncate cursor-pointer hover:text-[#7B9ED9] transition-colors leading-snug"
              onClick={focusMainWindow}
            >
              {state.taskTitle}
            </div>
            <div className={`text-[12px] tabular-nums leading-snug ${state.paused ? "text-black/20" : "text-black/30"}`}>
              {formatTime(state.elapsed)}
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
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#3B6D11" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
            <button onClick={() => sendCommand("requestBreak")} className={`${ICON_BTN} flex-col !h-auto gap-0 py-0.5`} title="Take a break">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 12h10" />
                <path d="M2 5h8v4a3 3 0 01-3 3H5a3 3 0 01-3-3V5z" />
                <path d="M10 6h1.5a2 2 0 010 4H10" />
              </svg>
              <span className="text-[7px] uppercase tracking-wider text-black/25 leading-none">Break</span>
            </button>
          </div>

          {/* Play/pause — always anchored to right edge */}
          <button
            onClick={() => sendCommand("pause")}
            className="w-7 h-7 rounded-full flex items-center justify-center cursor-pointer text-black/30 hover:text-[#2c2a35] hover:bg-black/[0.06] transition-colors flex-shrink-0"
            title={state.paused ? "Resume" : "Pause"}
          >
            {state.paused ? (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="#7B9ED9">
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
