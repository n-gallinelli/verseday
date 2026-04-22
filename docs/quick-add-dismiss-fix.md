# Quick-add dismiss + summon latency fix

**Author:** Terse
**For review by:** Verse
**Status:** Plan, not yet implemented

## Problem

Two user-reported issues after the dismiss-and-refocus work:

1. **"I have to hold Cmd+Shift+A"** — the quick-add bar takes ~200-500ms
   to appear after the keypress. The user expects instant response.
2. **Pressing Esc still briefly flashes the main VerseDay window** before
   the previous app takes focus (uncertain — may be resolved by the
   ordering fix below, but the root cause is the same latency).

## Root cause

`capture_previous_app` calls `osascript` to get the frontmost app's bundle
ID. `osascript` has ~200-500ms startup overhead because it launches the
full AppleScript interpreter, connects to System Events, queries the
process list, and returns. This blocks the shortcut callback between the
key press and the `win.show()` call:

```
User presses Cmd+Shift+A
  → await invoke("capture_previous_app")    ← 200-500ms blocked here
  → await win.center()
  → await win.show()
  → await win.setFocus()
```

The `dismiss_quick_add` command has the same issue: `open -b` is called
with `.output()` (blocking), adding ~50-100ms to the dismiss path.

## Proposed fix

Replace the `osascript` subprocess in `capture_previous_app` with a direct
macOS API call via `objc2`. The `objc2`, `objc2-app-kit`, and
`objc2-foundation` crates are already in the dependency tree (transitive
from Tauri/tao). Adding them as explicit deps reuses the already-compiled
versions — zero extra compile time or binary size.

The direct API path is:

```
NSWorkspace.shared.frontmostApplication?.bundleIdentifier
```

This is a single Objective-C property chain — microseconds, no subprocess,
no interpreter. The Rust code calls it via `objc2::msg_send!`.

For the dismiss path, switch `open -b` from `.output()` (blocking) back to
`.spawn()` (async), but emit it BEFORE hiding the window. The ~50ms `open`
latency is acceptable if the window hide doesn't depend on it completing
— the visual sequence is: previous app starts activating → quick-add
window disappears → previous app finishes activating. No flash.

## Changes

### commands.rs

1. Replace `get_frontmost_bundle_id()`:
   - Remove: `std::process::Command::new("osascript")...`
   - Add: direct `objc2` call to
     `NSWorkspace.shared.frontmostApplication?.bundleIdentifier`
   - Fallback on non-macOS: return empty string (unchanged)

2. In `dismiss_quick_add()`:
   - Change `open -b` from `.output()` (blocking) to `.spawn()` (async)
   - Keep the order: activate previous app first, THEN hide the window
   - The `.spawn()` fires and returns immediately; macOS processes the
     activation event asynchronously. By the time the hide completes
     (~1ms later), the previous app is already being activated.

### Cargo.toml

Add as explicit dependencies (already compiled as transitive deps, zero
extra cost):

```toml
[target.'cfg(target_os = "macos")'.dependencies]
objc2 = "0.6"
objc2-foundation = { version = "0.3", features = ["NSString"] }
objc2-app-kit = { version = "0.3", features = ["NSWorkspace", "NSRunningApplication"] }
```

The feature flags gate which AppKit/Foundation classes are available. We
need:
- `NSWorkspace` for `sharedWorkspace` + `frontmostApplication`
- `NSRunningApplication` for `bundleIdentifier`
- `NSString` for converting the ObjC string to Rust

### No JS changes needed

The `invoke("capture_previous_app")` and `invoke("dismiss_quick_add")`
call sites in App.tsx and QuickAdd.tsx stay exactly the same. The fix is
entirely in Rust.

## Expected latency improvement

| Path | Before (osascript) | After (objc2) |
|---|---|---|
| `capture_previous_app` | 200-500ms | <1ms |
| `dismiss_quick_add` (open -b) | 50-100ms blocking | ~0ms (spawn, async) |
| **Total summon latency** | **250-600ms** | **<5ms** |

## Risk

The `objc2` API surface in v0.6 uses `msg_send!` and `msg_send_id!` macros
that require careful type annotations. If the macro syntax is wrong, the
code compiles but panics at runtime (ObjC message send to wrong type). I'll
test the direct call in the running dev build before committing.

The feature flags on `objc2-app-kit` and `objc2-foundation` must match the
exact versions in the existing lock file (transitive from Tauri). If there's
a version mismatch, Cargo will pull a second version and the compile will be
slower (but not fail). I'll check the lock file versions before adding.

## Things for Verse to scrutinize

1. **Feature flag correctness.** Do `NSWorkspace` and `NSRunningApplication`
   features on `objc2-app-kit` v0.3 actually expose the properties I need?
   The objc2 ecosystem's feature gating is granular; I might need additional
   sub-features.

2. **Thread safety.** `NSWorkspace.shared` is documented as main-thread-only
   in some contexts. Tauri command handlers run on a thread pool. Is calling
   `frontmostApplication` from a background thread safe? (It should be —
   it's a read-only property — but verify.)

3. **The `spawn()` vs `output()` tradeoff on dismiss.** With `.spawn()`,
   `open -b` fires but the Rust command returns before activation completes.
   Is there a race where the window hides before the previous app is
   fully activated, causing a brief desktop flash? If so, we might need a
   small `sleep(10ms)` between spawn and hide, or use `.output()` with
   a timeout.

## Decision needed

APPROVED / REJECTED. If approved, I'll implement and test in the running
dev build.
