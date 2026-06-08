# Calendar import — accepted-only filter

**Date:** 2026-06-08
**Branch:** `fix/calendar-import-accepted-only`
**Author:** Terse
**Status:** Implemented — pending Verse review

## Problem

The calendar→tasks sync imported every (non-excluded, non-cancelled)
event for a date, regardless of whether the user had accepted the
invite. Events the user hadn't responded to — or had declined — still
showed up as tasks. Requirement: **only events the user has actually
accepted should be imported.**

## Key insight: event status ≠ RSVP

`CalendarEvent.status` (`confirmed`/`tentative`/`cancelled`) is the
*event's* status, not the user's RSVP. The user's response lives on the
per-attendee `EKParticipantStatus`. To know *my* response we must
identify which participant is me — EventKit exposes this directly via
`EKParticipant.isCurrentUser` (no email-matching heuristic needed).

## Design

### Rust (`src-tauri/src/calendar.rs`)

- New field `CalendarEvent.self_status: String` — the current user's
  relationship to the event, resolved by `self_participation_status()`:
  - **`"organizer"`** — `event.organizer().isCurrentUser()`. Your own
    event; nothing to accept.
  - **`"accepted" | "declined" | "tentative" | "pending"`** — the
    `isCurrentUser` attendee's `participantStatus`.
  - **`"unknown"`** — current-user attendee matched but the status enum
    was unrecognized.
  - **`"none"`** — no current-user participant found. A solo personal
    block (no attendees), or an event EventKit couldn't attribute to us.
- Precedence: organizer wins, then attendee RSVP, then `none`.
- Extracted `participant_status_str()` so the attendee mapping and the
  self-status mapping share one source of truth.

### TS (`src/calendar/types.ts`, `src/calendar/sync.ts`)

- Mirrored `selfStatus: string` onto the `CalendarEvent` interface.
- Step 4 of the sync algorithm now also drops events whose `selfStatus`
  is in `NON_ACCEPTED_SELF_STATUSES = {declined, tentative, pending}`.

## Import policy (the decision)

| `selfStatus` | Import? | Rationale |
|---|---|---|
| `accepted`  | ✅ | The explicit ask. |
| `organizer` | ✅ | Your own event; no RSVP exists to make. |
| `none`      | ✅ | Solo personal blocks; or unattributable — fail open, don't silently hide. |
| `unknown`   | ✅ | Matched-but-unmapped; fail open rather than drop on an enum we didn't recognize. |
| `tentative` | ❌ | "Maybe" is not "accepted" — the user asked for accepted only. |
| `pending`   | ❌ | No response yet. |
| `declined`  | ❌ | Explicitly not attending. |

**Fail-open choice:** when we cannot positively identify the user's
non-acceptance (`none`/`unknown`), we import. This protects personal
time-blocks (no attendees) and events EventKit can't attribute, at the
cost of occasionally importing an ambiguous event. The alternative
(fail-closed) would silently drop legitimate solo blocks — a worse
failure for a planning app.

## Scope / known limitation

INSERT-only sync is unchanged: this filters **future** imports. Events
imported *before* this change while pending/declined remain as tasks
until dismissed. Retroactively removing already-imported non-accepted
tasks is deliberately out of scope (destructive; would fight a user who
intentionally kept one). Flag for Verse if retroactive cleanup is wanted.

## Validation

- `cargo` (dev profile): compiles clean (macOS).
- `tsc --noEmit`: clean.
- No DB schema change (DDL); `self_status` is a transient sync-time
  field, never persisted as its own column.
- No new dependencies, no network, no cost.
