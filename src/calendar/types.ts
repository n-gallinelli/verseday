// TS mirror of Rust's `CalendarEvent` (src-tauri/src/calendar.rs).
// Field names are camelCase via `#[serde(rename_all = "camelCase")]`
// on the Rust struct, so this matches what `invoke()` returns.

export interface Attendee {
  name: string | null;
  email: string | null;
  /** EKParticipantStatus: 'accepted' | 'declined' | 'tentative' | 'pending' | 'unknown'. */
  status: string;
}

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
  /** Optional metadata surfaced in TaskDetailOverlay's right rail. All
   *  Option<…> on the Rust side; null/[] from JS. */
  notes: string | null;
  location: string | null;
  url: string | null;
  attendees: Attendee[];
  organizerEmail: string | null;
  /** The current user's relationship to this event (computed in Rust
   *  from `EKParticipant.isCurrentUser`):
   *  'accepted' | 'declined' | 'tentative' | 'pending' — your RSVP as
   *  an invitee; 'organizer' — your own event; 'none' — no current-user
   *  participant (solo block / unidentifiable); 'unknown' — matched but
   *  unmapped status. Drives the accepted-only import filter in sync.ts. */
  selfStatus: string;
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
