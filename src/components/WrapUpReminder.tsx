import { useState, useEffect, useRef } from "react";
import { useAppStore } from "../stores/appStore";

const WRAPUP_HOUR = 16;
const WRAPUP_MINUTE = 30;
const WRAPUP_KEY_PREFIX = "verseday_wrapup_";
const AUTO_DISMISS_MS = 60000;

function getTodayIso(): string {
  return new Date().toISOString().split("T")[0];
}

function isWrapUpTime(): boolean {
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();
  return h === WRAPUP_HOUR && m >= WRAPUP_MINUTE;
}

function wasShownToday(): boolean {
  return localStorage.getItem(WRAPUP_KEY_PREFIX + getTodayIso()) === "true";
}

function markShownToday(): void {
  localStorage.setItem(WRAPUP_KEY_PREFIX + getTodayIso(), "true");
}

// Clean up keys older than 7 days
function cleanupStaleKeys(): void {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(WRAPUP_KEY_PREFIX)) {
        const dateStr = key.slice(WRAPUP_KEY_PREFIX.length);
        if (dateStr < cutoff.toISOString().split("T")[0]) {
          keysToRemove.push(key);
        }
      }
    }
    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
  } catch {
    // silent
  }
}

export default function WrapUpReminder() {
  const [visible, setVisible] = useState(false);
  const setPage = useAppStore((s) => s.setPage);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    cleanupStaleKeys();

    function check() {
      if (!wasShownToday() && isWrapUpTime()) {
        markShownToday();
        setVisible(true);
      }
    }

    check();
    const interval = setInterval(check, 60000);
    return () => clearInterval(interval);
  }, []);

  // Auto-dismiss after 60 seconds
  useEffect(() => {
    if (visible) {
      dismissTimerRef.current = setTimeout(() => setVisible(false), AUTO_DISMISS_MS);
      return () => {
        if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
      };
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="fixed top-4 right-4 z-40 animate-slide-in">
      <div
        className="bg-white border border-black/[0.08] rounded-xl shadow-lg px-5 py-4 w-[280px]"
        style={{ borderWidth: "0.5px" }}
      >
        <div className="flex items-center gap-2.5 mb-3">
          <span className="text-[15px] font-medium text-[#7B9ED9] tracking-tight">
            VerseDay
          </span>
        </div>
        <p className="text-[14px] text-[#2c2a35] font-medium mb-1">
          Wrap up your day
        </p>
        <p className="text-[12px] text-black/40 mb-4">
          Take a few minutes to reflect and plan for tomorrow.
        </p>
        <div className="flex items-center gap-2">
          <button onClick={() => {
              setVisible(false);
              setPage("daily_shutdown");
            }} className="flex-1 py-2 rounded-lg bg-[#7B9ED9] text-white text-[13px] font-medium cursor-pointer hover:bg-[#6889c4] transition-colors">Start shutdown</button>
          <button onClick={() => setVisible(false)} className="px-3 py-2 rounded-lg text-[13px] text-black/35 cursor-pointer hover:bg-black/[0.04] transition-colors">Later</button>
        </div>
      </div>
    </div>
  );
}
