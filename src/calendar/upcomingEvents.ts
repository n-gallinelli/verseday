// Upcoming-events selector (M5 — meeting approach notifier).
//
// Reads today's calendar-sourced tasks and returns the subset whose
// `external_start_local` falls in the window `(now, now + leadMinutes]`.
// Skips all-day events (no time portion) and dismissed rows.
//
// Local-tz parsing follows the Verse Q3 convention from sync.ts: do NOT
// round-trip `external_start_local` through `new Date(string)`, which is
// flaky across engines for naked-local strings. The explicit numeric
// parser below is timezone-deterministic.

import { getDb } from "../db/database";
import { todayString } from "../utils/dates";

export interface UpcomingEvent {
  externalId: string;
  title: string;
  startLocal: string;
  startMs: number;
}

const START_LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;

/** Parse a `YYYY-MM-DDTHH:MM[…]` local-wall-clock string into ms since
 *  epoch using the local timezone. Returns `NaN` if the format doesn't
 *  match (caller treats as "not a timed event"). */
export function localStartToMs(s: string): number {
  const m = START_LOCAL_PATTERN.exec(s);
  if (!m) return NaN;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
}

interface Row {
  external_id: string;
  title: string;
  external_start_local: string | null;
}

/** Returns today's calendar events starting within `(now - graceMs,
 *  now + leadMinutes]`, excluding all-day events. Bounded by
 *  date_scheduled = today, so cost is O(today's calendar tasks).
 *
 *  #12 — `graceMs` keeps events that started up to that long ago in the
 *  window. A throttled/missed 30s tick can let an event cross from "within
 *  lead" to "already started" between fires; the grace lets the next tick
 *  still surface it (the notifier's per-event dedup prevents a repeat). With
 *  the default 0 the window is `(now, now + lead]` as before. */
export async function upcomingEvents(
  leadMinutes: number,
  graceMs = 0,
): Promise<UpcomingEvent[]> {
  if (!Number.isFinite(leadMinutes) || leadMinutes <= 0) return [];
  const db = await getDb();
  const rows: Row[] = await db.select(
    `SELECT external_id, title, external_start_local
       FROM tasks
       WHERE external_source = 'calendar'
         AND date_scheduled = $1
         AND external_id IS NOT NULL
         AND external_start_local IS NOT NULL
         AND external_dismissal_reason IS NULL`,
    [todayString()],
  );

  const now = Date.now();
  const leadMs = leadMinutes * 60 * 1000;
  const out: UpcomingEvent[] = [];
  for (const r of rows) {
    if (!r.external_start_local) continue;
    const startMs = localStartToMs(r.external_start_local);
    if (!Number.isFinite(startMs)) continue;
    if (startMs <= now - graceMs) continue; // started > grace ago → drop
    if (startMs - now > leadMs) continue;
    out.push({
      externalId: r.external_id,
      title: r.title,
      startLocal: r.external_start_local,
      startMs,
    });
  }
  return out;
}
