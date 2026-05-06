// Calendar integration settings (M3).
//
// Renders the "Calendar integration" section on the Settings page.
// Owns the toggle, EventKit permission flow, per-calendar exclude
// checkboxes, "Sync now" button, last-synced timestamp, and the
// state-banner display for denied / revoked states.
//
// State machine: see docs/2026-05-05-calendar-m3-plan.md §7.
//
// M4 follow-up (Verse correction #3): revoked-after-grant is detected
// only on Settings mount today. M4's hourly tick + window-focus
// triggers should also re-check, so a user who revokes outside Settings
// doesn't keep the integration in a silently-failing state.

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getSetting } from "../../db/queries";
import {
  getEnabled,
  setEnabled as setEnabledSetting,
  getExcludedCalendarIds,
  setExcludedCalendarIds,
} from "../../calendar/settings";
import {
  useCalendarPermission,
  useCalendarSync,
} from "../../calendar/hooks";
import type { PermissionStatus } from "../../calendar/permissions";
import { todayString } from "../../utils/dates";
import { errorMessage } from "../../utils/errors";

interface CalendarMeta {
  id: string;
  name: string;
}

const SYNC_DEBOUNCE_MS = 400;
const TOAST_AUTO_DISMISS_MS = 3000;
const KEY_LAST_SYNCED_AT = "calendar.last_synced_at";

