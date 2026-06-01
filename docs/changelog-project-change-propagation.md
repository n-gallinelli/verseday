# Changelog — Project-change propagation (lightweight `verseday:project-changed`)

**Branch:** `fix/project-change-propagation` (off `main`)
**Against:** `docs/2026-06-01-project-change-propagation-brief.md` (deferred #3, lightweight option A).

## Problem
No canonical project store and no project-changed broadcast: each screen held
its own `useState<Project[]>` loaded once, so a project edit (name/color/archive/
complete) left every other on-screen copy stale until remount. Reported repro:
edit a project on the Objectives page → a task's "Objective" dropdown still
showed the old value.

## Fix
- **`src/utils/projectEvents.ts` (new):** `PROJECT_CHANGED_EVENT`,
  `emitProjectChanged()` (window-guarded), `onProjectChanged(handler) →
  unsubscribe`. Payload-less; holders re-run their own `getProjects()`.
- **Emit — single chokepoint in the query layer.** All 6 project mutations in
  `queries.ts` (`createProject`, `updateProject`, `completeProject`,
  `archiveProject`, `deleteProject`, `updateProjectSortOrders`) call
  `emitProjectChanged()` after their DB write. Mirrors the existing
  `setTaskStatusFromUI` precedent; the `typeof window` guard keeps the query
  layer node-testable. Any UI caller is covered automatically — can't forget.
- **Subscribe — 10 live holders** each add a mounted-guarded `onProjectChanged`
  effect that re-fetches **projects only** (not full `loadData`):
  `TaskDetailOverlayHost` (the bug), `Projects`, `DailyPlanner`, `Dashboard`,
  `WeeklyShutdown`, `DailyShutdown`, `PastShutdowns`, `SummaryOverlay`,
  weekly-plan `PlanTab`, weekly-plan `ScheduleTab`. `PlanTab` replicates its
  active-filter so archive/complete also reflect.

## Historical-view judgment
Project name/color are identity attributes of a *living* objective, not
point-in-time facts; the historical content (tasks/reflections/worked-time) is
untouched by a project edit. So `PastShutdowns` / `SummaryOverlay` /
`WeeklyShutdown` re-fetch **projects only** for label consistency while their
historical data stays put. No deliberate project-identity snapshot.

## Known limitations (explicit — not oversights)
- **QuickAdd does NOT receive the broadcast.** It runs in a separate Tauri
  webview; a `window` CustomEvent cannot cross windows. It already reloads
  projects on `onFocusChanged` (`QuickAdd.tsx`), so it is current on every
  summon — no regression. **Follow-up if it ever matters:** bridge via Tauri
  `emit`/`listen` (the cross-window analogue of this DOM bus).
- **ScheduleTab membership on archive/complete.** The projects-only refresh
  fixes name/color everywhere; ScheduleTab's `activeProjectIds` derivation
  (which gates which projects render) is not recomputed by the lightweight
  refresh, so an archive/complete from another screen re-memberships only on its
  next full load. Name/color (the reported bug) is fully live. Full coverage
  arrives with option B.
- **Non-subscribers by design:** `ProjectDetail` (the emitter; holds no display
  list, and subscribing would risk `loadData` clobbering in-progress edits),
  `PlanProjectPanel` (prop-driven via `PlanTab`), `CalendarMetaRail` (no
  project list).

## No-regression guarantees
- **No feedback loop:** every handler only calls `getProjects` (a read) → never
  emits → can't re-trigger. By construction.
- **Balanced listeners:** all via `onProjectChanged`'s returned cleanup, called
  from each effect's teardown; `setProjects` mounted-guarded.
- **No re-render storms:** event-driven (on actual mutation), projects-only.

## Validation
- `tsc` clean · `tsc -p tsconfig.test.json` clean · `npm run build` clean.
- **Coverage proof (the brief's core ask):** scripted grep confirms all 6
  mutations call `emitProjectChanged()` and all 10 live holders call
  `onProjectChanged`. 4 non-subscribers each documented above.
- `npm test` **21/21** — incl. 4 new `projectEvents` bus-contract tests
  (emit→fires, unsubscribe→silent, stable name, node-safe without window).
- `eslint` on changed files: 0 errors. No schema/migration/native change. **No cost.**

## Deferred
The full `projectsById` canonical-store lift (option B) remains the logged **M5
follow-up**. This change is the lightweight broadcast only.
