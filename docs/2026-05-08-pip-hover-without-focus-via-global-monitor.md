# PiP hover-without-focus — global cursor monitor + Tauri event bridge

**Status:** Design heads-up — pending Verse review
**Branch:** `fix/pip-hover-without-focus`
**Author:** Terse
**Date:** 2026-05-08

## Background

Goal: when the focus pip is visible but the user is in another app, bringing
the cursor over the pip should fan out the icons immediately — no click
required. The user should be able to hover-and-click in one motion.

## Why the previous approach failed

Three commits chipped at this from inside the WKWebView event-dispatch
constraint:

- `5354c03` — `setAcceptsMouseMovedEvents:YES` on the NSWindow + `acceptFirstMouse:true`
- `44bea9b` — diagnostic instrumentation
- `23d8007` — install an `NSTrackingArea` on the WKWebView (after the
  contentView attempt failed)

None of them dispatched DOM `mouseenter` to JS reliably when the pip's
window wasn't key. The most recent attempt (`23d8007`) fired DOM
`mouseenter` once but never `mouseleave` — leaving React's `expanded`
state stuck `true` (icons frozen visible). All three reverted.

The OS-level reality: WKWebView's DOM hover dispatch is gated on the
window being active. Setting properties and adding tracking areas
doesn't open that gate. We were patching around an architectural
constraint and breaking other things in the process.

## New approach — bypass DOM hover entirely

Don't try to make WKWebView dispatch hover events when its window
isn't key. Detect cursor position **outside** the WebView and tell JS
what to render via a Tauri event.

### Architecture

1. **Rust — global mouse monitor.** On pip creation, register
   `NSEvent.addGlobalMonitorForEventsMatchingMask:` with
   `NSEventMaskMouseMoved`. Global monitors fire for cursor movement
   anywhere on the screen, regardless of which app is frontmost. No
   accessibility permission needed for monitoring (only for modifying)
   events.

2. **Rust — geometry check.** On each event, compare cursor position
   (NSEvent.locationInWindow + window-less screen translation, or
   `[NSEvent mouseLocation]`) against the pip's screen rect. The rect
   is cached at pip creation from `Window::outer_position()` +
   `Window::outer_size()`, invalidated when the pip moves.

3. **Rust — edge-triggered emit.** Track previous-state hover boolean.
   Only emit a Tauri event when the boolean transitions:
   `app.emit_to("focus-pip", "pip-hover", { over: true/false })`. No
   per-pixel chatter — at most two events per hover gesture.

4. **JS — composed hover state.** The pip listens for `pip-hover`,
   sets `isExternallyHovered` state. Render fans out from
   `isExternallyHovered || isCssHovered`. CSS `:hover` continues to
   work when the window IS key (existing behavior preserved); the
   external signal kicks in when the window isn't key. Both code
   paths converge on the same render output.

### Why this works where the previous attempts couldn't

- **No dependency on WKWebView's internal hover dispatch.** Fan-out
  renders from a JS state variable, not from CSS reacting to a DOM
  event that never fires.
- **No dependency on the window being key.** Global monitors fire
  regardless of focus.
- **No AppKit subclassing or class swaps.** No risk of breaking
  Tauri's window management.
- **Both states converge on the same render.** When pip IS key, CSS
  `:hover` still drives fan-out; when it isn't, the external signal
  drives fan-out. Same UI output, two input sources.

### Trade-offs to flag

- **Always-on monitor.** Runs while the pip exists. Cheap per event
  (cursor-rect intersection), but it IS always-on. Acceptable for a
  single-pip app; would need re-evaluation if we shipped multi-pip.
- **Slight IPC latency.** Rust → JS roundtrip adds a few ms vs.
  native CSS `:hover`. Imperceptible for a hover state change.
- **Coordinate cache invalidation.** Pip is draggable. Cache the rect
  at creation; subscribe to `tauri://move` events on the pip and
  re-cache. Stale-rect risk only on the first event after a drag,
  which is bounded to one event because the next mouseMoved triggers
  a recompute via the same path.
- **Cursor-leave timing is automatic.** Edge detection on the boolean
  handles "cursor left the pip" naturally — the next movement event
  past the boundary fires `over: false`. No special handling for
  cursor-position-stable-then-app-switch cases since those don't
  generate movement events anyway and the icons would have already
  retracted.

## What landed on this branch (clean slate)

- `a7130fa` — Revert "polish(pip): hover-without-focus on macOS"
  (drops 5354c03 entirely: `setAcceptsMouseMovedEvents`, the Tauri
  command, the `tauri://created` invoke, the `acceptFirstMouse:true`
  hunk).
- `67c4163` — Re-apply just the `acceptFirstMouse:true` change.
  Independent ergonomic win — first click engages the button instead
  of activating the window.

The `5354c03`-on-main + `44bea9b`/`23d8007`/`3e00ff7`-on-branch
experiments are gone. Branch diff against main is now: minus the old
Rust command + minus the old JS invoke + plus the small
`acceptFirstMouse:true` re-add.

## Order of operations from here

1. ✅ Revert failed attempts (above).
2. ⏳ **Verse design review** — this document.
3. Implementation:
   - Rust: NSEvent global monitor + rect cache + edge-triggered emit.
   - JS: `pip-hover` listener + `isExternallyHovered` state + render
     composition.
4. Self-validation: `tsc`, `cargo build`, smoke (focus session →
   background pip → cursor over pip from another app → fan-out fires;
   cursor leaves → fan-out retracts).
5. Cleanup: no diagnostic instrumentation needed — the cursor-rect
   intersection is observable directly. If something fails, the
   failure is "monitor doesn't fire" or "rect math is wrong," both
   diagnosable from inline `eprintln!` in Rust if needed.

## Open questions for Verse

1. **Monitor lifetime.** Should the monitor live for the duration of
   the pip window, or only while the pip is non-key? (Latter is
   marginally more efficient; former is simpler.) Recommendation:
   former — simpler, cost is negligible.

2. **Drag handling.** Cache + invalidate on `tauri://move` is the
   plan. Alternative: query `outer_position()` on every event. Latter
   is simpler but does an IPC-equivalent on every cursor movement.
   Recommendation: cache + invalidate.

3. **`acceptFirstMouse:true` survives.** Confirming this is fine to
   keep as the opening commit even though the hover work above is
   independent.

Standing by for review.
