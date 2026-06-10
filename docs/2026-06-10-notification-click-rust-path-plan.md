# Notification click → focus screen (native Rust path) — plan

**Date:** 2026-06-10
**Author:** Terse
**Status:** PLAN — awaiting Verse review (no code written)

## Goal
Clicking a meeting-approach notification jumps to that event's imported task
on the focus screen (preview). The JS-only attempt (90e40ee, deferred) can't
work: `@tauri-apps/plugin-notification`'s `onAction` is **mobile-only** — it
never fires on macOS desktop.

## What the desktop plugin does (investigated)
- The plugin sends macOS notifications via `mac-notification-sys` 0.6.12
  (the deprecated **NSUserNotification** API) and **throws the result away**
  (`NotificationBuilder::show()` → `Result<()>`).
- `mac-notification-sys::send()` is **synchronous/blocking** — it runs its
  own delegate + waits for the user to click/dismiss. Fine for a CLI, but we
  can't block a GUI thread per notification, and we can't read its result
  through the plugin anyway.
- Confirmed: `meetingApproachNotifier` is the ONLY `sendNotification` caller,
  so we can fully replace its send path with no conflict elsewhere.

## Approach — our own NSUserNotification + delegate (objc2)
Mirror the existing native pattern in this app (calendar.rs / commands.rs
already use objc2 + `run_on_main_thread` for NSWorkspace/EventKit). Do NOT
use `mac-notification-sys` (blocking model) and do NOT use UNUserNotifications
(needs proper code signing the ad-hoc app lacks; NSUserNotification still
delivers on this macOS — meetings already arrive today).

1. **Rust: a persistent NSUserNotificationCenter delegate** set once at app
   startup on `defaultUserNotificationCenter`. Its
   `userNotificationCenter:didActivateNotification:` fires async on the main
   run loop (non-blocking) when the user clicks the notification body; it
   reads the notification's `userInfo` and emits a Tauri event
   `verseday:notification-clicked { externalId }`. Also implement
   `shouldPresent` → return true so it shows even if we're frontmost.
2. **Rust command `send_meeting_notification(title, body, external_id)`**:
   build an `NSUserNotification`, set title/informativeText + `userInfo`
   `{ externalId }`, and `deliverNotification:` on the default center (on the
   main thread via `run_on_main_thread`). Replaces the plugin send for
   meetings only.
3. **JS — meetingApproachNotifier**: call
   `invoke("send_meeting_notification", { title, body, externalId })` instead
   of the plugin `sendNotification`. Keep the dedup/permission/grace logic.
4. **JS — App.tsx**: listen for `verseday:notification-clicked` and run the
   focus-jump (the logic already written + salvaged on branch
   feat/notification-click-to-focus: getTaskByExternalId → bring main window
   forward → if this task is already the live session just navigate, else
   commit any running session via endActiveFocusSession() then previewFocus +
   setPage("focus")). Swap the trigger from `onAction` to this event.

## Risks / unknowns (flagging for Verse)
- **NSUserNotification is deprecated** (since macOS 11). It still delivers on
  this machine today, but Apple could remove it; `#[allow(deprecated)]` on the
  objc2 calls. If a future macOS drops it, the fallback is UNUserNotifications
  — which needs the proper code signing the app doesn't have (the $99 Apple
  Developer path Nick declined). Document this ceiling.
- **dev vs installed:** NSUserNotification needs a real `.app` bundle; in
  `tauri dev` (`target/debug/app`) notifications may not deliver — so this is
  likely only testable in the installed build. Eyes-on after install.
- **Delegate lifetime:** the delegate must be retained for the app's life
  (leak it intentionally, like the calendar permission block) so it isn't
  freed while the center holds a weak ref.
- **Plugin coexistence:** we stop using the plugin's send for meetings; the
  plugin stays for permission probes (desktop returns Granted). No shared-
  delegate conflict since we no longer call the plugin's blocking send.
- **Main-thread discipline:** deliver + delegate work on the main thread via
  `run_on_main_thread` (NSUserNotificationCenter is main-thread-affine).

## Validation
- Build + tsc. The focus-jump JS is unchanged logic (already Verse-reviewed
  shape on the salvage branch) — only its trigger changes.
- Eyes-on (installed build): meeting notification fires → click it → app
  comes forward → focus screen shows that task in preview (committing any
  prior running session). Confirm a click while already focusing that task is
  a no-op nav.

## Scope
macOS-only. Adds a direct dep on objc2-foundation/objc2-app-kit pieces already
in the tree (EventKit/AppKit). No DDL. Reuses getTaskByExternalId + the switch
logic from feat/notification-click-to-focus.
