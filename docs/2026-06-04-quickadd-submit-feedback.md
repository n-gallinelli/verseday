# QuickAdd submit feedback

**Date:** 2026-06-04
**Branch:** `feat/quickadd-submit-feedback`
**Author:** Terse
**Status:** APPROVED by Verse 2026-06-04. Applied both optional suggestions:
600ms (was 520ms, so the drawn check breathes) + timer id stashed in a ref and
cleared in `resetFields`.

## Problem

Pressing Enter in the global quick-add bar created the task and **instantly
dismissed the window** (`QuickAdd.tsx` — `handleSubmit` called `hideWindow()`
immediately after the `verseday:task-created` emit). The bar just blinked away
with zero acknowledgement that anything happened.

## Change (`src/pages/QuickAdd.tsx`, one file)

A brief success flash before dismiss:

- New `submitted` state (cleared in `resetFields`, so every re-show is fresh).
- On a successful create + emit, instead of dismissing immediately:
  `setSubmitted(true)` then `setTimeout(hideWindow, 600)`.
- While `submitted`, the input bar swaps to a centered green checkmark +
  "Task added", with a pop-in + checkmark-draw CSS animation. The success
  state matches the input bar's `px-5 py-4` height so there's no layout jump.

## Why it's safe

- `submitting` stays `true` through the flash, so a second Enter can't re-fire
  `handleSubmit` during the 600ms window.
- The quick-add window is **hidden, not destroyed**, on dismiss — the component
  stays mounted, so the `setTimeout` always runs to completion. Its id is stashed
  in `flashTimerRef` and cleared in `resetFields`, so a re-show (`onFocusChanged`)
  can't be yanked closed by a stale timer from the previous add.
- `dismiss_quick_add` is idempotent (plain hide), so even a manual dismiss
  mid-flash followed by the timer firing is a harmless no-op.

## Scope / non-changes

- One file. No store/DB/IPC changes. No DDL, no migration, no cost.
- Task-creation path, smart time parsing, and cross-webview
  `verseday:task-created` emit are unchanged.
- Color tokens (`--accent-green`, `bg-accent-green/15`) already exist; the
  opacity-modifier form is used elsewhere in the app.

## Verification

- `tsc --noEmit` clean; `npm run build` clean (pre-existing chunk-size advisory
  only). No unit test — purely presentational, no extractable pure logic.
- Manual: `⌘⇧A` → type a task → Enter → green "Task added" flash → window
  dismisses; the task appears in today's Daily Plan.
