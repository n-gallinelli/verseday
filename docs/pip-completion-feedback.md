# Decision — PiP task-completion feedback

**Date:** 2026-06-05 · **Author:** Terse · **Status:** BUILT (awaiting Verse final review)

## Problem
Nick: "I don't love the feedback when you click the check mark in the pip." The old
feedback was a flash on the 32px checkmark button (`taskDone` scale-pop + green fill
+ `focus-complete-burst` ring + check redraw, resetting after 1.1s). In a 220×58
pill it read as a small flicker, not an "officially done" moment.

## Chosen direction (Nick picked from 3 previews)
**Option C — strike + hand-off (calm).** A full-pip takeover: the finished task's
title strikes through + a green check draws, the panel holds briefly, then slides
out to the right; the next task slides in. Whole-surface change = unmistakably
official; reuses the existing ACK-takeover pattern already in the pip.

(Rejected: full green sweep — too loud for a calm utility; confetti pop — fun but
still tiny/easy to miss.)

## Implementation
- `src/index.css`: three keyframes — `pipComplete` (entrance → hold → slide-out
  right + fade, 850ms), `pipStrike` (strike line width 0→100%, base 100% so
  reduced-motion shows a static full strike), `pipSlideIn` (next task rise + fade,
  300ms). All three added to the `prefers-reduced-motion` opt-out.
- `src/components/FocusPip.tsx`:
  - `completeWithFlourish()` snapshots the finished task's title, sends `"done"`
    immediately (data write not delayed by animation), then after `COMPLETE_MS`
    (850, matches the keyframe) clears `completing` and triggers `slideInNext`.
  - New full-pip completion-takeover render branch, placed BEFORE the `!state`
    check so completing the last task still plays even if the main window has
    already torn `state` down.
  - Next task's content slides in via `animate-pip-slide-in` (gated on
    `slideInNext`, cleared after 340ms so heartbeat state updates don't replay it).
  - Checkmark button stripped of its old inline completion styling (green fill /
    ring burst / check redraw) — feedback now lives in the takeover.

## Cost / blast radius
No DB, no migration, no dependency, $0. CSS + one component. `tsc` + `vite build`
clean. Other consumers of `animate-task-done` / `animate-focus-complete-burst`
(TaskCard, FocusMode) are untouched.
