import { useState, useEffect } from "react";
import { useAppStore } from "../stores/appStore";
import { todayString, localDateIso } from "../utils/dates";
import VerseDayLogo from "./VerseDayLogo";

const WRAPUP_HOUR = 16;
const WRAPUP_MINUTE = 30;
// Per-day flag — set when the user has already shut down (or has been
// reminded and started the shutdown flow). Prevents the reminder from
// re-popping the same evening. Cleaned up after 7 days.
const COMPLETED_KEY_PREFIX = "verseday_wrapup_";
// Cross-day snooze timestamp — Date.now() value past which the reminder
// is allowed to show again. Lives outside the per-day key so a snooze
// taken at 4:35pm survives a brief app close/reopen.
const SNOOZE_KEY = "verseday_wrapup_snooze";

function getTodayIso(): string {
  return todayString(); // #28 — local tz; toISOString() flips the per-day key in the evening
}

// True any time at or after 4:30 PM today — broader than the previous
// "exactly the 4:30–4:59 window" so a 30-minute snooze actually re-fires
// at 5:00 PM rather than silently expiring with the hour.
function isWrapUpOrLater(): boolean {
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();
  if (h > WRAPUP_HOUR) return true;
  if (h === WRAPUP_HOUR && m >= WRAPUP_MINUTE) return true;
  return false;
}

function wasCompletedToday(): boolean {
  return localStorage.getItem(COMPLETED_KEY_PREFIX + getTodayIso()) === "true";
}

function markCompletedToday(): void {
  localStorage.setItem(COMPLETED_KEY_PREFIX + getTodayIso(), "true");
}

function getSnoozeUntil(): number {
  const raw = localStorage.getItem(SNOOZE_KEY);
  const n = raw ? parseInt(raw, 10) : NaN;
  return isNaN(n) ? 0 : n;
}

function setSnoozeUntil(ts: number | null): void {
  if (ts == null) localStorage.removeItem(SNOOZE_KEY);
  else localStorage.setItem(SNOOZE_KEY, ts.toString());
}

function shouldShow(): boolean {
  if (wasCompletedToday()) return false;
  if (!isWrapUpOrLater()) return false;
  return Date.now() >= getSnoozeUntil();
}

// Clean up keys older than 7 days. Catches both the per-day completion
// flag and any stale snooze timestamp that's well in the past.
function cleanupStaleKeys(): void {
  try {
    const cutoffIso = (() => {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      return localDateIso(d); // #28 — local tz
    })();
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key.startsWith(COMPLETED_KEY_PREFIX) && key !== SNOOZE_KEY) {
        const dateStr = key.slice(COMPLETED_KEY_PREFIX.length);
        if (dateStr < cutoffIso) keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) localStorage.removeItem(key);
    // Drop a snooze timestamp that's already long past.
    const snooze = getSnoozeUntil();
    if (snooze > 0 && snooze < Date.now() - 24 * 60 * 60 * 1000) {
      setSnoozeUntil(null);
    }
  } catch {
    // silent
  }
}

export default function WrapUpReminder() {
  const [visible, setVisible] = useState(false);
  const setPage = useAppStore((s) => s.setPage);

  useEffect(() => {
    cleanupStaleKeys();
    function check() {
      if (shouldShow()) setVisible(true);
    }
    check();
    const interval = setInterval(check, 60000);
    return () => clearInterval(interval);
  }, []);

  function handleStartShutdown() {
    markCompletedToday();
    setSnoozeUntil(null);
    setVisible(false);
    setPage("daily_shutdown");
  }

  function handleSnooze(minutes: number) {
    setSnoozeUntil(Date.now() + minutes * 60 * 1000);
    setVisible(false);
  }

  // Dismiss for the rest of today without claiming a shutdown happened.
  // The per-day flag clears at midnight, so the reminder is free to fire
  // again tomorrow at 4:30 PM.
  function handleDismiss() {
    markCompletedToday();
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 animate-slide-up">
      <div
        className="relative bg-elevated border border-line-soft rounded-xl shadow-lg px-5 py-4 w-[300px]"
        style={{ borderWidth: "0.5px" }}
      >
        <button
          onClick={handleDismiss}
          aria-label="Dismiss"
          className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-md text-fg-disabled hover:text-fg-faded hover:bg-overlay-hover cursor-pointer transition-colors"
        >
          <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3l8 8M11 3l-8 8" />
          </svg>
        </button>
        <div className="flex items-center mb-3">
          <VerseDayLogo size={24} />
        </div>
        <p className="text-[14px] text-fg font-medium mb-1">
          Wrap up your day
        </p>
        <p className="text-[12px] text-fg-muted mb-4">
          Take a few minutes to reflect.
        </p>
        <button
          onClick={handleStartShutdown}
          className="w-full flex items-center justify-center gap-2 rounded-lg border border-accent-blue/50 text-accent-blue-soft-fg px-4 py-1.5 text-[13px] font-medium cursor-pointer hover:border-accent-blue hover:bg-accent-blue-soft transition-colors"
        >
          Start shutdown
        </button>
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={() => handleSnooze(15)}
            className="flex-1 text-[12px] text-fg-faded hover:text-fg-secondary hover:bg-overlay-hover cursor-pointer transition-colors py-1.5 rounded-md"
          >
            Snooze 15m
          </button>
          <button
            onClick={() => handleSnooze(30)}
            className="flex-1 text-[12px] text-fg-faded hover:text-fg-secondary hover:bg-overlay-hover cursor-pointer transition-colors py-1.5 rounded-md"
          >
            Snooze 30m
          </button>
        </div>
      </div>
    </div>
  );
}
