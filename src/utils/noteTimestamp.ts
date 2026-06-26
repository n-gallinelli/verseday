import { logicalDayIso } from "./dates";

/**
 * Format the label for an `@now` timestamp pill — time first, then the weekday +
 * date (e.g. "2:04 PM · Wed, Jun 24"). Captured once at insertion and frozen into
 * the pill's data-label (see src/components/editor/timePill.ts); `@today`/
 * `@tomorrow`/`@yesterday` pills use the date-only labeller in that file instead.
 *
 * The date part uses the app's LOGICAL day (3am cutoff via logicalDayIso) —
 * matching every other surface — and includes the short weekday; a prior calendar
 * year appends the year ("9:30 AM · Mon, Jun 23, 2025"). The time is minute
 * granularity (no seconds): the pill is a point-in-time stamp, not a clock.
 */
export function formatNoteTimestamp(ms: number, now: Date = new Date()): string {
  const d = new Date(ms);
  const dayDate = new Date(logicalDayIso(d) + "T00:00:00");

  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const dateBase = dayDate.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const datePart =
    d.getFullYear() === now.getFullYear()
      ? dateBase
      : `${dateBase}, ${d.getFullYear()}`;

  return `${time} · ${datePart}`;
}
