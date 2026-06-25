# QuickAdd — open on the cursor's monitor + project-button focus feedback

**Date:** 2026-06-16
**Author:** Terse
**Status:** PENDING Verse review — no code written yet
**Branch:** `feat/quickadd-monitor-and-focus-feedback` (off main @ b21c434)

## Context

Two follow-up asks on the QuickAdd bar (now live):

1. **Multi-monitor:** QuickAdd always opens on the primary display. It should
   open on the monitor the user is working on. Today the global-shortcut handler
   (`src/App.tsx:145`) calls `await win.center()`, which centers on the primary
   display — there's no monitor/cursor detection.
2. **Focus feedback:** when the user Tabs from the title input into the project
   picker, the dropdown opens and focus moves to the first option, but the
   project **toggle button** gives no visual cue. It should show a little
   shading/effect so it's clear focus is now "on the projects."

The Tauri JS API (v2.10.1) already exposes everything needed for #1 —
`cursorPosition()`, `monitorFromPoint(x, y)`, `currentMonitor()`,
`primaryMonitor()` — so the fix is **pure JS in App.tsx, no Rust**.

## Decision (stated, not asked)

"Focused screen" = **the monitor under the cursor** when the shortcut fires.
This is the standard launcher behavior (Spotlight / Alfred / Raycast) and the
robust signal: your cursor is on the screen you're working on when you hit
⌘⇧A. The alternative — the monitor of the frontmost app's window — isn't
reliably available cross-app in Tauri, so cursor-under is the proxy.

## Change 1 — position on the cursor's monitor (`src/App.tsx`)

Replace `await win.center()` in the show branch (~L145) with:

- `const cursor = await cursorPosition();` (physical px, Tauri top-left space)
- `const mon = (await monitorFromPoint(cursor.x, cursor.y)) ?? (await currentMonitor()) ?? (await primaryMonitor());`
- If `mon`: center the window inside that monitor's frame —
  - `const size = await win.outerSize();` (physical)
  - `x = round(mon.position.x + (mon.size.width  - size.width)  / 2)`
  - `y = round(mon.position.y + (mon.size.height - size.height) / 2)`
  - `await win.setPosition(new PhysicalPosition(x, y));`
- Else (all null): `await win.center();` (unchanged fallback).
- Wrap the whole positioning block in try/catch → on any error, `win.center()`,
  so the bar **never fails to appear**.
- Order stays **position → show → setFocus** so the bar is placed while hidden
  and never flashes on the wrong monitor.

Why JS, not Rust: `cursorPosition`, `monitor.position/size`, and `outerSize` are
all in Tauri's **physical-px, top-left** coordinate space, so the centering math
is consistent with no NSEvent Y-flip. (A Rust NSEvent read would be bottom-left
and need flipping — more surface area for a bug.)

Imports to add in App.tsx: `cursorPosition, monitorFromPoint, currentMonitor,
primaryMonitor` from `@tauri-apps/api/window`; `PhysicalPosition` from
`@tauri-apps/api/dpi`.

## Change 2 — project-button focus feedback (`src/pages/QuickAdd.tsx`)

When `showProjectPicker` is true (the state Tab sets), give the project toggle
button an on-brand "active" treatment so there's clear feedback focus is on the
projects — e.g. the app's existing selected-control look: `bg-accent-blue-soft`
+ `border-accent-blue/40` (matches the Settings segmented toggles and the
selected dropdown row). Pure conditional className on the existing button; no
behavior change.

## Risk / review focus
- **Coordinate consistency:** all physical, top-left (cursorPosition + monitor
  frame + outerSize) — centering correct on mixed-DPI multi-monitor.
- **Fallbacks:** `monitorFromPoint` → currentMonitor → primaryMonitor → center();
  whole block try/catch'd to center() so QuickAdd always shows.
- **No flash:** position before `show()`.
- No DB, **no Rust**, no migration, zero cost. Default behavior on a single
  display is unchanged (cursor monitor == primary == same centered result).

## Verification plan
- `tsc` + `eslint` + `vite build` clean.
- Manual multi-monitor: cursor on the external display → ⌘⇧A → bar appears
  centered on that display; repeat with cursor on the built-in display.
- Manual: title input → Tab → project button shows the focus shading while the
  dropdown is open; Esc/Shift+Tab returns and the shading clears.
