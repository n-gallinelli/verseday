# Plan — Decompress the PiP break prompt (grow the shared PiP window)

**Author:** Terse
**Date:** 2026-06-17
**Status:** PENDING Verse review (no code written yet)
**Branch (proposed):** `fix/pip-break-prompt-spacing` (off `build/combined-install`)
**Scope:** Presentational + a shared window-dimension change. No logic, store, flag, or DDL.

---

## Problem

The break prompt (`src/components/FocusPip.tsx:537`) feels cramped: the green "Start break"
button hugs the top border and "+5 min · Skip" hugs the bottom. Measured, the content
(`py-1.5` container + `py-1` button + `gap-1.5` + sub-row) already fills ~54 of the 58px box,
so there is only ~4px of slack to redistribute. Real breathing room requires a taller box.

Nick chose **grow the PiP window** (accepting that it affects all phases).

## Key facts that make this safe

- **Single source of truth.** Window dimensions live in `src/utils/pipEvents.ts`
  (`PIP_SIZE`, `PIP_SIZE_LARGE`, `pipSizeFor`). Both the create-size (`FocusMode.tsx:491`)
  and the live pin (`FocusPip.tsx:225`) derive from it. Changing the constants propagates
  everywhere; no other file hardcodes the size, and the pip window is created at runtime
  (`new WebviewWindow`), so there is **no `tauri.conf.json` / Rust change**.
- **Every phase centers in the box** via `h-full` + `justify-center` / `items-center`
  (completing :468, ack :509, prompt :539, running :627). A taller box simply gives each
  more centered breathing room — none are top-anchored, so none clip or misalign.
- **Off-screen clamp is size-agnostic.** It reads the *live* `win.outerSize()` at clamp time
  (`FocusPip.tsx:251`), so a taller window is clamped correctly with no constant to update.
- **High-vis ring halo** is the one thing to preserve (see math below).

## Proposed change

### 1. `src/utils/pipEvents.ts` — grow height only (width unchanged)
- `PIP_SIZE`:       `{ width: 220, height: 58 }` → `{ width: 220, height: 66 }`  (+8)
- `PIP_SIZE_LARGE`: `{ width: 300, height: 88 }` → `{ width: 300, height: 100 }` (+12)

**High-vis halo math (must stay ≥ ring spread):** the base box is rendered at `zoom 1.3`.
- Today: box 58·1.3 = 75.4 zoomed; window 88 → 12.6px vertical halo (6.3/side).
- New:   box 66·1.3 = 85.8 zoomed; window 100 → 14.2px vertical halo (7.1/side).
- Ring is `0 0 0 2px` → 2.6px under zoom. 7.1 > 2.6 ✓ (ring stays un-clipped).
- Width/horizontal halo unchanged (286 zoomed in 300 → 7px/side ✓).

### 2. `src/components/FocusPip.tsx` — spend the new room intentionally on the prompt
- Start-break button (:551): `py-1` → `py-1.5`.
- Prompt container (:540): `gap-1.5` → `gap-2`.
- Leave the other phases' inner classes untouched — they recenter automatically in the
  taller box.

### 3. Comments
- Update the "220×58" / "fit to 220×58" references (FocusPip `:407`, `:526`, and any in
  `pipEvents.ts`) to the new base height so the height-math comments stay accurate.

## Risk / blast radius

- **All PiP phases grow** (running, paused, completing, ack, prompt). Reviewed: all are
  vertically centered, so the change reads as more breathing room, not breakage. Needs
  eyes-on across phases, not just the prompt.
- **Window resize is the create-size** (FocusMode owns it) — no shrink-then-grow flicker
  since the constant is shared and pinned identically.
- No interaction with the canonical session / time-entry source of truth.

## Self-validation

- `tsc --noEmit` clean → `tauri build --debug` clean.
- `grep` for stray `58` / `88` / `220` / `300` literals to confirm none are an
  independent copy of the window size.
- **Eyes-on (the real check):** open focus, cycle phases — running clock, take a break →
  prompt, completion — and confirm (a) no clipping, (b) prompt no longer cramped,
  (c) high-vis ring still crisp and un-clipped on all four sides.

## Out of scope
- No width change. No new Settings toggle. No phase-specific window sizing (the deliberate
  "one fixed size, never resize between phases" discipline is preserved — we just move the
  single size up).
