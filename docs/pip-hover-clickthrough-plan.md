# Plan — PiP hover + click without focus

**Author:** Terse · **Status:** AWAITING VERSE REVIEW · **Date:** 2026-06-05
**Branch (when approved):** `feat/pip-unfocused-interaction` (not started — plan first)

## Goal (Nick's words)

> Hovering over the pip — even when it is NOT the focused window — should expand
> the buttons. And clicking those buttons while the pip is unfocused should still
> work, without a click-to-focus-first.

## What already exists (so we don't re-invent it)

1. **Global hover monitor** — `commands.rs › mod pip_hover`. An `NSEvent`
   `addGlobalMonitorForEventsMatchingMask:` (mouseMoved) reads the pip's
   `NSWindow.frame()` inline on each fire, intersects with the cursor, and emits
   edge-triggered `pip-hover {over}` events. JS (`FocusPip.tsx`) ORs that into
   `externallyHovered → expanded`.
2. **`acceptFirstMouse: true`** is already passed to `new WebviewWindow("focus-pip", …)`
   in `FocusMode.tsx`.
3. **`setAcceptsMouseMovedEvents: true`** is already set on the pip NSWindow at
   monitor start.

## Why it still doesn't work — two root causes

### RC-1 — the global monitor is blind while VerseDay is frontmost
`addGlobalMonitorForEventsMatchingMask:` **only fires for events delivered to
*other* applications.** When VerseDay's main window is the frontmost app (the
common case — Nick is looking at the app), mouseMoved routes to *us*, the global
monitor never fires, and the pip (not being key) gets no DOM `:hover` either. Net:
hovering the pip while the main window is focused never sets `expanded`.

This exact gap is documented as a deliberate "don't" in `FocusPip.tsx`
(the LOCAL-monitor note). Nick is now explicitly asking us to close it.

### RC-2 — the fan-out icons are non-interactive until `expanded`
In `FocusPip.tsx` the icon strip is `pointerEvents: expanded ? "auto" : "none"`.
So even with `acceptFirstMouse` correctly delivering the first click, the icons
**cannot** receive it while collapsed. Fixing RC-1 (so `expanded` actually turns
on when unfocused) is therefore a prerequisite for the click requirement, not a
separate feature. The always-visible pause/play button is NOT pointer-gated, so it
is the one control that should already click-through today — a good probe.

## Proposed change

### Part A — close the hover gap (RC-1): add a LOCAL NSEvent monitor
Add `addLocalMonitorForEventsMatchingMask:` (same `NSEventMaskMouseMoved`)
alongside the existing global one, running the **identical** frame-intersection +
edge-trigger logic, emitting the same `pip-hover {over}` event. Local fires for
events bound for *our own* windows (i.e. while VerseDay is frontmost); global
keeps covering the cross-app case. Together they cover every focus state.

- Local monitor handler must **return the event** (`-> id`), not nil, or it
  swallows mouseMoved for the whole app. (Global handlers return void; local
  handlers return the event.)
- Reuse the exact intersection/edge code — factor it into one closure both
  monitors call so the two can't drift.
- Store the local monitor handle in `Entry` next to `monitor_handle_ptr`; remove
  it in `stop()` (it's a separate `removeMonitor:` + `release`).
- Keep the existing retain/forget block lifetime discipline.

JS side: no change needed — `externallyHovered` already drives `expanded`, and the
existing `onMouseLeave` + Rust `over:false` edge already handle retraction.

### Part B — make the first click actually land (RC-2)
1. **First**, ship Part A and re-test. With `expanded` firing on unfocused hover,
   the icons flip to `pointerEvents:auto`, and the already-present
   `acceptFirstMouse:true` may be sufficient to deliver the click. **Probe before
   adding native click code:** does the always-on pause button click-through from
   another app today? If yes, `acceptFirstMouse` is working at the WKWebView level
   and Part A alone finishes the job.
2. **Only if the probe shows the click is still swallowed**, the cause is that the
   first-mouse responder is WKWebView's internal content view, which returns NO for
   `acceptsFirstMouse:` regardless of wry's container-level flag. Fix by
   **method-swizzling `-[WKWebView acceptsFirstMouse:]` to return YES**, installed
   once on the main thread (same pattern/discipline as the existing `pip_hover`
   objc2 code).
   - Trade-off for Verse: swizzling the base `WKWebView` method is **process-wide**
     — it also affects the main window's webview (first click anywhere activates a
     control instead of just focusing the window). This is benign-to-desirable for
     a productivity app, but it IS a behavior change to the main window. The scoped
     alternative (runtime subclass + `object_setClass` on only the pip's WKWebView)
     is rejected: WKWebView already lives under a KVO dynamic subclass, and
     re-`object_setClass`-ing it risks breaking that. Swizzling the method is the
     lower-risk choice.

## Explicitly out of scope (flagging, not doing)
- **Non-activating NSPanel** (so clicking the pip never steals focus from the
  user's other app). Nick asked for "clickable," not "never steals focus." This
  would need the `tauri-nspanel` plugin (a new dependency) or NSWindow class
  swizzling. Deferred unless Verse wants focus-preservation in scope now.
- Fullscreen-Space float (separate known follow-up, already noted in FocusMode).

## Blast radius / risk
- **No DB, no migration, no schema. No new npm/cargo dependency** (Part A + the
  swizzle use objc2 already in the tree). **No runtime cost** ($0).
- New native surface: one extra NSEvent monitor (Part A) and, conditionally, one
  method swizzle (Part B). Both confined to existing `mod pip_hover` patterns
  (main-thread, retain/forget, edge-trigger).
- Behavior change to the main window IF Part B swizzle is needed (see trade-off).
- Reversible: local monitor removed in `stop()`; swizzle is a single install site.

## Verify (no manual-UI-marathon — per standing self-validate pref)
- `cargo build` + `tsc` + `vite build` clean.
- Probe matrix, eyes-on (small, targeted): (a) Chrome frontmost → hover pip →
  expands; (b) VerseDay main window frontmost → hover pip → expands [the RC-1 fix];
  (c) from each of the above, click a fan-out icon (e.g. complete / break) on the
  FIRST click without pre-focusing → fires; (d) pause/play click-through probe.
- Retraction still fires on context-switch + real mouseLeave (no stuck-expanded).

## Open question for Verse (one)
Do you want focus-preservation (non-activating panel) **in scope now**, or is
"buttons are clickable while unfocused" (which may still briefly key the pip on
click) acceptable for v1? This is the only fork that changes dependency footprint.