export default function CalendarSettings() {
  const [enabled, setEnabledState] = useState(false);
  const [calendars, setCalendars] = useState<CalendarMeta[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [revoked, setRevoked] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const excludeDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { status, refresh, request } = useCalendarPermission();
  const { syncNow } = useCalendarSync();

  // Load persisted state on mount.
  useEffect(() => {
    void (async () => {
      const [en, ex, ls] = await Promise.all([
        getEnabled(),
        getExcludedCalendarIds(),
        getSetting(KEY_LAST_SYNCED_AT),
      ]);
      setEnabledState(en);
      setExcluded(ex);
      setLastSyncedAt(ls);
    })();
  }, []);

  // Revoked-after-grant detection: if persisted enabled='1' but
  // EventKit now reports denied, auto-flip enabled to '0' and surface
  // a distinct banner. Per Verse Q3 — lying state (enabled=1 +
  // permission=denied) is worse than forcing a re-toggle.
  useEffect(() => {
    if (status === "denied" && enabled) {
      setEnabledState(false);
      void setEnabledSetting(false);
      setRevoked(true);
    }
  }, [status, enabled]);

  // Load calendar list once we have permission. CalDAV / iCloud lists
  // can change between sessions, so re-fetch on each enable transition
  // rather than caching.
  useEffect(() => {
    if (!enabled || status !== "granted") {
      setCalendars([]);
      return;
    }
    void (async () => {
      try {
        const list = await invoke<CalendarMeta[]>("calendar_get_calendar_list");
        setCalendars(list);
      } catch (e) {
        setError(errorMessage(e, "Couldn't load calendar list"));
      }
    })();
  }, [enabled, status]);

  // Auto-dismiss toast.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), TOAST_AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [toast]);

  // Polish #1: cancel any pending excluded-write on unmount so a
  // navigation within the 400 ms debounce window doesn't fire a
  // post-unmount setState through the timer's path.
  useEffect(() => {
    return () => {
      if (excludeDebounce.current) clearTimeout(excludeDebounce.current);
    };
  }, []);

  const fireInitialSync = useCallback(async () => {
    // Verse correction #2: wrap the immediate post-toggle-on sync in
    // try/catch so an EventKit transient (or sandbox recheck) doesn't
    // leave the user staring at a confused enabled-but-empty state.
    // calendar.enabled stays '1' — permission was granted, sync is
    // retryable via the Sync now button.
    try {
      const result = await syncNow(todayString());
      if (result.created > 0) {
        setToast(`Synced ${result.created} event${result.created === 1 ? "" : "s"}.`);
      }
    } catch (e) {
      setToast(`Calendar connected — initial sync failed, try Sync now.`);
      setError(errorMessage(e, "Initial sync failed"));
    } finally {
      const ls = await getSetting(KEY_LAST_SYNCED_AT);
      setLastSyncedAt(ls);
    }
  }, [syncNow]);

  async function handleToggle(next: boolean) {
    setError(null);
    setRevoked(false);

    if (!next) {
      setEnabledState(false);
      await setEnabledSetting(false);
      return;
    }

    // Toggling ON. Guard against unknown status (still loading).
    const current = status ?? (await refresh());

    if (current === "granted") {
      setEnabledState(true);
      await setEnabledSetting(true);
      void fireInitialSync();
      return;
    }

    if (current === "prompt") {
      // Polish #2: request() can throw on rare sandbox / system-call
      // failures. Mirror fireInitialSync's pattern — surface the
      // error, keep the toggle in its off state.
      let granted: PermissionStatus;
      try {
        granted = await request();
      } catch (e) {
        setEnabledState(false);
        setError(errorMessage(e, "Couldn't request calendar permission"));
        return;
      }
      if (granted === "granted") {
        setEnabledState(true);
        await setEnabledSetting(true);
        void fireInitialSync();
      } else if (granted === "denied") {
        // Toggle snaps back; banner appears via render.
        setEnabledState(false);
      } else {
        // Still 'prompt' — OS dismissed without decision (rare,
        // MDM-managed). Treat as transient.
        setEnabledState(false);
        setToast("Couldn't get calendar permission — try again.");
      }
      return;
    }

    // current === 'denied' — system prompt won't re-appear (EventKit
    // only prompts once per app identifier). User must visit System
    // Settings. Snap toggle back; banner is rendered by status branch.
    setEnabledState(false);
  }

  async function handleExcludeChange(id: string, include: boolean) {
    const next = new Set(excluded);
    if (include) next.delete(id);
    else next.add(id);
    setExcluded(next);

    // Debounce writes — matches focus-settings pattern.
    if (excludeDebounce.current) clearTimeout(excludeDebounce.current);
    excludeDebounce.current = setTimeout(() => {
      void setExcludedCalendarIds(next);
    }, SYNC_DEBOUNCE_MS);
  }

  async function handleSyncNow() {
    if (syncing) return;
    setSyncing(true);
    setError(null);
    setToast(null);
    try {
      const result = await syncNow(todayString());
      if (result.created > 0) {
        setToast(`Synced ${result.created} event${result.created === 1 ? "" : "s"}.`);
      } else if (result.skipped > 0) {
        setToast("Up to date.");
      } else {
        setToast("No events for today.");
      }
      const ls = await getSetting(KEY_LAST_SYNCED_AT);
      setLastSyncedAt(ls);
    } catch (e) {
      setError(errorMessage(e, "Sync failed"));
    } finally {
      setSyncing(false);
    }
  }

  const showCalendarList = enabled && status === "granted";
  const syncDisabled = !enabled || status !== "granted" || syncing;

  return (
    <section className="mt-1">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--text-faded)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="10" height="9" rx="1" />
            <path d="M2 5.5h10" />
            <path d="M5 2v2M9 2v2" />
          </svg>
          <h3 className="uppercase [font-size:var(--font-size-label)] [letter-spacing:var(--letter-spacing-label)] text-fg-faded" style={{ fontWeight: 500 }}>
            Calendar integration
          </h3>
        </div>
      </div>

      <div className="bg-elevated rounded-lg p-6 space-y-5" style={{ border: "0.5px solid var(--border-hairline)" }}>
        {/* Pre-prompt copy */}
        <div className="text-[12px] text-fg-faded leading-snug">
          VerseDay reads your Mac calendar to surface meetings as scheduled tasks. Nothing leaves your device.
        </div>

        {/* Toggle row */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13px] text-fg">Enable calendar import</div>
            <div className="text-[11px] text-fg-faded">Imports today's events into Daily Plan.</div>
          </div>
          <button
            onClick={() => handleToggle(!enabled)}
            disabled={status === null}
            className="relative w-10 h-6 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              backgroundColor: enabled ? "var(--accent-green)" : "var(--border-medium)",
            }}
            aria-pressed={enabled}
            aria-label={enabled ? "Disable calendar import" : "Enable calendar import"}
          >
            <span
              className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform"
              style={{ transform: enabled ? "translateX(18px)" : "translateX(2px)" }}
            />
          </button>
        </div>

        {/* Banners */}
        {revoked && (
          <div className="text-[12px] p-3 rounded-md" style={{ background: "var(--accent-orange-soft-bg)", color: "var(--accent-orange-soft-text)" }}>
            Calendar access was revoked. Open <strong>System Settings → Privacy & Security → Calendars</strong>, enable VerseDay, then toggle this on again.
          </div>
        )}
        {!revoked && status === "denied" && (
          <div className="text-[12px] p-3 rounded-md" style={{ background: "var(--accent-orange-soft-bg)", color: "var(--accent-orange-soft-text)" }}>
            Calendar access denied. Open <strong>System Settings → Privacy & Security → Calendars</strong> and enable VerseDay, then toggle this on again.
          </div>
        )}
        {error && (
          <div className="text-[12px] p-3 rounded-md bg-accent-danger text-fg-on-accent">
            {error}
          </div>
        )}

        {/* Calendar list */}
        {showCalendarList && (
          <div className="space-y-2">
            <div className="text-[11px] uppercase tracking-wider text-fg-faded">
              Include calendars
            </div>
            {calendars.length === 0 ? (
              <div className="text-[12px] text-fg-faded italic">No calendars found.</div>
            ) : (
              <div className="max-h-[360px] overflow-y-auto space-y-1.5 pr-2">
                {calendars.map((cal) => {
                  const isIncluded = !excluded.has(cal.id);
                  return (
                    <label key={cal.id} className="flex items-center gap-2 text-[13px] text-fg cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isIncluded}
                        onChange={(e) => handleExcludeChange(cal.id, e.target.checked)}
                        className="cursor-pointer"
                      />
                      <span>{cal.name}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Sync now + last-synced */}
        {enabled && status === "granted" && (
          <div className="flex items-center justify-between pt-2" style={{ borderTop: "0.5px solid var(--border-hairline)" }}>
            <div className="text-[11px] text-fg-faded">
              {lastSyncedAt ? `Last synced ${formatLastSynced(lastSyncedAt)}` : "Not yet synced"}
            </div>
            <button
              onClick={handleSyncNow}
              disabled={syncDisabled}
              className="text-[12px] px-3 py-1.5 rounded-md cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              style={{ border: "1px solid var(--border-medium)" }}
            >
              {syncing ? "Syncing…" : "Sync now"}
            </button>
          </div>
        )}

        {/* Toast (success / info) */}
        {toast && (
          <div className="text-[12px] p-2.5 rounded-md text-center" style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "0.5px solid var(--border-hairline)" }}>
            {toast}
          </div>
        )}
      </div>
    </section>
  );
}

function formatLastSynced(iso: string): string {
  // ISO8601 from sync.ts (toISOString). Render as relative if recent,
  // fall back to local time. Mirrors the Daily Plan's clock display.
  const then = new Date(iso);
  if (!Number.isFinite(then.getTime())) return iso;
  const seconds = Math.floor((Date.now() - then.getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600);
    return `${h} hour${h === 1 ? "" : "s"} ago`;
  }
  return then.toLocaleString();
}
