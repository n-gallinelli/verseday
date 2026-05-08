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

## Verse review — design approved 2026-05-08

### Three answers

1. **Monitor lifetime — full pip lifetime.** Switching on/off based on
   key state requires hooking window key/main notifications, which
   adds complexity for marginal savings. Per-event cost is one rect
   intersection (microseconds); when the window IS key, the external
   signal piles on harmlessly via `isExternallyHovered || isCssHovered`.
2. **Drag handling — cache + invalidate.** `outer_position()` per
   event would be hundreds of cross-thread calls per second.
   Stale-rect window only exists during the drag itself, and during
   drag the cursor is on the drag handle (not the icon area), so
   fan-out behavior is irrelevant in that window.
3. **`acceptFirstMouse:true` survives.** Independent ergonomic win,
   already landed as the opening commit (`67c4163`).

### Four implementation notes folded in

1. **Monitor handle lifecycle.** `addGlobalMonitorForEventsMatchingMask:`
   returns an opaque retained monitor object that must be removed via
   `[NSEvent removeMonitor:handle]` to stop firing. Hold the handle
   in a Rust-side `Mutex<Option<usize>>` (handle as ptr-as-usize;
   AnyObject pointers are `!Send`). Remove on pip close — otherwise
   the monitor leaks across pip recreations and keeps firing against
   a stale rect.
2. **Window events for cache invalidation.** Drag (window-moved) is
   the obvious one. Resize and DPI/screen changes also affect
   `outer_position`. Subscribe to whichever Tauri 2 events cover
   those; the cheap path is to invalidate on any window event that
   could move the frame and re-read `outer_position()` lazily on the
   next monitor fire.
3. **Multi-screen.** macOS cursor coordinates and `outer_position()`
   are both in global screen space. Pip-on-secondary + cursor-on-
   secondary "just works" with the rect intersection — no special
   logic.
4. **Pip-close cleanup.** Hook the close path to call
   `removeMonitor:`. Without this, the monitor keeps firing after the
   pip is gone (harmless but unclean).

## Implementation shape

**Rust (`src-tauri/src/commands.rs` + `lib.rs`):**

- `PipHoverState`: `Mutex<Option<PipHoverEntry>>` in app state.
  Entry holds:
  - `monitor_handle: usize` (the `NSEvent` monitor handle, ptr cast)
  - `cached_rect: Option<(f64, f64, f64, f64)>` (origin x, origin y,
    width, height in global screen coords)
  - `last_over: bool` (for edge detection)
- `start_pip_hover_monitor(label: String)` Tauri command:
  1. Resolve the pip window via `Manager`.
  2. Compute initial cached rect from `outer_position()` +
     `outer_size()` (cross-thread convert as needed).
  3. Hop to main thread (Cocoa rule).
  4. Build a closure that on each `NSEvent.MouseMoved`:
     - Reads cursor location (`NSEvent::mouseLocation`).
     - Tests cursor ∈ cached rect.
     - If transition vs `last_over`, emit `pip-hover { over: bool }`
       to the pip window via `app.emit_to`.
  5. `addGlobalMonitorForEventsMatchingMask:NSEventMaskMouseMoved
     handler:closure`. Store returned handle.
- `stop_pip_hover_monitor` Tauri command:
  - `removeMonitor:` on the stored handle. Clear state entry.
- Cache invalidation: a separate Tauri command
  `invalidate_pip_hover_rect(label)` that JS calls from a
  `tauri://move` listener (and resize listener if applicable). Re-
  reads `outer_position` + `outer_size` and stores. Cheap.

**JS (`src/pages/FocusMode.tsx` + `src/components/FocusPip.tsx`):**

- After pip creation: `void invoke("start_pip_hover_monitor", { label: "focus-pip" })`.
- On pip's `tauri://move` (and `tauri://resize` if it exists in
  Tauri 2): `void invoke("invalidate_pip_hover_rect", { label: "focus-pip" })`.
- On pip cleanup (close path): `void invoke("stop_pip_hover_monitor", { label: "focus-pip" })`.
- Inside the pip page, listen for `pip-hover` event:
  ```ts
  const unlisten = await getCurrent().listen<{ over: boolean }>(
    "pip-hover",
    (evt) => setIsExternallyHovered(evt.payload.over)
  );
  ```
- Render: `const expanded = isCssHovered || isExternallyHovered`,
  drives the existing fan-out animation.

## Order of operations from here

1. ✅ Revert failed attempts.
2. ✅ **Verse design review** — approved.
3. ⏳ Implementation per the shape above.
4. Heads-up paragraph before commit (discipline rule).
5. Verify with trace: focus session → background → hover from another
   app → fan-out fires → cursor leaves → fan-out retracts.
6. If it works: merge to main, push.
7. If not: failure modes are narrow (monitor doesn't fire, rect math,
   edge detection) — diagnose with single inline `eprintln!`s.
