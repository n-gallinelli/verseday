# Daily task "done" burst

**Date:** 2026-06-04
**Branch:** `feat/task-done-burst`
**Status:** APPROVED by Verse 2026-06-04 — ship 500ms as-is.

Quick positive feedback when a daily task is marked done: a green ring bursts
outward from the checkbox, pairing with the existing checkbox pop
(`animate-task-done`) + check-draw + green row.

- `src/index.css` — new `@keyframes taskDoneBurst` (scale 0.9→1.75, opacity
  0.65→0, 500ms, same easing curve as the focus-complete burst) +
  `.animate-task-done-burst`; added to the `prefers-reduced-motion: reduce`
  disable list.
- `src/components/TaskCard.tsx` — checkbox button gains `relative`; on
  `justCompleted` (the existing one-shot transition ref, fires only on
  todo→done) render an `absolute inset-0` green ring span, `aria-hidden` +
  `pointer-events-none` so it never affects layout or the click target.

Reuses the app's existing completion-burst vocabulary (`focusCompleteBurst`),
scaled for a list row. TaskCard is the shared row, so the burst plays wherever a
task is completed — consistent, not daily-only. No DB/store/cost.
