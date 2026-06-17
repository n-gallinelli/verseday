# Plan — Task card layout fix in narrow Objective-detail window

**Author:** Terse
**Date:** 2026-06-17
**Status:** PENDING Verse review (no code written yet)
**Branch (proposed):** `fix/task-card-narrow-window` (cut from `build/combined-install`)
**Scope:** Presentational only — two className edits, no logic, no flag, no migration.

---

## Problem

In the Objective-detail view (`src/pages/ProjectDetail.tsx`, `SortableTaskRow`), when the
window/panel is narrow the task card degrades badly:

1. **Title wraps one word per line** (e.g. "Review / Sara / Sales / PRD").
2. **The ESTIMATE pill is clipped** off the right edge of the card.

### Root cause

Two flex children compete with the title for horizontal space and neither yields:

- **Hover-actions block (line 348)** uses `opacity-0` (still in layout) + `flex-shrink-0`,
  so the Start/Delete buttons permanently reserve ~90px of the title row even while invisible.
  The title is `flex-1 min-w-0`, so it gets `wrapperWidth − ~90px`. In a narrow card that
  leaves ~40–50px → one word per line.
- **Metadata row (line 382)** is `flex items-center gap-3` holding a 110px date pill plus two
  100px pills, all `flex-shrink-0`, **no wrap** — ~330px that cannot compress, so the third
  pill overflows and is clipped.

---

## Proposed change

### 1. Reclaim title width from the hidden actions
- Card container (line 296): add `relative`.
- Actions block (line 348): change from in-flow `flex-shrink-0` to
  `absolute top-3 right-3` so it overlays the card's top-right on hover instead of
  consuming title width. The title row then spans the full content width.
- Keep `opacity-0 group-hover:opacity-100` hover behavior unchanged.

### 2. Let metadata pills wrap instead of clipping
- Metadata row (line 382): add `flex-wrap` and `gap-y-2`. In a narrow card the
  worked/estimate pair drops to a second line rather than overflowing.

### 3. (Optional, ask Verse) Hard floor on panel width
- Left task panel: add `min-w-[220px]` so the card can never collapse to an absurd width.
  Listed as optional — items 1 & 2 fix the reported symptoms on their own.

No other components touched. `line-clamp-2` already caps the title at two lines.

---

## Risk / blast radius

- Purely visual; `SortableTaskRow` is the only render path affected.
- Absolute-positioning the actions: must verify it does **not** overlap the title text on a
  hovered card with a long 2-line title, and does not sit over the metadata pills (the
  original in-flow placement was chosen specifically to avoid that overlap — see the code
  comment at line 329). Top-right anchor + `top-3 right-3` keeps it on the title's line.
- Drag-and-drop (`@dnd-kit`) handlers on the buttons (`onMouseDown`/`onPointerDown` stop
  propagation) are unchanged; absolute positioning does not affect them.

## Self-validation (per standing discipline — no manual UI ask unless needed)

- `tsc --noEmit` clean.
- `tauri build --debug` succeeds (dev is broken on macOS 26; preview via the .app bundle).
- Grep to confirm no other component duplicates this task-card markup.
- Eyes-on: resize the window narrow and confirm (a) title wraps normally to ≤2 lines,
  (b) all three pills visible/wrapped, (c) hover actions appear top-right without overlap.

## Out of scope

- No DDL / migration.
- No change to task data, store, or canonical reconciliation.
- No change to the right-hand DATES / NOTES / "This week" panel.
