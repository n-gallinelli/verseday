# Plan — Break-view polish (4 items)

**Author:** Terse
**Date:** 2026-06-17
**Status:** PENDING Verse review (no code written yet)
**Branch (proposed):** `feat/break-view-polish` (off `build/combined-install`)
**Scope:** Presentational only. No DDL, no store, no flag.
**Decided with Nick:** KEEP the blue ring (`--pip-ring` = `#4070B5`). The border/ring swap
is DROPPED — no change to `--pip-ring` or `--focus-pip-border`.

Four items remain:

---

## 1. Full-screen break view — small "BREAK" label above the timer

`FocusMode.tsx` `BreakScreen` (~1918-1930): currently logo (72px, `mb-8`) → 72px timer →
`<p>On a break · ends {endsAt}</p>`. There is no "BREAK" label.

**Change:** insert a small uppercase label directly ABOVE the timer (between the logo and
the `text-[72px]` div), styled to match the widget's BREAK label — a quiet whisper, not a
heading:
```jsx
<div className="uppercase [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] mb-2" style={{ color: "var(--focus-break-label)" }}>Break</div>
```
(`--font-size-label`=11px, weight 500, tracking 0.06em — same tokens the widget uses. Small
`mb-2` gap to the timer.)

## 2. Warm the "BREAK" label color

Both BREAK labels currently read cool: the widget uses `text-fg-faded`
(`rgba(0,0,0,0.25)` — pure black alpha, reads gray/cool over the warm cream palette).

**Change:** add ONE themed CSS var in `src/index.css` and use it for BOTH labels (full-screen
+ widget) so they stay in lockstep:
```css
/* light */ --focus-break-label: rgba(74, 55, 38, 0.42);   /* warm taupe, muted */
/* dark  */ --focus-break-label: rgba(232, 224, 210, 0.45); /* warm off-white, muted */
```
- Widget label (`FocusPip.tsx:651`): replace `text-fg-faded` with
  `style={{ color: "var(--focus-break-label)" }}`.
- Full-screen label (item 1): same var.
Values are a starting point; final temperature confirmed by eyes-on (warm "slightly," not a
brown shout).

## 3. Widget "BREAK" → "ends H:MM" hover crossfade (no layout shift)

In the break-countdown phase (`FocusPip.tsx:646-663`), the label should crossfade to the end
time on hover and back on mouse-out — same position, same size, no reflow.

**Change:**
- Replace the single label div with a `relative` box of fixed height containing TWO
  absolutely-stacked spans occupying the same rect (so no layout shift): "BREAK" and
  `ends {breakEndClock(Date.now(), state.breakRemaining)}`. Import `breakEndClock` from
  `src/utils/breakClock.ts` (already shared — same formatter the full-screen "ends" text
  uses, so they read identically). The end clock is stable as it counts down (now +
  remaining ≈ fixed end).
- Crossfade via opacity + `transition-opacity` driven by `expanded` (the existing
  `cssHovered || externallyHovered`). BREAK `opacity: expanded ? 0 : 1`; end-time the
  inverse. ~180ms ease — a quiet reveal, not a pop.
- The break phase doesn't currently track DOM hover, so add `onMouseEnter`/`onMouseLeave`
  to set `cssHovered` (mirroring the running-readout). `externallyHovered` already fires in
  any phase via the Rust geometry monitor, so the reveal also works when the pip isn't key
  (same hover model as the icon fan-out; same macOS not-key caveat, intentional).

## 4. Timer font parity (widget vs full-screen)

The two break timers are different typefaces:
- Full-screen (`FocusMode:1923`): `font-display` (Bricolage), `font-semibold` (600),
  `tabular-nums`, `tracking-tight`, `letter-spacing: -2px` @72px (≈ -0.028em).
- Widget (`FocusPip:652`): inherited Figtree, `font-medium` (500), `tabular-nums`,
  `letter-spacing: -0.5px` @20px. Reads heavier + tighter than the full-screen.

**Change:** make the widget timer the SAME element at a smaller size — add `font-display`,
bump `font-medium`→`font-semibold`, keep `tabular-nums`, set `letter-spacing` to the
proportional equivalent (`-0.028em × 20px ≈ -0.55px`; current -0.5px is close — use -0.55px).
Result: same typeface, same weight, same proportional tracking at 20px vs 72px. Eyes-on
confirms they "feel like the same element."

---

## Risk / blast radius
- All four are presentational; no ring/border change (Nick keeps blue).
- #3 adds DOM hover handlers to the break phase + a stacked-span label. Watch: the two spans
  must share an identical box (same line-height/size) so the crossfade has zero layout shift;
  verify the end-time string ("ends 4:36") fits the pip width without wrapping at the break
  phase's available width.
- #4 changes the widget timer typeface — purely visual; confirm tabular-nums still aligns
  digits in Bricolage (full-screen already uses it, so yes).

## Self-validation
- `tsc --noEmit` → `tauri build --debug`.
- **Eyes-on:** (1) full-screen break shows a quiet "BREAK" above the timer; (2) both BREAK
  labels read warm, not cool-gray; (3) hover the break pip → BREAK smoothly crossfades to
  "ends 4:36" and back, no jump; (4) widget vs full-screen break timer look like one element
  at two sizes.

## Out of scope
- The blue ring / pip border (kept as-is per Nick).
- The "Next task = today-only" ticket ([[project_next_task_today_only]]).
