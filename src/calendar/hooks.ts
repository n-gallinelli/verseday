// Calendar React hooks.
//
// `useCalendarSync` exposes the imperative sync surface; M4 will add
// the visibility-aware hourly tick + mount triggers. `useCalendarPermission`
// reads EventKit's permission status fresh on every mount (and exposes
// a refresh + request callback) — never persists to the DB, since
// permission state lives in System Settings and the user can revoke
// out-of-band at any time. See Verse Q1 / plan §3.6.

import { useCallback, useEffect, useState } from "react";
import {
  syncCalendarEventsForDate,
  type SyncResult,
} from "./sync";
import {
  checkPermission,
  requestPermission,
  type PermissionStatus,
} from "./permissions";
import {
  getEnabled,
  setEnabled as setEnabledSetting,
} from "./settings";

export interface UseCalendarSyncResult {
  /** Force a sync now, bypassing the in-memory TTL. Wired to the
   *  Settings "Sync now" button in M3 and used by M4's Daily Plan
   *  manual refresh. */
  syncNow: (dateIso: string) => Promise<SyncResult>;
}

export function useCalendarSync(): UseCalendarSyncResult {
  const syncNow = useCallback(async (dateIso: string) => {
    return syncCalendarEventsForDate(dateIso, { force: true });
  }, []);

  return { syncNow };
}

export interface UseCalendarPermissionResult {
  /** Live status. `null` while the initial check is in flight on
   *  first mount — consumers should treat that as "loading" and not
   *  render denied/granted UI yet. */
  status: PermissionStatus | null;
  /** Re-read EventKit status. Use this when the user returns to a
   *  surface where the answer might have changed (Settings mount,
   *  Sync now click). */
  refresh: () => Promise<PermissionStatus>;
  /** Trigger the system prompt (no-op past first time per
   *  EventKit). Returns the resulting status. */
  request: () => Promise<PermissionStatus>;
}

export function useCalendarPermission(): UseCalendarPermissionResult {
  const [status, setStatus] = useState<PermissionStatus | null>(null);

  const refresh = useCallback(async () => {
    const next = await checkPermission();
    setStatus(next);
    return next;
  }, []);

  const request = useCallback(async () => {
    const next = await requestPermission();
    setStatus(next);
    return next;
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { status, refresh, request };
}

// ───────────────────────────────────────────────────────────────────
// useCalendarAutoSync — Daily Plan auto-sync lifecycle (M4)
// ───────────────────────────────────────────────────────────────────

const HOURLY_TICK_MS = 60 * 60 * 1000;

export interface UseCalendarAutoSyncResult {
  /** True while a sync is in flight. Daily Plan watches this for the
   *  3-second-deferred slow-sync toast. */
  syncing: boolean;
  /** `Date.now()` of the most recent sync that imported rows.
   *  Stable when a sync produced zero new rows (Verse polish — avoids
   *  Daily Plan refetching `getTasksForDate` every visibility ping). */
  lastResultAt: number | null;
}

/** Auto-sync the user's calendar into the given date on the Daily
 *  Plan. Owns mount + dateIso change + hourly tick + visibilitychange
 *  + window.focus. Re-checks permission status before every sync; if
 *  the user revoked outside Settings, the auto-flip useEffect (below)
 *  flips `calendar.enabled` to '0' — same logic as
 *  `CalendarSettings.tsx` §3.6, just triggered from M4's lifecycle.
 *
 *  See docs/2026-05-06-calendar-m4-plan.md for the full state machine. */
export function useCalendarAutoSync(dateIso: string): UseCalendarAutoSyncResult {
  const [enabled, setEnabledLocal] = useState<boolean | null>(null);
  const [status, setStatus] = useState<PermissionStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastResultAt, setLastResultAt] = useState<number | null>(null);

  // Initial state load. Both reads happen in parallel; the trigger
  // useEffect waits for both to resolve before firing the first sync
  // (Verse correction #3 — initial-mount race).
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [en, st] = await Promise.all([getEnabled(), checkPermission()]);
      if (!alive) return;
      setEnabledLocal(en);
      setStatus(st);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Verse correction #1: auto-flip on revoked-after-grant fires
  // independent of any sync attempt. Mirrors
  // CalendarSettings.tsx:73-79 byte-for-byte. State correction is not
  // a sync precondition — a user with enabled='1' + status='denied'
  // who never opens Settings would otherwise stay in a lying state
  // forever.
  useEffect(() => {
    if (status === "denied" && enabled) {
      setEnabledLocal(false);
      void setEnabledSetting(false);
    }
  }, [status, enabled]);

  // Trigger registration. Re-runs only when the boundary conditions
  // change (dateIso, enabled, hasPermission). Status updates from
  // mid-tick refreshes don't thrash this effect because we depend on
  // the boolean derived from status, not status itself.
  const hasPermission = status === "granted";
  useEffect(() => {
    // Verse correction #3: don't fire anything until full state
    // resolved. enabled === null OR status === null means initial
    // load is still in flight.
    if (enabled === null || status === null) return;
    if (!enabled) return;
    if (!hasPermission) return;

    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      // Visibility gate at fire time (plan v3 A4). WKWebView
      // occlusion isn't pixel-visibility — that's correct semantics
      // (plan §11 ¶5).
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;

      let liveStatus: PermissionStatus;
      try {
        liveStatus = await checkPermission();
      } catch (err) {
        // Verse correction #2: silent + console.error. Background-
        // sync failures shouldn't interrupt plan-viewing.
        console.error("calendar auto-sync: checkPermission failed:", err);
        return;
      }
      if (cancelled) return;
      // setStatus may flip hasPermission false → cleanup runs and
      // the auto-flip useEffect picks up the denied state.
      setStatus(liveStatus);
      if (liveStatus !== "granted") return;

      setSyncing(true);
      try {
        const result: SyncResult = await syncCalendarEventsForDate(dateIso, { force: false });
        // Verse polish: only update lastResultAt when rows actually
        // landed. Otherwise every visibility ping would fire a
        // useless getTasksForDate refetch in DailyPlanner.
        if (!cancelled && result.created > 0) {
          setLastResultAt(Date.now());
        }
      } catch (err) {
        console.error("calendar auto-sync: syncCalendarEventsForDate failed:", err);
      } finally {
        if (!cancelled) setSyncing(false);
      }
    };

    // Initial fire on mount + every dateIso change (effect re-runs).
    void tick();

    const interval = setInterval(() => {
      void tick();
    }, HOURLY_TICK_MS);

    // Both fire on Tauri app-switch; TTL absorbs the duplicate. Both
    // kept for future web-build coverage (plan Q5).
    const onVisibility = () => {
      if (document.visibilityState === "visible") void tick();
    };
    const onFocus = () => {
      void tick();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [dateIso, enabled, status, hasPermission]);

  return { syncing, lastResultAt };
}
