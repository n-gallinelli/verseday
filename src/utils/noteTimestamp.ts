import { logicalDayIso, formatMonthDay } from "./dates";

/**
 * Format the label for an `@now` timestamp pill — time first, then the date
 * (e.g. "2:04 PM · Jun 24"). Captured once at insertion and frozen into the
 * pill's data-label (see src/components/editor/timePill.ts); `@today`/`@tomorrow`
 * pills use the date-only labeller in that file instead.
 *
 * The date part uses the app's LOGICAL day (3am cutoff via logicalDayIso) —
 * matching every other surface — and the shared formatMonthDay helper; a prior
 * calendar year appends the year ("9:30 AM · Jun 23, 2025"). The time is minute
 * granularity (no seconds): the pill is a point-in-time stamp, not a clock.
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
