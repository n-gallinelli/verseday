# Calendar: automatic morning sync of today

**Date:** 2026-06-15
**Branch:** `feat/calendar-morning-autosync`
**Status:** Verse APPROVED (plan, 3 conditions) — implemented, pending final diff review.

## Request
"On verseday, we should automatically sync the calendar every morning."

## Gap
Calendar auto-sync already runs, but it is scoped to the **Daily Planner** and
the **date currently viewed**: `useCalendarAutoSync(selectedDate)` syncs on
mount / date-change / hourly / focus / visibility (5-min TTL). There was no
guaranteed *morning* sync of **today**. If the app is left open across midnight,
opened to a non-planner page (Dashboard, Calendar), or parked on another date,
today's events weren't imported until the user landed on today's plan.

## Interpretation
"Every morning" = on each new **logical day**, force today's calendar into
today's plan, app-level (page/date independent). The trigger reuses the
existing day-rollover detector in `App.tsx` (`logicalDayIso`, 3am boundary,
focus/visibility-driven) — the single canonical day-change signal. It fires on
the next focus/visible **after** 3am, not at 3am while backgrounded (nothing is
stale until you look; cold-launch mornings are already covered by the planner's
mount sync; no background battery drain). A fixed wall-clock scheduler was
rejected: it requires the app to be open at that instant, unreliable on desktop.

## Implementation
1. **New primitive** `syncTodayIfReady()` in `src/calendar/sync.ts`:
   - Gates on `getEnabled()` **and** `checkPermission() === "granted"`;
     self-gating no-op otherwise (never hits EventKit when disabled/denied).
   - Calls `syncCalendarEventsForDate(todayString(), { force: false })` —
     `force:false` lets the existing per-date TTL dedupe against the planner's
     own `useCalendarAutoSync`, so a morning open doesn't double-fetch today.
   - **Never rejects**: internal try/catch, swallow + `console.error` (the
     rollover caller `void`s it; an unhandled rejection would otherwise leak).
     Mirrors the background-sync error handling in `hooks.ts`.
   - **Store-agnostic**: returns `SyncResult`, imports no store. No new
     calendar→store import edge.
2. **Wiring** in `App.tsx`'s rollover `check()`: right after the
   `lastLogicalDay/lastToday/lastWeek` ref update and **before** the
   `onShutdownSurface` branch, so it fires once per day-advance on either exit.
   The caller owns reconcile-on-success (standing consumer-reconciles rule):
   ```js
   void (async () => {
     const res = await syncTodayIfReady();
     if (res.created > 0) useAppStore.getState().loadTasksForDate(todayString());
   })();
   ```
3. **No** new permission, DB schema, migration, or network. Zero cost.

## Out of scope (Verse FYI)
The primitive does **not** replicate the planner hook's "enabled + denied →
`setEnabled(false)`" auto-flip. State correction stays the planner hook /
Settings' job — pre-existing behavior, unchanged.

## Tests
`src/calendar/sync.test.ts` (5):
- disabled → no-op, EventKit not touched.
- permission not granted → no-op, EventKit not touched.
- sync failure → never rejects, swallowed + logged.
- ready + inserted → `created > 0` (the caller's reconcile gate fires).
- ready + already-exists → `created === 0` (reconcile does not fire).

`todayString` is mocked to a unique date per test so `sync.ts`'s module-level
per-date TTL can't short-circuit a later test.

## Validation
`tsc` (app + test configs) clean · `eslint` clean on changed files ·
full suite 132/132.
