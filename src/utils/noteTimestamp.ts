import { logicalDayIso, formatMonthDay } from "./dates";

/**
 * Format a note bullet's creation time for the unobtrusive right gutter —
 * time first, then the date (e.g. "2:04 PM · Jun 24").
 *
 * The date part uses the app's LOGICAL day (3am cutoff via logicalDayIso) —
 * matching every other surface — and the shared formatMonthDay helper; a prior
 * calendar year appends the year ("9:30 AM · Jun 23, 2025"). The time is minute
 * granularity (no seconds) on purpose: a burst of bullets typed in the same
 * minute renders the identical string, which the decoration layer collapses to
 * a single visible stamp.
 */
export function formatNoteTimestamp(ms: number, now: Date = new Date()): string {
  const d = new Date(ms);
  const day = logicalDayIso(d);

  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const datePart =
    d.getFullYear() === now.getFullYear()
      ? formatMonthDay(day)
      : `${formatMonthDay(day)}, ${d.getFullYear()}`;

  return `${time} · ${datePart}`;
}
