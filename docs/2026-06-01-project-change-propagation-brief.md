# Project (a.k.a. "Objective") Change Propagation — Brief for Terse

**Date:** 2026-06-01
**From:** Audit + Verse
**To:** Terse
**Status:** BRIEF — not a plan. Terse plans against this, Verse approves the plan before any code.

## The bug (observed)

Editing a project on the **Objectives** page is not reflected in a task's **Objective**
dropdown until the overlay remounts. Repro: edit a project name/color on the Objectives
page → open a task → the dropdown still shows the old value.

## Critical framing — read before planning

**"Objective" is the UI label for a Project. There is no separate objective entity.**
- The "Objectives" nav item routes to `page: "projects"` (`Sidebar.tsx:102`) — the Objectives
  page *is* `src/pages/Projects.tsx`.
- The task "Objective" dropdown is a `<ProjectPicker value={projectId} projects={projects}>`
  (`TaskDetailOverlay.tsx:758`) — bound to `project_id`.
- The legacy `objectives` table and `tasks.objective_id` column are **dead** (a prior migration
  "remove objectives dependency"). Do **not** build anything around them.

So this is **not** an "objectives" problem and needs **no new entity, schema, or migration.**
It is the project-propagation drift we deferred as **#3** in the stability effort
(`docs/2026-06-01-stability-hardening-brief.md`, "Out of scope"). It has now surfaced, so we're
doing it — the **lightweight** version, not the full store rewrite.

## Root cause

There is no canonical project store and no project-changed broadcast. Each screen holds its own
`useState<Project[]>` loaded once on mount (the dropdown's list comes from
`TaskDetailOverlayHost.tsx:40`, loaded via `getProjects()` at `:63`). A project mutation writes
the DB but never tells the other copies, so they go stale until remount.

## Approach (approved scope: A, the lightweight broadcast)

Mirror the **task-event pattern the app already used and later retired** (e.g. the
`verseday:task-notes-changed` / `task-updated` window events; grep the codebase for the precedent
and follow its shape). Introduce a single `verseday:project-changed` event: project mutations emit
it after a successful DB write; every screen that holds a project copy re-fetches on it.

We are **not** doing the full `projectsById` canonical lift (option B) — that stays the logged M5
follow-up. Do not lift state into the store.

## Working rules (reminders)

- Plan first, present to Verse, wait for APPROVED before writing code.
- New branch off `main`, never `main` directly.
- Small modules; document decisions + a changelog in `/docs`.
- Self-validate per Nick's preference: `tsc` + `npm run build` + grep. **This is a propagation
  bug, so static validation rests on coverage proof** — your plan must grep-enumerate *every*
  project mutation site (proving each emits) and *every* project-copy holder (proving each
  subscribes). A missed site = a silently-still-stale screen. No manual UI test required, but call
  out anything you can't prove statically.
- Flag anything that costs money (there's nothing here — local only, no schema).

## Outcomes we want

1. **Propagation.** A project create / edit / archive / complete is reflected in every on-screen
   project list **immediately**, with no remount or app reload. Specifically: edit a project on
   the Objectives page → the task "Objective" dropdown shows the new name/color without reopening.
2. **Complete coverage.** Every screen that displays project data updates — not just the task
   dropdown. The known holders (verify and complete this list by grepping `getProjects(` /
   `useState<Project\[\]>`): `Dashboard`, `DailyPlanner`, `QuickAdd`, `WeeklyShutdown`,
   `DailyShutdown`, `PastShutdowns`, `SummaryOverlay`, `TaskDetailOverlayHost`, `Projects`,
   weekly-plan `ScheduleTab` / `PlanTab` / `PlanProjectPanel`, `CalendarMetaRail`. Treat the grep
   result as authoritative, not this list.
3. **Single chokepoint for emits.** Emit from one place that every mutation path flows through, so
   no future mutation can forget to fire it. Justify the location in your plan (it must not couple
   the DB layer to the DOM in a way that breaks the query layer's testability — your call where,
   with rationale).
4. **No regressions:** no feedback loop (a re-fetch triggered by the event must not re-emit it);
   listeners are cleaned up on unmount (match the app's existing add/removeEventListener
   discipline — the state audit confirmed all current listeners are balanced, keep it that way);
   no extra re-render storms (re-fetch on the event, not on a timer).

## Judgment call to make explicit in the plan

Some screens are **historical/point-in-time** (e.g. `PastShutdowns`, possibly `SummaryOverlay`).
Decide per screen whether it should reflect live project edits (name/color consistency) or
intentionally snapshot the project state as it was. Live-editing views re-fetch; if any view is a
deliberate snapshot, leave it and say so — don't blindly wire every consumer.

## Definition of done

- Outcome 1 holds (the reported bug is gone), and outcome 2 is proven by a grep showing every
  mutation site emits and every live project-copy holder subscribes.
- No new entity / schema / migration. No `projectsById` store lift.
- `/docs` changelog entry + a one-line note that the full canonical lift (option B) remains the
  deferred M5 follow-up.
- Final Verse review passes.
