# Plan: Reset stale shutdown view on a new day (3am cutoff)

**Date:** 2026-06-04
**Branch:** `fix/shutdown-day-rollover-reset`
**Author:** Terse
**Status:** APPROVED by Verse 2026-06-04 (re-focus-only confirmed; shutdown-surface gate only). Doc-path + completeShutdown wording corrected per review.

## Problem

When the user shuts down the day and later closes the window, the app
**process stays alive** (standard macOS behavior — the window hides, the
process does not exit). The app store is in-memory only — `currentPage`,
`selectedDate`, and `sunsetOverlayOpen` are NOT persisted (`src/stores/appStore.ts:1052-1068`).
So on reopen the next day, the user is still looking at yesterday's state:

- `completeShutdown()` (`DailyShutdown.tsx:252`) only flips `sunsetOverlayOpen = true`.
  It does not set the page — the user is already on `currentPage = "daily_shutdown"`
  with `selectedDate = <yesterday>`. Net stale state: the sunset overlay open over
  yesterday's shutdown page.
- Closing the window does not tear down the store.
- Reopening the next morning re-renders that exact stale state — the previous
  day's shutdown quote.

A true process restart already does the right thing (store re-inits to today),
so this only bites the keep-the-process-alive reopen path.

## Goal

On window re-focus, if the logical day has advanced past the day the shutdown
surface belongs to, dismiss the sunset overlay and route back to **today's**
Daily Plan. Day boundary is **3am**, not midnight — reopening at 1am still
shows last night's shutdown; reopening at 9am shows the fresh day.

## Design

### 1. `logicalDayIso()` helper — `src/utils/dates.ts`

A "logical day" with a configurable cutoff hour (default 3am). Times between
midnight and the cutoff map to the previous calendar day. Built on the existing
local-tz primitives — no UTC.

```ts
/**
 * The "logical day" (YYYY-MM-DD, local tz) for a wall-clock instant, where
 * the day boundary is `cutoffHour` (default 3am) rather than midnight. Times
 * between midnight and the cutoff belong to the previous calendar day. Used so
 * a late-night shutdown reopened before 3am still reads as the same day.
 */
export function logicalDayIso(d: Date = new Date(), cutoffHour = 3): string {
  const shifted = new Date(d);
  shifted.setHours(shifted.getHours() - cutoffHour);
  return localDateIso(shifted);
}
```

### 2. Day-rollover reset effect — `src/App.tsx` (`MainApp`)

A new `useEffect` (no deps; registers once) that:

- Holds the last-seen logical day in a `useRef`, initialized to
  `logicalDayIso()` on mount.
- On `visibilitychange` → `visible` and on `window` `focus`, recomputes the
  current logical day.
- If it **advanced** (`current !== ref`) AND the app is sitting on a stale
  shutdown surface — `sunsetOverlayOpen === true` OR `currentPage` is
  `"daily_shutdown"` / `"shutdown"` — it resets:
  - `closeSunsetOverlay()`
  - `setSelectedDate(todayString())`
  - `setPage("daily")`
- Always updates the ref to the current logical day after the check.

Reads live state via `useAppStore.getState()` at fire time (mirrors the
calendar auto-sync listener pattern in `calendar/hooks.ts:197-204`), so the
listeners never need re-registration.

```ts
useEffect(() => {
  const lastLogicalDay = { current: logicalDayIso() };

  const check = () => {
    const today = logicalDayIso();
    if (today === lastLogicalDay.current) return;
    lastLogicalDay.current = today;

    const s = useAppStore.getState();
    const onShutdownSurface =
      s.sunsetOverlayOpen ||
      s.currentPage === "daily_shutdown" ||
      s.currentPage === "shutdown";
    if (!onShutdownSurface) return;

    s.closeSunsetOverlay();
    s.setSelectedDate(todayString());
    s.setPage("daily");
  };

  const onVisibility = () => {
    if (document.visibilityState === "visible") check();
  };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("focus", check);
  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("focus", check);
  };
}, []);
```

## Scope decisions (deliberate)

- **Trigger on re-focus only, no periodic tick.** A timer that flips the view
  at 3am while the user is actively looking at the overlay would be jarring.
  The reported scenario is "close, reopen next day" — `visibilitychange` +
  `focus` cover it. Trade-off: a window left in the foreground across 3am stays
  stale until the next focus; acceptable.
- **Reset only shutdown surfaces, not arbitrary stale `selectedDate`.** If the
  user intentionally paged to a past Daily Plan, snapping them to today on
  every refocus would be surprising. The complaint is specifically the stale
  shutdown quote, so we gate on shutdown surfaces only.
- **`setSelectedDate(todayString())`** uses the calendar date. A reset only
  fires when the logical day advanced, which (with a 3am cutoff) means it is
  already ≥3am of a new calendar day, so calendar-today and logical-today
  agree at reset time.

## Out of scope / non-changes

- No persistence added — in-memory store reset semantics unchanged.
- No DB schema change, **no migration, zero DDL.**
- No cost to run. No credentials, no network.
- Quote rotation / 40-day cooldown (`SunsetOverlay.tsx`) untouched.

## Files touched

- `src/utils/dates.ts` — add `logicalDayIso()`.
- `src/App.tsx` — add rollover-reset effect; import `logicalDayIso`.

## Verification (self-validate — no manual UI test)

- `tsc --noEmit` / build clean.
- Unit test for `logicalDayIso`: 2026-06-04T01:00 → `2026-06-03`;
  2026-06-04T03:00 → `2026-06-04`; 2026-06-04T09:00 → `2026-06-04`.
- Code review of the effect: listener cleanup, `getState()` freshness, gate
  correctness.
