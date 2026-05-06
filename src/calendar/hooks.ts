// Calendar React hooks (M2 stub, fully wired in M4).
//
// `useCalendarSync` will mount on the Daily Plan page in M4. Today
// (M2) it just exposes the imperative sync surface and a stable
// callback shape so M4 can drop the hourly tick + mount + date-change
// triggers in without touching consumers.
//
// Per Verse A4 (plan v3): the hourly setInterval is
// `document.visibilityState`-aware from M4, not deferred — the
// scaffolding lives here, but actual scheduling is M4's job.

import { useCallback } from "react";
import {
  syncCalendarEventsForDate,
  type SyncResult,
} from "./sync";

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
