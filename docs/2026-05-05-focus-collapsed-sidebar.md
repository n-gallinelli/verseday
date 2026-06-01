# Focus screen — collapsed, expandable sidebar

**Date:** 2026-05-05
**Branch:** `feat/focus-collapsed-sidebar`

## Problem

On the Focus screen (active session), the sidebar was hidden entirely — `App.tsx` early-returned a `fixed inset-0 z-50` `FocusMode` overlay that covered everything. On `FocusLanding` (pre-start) the sidebar was already collapsed to a 64px logo-only rail, but with no way to expand without leaving the screen.

The user wanted:
1. The active focus screen to match the pre-start screen (collapsed rail, not invisible).
2. The collapsed rail to be expandable so they can navigate without exiting focus.

## Decisions

- **One collapsed-rail branch covers both focus pages.** `Sidebar.tsx` now collapses on `currentPage === "focus_landing" || "focus"`.
- **Click-to-toggle expand,** not hover-to-expand. Hover-expand can feel jumpy in an immersive screen; click is intentional.
- **Local state only** (`useState` in `Sidebar`). The expand/collapse preference is per-mount, not persisted — leaving and re-entering focus resets to collapsed, which keeps "focus" as the default posture.
- **Chevron affordance** placed below the logo on the rail, and inline with the wordmark (right-aligned) when expanded — so the toggle lives in the same visual zone in both states.
- **`FocusMode` reflowed** from `fixed inset-0 z-50` to `relative h-full` and routed through the normal `renderPage()` switch in `App.tsx`. This means it now lives inside `<main>` next to the sidebar instead of covering it.

## Files changed

- `src/components/Sidebar.tsx` — added `focusExpanded` state, expand/collapse chevrons, broadened collapse condition.
- `src/pages/FocusMode.tsx` — outer wrapper changed from `fixed inset-0 ... z-50` to `relative h-full`.
- `src/App.tsx` — removed the special-case full-screen early return; added `case "focus"` to `renderPage()`.

## Trade-offs

- The `focus-ambient-bg` animated background no longer covers the whole viewport — only the main content area. The sidebar keeps its own `bg-sidebar` surface. Acceptable: the sidebar is now part of the layout, so giving it a different surface reads correctly.
- The completion-burst overlay and break prompt still sit inside the main area; their positioning is unchanged because they were always `absolute` relative to the FocusMode root, not the viewport.
