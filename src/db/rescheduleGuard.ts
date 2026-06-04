// Reschedule guard, split out of queries.ts (no Tauri/runtime imports) so the
// integrity test can pin it without a live DB — same pattern as rolloverSql.ts.
//
// Calendar-imported tasks are date-specific snapshots of the user's external
// calendar; their date is owned by the calendar, not the user. Re-dating one
// (manual "move to tomorrow" at shutdown, or a drag to another day) would
// mis-attribute a meeting and be silently overwritten on the next sync. The
// automatic rollover already refuses them at the SQL layer (rolloverSql.ts:
// `external_source IS NULL`); this guards the manual chokepoint symmetrically.

export class CalendarRescheduleError extends Error {
  constructor() {
    super("Calendar-imported tasks follow your calendar and can't be rescheduled.");
    this.name = "CalendarRescheduleError";
  }
}

/** Throw if a task may not be manually re-dated. Currently: calendar imports. */
export function assertReschedulable(externalSource: string | null | undefined): void {
  if (externalSource === "calendar") {
    throw new CalendarRescheduleError();
  }
}
