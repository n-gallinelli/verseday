# Changelog — Branch C: Tier-1 surgical batch

**Branch:** `fix/tier1-batch` (off `main`)
**Items:** #4, #5, #9, #8, #13, #14 from `docs/2026-06-01-stability-hardening-brief.md`.
**Validation:** static (tsc + build + grep + review) per Nick's preference — none
of these are time-integrity ⚠️ items.

## #4 — editing worked-minutes on the active task didn't update the live readout
`setTaskWorkedMinutesAction` (appStore) wrote the DB but never updated the focus
baseline, so editing worked-minutes from **ProjectDetail** left the focus timer
showing the old value (the TaskDetailOverlay happened to call it itself). Fixed
by centralizing: after the DB write, `get().setFocusPriorElapsedMs(id, minutes*60*1000)`.
The setter no-ops unless `focus.taskId === id`, so it's safe for any task and
idempotent with the overlay's existing call (same value).

## #5 — "today" / date paging used UTC instead of local-tz helpers
`DailyPlanner.changeDate`, `isToday`, and the rollover gate (`todayIso`) used
`new Date().toISOString()`, which formats the local date in UTC → off-by-one
after ~5pm Pacific (wrong "today" highlight, arrows mis-step, tasks land on the
wrong day). Switched to `todayString()` / `localDateIso()`. Same fix applied to
`DailyShutdown` (`getTomorrowDate` carry-forward target + the snap-to-today on
mount), which had the identical smell.

## #9 — `completed_at` (UTC) compared against local week-bound strings
`getTasksCompletedInWeek` compared a UTC `completed_at` instant against bare
local date strings + a UTC-suffixed Friday end, so a task completed near
midnight could land in the wrong local week. Added `localDayStartUtc` /
`localDayEndUtc` to `utils/dates` and compare `completed_at` against those UTC
instants; the `date_scheduled` fallback branch stays on local date strings
(that column is a local date). Now uses 4 params (completed-at UTC bounds +
date_scheduled local bounds).

## #8 — intervals/listeners rebuilt every tick
- `FocusMode` PiP-command interval listed `elapsed` in deps but never reads it
  (all handlers go through `*Ref.current`) → the 200ms poller tore down/rebuilt
  every second, opening a window where a PiP pause/stop click could be dropped.
  Deps narrowed to what the body actually reads.
- `DailyPlanner` keydown listener listed `tasks` (unused since Space-on-hover
  was removed) → re-bound the window listeners on every task mutation. Dropped.
- `DailyPlanner` `projectMap` now `useMemo`'d (rebuilt only on `projects`
  change, not every focus-tick render).

## #13 — global quick-add shortcut never unregistered
`App.tsx` registered `CmdOrCtrl+Shift+A` with no teardown. Added `unregister`
in the startup effect's cleanup so a remount can't leave a stale handler /
"already registered" error (mostly a dev-stability win).

## #14 — setState-after-unmount in async loaders
`ProjectDetail.loadData` and `DailyPlanner.loadData` set state after awaits with
no guard → fast project/date switching over slow reads could flash stale data
or warn. Added an optional `isStale` arg checked before each post-await
setState, driven from the loading effect via the codebase's cancelled-ref
pattern (`let cancelled = false; … return () => { cancelled = true }`). Covers
both unmount and dependency-change (the cleanup runs before the re-fire).
Event-handler callers (mounted) omit `isStale` and behave exactly as before.

## Files
- `src/stores/appStore.ts` (#4) · `src/pages/DailyPlanner.tsx` (#5,#8,#14) ·
  `src/pages/DailyShutdown.tsx` (#5) · `src/pages/FocusMode.tsx` (#8) ·
  `src/pages/ProjectDetail.tsx` (#14) · `src/db/queries.ts` (#9) ·
  `src/utils/dates.ts` (#9 helpers) · `src/App.tsx` (#13).

## Validation
- `npx tsc --noEmit` clean · `npm run build` clean · `npm test` 11/11 (unchanged).
- Grep: #4 sole DB-write path now syncs the focus baseline; #5 no
  `new Date().toISOString()` left in the touched date paths; #8 deps narrowed to
  values actually read; #14 every post-await setState guarded.
- ESLint: this repo ships with pre-existing errors (unused vars + a missing
  `react-hooks/exhaustive-deps` rule config). This change introduces **none** —
  the only flagged line within the diff is the DailyPlanner keydown
  `eslint-disable` directive, whose "rule not found" error is produced
  identically by the same directive on `main`.
- No schema/migration/native changes. **No money cost.**
