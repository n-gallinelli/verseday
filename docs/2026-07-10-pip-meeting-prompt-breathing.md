# PiP meeting-prompt — breathing room (taller phase-aware card)

**Author:** Terse
**Date:** 2026-07-10
**Status:** Verse-APPROVED (with required corrections, all honored); committed on `feat/pip-meeting-prompt-breathing`
**Scope:** `src/utils/pipEvents.ts` + `src/components/FocusPip.tsx`. No schema/logic.

## Problem
The meeting-start PiP prompt (`Go to meeting` / `Not now`) packs a 2-line text
block + a button row (~76px) into the fixed 66px PiP box, so the brown button
clipped against the bottom edge. `zoom` scales the box uniformly, so high-vis
didn't help.

## Fix — phase-aware taller box for `meetingPrompt` only
One source of truth in `pipEvents.ts`, split into the two families the file's
discipline requires:
- **Base content box** (shell renders + zooms): `PIP_SIZE` 220×66 for
  resting/focus/break; `PIP_SIZE_MEETING` 220×90 for `meetingPrompt`, via
  `pipBaseBoxForPhase(phase)`.
- **Window size** (`windowFor(box, highVis)`): box in normal mode; in high-vis
  `box×1.3 + 2×7.1px halo`, **derived** from the base box so it can't drift.
  `PIP_SIZE_LARGE` and both `pipSizeFor` / `pipSizeForPhase` all flow from it.

`FocusPip` pins the window via `pipSizeForPhase(state?.phase, highVis)` (phase in
the effect deps → re-pins on enter AND on clear); the shell box reads
`pipBaseBoxForPhase(state?.phase)` — same source, no drift. Create-size in
`FocusMode` untouched (resting). Meeting container padding `py-2`→`py-3`,
`gap-2.5`→`gap-3`.

## Verification (measured, Figtree, real box dims)
- Normal 220×90: button→bottom clearance **11.1px**, symmetric top 11.1px.
- High-vis window 300×131: ring halo **7.0px on all four sides**, un-clipped.
- `tsc` + `vite build` clean.
- Break/focus pips unchanged (still 220×66) — smallest blast radius.

## Verse corrections honored
- High-vis height derived (300×131 for box 90), NOT the rejected 118.
- Single source of truth: window pin + shell box both from the base-box constant.
- Box sized to 90 (not exact-fit 88) for sub-pixel slack.
- Meeting-only; break prompt untouched.
