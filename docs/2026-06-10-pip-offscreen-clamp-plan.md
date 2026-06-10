# Pip off-screen clamp — fix plan

**Date:** 2026-06-10
**Author:** Terse
**Status:** PLAN — awaiting Verse review (no code written)

## Problem
The focus pip is drag-anywhere (`handlePipMouseDown` → `startDragging`,
FocusPip.tsx:120-124) with **no on-screen clamping**. It can be dragged
off a screen edge and become unreachable — observed live on 2026-06-08,
parked at y = −68 (above the menu bar), invisible and un-grabbable.
Because the live session keeps the SAME pip window alive the whole time,
a pip dragged off-screen stays lost until stop→restart. (Recovered that
day by nudging it back via System Events; this is the durable fix.)

No window-state persistence is involved — each session recreates the pip
at x:20, y:20 (FocusMode.tsx:443-467). This is purely runtime drag
protection.

## Goal
The pip can never be dragged (or otherwise moved) fully off-screen — at
minimum a grabbable strip always stays within the visible work area of
the monitor it's on. In-bounds dragging is unaffected (no jitter).

## Approach options

### Option A (recommended) — JS `onMoved` edge-clamp in FocusPip
The pip webview owns its window, so clamp there:
- Subscribe to `getCurrentWebviewWindow().onMoved(...)`.
- On each move, read the pip's outer position + size and the current
  monitor (`currentMonitor()`; fall back to primary / `availableMonitors`
  if null). Work in **physical pixels** consistently (onMoved gives
  `PhysicalPosition`; monitor gives physical `size` + `scaleFactor`) to
  avoid Retina/multi-monitor drift.
- Compute the clamped position so the whole pip stays inside the monitor
  frame minus a margin, reserving a **top margin for the macOS menu bar**
  (Tauri's JS `Monitor` exposes full `size`/`position`, not the
  menu-bar/dock-excluded work area — see limitation below).
- Call `setPosition` **only when the clamped value differs** from the
  current one. So normal in-bounds dragging never triggers a setPosition
  (no fight/jitter); crossing an edge makes the pip "stick" at the edge.

**Limitation:** without the true work area, the reserved margins are
approximate (e.g. ~28px top for the menu bar, a dock-side guess). The pip
could still be clamped slightly under the menu bar / over the dock — but
never fully off-screen, which is the actual bug.

### Option B — Rust `NSScreen.visibleFrame` clamp
Reuse the existing pip Rust infrastructure (the hover monitor already
reads the pip's `NSWindow.frame()`, commands.rs). Clamp against
`NSScreen.visibleFrame` (the exact menu-bar- and dock-excluded work area)
on the window's move/`windowDidMove`. More correct margins; more native
code + coordinate-system care (AppKit's bottom-left origin vs Tauri's
top-left). Heavier than the bug warrants.

**Recommendation:** Option A. It kills the "lost off-screen" class with
minimal, contained code; the margin approximation is cosmetic. Escalate
to B only if the menu-bar/dock margin proves annoying in use.

## Risks / things to confirm in eyes-on
- **setPosition during an active `startDragging` loop** — does clamping
  mid-drag fight the OS drag or jitter at the edge? If it does, fall back
  to clamping on a short debounce after moves settle (no drag-end event
  exists for startDragging). This is the main thing to watch.
- Multi-monitor: dragging across monitors should clamp to whichever
  monitor the pip is currently on (`currentMonitor()` re-resolves per
  move).
- The clamp must not re-fire endlessly (setPosition → onMoved → clamp).
  Guard by only setting when the target differs from current (idempotent),
  and tolerate a 1px rounding band so a physical-pixel round-trip doesn't
  oscillate.

## Validation
- tsc + build. The geometry (clamp math) can be extracted as a pure fn
  `clampToFrame(pos, size, frame, margins) → pos` and unit-tested
  (off-top, off-left, off-right, off-bottom, in-bounds→unchanged) — the
  testable core, mirroring the day-rollover `nextSelected` approach.
- Eyes-on: drag the pip hard at each edge (and off the top, the original
  failure) — it should stick on-screen, grabbable; in-bounds drag smooth.

## Scope
- macOS only (the only platform that builds this app today).
- No DB / DDL. No deps. Pure window-geometry handling.
