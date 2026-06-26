# Plan: Focus screen — scroll notes that go below the fold

**Date:** 2026-06-26
**Author:** Terse
**Status:** Awaiting Verse review (no code written)

## Problem

On the full-screen Focus surface, when a task's notes are long enough to run past
the bottom of the viewport, there is no way to scroll to read the rest. The
content below the fold is simply clipped and unreachable (see the "Best-practice
guardrails…" heading cut off at the screen bottom in the report).

## Root cause

The Focus layout in `src/pages/FocusMode.tsx` is a fixed full-viewport surface
whose only height-bounded ancestor has `overflow-hidden`, and **no descendant
opts back into scrolling**:

| Level | File / line | Classes | Role |
|---|---|---|---|
| 1 — outer backdrop | `FocusMode.tsx:1756` | `fixed inset-0 flex flex-col items-center overflow-hidden` | 100vh, clips everything |
| 2 — tunnel-in wrapper | `FocusMode.tsx:1804` | `w-full h-full flex flex-col items-center pt-[24vh] animate-focus-tunnel-in` | 100vh tall, top-anchored, **no overflow** |
| 3 — content column | `FocusMode.tsx:1850` | `w-full max-w-[900px] px-12 flex flex-col items-center` | logo + title/timer row + hr + notes |
| 4 — notes | `FocusMode.tsx:2090` | `RichTextEditor … min-h-[240px]` | grows with content, **no overflow** |

The composition is top-anchored at `pt-[24vh]`, so once the column's natural
height exceeds `100vh − 24vh` the overflow spills past Level 2's `h-full` box and
is hidden by Level 1's `overflow-hidden`. Nothing in the chain is a scroll
container, so the wheel/trackpad has nothing to scroll.

Confirmed **not** a global cause: `body`/`html`/`#root` have no `overflow:hidden`
(`src/index.css`); the webkit scrollbar styling in `index.css` already expects
scroll regions to exist. The defect is local to this layout.

## Proposed fix (minimal)

Make the **tunnel-in wrapper (Level 2)** the scroll container. The whole
composition (logo → title/timer → notes) scrolls as one unit, which matches the
existing top-anchored design — the timer stays glued to the title row exactly as
today, the page just becomes scrollable when the notes outgrow the viewport.

`FocusMode.tsx:1804`, change:

```diff
- <div key={zoomKey} className="relative z-[1] w-full h-full flex flex-col items-center pt-[24vh] animate-focus-tunnel-in">
+ <div key={zoomKey} className="relative z-[1] w-full h-full overflow-y-auto overscroll-contain flex flex-col items-center pt-[24vh] pb-24 animate-focus-tunnel-in">
```

Two additions beyond `overflow-y-auto`:
- **`pb-24`** — breathing room so the last line of notes never hugs the screen
  edge when scrolled to the bottom (consistent with our bottom-padding habit).
- **`overscroll-contain`** — keeps the scroll from chaining to the parent /
  rubber-banding the whole window.

### Why this is safe

- **Chrome stays pinned.** The "Still timing X" banner (`:1761`, `absolute
  bottom-6`) and "Show mini timer" button (`:1786`, `absolute top-4 right-4`) are
  siblings on Level 1, *outside* the scroll container — they stay fixed, not
  scrolled away.
- **Break / celebration branches unaffected.** `BreakCelebration` and
  `BreakScreen` are centered compositions that fit on screen; an
  `overflow-y-auto` parent with content shorter than the box shows no scrollbar
  and behaves identically.
- **No top-clip flex bug.** `items-center` is cross-axis (horizontal) only;
  vertical stacking is `flex-start`, so overflow grows downward and is fully
  reachable — none of the "centered child clipped at the top" failure mode.
- **Animation.** `animate-focus-tunnel-in` is a one-shot scale/opacity keyframe;
  `overflow-y-auto` on the same element is fine once it settles, and there's no
  scrollable overflow during the brief mount animation anyway.

### Scrollbar aesthetics

The surface is intentionally zen. Existing `index.css` webkit scrollbar styling
applies; if the thin track still reads as noise on this clean surface we can fall
back to an auto-hiding overlay scrollbar, but I'd ship the default first and only
add that if it looks wrong on eyes-on.

## Alternatives considered (not recommended)

- **Scroll only the notes region (Level 4).** Would require a
  `max-h-[calc(100vh − …)]` tied to the variable title/timer height above it —
  fragile (title wraps to 1–4 lines), and produces a second nested scroll area.
  Rejected for brittleness.
- **Sticky timer while notes scroll.** Possible (make the title/timer row
  `sticky top-0`), but it's a behavior change beyond the reported bug and fights
  the top-anchored composition. Out of scope unless requested.

## Scope / risk

- One-line className change in `FocusMode.tsx`. No new deps, no state, no IPC, no
  DB/migration. Nothing that costs money to run.
- Atomic and trivially revertible (single commit, no flag needed).
- Branch: new feature branch off `main`, not `main` directly.

## Verification plan

- `tsc` + `tauri build --debug` (dev is broken on macOS 26 — preview via the
  `.app` bundle).
- Eyes-on: open Focus on a task with long notes → confirm scroll reaches the
  bottom with `pb-24` gap; confirm "Still timing" banner / "Show mini timer" stay
  pinned; confirm a short-notes task shows no scrollbar; confirm break screen
  unaffected.
