# Focus Screen Redesign

## Date
2026-03-25

## Summary
Redesigned the focus mode screen for a calmer, flow-state experience with a breathing arc, ambient background, inline notes, and icon-based controls.

## Timer
- Counts **up** showing total time worked on the task across all sessions (e.g. "37:12")
- Sub-label shows "of 1:00:00" if the task has an estimate, "worked" if no estimate, "paused" when paused, "break" during breaks
- Displayed inside a **circular SVG progress arc** (7px stroke, muted blue `#7B9ED9`) that fills clockwise based on worked time vs estimated time
- Break countdown still shows inside the arc during breaks (green `#4a9e6e`)
- Break prompts still fire every 25 minutes of work time

## Breathing glow
- A **duplicate progress arc** rendered behind the main arc on a separate `<div>` wrapper (WebKit doesn't animate transforms on `<svg>` elements directly)
- 14px thick stroke, pulsing opacity 0.2→0.6 and scale 1.0→1.06 on a 4s CSS animation loop (`focus-glow-layer`)
- Parent container has `overflow-visible` to prevent clipping at scale
- **Stops completely when paused** — the glow layer is conditionally removed from the DOM

## Ambient background
- 25-minute CSS `@keyframes` animation (`focus-ambient-bg`) shifting from cool blue-neutral `#f0f2f5` to warm amber-neutral `#f5f0e6`
- Nearly imperceptible transition, applied to the root focus container

## Notes panel
- Always-visible textarea between task title and timer arc
- Pre-loaded with `task.notes`, auto-saves on blur and debounced on change (600ms) via `updateTaskNotes()`
- Minimal styling: barely-there border (`border-black/[0.04]`), very light fill (`bg-black/[0.02]`), subtle warm on focus (`bg-black/[0.03]`), placeholder "Add notes…", max-height 120px with scroll

## Buttons — icon-based
- **Mark Done** — large (48px) circular button with green border and checkmark SVG icon, centered
- **Pause/Resume** — smaller (40px) ghost circle to the left, pause bars / play triangle icon
- **Stop & Save** — smaller (40px) ghost circle to the right, filled square icon
- All three in a horizontal row with tooltips for discoverability

## Layout
- Content shifted slightly upward (`mt-4`) for better center gravity
- Tighter spacing: title mb-3, notes mb-4, arc mb-6

## Removed
- "RUNNING" / "Paused" status label (arc + sub-label communicate state)
- "TOTAL TIME ON TASK" and "THIS SESSION" stat blocks
- Session dot indicators
- "Session X of Y" label at bottom
- Equal visual weight on Pause and Stop & Save

## Files changed
- `src/pages/FocusMode.tsx` — full render rewrite, notes state/auto-save, icon buttons, breathing glow layer, count-up timer with estimate context
- `src/db/queries.ts` — `updateTaskNotes()` function
- `src/index.css` — `focusGlowPulse` (4s scale+opacity), `focusAmbientBg` (25min color shift) keyframes
