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
