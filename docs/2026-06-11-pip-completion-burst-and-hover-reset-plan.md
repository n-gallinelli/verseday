# Plan — PiP completion: green-burst "done" beat + fix stuck hover controls

**Date:** 2026-06-11
**Author:** Terse
**Status:** PENDING Verse review
**Branch (proposed):** `fix/pip-completion-burst-hover-reset`

Two related PiP issues when completing a task from the mini-timer.

---

## Issue 1 (bug) — controls stay expanded after completing

**Repro:** Hover the pip → click the green check to complete → move the cursor
away. The pip keeps showing the expanded icon strip (check / stop / pause /
break) over the *next* task instead of collapsing back to the task title.

**Root cause** (`FocusPip.tsx`): `expanded = cssHovered || externallyHovered`.
When you complete via a pip click, the pip/app is frontmost, so Rust's global
mouse monitor is dormant (`externallyHovered` can't get its `over=false` edge),
and the completion takeover (`completing`) unmounts the hover-region div for
~850ms — so its `onMouseLeave` never fires when the cursor actually leaves.
Both hover flags stay stuck `true`; the next task renders expanded.

**Fix:** On the completion hand-off (the `completeWithFlourish` timeout that
flips `completing` back to false and slides in the next task), explicitly reset
`setCssHovered(false)` + `setExternallyHovered(false)`. The next task then
renders in the calm collapsed title state. If the user really is still hovering,
a fresh `mouseEnter` re-expands — correct in both cases.

---

## Issue 2 (design) — strike-through doesn't match the app's language

The completion takeover draws a **strike-through line** left→right across the
finished title (`animate-pip-strike`). That motion exists *nowhere else* in the
app, which is why it reads as foreign.

The app's real, repeated "done" beat is a **green check-circle + a ring that
bursts outward**:
- daily task rows: `taskDoneBurst` (`.animate-task-done-burst`)
- focus screen: `focusCompleteBurst` / `focusCompleteCore`

**Fix:** bring the pip into that vocabulary.
- **Remove** the strike-through `<span>` + `animate-pip-strike`.
- Title shows calmly in `text-fg-faded` (no line through it).
- Around the existing green check-circle, add a **radiating green ring burst**
  (reuse the `taskDoneBurst` motif, pip-sized) plus a gentle scale-pop on the
  check circle. Keep the existing `animate-check-draw` checkmark + "Done" label.
- Keep the panel entrance + slide-out hand-off (`animate-pip-complete`) and the
  next-task `animate-pip-slide-in` — those are fine, only the strike changes.
- Remove the now-dead `pipStrike` keyframes + `.animate-pip-strike` class and its
  `prefers-reduced-motion` entry from `index.css`.

### Result
The pip's completion reads like the rest of the app: green check + a quick
positive burst, then a calm hand-off to the next task.

---

## Files

- `src/components/FocusPip.tsx` — hover reset in the completion timeout; swap the
  strike span for a burst ring + check pop in the `completing` takeover.
- `src/index.css` — add a pip-sized burst class (or reuse `.animate-task-done-burst`);
  delete the `pipStrike` keyframes/class + its reduced-motion line.

## Out of scope

- No sound change. No window-size change. The hand-off slide stays.
- Full-screen `BreakCelebration` contrast follow-up (separate, already logged).

## Verification (per `feedback_self_validate`)

- `tsc --noEmit` + `npm run build` clean.
- grep: zero remaining `pip-strike` / `animate-pip-strike` refs.
- Reduced-motion path still resolves to a static "done" state (check + Done,
  no motion), not a blank panel.

## Cost / security

Presentation + local state only. No DB, no DDL, no external calls. $0.
