# Project-change propagation — Terse Plan

**Date:** 2026-06-01
**Author:** Terse
**Against:** `docs/2026-06-01-project-change-propagation-brief.md`
**Status:** PLAN — awaiting Verse review. **No code until APPROVED.**

Scope: the lightweight `verseday:project-changed` broadcast (option A). **No**
new entity/schema/migration, **no** `projectsById` lift (that stays the deferred
M5 follow-up). "Objective" = Project throughout. Local only — **no money cost.**

## Design

A single window CustomEvent `verseday:project-changed`, mirroring the existing
`verseday:task-status-changed` precedent (`queries.ts:527` —
`setTaskStatusFromUI` emits after the DB write, guarded by
`typeof window !== "undefined"`).

**New module `src/utils/projectEvents.ts`** (keeps the event name + guard +
listener discipline in one place, no string drift):
```ts
export const PROJECT_CHANGED_EVENT = "verseday:project-changed";
export function emitProjectChanged(): void {
  if (typeof window !== "undefined")
    window.dispatchEvent(new CustomEvent(PROJECT_CHANGED_EVENT));
}
/** Subscribe; returns an unsubscribe. Standardizes the add/removeEventListener
 *  pair so every holder's listener is balanced. */
export function onProjectChanged(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(PROJECT_CHANGED_EVENT, handler);
  return () => window.removeEventListener(PROJECT_CHANGED_EVENT, handler);
}
```
Payload-less: holders just re-run their own `getProjects(...)`; no "which
project" detail is needed since each re-fetches its whole list.

## Single emit chokepoint — the query layer (rationale)

