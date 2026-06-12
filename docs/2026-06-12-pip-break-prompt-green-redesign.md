# PiP break-prompt redesign — on-brand green, readable

**Date:** 2026-06-12
**Author:** Terse
**Status:** BUILT — awaiting Verse final review

## Context

Nick flagged the break-prompt PiP as unusable ("you can't even see this").
Three concrete problems:

1. **Off-brand color.** The CTA used a hard-pinned muddy brown `#A85E1E`
   ("warm CTA"). Rest/break is **green** everywhere else in the app — the
   break *countdown* renders in `--accent-green-deep`. The lone brown matched
   nothing and read as a dirty-orange blob.
2. **Invisible secondaries.** "5 more minutes" / "Skip" were 11px with a
   `text-fg-secondary` / `text-fg-faded` split — the faded one was effectively
   unreadable on the light pill.
3. **No semantic cue** that this is a break offer.

Nick picked direction **"Green, decluttered"** (keep the 220×58 window; recolor
+ readability; no resize).

## Change (`src/components/FocusPip.tsx`, break-prompt phase only)

- **CTA recolored to deep green, PINNED `#0F6E56` / hover `#0B5A46`** — the
  same green as the break countdown, so prompt + running break read as one
  moment. Pinned (not the `--accent-green` token) for the same reason the brown
  was pinned: the token swaps lighter (`#6fa088`) in dark mode and would fail
  WCAG 1.4.3 behind white text.
  - **Contrast: white on `#0F6E56` ≈ 6.2:1** (AA pass; better than the brown's
    4.9:1). Hover is darker → higher.
- **Coffee-cup icon** (13px, inline SVG, `currentColor` white) before the label
  — the semantic cue replacing a header, fits the same row.
- **Secondary links now readable:** both `text-fg-secondary` (was a
  secondary/faded split), bumped 11px → 12px, snooze shortened
  "5 more minutes" → "+5 min", joined by a `·` separator.
- Window size, layout structure, commands (`takeBreak` / `snooze5` / `noBreak`),
  and the 30s auto-dismiss are **unchanged**.

## Verification
- `tsc --noEmit` exit 0; `vite build` clean.
- Eyes-on (Nick, mid-session — rebuild quits the app): trigger the break prompt
  → green CTA + cup icon, "+5 min · Skip" legible; light + dark both readable;
  the three actions still fire (start / snooze / skip).
