// Calendar settings TS surface (M3).
//
// Typed getters/setters for the three calendar.* keys in the v12
// `settings` table:
//   - calendar.enabled       — '1' | '0' | absent (treat absent as '0')
//   - calendar.excluded      — JSON array of calendar IDs (CalDAV-style strings)
//   - calendar.last_synced_at — ISO8601 timestamp written by sync.ts step 7
//
// Per Verse review: stale IDs in `calendar.excluded` are NOT pruned
// on save. If a calendar disappears from the list for one mount
// (transient CalDAV hiccup), an intentional exclusion would otherwise
// be erased and the next sync would flood Daily Plan. Stale IDs are
// harmless — sync.ts's filter just doesn't match them.
//
// The reader function is also used by sync.ts (which previously
// inlined its own copy). Single source of truth lives here.

import { getSetting, setSetting } from "../db/queries";

const KEY_ENABLED = "calendar.enabled";
const KEY_EXCLUDED = "calendar.excluded";
const KEY_APPROACH_NOTIFY_ENABLED = "calendar.approach_notify_enabled";
const KEY_APPROACH_LEAD_MINUTES = "calendar.approach_lead_minutes";

export const APPROACH_LEAD_DEFAULT = 3;
export const APPROACH_LEAD_MIN = 1;
export const APPROACH_LEAD_MAX = 15;

export async function getEnabled(): Promise<boolean> {
  return (await getSetting(KEY_ENABLED)) === "1";
}

export async function setEnabled(enabled: boolean): Promise<void> {
  // Explicit '0' rather than DELETE so the row exists for analytics /
  // future debugging.
  await setSetting(KEY_ENABLED, enabled ? "1" : "0");
}

export async function getExcludedCalendarIds(): Promise<Set<string>> {
  const raw = await getSetting(KEY_EXCLUDED);
  if (!raw) return new Set();
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

export async function setExcludedCalendarIds(ids: Iterable<string>): Promise<void> {
  // Sort for deterministic on-disk shape (debugging / diffability).
  const arr = [...new Set(ids)].sort();
  await setSetting(KEY_EXCLUDED, JSON.stringify(arr));
}

// ── Meeting approach notifier (M5) ─────────────────────────────────────

export async function getApproachNotifyEnabled(): Promise<boolean> {
  return (await getSetting(KEY_APPROACH_NOTIFY_ENABLED)) === "1";
}

export async function setApproachNotifyEnabled(enabled: boolean): Promise<void> {
  await setSetting(KEY_APPROACH_NOTIFY_ENABLED, enabled ? "1" : "0");
}

export async function getApproachLeadMinutes(): Promise<number> {
  const raw = await getSetting(KEY_APPROACH_LEAD_MINUTES);
  if (!raw) return APPROACH_LEAD_DEFAULT;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return APPROACH_LEAD_DEFAULT;
  return Math.min(APPROACH_LEAD_MAX, Math.max(APPROACH_LEAD_MIN, n));
}

export async function setApproachLeadMinutes(minutes: number): Promise<void> {
  const clamped = Math.min(
    APPROACH_LEAD_MAX,
    Math.max(APPROACH_LEAD_MIN, Math.round(minutes)),
  );
  await setSetting(KEY_APPROACH_LEAD_MINUTES, String(clamped));
}
