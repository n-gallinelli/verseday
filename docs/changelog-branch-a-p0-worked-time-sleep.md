# Changelog — Branch A (P0-1): sleep/lid-close worked-time inflation

**Branch:** `fix/p0-worked-time-sleep-clamp` (off `main`)
**Item:** P0-1 from `docs/2026-06-01-stability-hardening-brief.md`
**Verse:** plan rejected (10s discard) → reworked → **spot re-approved**.

## Problem
The focus tick fed `delta = Date.now() - lastTickRef` into `tickFocus`
unbounded. A suspended interval (sleep / lid-close) added the entire wake gap
on the first post-wake tick — a 5-min task could read ~2h after a 2h sleep.

## Fix (two layers)
1. **Primary — OS resume signal.** `src-tauri` observes
   `NSWorkspaceDidWakeNotification` (`commands::start_system_resume_notifier`,
   wired in `lib.rs` setup) and emits `system-resumed`. This fires only on a
   real wake and is never raised by App Nap / timer throttling — the exact
   sleep-vs-throttle distinction a delta-size threshold can't make. `App.tsx`
   listens and sets a one-shot store flag (`markFocusResume`); the focus tick
   consumes it (`consumeFocusResume`) and drops that span.
2. **Backstop — `MAX_TICK_DELTA_MS = 300_000` (5 min).** Catches a wake event
   that lost the async emit→listen race or was dropped. Sized ~5× worst-case
   App Nap coalescing, so it can never discard real occluded-but-working time;
   only an unexplained multi-minute gap is dropped.

Decision logic isolated in `src/utils/workedTime.ts` (`clampWorkedDelta`).
`lastTickRef` is always advanced so the tick after a dropped span computes a
normal small delta; a resume flag that arrives while paused/inactive is cleared
on tick (re)start so it can't later eat a legitimate first second.

## Files
- `src/utils/workedTime.ts` (new) — `clampWorkedDelta` + `MAX_TICK_DELTA_MS`.
- `src/utils/workedTime.test.ts` (new) — fake-clock cases.
- `src/stores/appStore.ts` — one-shot resume flag (`mark`/`consume`/`clear`).
- `src/pages/FocusMode.tsx` — tick applies the clamp; clears stale flag on start.
- `src/App.tsx` — `system-resumed` listener with `unlisten` teardown.
- `src-tauri/src/commands.rs` — `start_system_resume_notifier` (macOS / no-op).
- `src-tauri/src/lib.rs` — call it in `setup`.
- `src-tauri/Cargo.toml` — add `objc2-foundation` `NSNotification` feature.
- `package.json` + `vitest.config.ts` — vitest devDep + `npm test` script.

## Validation (static + runtime per ⚠️ requirement)
- `npm test` → 6/6 pass. Cases prove: normal 1s kept; 90s throttle kept in full
  (regression Verse blocked); resume → 0 any size; 2h-no-resume → 0 (backstop
  net incl. the lost-race path Verse asked for); cap boundary; clock-skew → 0.
- `npx tsc --noEmit` clean. `npm run build` clean (pre-existing chunk-size warn).
- `cargo check` clean.
- Grep: `tickFocus` has one delta-feeding caller (FocusMode tick); no other path
  feeds a raw `Date.now()` delta into worked time.

## Notes
- No DB / schema / migration touched. Nothing structural; only additions are
  dev-only test tooling (vitest) and one Cargo feature flag. **No money cost.**
- Native code follows the existing objc2 patterns in `commands.rs`; the observer
  is retained for app lifetime.
