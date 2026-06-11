# Plan — PiP break prompt: warm labeled CTA over icon-only buttons

**Date:** 2026-06-11
**Author:** Terse
**Status:** PENDING Verse review
**Branch (proposed):** `feat/pip-break-prompt-warm-cta`

## Problem (Nick's directive)

The PiP break prompt (`FocusPip.tsx`, `state.phase === "prompt"`) currently
shows three equal-weight icon-only circular buttons:
- 👍 thumbs-up (green `bg-accent-green-deep`) = take the break
- 🕐 clock = snooze 5 min
- ✕ = skip

Two problems:
1. **Thumbs-up is wrong.** Green is off-palette (should pull from the warm
   sunset set), and a thumbs-up reads as a rating ("do you like this?") not an
   action. The action is *start the break* — say that.
2. **Icon-only flattens hierarchy.** Three bare glyphs make the user decode
   clock=snooze, ✕=skip, and all three read as equal-weight circles. The
   expected action (take the break) should visually dominate.

## Fix (action-over-state hierarchy)

- **Primary:** filled, **labeled** button in warm accent — **"Start break"**,
  `bg-accent-orange text-white hover:bg-accent-orange-hover`. Own row, dominant.
- **Secondary:** **"5 more minutes"** as a plain text link
  (`text-fg-secondary hover:text-fg`).
- **Tertiary:** **"Skip"** as a quieter text link
  (`text-fg-faded hover:text-fg-secondary`).

The two text links share one centered row beneath the button.

### Proposed layout (220×58 pip)

```
┌──────────────────────────────┐
│      ▟ Start break ▙          │   ← filled orange, white text (hero)
│   5 more minutes    Skip      │   ← plain link · quieter link
└──────────────────────────────┘
```

**Header dropped.** The old "Ready for a break?" line is removed — the labeled
primary now carries the meaning, and dropping it frees vertical room so the CTA
can dominate within the 220×58 footprint. (Alternative: keep a tiny header and
put the button + links on one row — rejected as too cramped at this width.)

## Changes (all in `src/components/FocusPip.tsx`)

1. Replace the `state.phase === "prompt"` block (≈484–528): icon row → filled
   orange "Start break" button on top, "5 more minutes" + "Skip" text links
   below. Keep `data-tauri-drag-region`, `PIP_BG`, border/shadow wrapper.
2. **Handlers unchanged:** primary → `sendCommand("takeBreak")`; "5 more
   minutes" → `flashAck("5 more minutes", "snooze5")`; "Skip" →
   `flashAck("Break skipped", "noBreak")`. Keep `title`/`aria-label` for a11y.
3. **Remove dead code:** `ThumbsUpIcon`, `ClockIcon`, `CloseIcon` (lines 54–108)
   — used only in this block (grep-confirmed, no other usages anywhere in src/).

## Color spec (FINAL — Verse-corrected for WCAG 1.4.3)

The labeled button carries text, so 4.5:1 normal-text contrast applies. The
theme token `--accent-orange` swaps to the lighter `#d68647` in dark mode →
white-on-that ≈ 2.9:1, FAILS. So the fill is **pinned to a single deep orange
in both themes** (not the swapping token):

| | Fill | Hover fill | Text | White-on-fill contrast |
|---|---|---|---|---|
| Light | `#A85E1E` | `#94511A` | `#FFFFFF` | ~4.9:1 ✓ |
| Dark  | `#A85E1E` | `#94511A` | `#FFFFFF` | ~4.9:1 ✓ |

Implementation: pinned via Tailwind arbitrary values
`bg-[#A85E1E] hover:bg-[#94511A] text-white` so it does NOT swap by theme. A
deep burnt-orange still reads as the warm primary on both light and dark pip
backgrounds. No white-on-bright-orange anywhere.

## Out of scope

- The **full-screen** `BreakCelebration` ("Rest now", `bg-accent-green-deep`) in
  `FocusMode.tsx` has the same off-palette-green primary. Nick's directive named
  the **pip** only — leaving it untouched here and flagging it as a sibling
  follow-up rather than widening scope.

## Verification (per `feedback_self_validate`)

- `tsc --noEmit` + `npm run build` clean.
- grep: no remaining references to the removed icon components.
- Confirm the three handlers/flashAck keys (`snooze5`, `noBreak`, `takeBreak`)
  are preserved exactly.

## Cost / security

No DB, no DDL, no external calls, no credentials. $0. Presentation-only.
