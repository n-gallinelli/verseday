import { logicalDayIso, formatMonthDay } from "./dates";

/**
 * Format a note bullet's creation time for the unobtrusive right gutter.
 *
 * "Same day" is the app's LOGICAL day (3am cutoff via logicalDayIso) — matching
 * every other surface — NOT raw midnight. Same logical day shows the clock time
 * ("2:04 PM"); an earlier day shows a short date ("Jun 23") via the shared
 * formatMonthDay; a prior calendar year appends the year ("Jun 23, 2025").
 *
 * Minute granularity (no seconds) is deliberate: a burst of bullets typed in the
 * same minute renders the identical string, which the decoration layer then
 * collapses to a single visible stamp.
 */
export function formatNoteTimestamp(ms: number, now: Date = new Date()): string {
  const d = new Date(ms);
  const day = logicalDayIso(d);
  const today = logicalDayIso(now);

  if (day === today) {
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }

  const label = formatMonthDay(day);
  return d.getFullYear() === now.getFullYear() ? label : `${label}, ${d.getFullYear()}`;
}
