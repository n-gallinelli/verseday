# Focus PiP visible on all desktops

**Date:** 2026-06-04
**Branch:** `feat/pip-all-desktops`
**Status:** APPROVED by Verse 2026-06-04 — ship as-is (fullscreen gap deferred).

The focus PiP used to live only on the macOS Space it spawned on, so switching
desktops hid it — exactly when you'd forget a session is running. Now it rides
along to every desktop at the same screen position.

- `src/pages/FocusMode.tsx` — the pip's `new WebviewWindow("focus-pip", …)`
  options gain `visibleOnAllWorkspaces: true` (Tauri v2 build-time option →
  tao `set_visible_on_all_workspaces` → NSWindow collectionBehavior
  `canJoinAllSpaces`). Set at creation, so no `core:window` capability is
  needed. No-op off macOS. Orthogonal to the existing single-instance sweep,
  drag, hover monitor, and `alwaysOnTop`.

**Known boundary (deferred):** covers standard desktops/Spaces, NOT a single-app
fullscreen Space — the pip won't float over a fullscreened app. Lifting that
needs Rust-side NSWindow collection-behavior flags tao doesn't expose; left as a
follow-up for Nick to decide if/when it's worth it.

**Verify:** `npm run tauri dev`, start a focus session, switch desktops — the
pip stays in place on each. (dev is enough; no rebuild needed for the check.)
