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
 * The "logical day" (local-tz YYYY-MM-DD) for a wall-clock instant, where the
 * day boundary is `cutoffHour` (default 3am) rather than midnight. Times
 * between midnight and the cutoff map to the previous calendar day — so a
 * late-night shutdown reopened before 3am still reads as the same day, while
 * reopening after 3am reads as the next day. Built on `localDateIso` so it
 * stays in local tz (never UTC).
 */
export function logicalDayIso(d: Date = new Date(), cutoffHour = 3): string {
  const shifted = new Date(d);
  shifted.setHours(shifted.getHours() - cutoffHour);
  return localDateIso(shifted);
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
 * The UTC instant (ISO 8601, ...Z) at the START of the given LOCAL calendar
 * day. Use to compare a UTC `completed_at`/timestamp against a local-day
 * boundary: `new Date("YYYY-MM-DDT00:00:00")` (no Z) parses in local tz, so
 * `.toISOString()` yields that local midnight expressed as a UTC instant.
 */
export function localDayStartUtc(dateIso: string): string {
  return new Date(`${dateIso}T00:00:00`).toISOString();
}

/** The UTC instant (ISO 8601, ...Z) at the END of the given LOCAL calendar day. */
export function localDayEndUtc(dateIso: string): string {
  return new Date(`${dateIso}T23:59:59.999`).toISOString();
}

/**
 * Render a YYYY-MM-DD ISO string as a short "Jun 21" label. Parses with
 * `T00:00:00` so the displayed day matches the local calendar day (no UTC
 * off-by-one). Returns "" for empty/falsy input.
 */
export function formatMonthDay(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** Shift a YYYY-MM-DD ISO string by N days, staying in local tz. */
export function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return localDateIso(d);
}

/** Shift a YYYY-MM-DD ISO string by N months, staying in local tz. */
export function addMonthsIso(iso: string, months: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setMonth(d.getMonth() + months);
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

/**
 * Decide what a date/week selection should become when the logical day
 * rolls over while the app was left open across the boundary. Pure so it's
 * unit-testable (wall-clock-on-reopen behavior is painful to exercise
 * end-to-end).
 *
 *  - `prevSnapshot` — what "today" / "this week" was just BEFORE the roll.
 *  - `current`      — the user's current selection.
 *  - `nowValue`     — the new "today" / "this week".
 *
 * Returns the value to select, or `null` to leave the selection alone.
 * Advances ONLY when the user was sitting on the old "today"/"this week"
 * (`current === prevSnapshot`); a deliberately-navigated past/future
 * selection is preserved. Returns null when nothing actually changed.
 */
export function nextSelected(
  prevSnapshot: string,
  current: string,
  nowValue: string,
): string | null {
  if (current !== prevSnapshot) return null; // deliberate navigation — keep it
  if (nowValue === current) return null; // no real change
  return nowValue; // was on the old "today" — advance
}