Emit from the **6 project mutation functions in `queries.ts`** (each calls
`emitProjectChanged()` after its successful DB write), NOT from UI callers.
Rationale:
- It's the one layer every mutation path flows through — a future UI caller
  **cannot forget** to fire it (the brief's outcome 3).
- It mirrors the established `setTaskStatusFromUI` precedent already in this file.
- The `typeof window` guard keeps the query layer node-safe — the SQL-module
  integrity tests don't import `queries.ts`, and even direct query-layer tests
  would no-op the emit. No DB→DOM coupling that breaks testability.

**Emit coverage (grep-proven — every mutation fn + its callers):**
| `queries.ts` fn | UI callers (all auto-covered) |
|---|---|
| `createProject` :99 | `Projects.tsx:194` |
| `updateProject` :123 | `ProjectDetail.tsx:664, :701` |
| `completeProject` :133 | `ProjectDetail.tsx:812` |
| `archiveProject` :144 | `ProjectDetail.tsx:770`, `Projects.tsx:307` |
| `deleteProject` :174 | `ProjectDetail.tsx:759` |
| `updateProjectSortOrders` :179 | `Projects.tsx:253` |

All 6 emit uniformly (no exceptions → can't-forget). Note on
`updateProjectSortOrders`: it fires too; Projects.tsx reorders optimistically
then its own listener re-fetches the persisted (identical) order — benign, no
flicker, no loop (re-fetch is a read).

## Subscribers — every live project-copy holder (grep-authoritative)

Holders found via `getProjects(` + `useState<Project[]>`. Each gets a
`useEffect(() => onProjectChanged(refetchProjectsOnly), [])`. The handler
re-fetches **only** projects (with that screen's existing `includeArchived`
arg) — not a full `loadData` — to avoid resetting unrelated state / re-render
storms. Each `setProjects` is mounted-guarded (the listener unsubscribes on
unmount; an in-flight fetch is guarded too, matching the #14 cancelled-ref
discipline).

| Holder | getProjects | Subscribe? |
|---|---|---|
| `TaskDetailOverlayHost` (the reported bug) | :63 | ✅ |
| `Projects` (the Objectives page) | :148 | ✅ |
| `DailyPlanner` | :405 | ✅ |
| `Dashboard` | :194 | ✅ |
| `WeeklyShutdown` | :311 | ✅ |
| `DailyShutdown` | :95 | ✅ |
| `PastShutdowns` | :19 | ✅ (see judgment) |
| `SummaryOverlay` | :262/:270 | ✅ (see judgment) |
| `weekly-plan/PlanTab` | :96 | ✅ |
| `weekly-plan/ScheduleTab` | :588 | ✅ |
| `QuickAdd` | :35 | ❌ — separate webview (see below) |
| `ProjectDetail` | :588 | ❌ — emitter only (see below) |
| `weekly-plan/PlanProjectPanel` | — (prop `allProjects`) | ❌ — covered by PlanTab |
| `CalendarMetaRail` | — (no projects) | ❌ — not a holder |

### Non-subscribers — explicit rationale
- **QuickAdd** runs in its own Tauri webview; a `window` CustomEvent in the main
  window cannot reach it. It already reloads projects on `onFocusChanged`
  (`QuickAdd.tsx:79`), so it's current on every summon. Cross-window live sync
  would need Tauri `emit`/`listen` — **out of scope** for the lightweight
  broadcast; noted as a known limitation (not a regression — same as today).
- **ProjectDetail** is the emitter for project edits; it holds no project *list*
  for display, only `takenColors` (the unique-color picker) + the single edited
  project. Single-user can't edit two projects at once, so `takenColors` can't
  go stale from a concurrent edit; subscribing would risk `loadData` resetting
  in-progress edit fields mid-edit. So: emit only, don't subscribe.
- **PlanProjectPanel** receives `allProjects` as a prop from PlanTab → covered
  when PlanTab re-fetches. **CalendarMetaRail** shows calendar metadata, no
  project list.

## Judgment call — historical / point-in-time screens

**Decision: project name/color are identity attributes of a living objective,
not point-in-time facts — so every live view re-fetches them; there is no
deliberate project-identity snapshot.** The historical data on
`PastShutdowns` / `SummaryOverlay` / `WeeklyShutdown` is the tasks, reflections,
and worked time — none of which a project edit changes. Showing a *stale*
project name in history would be the inconsistency (a renamed objective reading
under two names). So these screens re-fetch **projects only** on the event while
their historical task data stays put. (If Verse wants any of these to snapshot
the old label instead, it's a one-line "don't subscribe" per screen — flagging
for your call, but I recommend live for all three.)

## No-regression guarantees (brief outcome 4)
- **No feedback loop:** every event handler only calls `getProjects` (a read) →
  never emits → cannot re-trigger itself. Guaranteed by construction.
- **Balanced listeners:** all subscriptions go through `onProjectChanged`, which
  returns its own `removeEventListener` cleanup; each holder returns it from the
  effect. Matches the app's existing add/remove discipline.
- **No re-render storms:** re-fetch is event-driven (on actual mutation), not a
  timer; handler re-fetches projects only, not full screen reloads.

## Modules / changes
- `src/utils/projectEvents.ts` (new) — event name + `emitProjectChanged` +
  `onProjectChanged`.
- `src/db/queries.ts` — call `emitProjectChanged()` in the 6 project mutations.
- 10 holder files — add one `onProjectChanged` effect each (projects-only
  re-fetch, mounted-guarded).
- `/docs` changelog + the one-line note that option B (`projectsById` canonical
  lift) remains the deferred M5 follow-up.

## Validation (coverage proof, per the brief)
- `tsc` + `npm run build` clean.
- **Emit proof:** grep that all 6 `queries.ts` project mutations call
  `emitProjectChanged()`; the caller table above shows every UI mutation path
  flows through them.
- **Subscribe proof:** grep that all 10 live holders call `onProjectChanged`;
  the 4 non-subscribers each have a documented reason above.
- Can't be proven statically: cross-webview (QuickAdd) — explicitly out of
  scope, mitigated by its on-focus reload. No manual UI test required.
