# QuickAdd — Tab-to-dropdown, tooltip contrast, refocus-after-select

**Date:** 2026-06-16
**Author:** Terse
**Status:** PENDING Verse review — no code written yet
**Branch:** TBD (feature branch off `main`, never `main` directly)

## Context

Three friction points in the global Quick-Add bar (`src/pages/QuickAdd.tsx`, its own
Tauri webview). The visible card sits inside a larger transparent window, so the
objective-name tooltip can float out over the main app showing through behind it.

Current behavior:
- `handleKeyDown` (QuickAdd.tsx:226–241) handles only **Enter** (submit) and **Esc**
  (close dropdown / dismiss). No **Tab** handling.
- Selecting a project (QuickAdd.tsx:447–474) sets `projectId` and closes the dropdown
  but **returns focus to nothing** — the user must click back into the title input to
  press Enter.
- The full-name tooltip is the shared `useObjectiveNameTooltip` hook
  (`src/components/useObjectiveNameTooltip.tsx`): `bg-elevated`, `0.5px` soft border,
  light `--shadow-card`. Over busy content behind the transparent window it lacks
  separation and reads poorly.

## Scope (this pass)

Three changes. Item 3 is **B only** (refocus the input) — auto-submit-on-select and a
visible Add button were considered and **deferred** (auto-submit is error-prone: a stray
click picks the wrong project and instantly creates a task with no chance to set an
estimate or fix a typo).

### 1. Tab moves focus from the title input into the project dropdown

- Add a `Tab` branch to `handleKeyDown`: when the picker is closed and the title input
  has focus, `e.preventDefault()`, open the picker (`setShowProjectPicker(true)`), and
  move focus to the first option.
- In-dropdown keyboard nav (makes the opened list usable):
  - **↑ / ↓** move focus between option buttons.
  - **Enter** selects the focused option (native button activation; reuses the existing
    onClick → also triggers item 3's refocus).
  - **Esc** or **Shift+Tab** closes the picker and returns focus to the title input.
- Implementation notes: focus the first option via a `useEffect` keyed on
  `showProjectPicker` becoming true *through the keyboard path* (guard so mouse-open
  doesn't steal focus), or by querying the first `button` inside `projectPickerRef`.
  Arrow handling lives on the dropdown container's `onKeyDown`.

**Files:** `src/pages/QuickAdd.tsx` only. No shared-component impact.

### 2. Tooltip contrast / readability

Goal is stronger separation, not a new color. In `useObjectiveNameTooltip.tsx`
(lines 76–84):
- Heavier shadow: `--shadow-card` → `--shadow-modal`.
- More defined border: `0.5px ... border-soft` → `1px` solid `--border-strong`
  (or equivalent defined line token).
- Add `backdrop-blur` so the panel reads cleanly over whatever shows through.
- Keep `bg-elevated` (already the panel surface); ensure it's fully opaque.

**Shared-component caveat (for Verse):** this hook is also used by the TaskDetailOverlay
objective picker (via ProjectPicker). The change lands in **both** surfaces. The
improvement is universally beneficial (better contrast never hurts), so we propose
changing it in place rather than forking a QuickAdd-only variant — but flagging it
explicitly since it's not QuickAdd-isolated.

**Files:** `src/components/useObjectiveNameTooltip.tsx` (shared).

### 3. (B) Return focus to the title input after selecting a project

- After any pick — both "No project" (QuickAdd.tsx:447) and each project option
  (QuickAdd.tsx:459) — refocus the title input so the bar is always "one Enter away
  from adding."
- Use a **cursor-at-end** focus, *not* the existing `focusTitle()` which calls
  `el.select()` (select-all would risk overtyping). Add a small variant
  (`focusTitleAtEnd`, or a param on `focusTitle` to skip `select()`).
- **Blur-dismiss interaction (for Verse):** selecting a project blurs the input then
  refocuses it. The window has a 450ms blur-dismiss grace period (`armBlurDismiss`),
  and focus stays within the same webview, so this should not trip dismissal — but we'll
  verify the refocus fires synchronously / next-frame and does not close the window.

**Files:** `src/pages/QuickAdd.tsx` only.

## Out of scope / deferred
- Auto-submit on project select (rejected — error-prone).
- Visible "Add" button for the mouse-only flow (deferred; revisit if B alone isn't
  enough for the mouse path).

## Risk / review focus
- **Shared tooltip** (item 2) touches TaskDetailOverlay — intentional, flagged above.
- **Focus management** (items 1 & 3) interacts with the webview's existing
  retry-based focus + blur-dismiss grace logic; no regressions to cold-start focus or
  window dismissal.
- No DB, no migrations, no schema, no money. Pure front-end / no-cost.

## Verification plan
- `tsc` + build clean.
- Code-review the focus/keydown changes against the existing focus + blur-dismiss logic.
- Manual: type → Tab opens dropdown + focuses first item → ↑/↓ navigate → Enter selects
  → focus returns to input → Enter adds. Confirm tooltip readability over the main
  window. Confirm window doesn't dismiss on select.
