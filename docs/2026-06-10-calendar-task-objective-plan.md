# Assign objectives to calendar-imported tasks — plan

**Date:** 2026-06-10
**Author:** Terse
**Status:** PLAN — awaiting Verse review (no code written)

## Want
Be able to assign an Objective (project) to a calendar-imported task, same
as a normal task.

## Why it's not possible today (the blocker)
It's purely a UI gap — NOT a data problem:
- TaskDetailOverlay branches on `task.external_source === "calendar"`
  (TaskDetailOverlay.tsx:815): calendar tasks render the read-only
  `CalendarMetaRail` (event time / attendees / location / description)
  INSTEAD of the in-app property rail — and the Objective picker lives only
  in that in-app rail (the `else` branch). So a calendar task has no
  objective control at all.
- Persistence is already fine: `upsertCalendarTask` preserves `project_id`
  across re-sync (the upsert contract only refreshes external_* fields +
  date_scheduled; see docs/2026-05-06-calendar-upsert-contract.md). So once
  the UI lets the user set it, a re-sync won't wipe it.

## Proposed change
Surface the Objective picker on the calendar-task panel:
- Add an **Objective** row to `CalendarMetaRail` (or render it above the
  rail in the calendar branch), reusing the existing `ProjectPicker` +
  `activeObjectiveOptions(projects, projectId)` + the same
  `setProjectId(val) → debouncedSave({ projectId: val })` wiring the in-app
  branch uses. No new persistence path — it writes `project_id` like any
  task.
- Keep the rest of CalendarMetaRail read-only (event metadata is still not
  user-editable). The Objective is the one in-app property that DOES apply
  to a calendar task, so it's the only one to add (not the full property
  rail).
- Verse design call: placement — a dedicated "Objective" section at the top
  of the rail (matches the in-app rail's order) vs. tucked under the event
  meta. Recommend top, mirroring the in-app rail so the two overlays feel
  consistent.

## Scope / risk
- UI-only; reuses canonical ProjectPicker + the existing projectId save
  path. No DDL, no sync-contract change (project_id already preserved).
- Confirm the calendar task appears under the objective everywhere a
  project's tasks are listed (it should — those queries filter by
  project_id, not by external_source; quick check during impl).
- The "Open ↗" objective shortcut + full-name tooltip we added to the
  in-app picker come along for free if we reuse ProjectPicker / the row.

## Validation
tsc + build; eyes-on: open a calendar task → assign an objective → re-sync
the calendar → objective persists; the task shows under that objective.

## Sequencing
Per Nick: this first, then revisit the deferred notification-click feature
(native Rust path — see docs/... onAction-is-mobile-only finding).
