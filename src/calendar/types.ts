// TS mirror of Rust's `CalendarEvent` (src-tauri/src/calendar.rs).
// Field names are camelCase via `#[serde(rename_all = "camelCase")]`
// on the Rust struct, so this matches what `invoke()` returns.

export interface CalendarEvent {
  /** Per-instance identifier — distinct for each occurrence of a
   *  recurring event. Backed by EventKit's `eventIdentifier`. See
   *  `docs/m1-calendar-recurrence-verification.md`. */
  externalId: string;
  calendarId: string;
  calendarName: string;
  title: string;
  /** Local-tz `YYYY-MM-DDTHH:MM` from Rust's NSDateFormatter pass.
   *  Already wall-clock time — do NOT round-trip through `new Date()`,
   *  which infers UTC vs local inconsistently across engines (Verse Q3
   *  guard). Split on 'T' to get the date portion. */
  startLocal: string;
  endLocal: string | null;
  allDay: boolean;
  /** EventKit status: 'confirmed' | 'tentative' | 'cancelled' | 'none'. */
  status: string;
}

/** Why a calendar task was dismissed. Soft-delete via column on
 *  `tasks.external_dismissal_reason` (Verse pre-M2 ask).
 *  - `'user'`     — user explicitly deleted the imported task locally.
 *                   The sync loop must skip re-importing it (see
 *                   `getDismissedExternalIds`).
 *  - `'cancelled'` — reserved for M5: when the calendar reports an
 *                   event cancelled, we may opt to dismiss the
 *                   corresponding task. Not used in M2.
 *
 *  Defined as a literal-union type and re-exported as a const map so
 *  callers don't sprinkle raw strings (Verse non-blocking #3). */
export type DismissalReason = "user" | "cancelled";

export const DismissalReason = {
  User: "user" as const,
  Cancelled: "cancelled" as const,
} satisfies Record<string, DismissalReason>;
