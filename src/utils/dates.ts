/**
 * Local-timezone date helpers.
 *
 * Background: prior to commit 450d761 + this sweep, multiple call sites
 * across the app used `new Date().toISOString().split("T")[0]` — UTC
 * formatting — to produce strings used as the user's "today" or "Monday
 * of this week." That silently shifts dates by ±1 in evening-west /
 * morning-east timezones and produced a label-vs-state mismatch in the
 * Weekly Plan day strip. Centralizing here so the next sweep is a
 * single-file fix.
 */

/** Format a Date as YYYY-MM-DD in the user's local timezone. */
export function localDateIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Today, as a local-tz YYYY-MM-DD. */
export function todayString(): string {
  return localDateIso(new Date());
}

/**
 * Monday of the local week containing `date` (default: now), as
 * YYYY-MM-DD. Sunday counts as the previous week's Monday — matches
 * the convention `selectedWeek` has always followed.
 */
export function mondayOfWeek(date: Date = new Date()): string {
  const d = new Date(date);
  const day = d.getDay(); // local
  const diff = day === 0 ? -6 : 1 - day; // Monday = 1
  d.setDate(d.getDate() + diff);
  return localDateIso(d);
}

/**
 * Five Mon..Fri ISO strings (local) starting from a Monday-ISO.
 * Parses with `T00:00:00` so DST transitions don't shift the boundary.
 */
export function weekdayDates(mondayIso: string): string[] {
  const out: string[] = [];
  const d = new Date(mondayIso + "T00:00:00");
  for (let i = 0; i < 5; i++) {
    const dd = new Date(d);
    dd.setDate(d.getDate() + i);
    out.push(localDateIso(dd));
  }
  return out;
}
