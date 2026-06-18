# Plan — Completion-feedback toggle, daily burst timing, same-day PiP position

Date: 2026-06-18
Branch: feat/chime-cleanup-followups (continues prior auto-close work)
Author: Terse
Status: AWAITING Verse pre-code review + Nick approval

Three independent UI asks. No DDL — all persistence reuses the existing
`settings` table (`getSetting`/`setSetting`). Nothing costs money.

---

## 1. Setting: cross out completed tasks (on/off)

**Scope (confirmed with Nick):** the toggle controls the *strikethrough only*.
When OFF, completed tasks keep the green check, glow, and faded text but the
`line-through` line is not drawn. Applies to BOTH surfaces:
- `TaskDetailOverlay.tsx` title (line ~800)
- `TaskCard.tsx` daily row (line ~327)

**Default:** ON (current behavior), so nothing changes until Nick flips it.

**Storage:** new key `ui.strikethrough_completed` = `"1"`/`"0"`.

**Plumbing (no cross-webview events needed — both consumers live in the main
window):**
- Add `strikethroughCompleted: boolean` to the app store (zustand), default
  `true`, plus a `setStrikethroughCompleted(v)` action that persists via
  `setSetting` and updates the store.
- Load the value once on app boot alongside the other settings reads.
- `TaskCard` and `TaskDetailOverlay` read `useAppStore(s => s.strikethroughCompleted)`
  and gate the `line-through` class on it. Reactive automatically — no event bus.
- Helper `getStrikethroughCompleted()/setStrikethroughCompleted()` in a small new
  `src/utils/uiSettings.ts` (keeps `focusSettings.ts` focus-scoped).

**Settings UI:** add one toggle row in `pages/Settings.tsx` using the exact
two-button pattern already used by "High-visibility focus timer":
> **Cross out completed tasks** — "Draw a line through finished tasks" / "Leave
> finished tasks un-struck (still checked + faded)".

---

## 2. Daily-page completion burst — ease slightly slower

The circle-click feedback on the daily list is the green ring `taskDoneBurst`
(`index.css`, currently `500ms`). Bump to **650ms** (same easing). This is the
daily-row-only animation, so the detail overlay is unaffected. The shared
`animate-check-draw` (200ms) is intentionally LEFT ALONE so it doesn't also slow
the detail overlay's checkmark.

Single-line CSS change.

---

## 3. PiP position — default on a new day, persist within the same day

**Today's behavior:** the pip window is swept-and-recreated at hardcoded
`x:20, y:20` every time it opens (acknowledged TODO in `FocusMode.tsx`). So
completing a task / hiding+reopening loses the drag position.

**Desired:**
- Same logical day → reopen at the last dragged position.
- New logical day → back to the default spot.

"Logical day" uses `logicalDayIso()` (3am boundary), matching the app's existing
day-rollover semantics.

**Storage:** key `pip.position` = `{"x":<physical>,"y":<physical>,"day":"<logicalDayIso>"}`.

**Where the save happens — main window, not the pip.** The pip webview's DB/sql
capability isn't guaranteed, and the app already uses Tauri events for
cross-webview sync (QuickAdd precedent). So:
- `FocusPip.tsx` `clampNow()` already computes the settled, clamped *physical*
  position on every `onMoved`/`onResized`. After it settles, `emit("verseday:pip-moved", {x, y})`.
- `FocusMode.tsx` (main window) listens for `verseday:pip-moved` and calls
  `savePipPosition(x, y)` → `setSetting("pip.position", {x, y, day: logicalDayIso()})`.

**Where the restore happens — pip creation in `FocusMode.tsx`:**
- Before creating the window, `getPipPosition()` reads the key, parses it, and
  returns `{x, y}` only if `day === logicalDayIso()` now; otherwise `null`.
- If a same-day position exists: create the window with `visible:false`, then
  `setPosition(new PhysicalPosition(x, y))`, then `show()` — avoids a flash at
  the default spot. If `null`: keep the current `x:20, y:20` default path
  unchanged.

**Unit safety:** the saved value is read from `win.outerPosition()` (physical)
and restored via `PhysicalPosition` — fully self-consistent regardless of the
create-option unit ambiguity, because the default path is never round-tripped
through storage.

**Known edge (acceptable):** a stored position is clamped to the monitor it was
saved on; if the display config changes mid-day the restored point could land
oddly, but `clampToFrame` fails safe and the next drag re-clamps. Not handling
cross-monitor re-clamp at restore time in this pass.

Helpers `getPipPosition()/savePipPosition()` live in `src/utils/focusSettings.ts`
(pip-scoped, fits the existing pip helpers there).

---

## Verification (self-validate per standing discipline)

- `tsc --noEmit` clean.
- `npm run tauri build` succeeds (signed).
- Grep to confirm both strikethrough sites are gated on the store value.
- Eyes-on after install: toggle off → complete a task (no line, still checked);
  daily burst feels slightly slower; drag pip, complete a task, reopen → same
  spot; next day → default spot.

## Out of scope
- No change to the auto-close-on-completion behavior shipped at 2847db3.
- No change to check-draw or completion-glow timing.
- No cross-monitor re-clamp on restore.
