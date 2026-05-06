// Calendar → tasks sync layer (M2).
//
// Bridges the Rust `calendar_get_events_for_date` Tauri command into
// task rows. INSERT-only — no UPDATE branch. Existing rows with
// matching `external_id` are skipped (the v19 UNIQUE partial index
// makes this an SQLite-native ON CONFLICT). Dismissed tasks
// (soft-delete via `external_dismissal_reason`) are skipped on the
// way in too, so a delete-then-resync doesn't recreate them.
//
// See `docs/2026-05-05-calendar-integration-plan.md` for the approved
// design and the Verse-review trail.

import { invoke } from "@tauri-apps/api/core";
import {
  getDismissedExternalIds,
  upsertCalendarTask,
  setSetting,
} from "../db/queries";
import { getEnabled, getExcludedCalendarIds } from "./settings";
import type { CalendarEvent } from "./types";

// ───────────────────────────────────────────────────────────────────
// Settings keys (M3 owns the readers/writers; sync.ts just stamps
// `last_synced_at` so keep the constant local).
// ───────────────────────────────────────────────────────────────────

const SETTING_LAST_SYNCED_AT = "calendar.last_synced_at";

// ───────────────────────────────────────────────────────────────────
// Per-date TTL (Verse Q1: in-memory Map, capped ≤64 to bound long-
// session navigation through many dates — weekly views are 7-date
// sweeps, so naive growth is non-trivial).
// ───────────────────────────────────────────────────────────────────

const TTL_MS = 5 * 60 * 1000; // 5 minutes
const TTL_MAP_CAP = 64;
const lastSyncByDate = new Map<string, number>();

function ttlEvictIfFull(): void {
  if (lastSyncByDate.size < TTL_MAP_CAP) return;
  // Evict oldest entry — Map iteration order is insertion order, so
  // `keys().next()` gives us the longest-resident date.
  const oldest = lastSyncByDate.keys().next();
  if (!oldest.done) {
    lastSyncByDate.delete(oldest.value);
  }
}

function ttlMark(dateIso: string): void {
  ttlEvictIfFull();
  lastSyncByDate.set(dateIso, Date.now());
}

function ttlIsFresh(dateIso: string): boolean {
  const last = lastSyncByDate.get(dateIso);
  if (last == null) return false;
  return Date.now() - last < TTL_MS;
}

// ───────────────────────────────────────────────────────────────────
// Format guard (Verse Q3): trust Rust's local-tz string instead of
// round-tripping through `new Date()`, but assert at the boundary so
// a future serialization drift fails loudly rather than silently
// writing wrong dates.
// ───────────────────────────────────────────────────────────────────

const START_LOCAL_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function dateFromStartLocal(startLocal: string): string {
  if (!START_LOCAL_PATTERN.test(startLocal)) {
    throw new Error(
      `calendar: unexpected startLocal format from Rust: ${JSON.stringify(startLocal)} ` +
        `(expected YYYY-MM-DDTHH:MM…). If this fires, the Rust ` +
        `formatter in src-tauri/src/calendar.rs has drifted.`,
    );
  }
  return startLocal.split("T")[0];
}

// ───────────────────────────────────────────────────────────────────
// Estimated minutes derivation
// ───────────────────────────────────────────────────────────────────

/** Returns `null` for all-day events (Verse Q4 — `null` matches the
 *  existing convention for "no estimate" and avoids implying "0 min
 *  of work"). For timed events, computes `(end - start) / 60000`,
 *  rounded. Returns `null` if either bound is missing or the math
 *  goes negative (clock skew shouldn't let us write garbage). */
function estimatedMinutesForEvent(ev: CalendarEvent): number | null {
  if (ev.allDay) return null;
  if (!ev.endLocal) return null;
  if (!START_LOCAL_PATTERN.test(ev.endLocal)) return null;
  // The strings are local-tz HH:MM with no timezone offset; comparing
  // as Date is ambiguous on absolute UTC, but for a *duration* between
  // two strings in the same zone the offset cancels out. Construct
  // both with the same parser, subtract.
  const start = new Date(ev.startLocal).getTime();
  const end = new Date(ev.endLocal).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const minutes = Math.round((end - start) / 60000);
  return minutes > 0 ? minutes : null;
}

// ───────────────────────────────────────────────────────────────────
// Public API
// ───────────────────────────────────────────────────────────────────

export interface SyncResult {
  created: number;
  skipped: number;
}

/** Sync calendar events for a single local date into `tasks`.
 *  See `docs/2026-05-05-calendar-integration-plan.md` § "Sync algorithm". */
export async function syncCalendarEventsForDate(
  dateIso: string,
  opts: { force?: boolean } = {},
): Promise<SyncResult> {
  // 1. Disabled → exit.
  if (!(await getEnabled())) return { created: 0, skipped: 0 };

  // 2. TTL guard.
  if (!opts.force && ttlIsFresh(dateIso)) {
    return { created: 0, skipped: 0 };
  }

  // 3. Fetch events from Rust.
  const events: CalendarEvent[] = await invoke("calendar_get_events_for_date", {
    dateIso,
  });

  // 4. Filter excluded calendars + cancelled events.
  const excluded: Set<string> = await getExcludedCalendarIds();
  const candidates = events.filter(
    (ev) => !excluded.has(ev.calendarId) && ev.status !== "cancelled",
  );

  // 5. Drop dismissed external_ids for the date.
  const dismissed = new Set(await getDismissedExternalIds(dateIso));

  // 6. Insert remaining.
  let created = 0;
  let skipped = 0;
  for (const ev of candidates) {
    if (dismissed.has(ev.externalId)) {
      skipped++;
      continue;
    }
    const inserted = await upsertCalendarTask({
      externalId: ev.externalId,
      title: ev.title,
      dateScheduled: dateFromStartLocal(ev.startLocal),
      estimatedMinutes: estimatedMinutesForEvent(ev),
      notes: ev.notes,
      location: ev.location,
      url: ev.url,
      attendees: ev.attendees.length > 0 ? JSON.stringify(ev.attendees) : null,
      organizerEmail: ev.organizerEmail,
      calendarName: ev.calendarName,
      startLocal: ev.startLocal,
      endLocal: ev.endLocal,
    });
    if (inserted) created++;
    else skipped++;
  }

  // 7. Stamp.
  ttlMark(dateIso);
  await setSetting(SETTING_LAST_SYNCED_AT, new Date().toISOString());

  return { created, skipped };
}

// ───────────────────────────────────────────────────────────────────
// Test surface — exported for unit/manual verification only.
// ───────────────────────────────────────────────────────────────────

export const _internals = {
  TTL_MS,
  TTL_MAP_CAP,
  lastSyncByDate,
  dateFromStartLocal,
  estimatedMinutesForEvent,
};
