# Calendar UPSERT contract

When `syncCalendarEventsForDate` re-runs against a date whose events
have already been imported, `upsertCalendarTask` (`src/db/queries.ts`)
hits the `ON CONFLICT(external_source, external_id) DO UPDATE` branch.
That branch is deliberately narrow.

This document is the source of truth for which columns the calendar
owns vs. which the user owns. Verse review on PR #12 caught the
title-clobber failure mode that drove the split. Future changes to the
DO UPDATE clause should be checked against this contract.

## Refresh on every sync (calendar-authoritative)

These fields describe the **event** as it currently stands. The
calendar source is the source of truth; if it changes, the local copy
should follow:

- `external_notes` — event description / body
- `external_location` — location string (often a Zoom/Meet URL)
- `external_url` — EKEvent's URL field
- `external_attendees` — JSON array of `{name, email, status}`
- `external_organizer_email`
- `external_calendar_name` — which calendar the event lives on
- `external_start_local` / `external_end_local` — local-tz time range

## Refreshed despite being shared with the user — `date_scheduled`

`date_scheduled` is the deliberate exception. If the calendar moves an
event to a different day, the task should move with it — that's the
point of calendar sync. Renaming a task is a different gesture than
moving its date; treating them differently respects user intent in
both cases.

## Preserve on conflict — user-authored intent

These columns can be edited by the user after import. A re-sync must
**not** overwrite them, even if the upstream event also changed. They
are NOT in the DO UPDATE clause; SQLite leaves them at the existing
row's value:

- `title` — user may rename "Lunch w/ Cam" to "1:1 prep — talk
  roadmap". A title change on the host's side should NOT clobber the
  rename. (Failure mode that drove this rule, Verse PR #12.)
- `estimated_minutes` — user may set a 30-min estimate even though the
  meeting is 60 min (only need 30 min of prep). Calendar duration is
  reflected in `external_start_local` / `external_end_local`; the
  estimate column is the user's planning input, not the event's
  duration.
- `notes` — the user's **own** task notes, distinct from the event's
  description (`external_notes`). The notes column on the left of
  TaskDetailOverlay maps to this.
- `status`, `is_highlight`, `sort_order`, `priority`, `project_id`,
  `objective_id` — pure in-app state. Calendar has no opinion on
  these.

## What this means in practice

- Renaming a calendar task is **safe and durable**. The task stays
  linked to its calendar event (`external_id` unchanged) and the new
  title survives every future sync.
- Editing the estimate after import is safe.
- Adding the user's own notes alongside the imported event description
  is safe — both are stored on the same row but in different columns.
- Moving the event in your calendar will move the task's
  `date_scheduled` on next sync.
- Updating the event's body / attendees / location in your calendar
  will refresh the right-rail panel on next sync.

## What does NOT trigger a write

- Soft-deleted (`external_dismissal_reason IS NOT NULL`) rows are
  filtered out upstream by `getDismissedExternalIds(date)` before
  `upsertCalendarTask` is even called. Dismissed events stay
  dismissed; the dismissal is not cleared by re-sync.
- Events on excluded calendars (`getExcludedCalendarIds()`) and
  cancelled events (`status === 'cancelled'`) are filtered upstream
  too.

## Migration notes

The columns themselves were added in migration v21 (frozen — see
`/docs/migration-discipline.md`). Schema changes go in v22+.
