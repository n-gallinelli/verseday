# Day doesn't roll over on reopen (stale date + lingering wrap-up) — plan

**Date:** 2026-06-10
**Author:** Terse
**Status:** PLAN — awaiting Verse review (no code written)

## Symptom
Reopening VerseDay the morning after last using it (app was hidden, not
quit, overnight) shows **yesterday's** date as "Today" (Tue Jun 9 at
8:34am Wed Jun 10) and a stale **"Wrap up your day"** prompt.

## Root cause (shared)
macOS keeps the app process alive when the window is closed (close = hide,
per the lib.rs close handler). So the JS context — and all day-scoped
state — persists across the midnight/3am boundary and is never refreshed
on reopen.

### Bug 1 — stale `selectedDate`
- `selectedDate: todayString()` is evaluated ONCE at store creation
  (appStore.ts:958), i.e. when the app first launched (Tuesday).
- The day-rollover effect (App.tsx:190) DOES detect a `logicalDayIso()`
  change on re-focus, but only acts when `onShutdownSurface`
  (sunset overlay / daily_shutdown / shutdown). On the Daily Plan it
  returns without advancing → `selectedDate` stays on yesterday.
- DailyPlanner's "today" check uses `todayString()` (DailyPlanner.tsx:212),
  so the header reads yesterday as the selected day.

### Bug 2 — lingering WrapUpReminder
- `shouldShow()` requires `isWrapUpOrLater()` (≥16:30). At 8:34am it's
  false — so it should NOT show.
- But `check()` only ever does `if (shouldShow()) setVisible(true)` — it
  never sets `false` (WrapUpReminder.tsx:93-95). Yesterday's 4:30pm
  reminder set `visible=true`; the persistent process kept it true through
  the night. The per-day completed-flag also rolls at midnight, so a new
  day starts "not completed" and nothing re-hides the stale toast.

## Proposed fixes

### Fix 1 — advance `selectedDate` on day-rollover (App.tsx rollover effect)
Extend the existing re-focus rollover check so it also advances the Daily
Plan date, WITHOUT yanking deliberate navigation:
- Track the last-known "today" (`todayString()`).
- On re-focus, if today changed AND `selectedDate === <last-known today>`
  (i.e. the user was sitting on "today", the common case), set
  `selectedDate = todayString()` (and `selectedWeek = mondayOfWeek()`).
- If `selectedDate` is some OTHER date the user navigated to, leave it
  (preserves the existing "don't yank a view the user is using" intent —
  the reason the effect was shutdown-surface-only).
- Keep the existing shutdown-surface reset (close overlay → daily).
- Open question for Verse: trigger on `logicalDayIso()` (3am boundary, what
  the effect uses today and what Nick expects) but SET the date to
  `todayString()` (calendar, what DailyPlanner compares). These agree
  except 00:00–03:00; confirm the intended behavior in that window.

### Fix 2 — let WrapUpReminder hide itself
- Change `check()` to `setVisible(shouldShow())` (both directions) so when
  it's no longer wrap-up time (new morning) the toast retracts.
- Add a focus/visibilitychange listener to re-run `check()` on reopen so a
  stale overnight toast clears immediately rather than waiting up to 60s
  for the interval.

## Notes / risk
- Both are re-focus-only (no timers yanking mid-use), consistent with the
  Verse-reviewed comment on the existing effect.
- No DB / DDL. Pure client state.
- Validation: tsc + build; eyes-on is the real test (reopen across a day
  boundary) — hard to unit-test wall-clock-on-reopen, but the date-advance
  rule (advance iff sitting on old today) is unit-testable as a pure fn if
  Verse wants it extracted.
- Consider whether the Weekly Plan's `selectedWeek` needs the same
  treatment (flagging; proposing daily-date only for now).
