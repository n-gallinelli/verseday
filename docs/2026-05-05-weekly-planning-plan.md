# Weekly Planning — Implementation Plan (for Verse review)

**Date:** 2026-05-05
**Author:** Terse
**Revision:** v2 — addresses Verse review B1/B2/B3 + A1/A2/A3/A5
**Branch (proposed):** `feat/weekly-planning` (off `main`, after the procedure in [Branch hygiene](#branch-hygiene))
**Spec:** "VerseDay — Weekly Planning Feature Handoff (v3)" (user message, 2026-05-05)

---

## Goal

Add a **Plan** tab to the existing Weekly Plan screen (current view becomes the **Schedule** tab). The Plan tab is a Friday-anchored ritual: the user steps through each active project and commits a minimum amount of time per day (Mon–Fri), optionally listing tasks for that project at the week level.

**Not** a calendar. **Not** time-blocking. **Not** form-filling.

---

## Confirmed scope (after Q&A with user)

- Tasks added in the Plan tab → real `Task` rows (`project_id` set, `date_scheduled = null`). They flow into the rest of the app.
- **No "Done planning" terminal state.** The plan stays editable all week. When every project has been reviewed, the right panel shows a week summary, but it's a natural endpoint, not a locked state.
- Friday "Let's plan" advances `selectedWeek` to next Monday and switches to the Plan tab.
- Strictly Mon–Fri. No weekends anywhere in the UI.
- Desktop only.
- Previous week's plan is not copied forward; each week starts fresh.

---

## Data model

### Migration v17 (additive only)

```sql
-- per (week, project, day) minimum-time commitment
CREATE TABLE IF NOT EXISTS weekly_plan_commitments (
  week_start_date TEXT NOT NULL,
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  day_offset      INTEGER NOT NULL CHECK (day_offset BETWEEN 0 AND 4),  -- 0=Mon … 4=Fri
  minutes         INTEGER NOT NULL CHECK (minutes >= 0),
  PRIMARY KEY (week_start_date, project_id, day_offset)
);

-- per (week, project) review state: 'planned' or 'skipped'
CREATE TABLE IF NOT EXISTS weekly_plan_project_status (
  week_start_date TEXT NOT NULL,
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status          TEXT NOT NULL CHECK (status IN ('planned', 'skipped')),
  reviewed_at     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (week_start_date, project_id)
);
```

**Default state for any (week, project) with no row in `weekly_plan_project_status` = `unplanned`.**

No `plan_completed_at` column. No read-only mode. (Removed per user direction.)

**CHECK constraints** (Verse A1 / A3): `day_offset` clamped to 0–4 to enforce the Mon–Fri invariant at the DB layer; `status` clamped to `'planned' | 'skipped'`; `minutes` non-negative. Cheap insurance — the v14/v15 migration history (lib.rs:244-254) shows this codebase has been burned by lax invariants before.

**Timestamp dialect** (Verse A2): `datetime('now')` matches every other `created_at` default in `lib.rs` (verified at lines 18, 29, 44, 67, 75, 91, 134). No new dialect introduced.

### Tasks

Plan-tab tasks are normal `Task` rows:
- `project_id` = the project being planned
- `date_scheduled` = `null` (week-level intent — user can later schedule from Schedule view)
- `status` = `'todo'`
- everything else default

They are not visually distinguished from any other task in the rest of the app.

#### Side effect to surface (Verse B3)

`date_scheduled = null` rows are already returned by:

- `getUnscheduledTasks(projectId?)` — `queries.ts:646`
- The unscheduled rail in `WeeklyPlanner` Schedule view — `queries.ts:1040` group
- Project detail's unscheduled list — `queries.ts:771`

Implication: the moment the user types a task into the Plan panel, it appears in the project's unscheduled list and any global inbox surface that consumes those queries. This is consistent with the user's confirmed intent ("flow into the rest of the app"), but it's a behavior change worth surfacing explicitly.

**Action**: I'll re-confirm with the user before starting M4 (the milestone where the task list goes live). If they want any visual flag on Plan-originated tasks (e.g. a "weekly intent" pill in unscheduled lists), that's a small addendum we'd add to M4 scope.

---

## Component tree

`src/pages/WeeklyPlanner.tsx` is currently 1,078 lines. It becomes a thin **host** that owns only the tab toggle and the Friday banner. The existing Schedule code is **extracted** into its own file (zero behavior change refactor) before any Plan code is written — see M2a below. After the split:

```
src/pages/WeeklyPlanner.tsx                    host (~150 lines target): tab toggle + Friday banner
src/pages/weekly-plan/
  ScheduleTab.tsx                              extracted Schedule view (Verse B2 — pure refactor)
  PlanTab.tsx                                  orchestrator
  PlanProjectRail.tsx                          left ~240px column — project cards w/ status
  PlanProjectPanel.tsx                         right column shell — header + content
  PlanDayStrip.tsx                             Mon–Fri buttons + min-time inputs
  PlanTaskList.tsx                             week-level task list
  PlanWeekSummary.tsx                          read-only summary when no unplanned projects remain
  PlanFridayBanner.tsx                         Friday prompt
  usePlanData.ts                               data-loading hook
```

Per CLAUDE.md "build in small modules" — no file >300 lines target.

---

## Behavior

### Tabs

- Two tabs at the top of `WeeklyPlanner`: **Schedule** (default) | **Plan**.
- Visual treatment: minimal segmented toggle, not a heavy nav bar.
- Switching is instant from the user's POV but renders with a 200ms crossfade so it feels like a mode change.
- Tab choice is **session-local** (component state). Not persisted. Each time the user opens the screen they start on Schedule unless the Friday banner steers them.

### Friday banner

- Shown at the top of `WeeklyPlanner` only when:
  - Local day-of-week is Friday
  - `selectedWeek === thisWeek`
  - User has not dismissed it for this Friday
- Slim banner (not modal): "Ready to plan next week?" + "Let's plan" CTA + "Not now" link.
- Accept → `setSelectedWeek(nextMonday)` + activate Plan tab.
- Dismiss → write `localStorage["verseday_plan_friday_dismissed_<friday-iso>"] = "1"`. Auto-resets next Friday because the key is dated.

### Plan tab — entry behavior

1. Load active projects (filter: `!archived && !completed`).
2. Load `weekly_plan_commitments` and `weekly_plan_project_status` for `selectedWeek`.
3. Auto-select first **unplanned** project. If none, show the week summary.

### Project rail (left, ~240px fixed)

For each active project, a card showing:
- Project color dot
- Project name
- **Status indicator**:
  - `unplanned` (default) — neutral, no badge
  - `planned` — small green checkmark
  - `skipped` — italic / dimmed, "Skipped" label
- Click → open in right panel (regardless of status — fully editable revisits).

Below the list: nothing. The rail is a map, not a workspace.

### Project panel (right, fills remaining)

Three stacked sections inside one panel — no nested overlays:

1. **Header** — project color + name, large.
2. **Task list** — `PlanTaskList`. Lightweight line-by-line input. Each line on Enter creates a new `Task` row (project_id set, date_scheduled null). Existing lines are editable / deletable. Optional — empty is valid.
3. **Day strip** — `PlanDayStrip`. Five day buttons.

At the bottom: two actions.
- Primary: **Done with this project** — requires ≥1 day activated OR shows a hint to skip. Sets `weekly_plan_project_status = 'planned'`. Auto-advances to next unplanned project.
- Secondary text link: **Skip this week** — sets `weekly_plan_project_status = 'skipped'`. Auto-advances.

### Day strip

Each of Mon–Fri rendered as a button showing day name + date ("Tue · May 13"):
- **Inactive (default)**: neutral chip, no minutes shown.
- **Click inactive** → activates with default `0:30`. Minutes input (`H:MM`) appears below the button. Project color tints the active button.
- **Active button click again** → if minutes were set, show inline confirm "Clear?" before deactivating; otherwise deactivate immediately.
- **Minutes input**: stepper (▲/▼ in 5-min steps) + direct type. Format `H:MM`. Label includes a clock icon and the word "min" (or "minimum") to distinguish from "duration" or "start time."
- **Keyboard**: bare `1`–`5` toggle Mon–Fri when a project panel is focused. (App.tsx uses Cmd+1..6 for page nav and bare T/W/O/D/S/F — bare digits are free; verified.)

Persistence: each change writes immediately to `weekly_plan_commitments` (no Save button).

### Week summary

Shown in the right panel when **every active project has a status** (planned or skipped) and no unplanned remain.

Read-only overview:
- Five day columns (Mon–Fri) stacked vertically OR five rows — designer's call during the polish milestone.
- Each day lists the projects committed and their minutes.
- A subtle "All projects reviewed for this week" header, plus a button to revisit any project (clicking a project row opens it in the panel for further edits).

The summary is an *informational* state, not a terminal one. Editing remains available throughout.

---

## Visual / motion

- Plan tab background: a subtle warm wash (low-opacity `--focus-ambient-warm` or new token `--plan-ambient-warm`).
- Tab transition: 200ms crossfade.
- "Ceremonial without being dramatic." More breathing room than Schedule. No timers, counters, or metrics in the Plan tab chrome.

I'll run the `ui-styling` / `polish` skills during the polish milestone — not at every step.

---

## Milestones (each ends with "Ready for Verse review")

### M1 — Schema + queries layer

- Migration v17 added to `src-tauri/src/lib.rs` (with CHECK constraints per A1/A3).
- Query functions in `src/db/queries.ts`:
  - `getWeeklyPlanCommitments(weekStartDate) → Map<projectId, Map<dayOffset, minutes>>`
  - `setWeeklyPlanCommitment(weekStartDate, projectId, dayOffset, minutes)`
  - `clearWeeklyPlanCommitment(weekStartDate, projectId, dayOffset)`
  - `getWeeklyPlanProjectStatuses(weekStartDate) → Map<projectId, 'planned' | 'skipped'>`
  - `setWeeklyPlanProjectStatus(weekStartDate, projectId, status)`
- No UI yet.
- **Verification (Verse A5)**:
  - Apply against a fresh DB (deleted `verseday.db`) — migration runs cleanly from v1→v17.
  - Apply against the developer's existing populated DB at v16 — migration adds only the two new tables, no data loss, no constraint violations on existing rows.
  - Smoke-call each query function from a temporary test harness or the dev console; verify CHECK constraints reject `day_offset = 5`, `status = 'foo'`, `minutes = -1`.

### M2a — Refactor: extract `ScheduleTab` (Verse B2)

**Pure refactor, zero behavior change.** Splitting this from M2b gives a clean Verse-review break between the move and the new behavior.

- Create `src/pages/weekly-plan/ScheduleTab.tsx`.
- Move all current `WeeklyPlanner` body (header utility row + DnD context + left rail + calendar) into `ScheduleTab`. Keep prop-less; it reads from `useAppStore` and queries directly, same as today.
- `WeeklyPlanner.tsx` becomes a passthrough that renders `<ScheduleTab />`.
- Verification: full Schedule view behaves identically to pre-refactor. Drag-drop, undo banner, day modal, weekly notes, carry-forward, objectives collapse — all still work.

### M2b — Tab toggle + Friday banner + Plan skeleton

- Add segmented tab control to `WeeklyPlanner.tsx` (host now ~150 lines).
- Conditional render: `<ScheduleTab />` (default) or `<PlanTab />`.
- Add `PlanFridayBanner` with day-of-week check + dismissal key.
- `PlanTab` renders empty `PlanProjectRail` and `PlanProjectPanel` shells.
- 200ms crossfade between tabs.

### M3 — Project rail + activation flow

- `PlanProjectRail` lists active projects with status badges driven by `weekly_plan_project_status`.
- `PlanProjectPanel` renders header + Done/Skip footer.
- "Done with this project" / "Skip this week" persist via queries; auto-advance to next unplanned.
- Empty-state message when no active projects exist.

### M4 — Day strip + min-time + task list

**Pre-M4 gate (Verse B3)**: re-confirm with user that Plan-tab tasks appearing in unscheduled / inbox surfaces is the desired behavior, or whether a "weekly intent" pill is wanted. No code in M4 starts until that confirmation lands.

- `PlanDayStrip` with click-to-activate, default 0:30, stepper input, deactivate confirm.
- `PlanTaskList` with line-by-line `Task` row creation/edit/delete.
- Bare 1–5 keyboard shortcuts.
- All edits write through immediately.

### M5 — Week summary

- `PlanWeekSummary` shown when no unplanned projects remain.
- Read-only day-by-day rollup with project commitments.
- Click a project row → re-opens it in the panel for editing.

### M6 — Polish

- Warm ambient tone, transitions tuned, micro-interactions.
- Run `polish` + `audit` skills.
- Edge cases: returning mid-week (data loads intact), no active projects, single project, all-skipped.
- Final verification in `npm run tauri dev`.

---

## Risks & open questions

- **Active project list parity with Schedule**: I'll reuse `!archived && !completed`. If Verse spots a divergence (e.g. Schedule also shows projects with tasks this week even if archived), we should align.
- **Min-time UX**: stepper vs. inline editable text. Going with both (stepper buttons + click-to-type). Open to redirection.
- **Auto-advance on Done/Skip**: helpful momentum or jarring? I'll add it and we can dial back if it feels pushy in M3 review.
- **Tab state persistence**: not persisted between visits. If users keep ending up on the wrong tab, we add a localStorage flag.

---

## Out of scope

- Mobile / responsive
- Copying last week's plan forward
- History view of past plans
- Mood, reflection, or shutdown integration
- Time-blocking, calendar grid in Plan tab
- Read-only "done planning" lock (removed per user)

---

## Branch hygiene

**Current state** (from `git status` at planning time):

- On branch `feat/focus-collapsed-sidebar`.
- **Modified, focus-sidebar work** (this branch): `src/App.tsx`, `src/components/Sidebar.tsx`, `src/pages/FocusMode.tsx`.
- **New, focus-sidebar work** (this branch): `docs/2026-05-05-focus-collapsed-sidebar.md`.
- **Modified, pre-existing & unrelated** (carried in working tree from before the focus-sidebar work): `src/components/MoodSelector.tsx`, `src/pages/DailyShutdown.tsx`, `src/pages/Projects.tsx`.
- Critically: `src/pages/WeeklyPlanner.tsx` is also modified (verified by Verse) — and Weekly Planning will edit that exact file. A naive `git checkout -b feat/weekly-planning main` from here would either drag the focus-sidebar dirty tree onto the new branch (mixing two unrelated workstreams in one diff) or lose it.

### Required procedure before M1 starts

The user must choose how to handle each of the two clusters of working-tree changes. I will not execute this procedure without explicit direction; it's the first thing I'll confirm when M1 kicks off.

1. **Focus-sidebar cluster** (`App.tsx`, `Sidebar.tsx`, `FocusMode.tsx`, `docs/2026-05-05-focus-collapsed-sidebar.md`) — three options:
   - **Commit on `feat/focus-collapsed-sidebar`** (recommended — the work is reviewable as-is).
   - **`git stash push -m "focus-sidebar wip"`** — defer commit decision; restore later with `git stash pop` after switching back.
   - User explicitly directs another path.
2. **Pre-existing unrelated cluster** (`MoodSelector.tsx`, `DailyShutdown.tsx`, `Projects.tsx`) — same three options, treated independently. These predate the focus-sidebar work and likely belong to whatever workstream `feat/shutdown-mood-column` was originally about.
3. Once both clusters are resolved and `git status` is clean: `git checkout main && git checkout -b feat/weekly-planning`.
4. **Do not carry `docs/2026-05-05-focus-collapsed-sidebar.md` into `feat/weekly-planning`** — it belongs to the focus-sidebar branch (and will be present there once cluster 1 is committed). Verify via `git log --name-only main..HEAD` after branching that the new branch only contains weekly-planning work.

Verification step at branch creation: `git status` shows clean tree on `main` immediately before the branch command runs.
