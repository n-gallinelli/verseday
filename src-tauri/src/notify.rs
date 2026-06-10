//! Native macOS meeting-notification delivery + click → focus jump.
//!
//! Why this exists: the Tauri notification plugin sends macOS notifications
//! via the deprecated NSUserNotification API but DISCARDS the click result,
//! and `plugin-notification`'s `onAction` is mobile-only — so a notification
//! tap can't be observed through the plugin on desktop. We own delivery for
//! the meeting-approach notification here and attach our own delegate to the
//! shared NSUserNotificationCenter so a body click emits a Tauri event the JS
//! side turns into a focus-screen jump.
//!
//! Framework choice: NSUserNotification is deprecated, but it's the only path
//! that works on this ad-hoc-signed app — UNUserNotifications requires proper
//! code signing (Apple Developer Program, declined: "budget is zero"). It
//! still delivers on this macOS today. The JS listens for a mechanism-agnostic
//! `verseday:notification-clicked`, so a future swap to UN never touches JS.
//! See docs/2026-06-10-notification-click-rust-path-plan.md.

#![cfg(target_os = "macos")]
#![allow(deprecated)] // NSUserNotification* — see module doc.

use std::sync::OnceLock;

use objc2::rc::{Allocated, Retained};
use objc2::runtime::{NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{define_class, msg_send, AllocAnyThread};
use objc2_foundation::{
    NSString, NSUserNotification, NSUserNotificationActivationType, NSUserNotificationCenter,
    NSUserNotificationCenterDelegate,
};
use tauri::{AppHandle, Emitter};

/// Emitted (with the clicked event's `external_id` as the payload) when the
/// user clicks a meeting notification's body. App.tsx listens and jumps to the
/// task on the focus screen.
pub const NOTIFICATION_CLICKED_EVENT: &str = "verseday:notification-clicked";

/// Set once at startup so the delegate (a plain ObjC object with no ivars) can
/// reach the app to emit. AppHandle is Send + Sync.
static APP: OnceLock<AppHandle> = OnceLock::new();

define_class!(
    // Plain NSObject subclass conforming to NSUserNotificationCenterDelegate.
    // No ivars — state lives in the APP static — so the delegate stays trivial
    // (Verse A: keep it minimal/stateless, read userInfo, emit, nothing else).
    #[unsafe(super(NSObject))]
    #[name = "VerseDayNotificationDelegate"]
    #[ivars = ()]
    struct NotificationDelegate;

    impl NotificationDelegate {
        #[unsafe(method_id(init))]
        fn init(this: Allocated<Self>) -> Option<Retained<Self>> {
            unsafe { msg_send![super(this.set_ivars(())), init] }
        }
    }

    unsafe impl NSObjectProtocol for NotificationDelegate {}

    unsafe impl NSUserNotificationCenterDelegate for NotificationDelegate {
        // Fires async on the main run loop when the user interacts. We only
        // act on a BODY click (ContentsClicked) — not other activation types.
        #[unsafe(method(userNotificationCenter:didActivateNotification:))]
        fn did_activate(
            &self,
            _center: &NSUserNotificationCenter,
            notification: &NSUserNotification,
        ) {
            if notification.activationType() != NSUserNotificationActivationType::ContentsClicked {
                return;
            }
            // We stash the event's external_id in the notification identifier.
            let Some(identifier) = notification.identifier() else {
                return;
            };
            if let Some(app) = APP.get() {
                let _ = app.emit(NOTIFICATION_CLICKED_EVENT, identifier.to_string());
            }
        }

        // Show the notification even when VerseDay is frontmost.
        #[unsafe(method(userNotificationCenter:shouldPresentNotification:))]
        fn should_present(
            &self,
            _center: &NSUserNotificationCenter,
            _notification: &NSUserNotification,
        ) -> bool {
            true
        }
    }
);

/// Install the notification-click delegate once at startup. Runs on the main
/// thread (NSUserNotificationCenter is main-thread-affine) and LEAKS the
/// delegate so it outlives the app — the center keeps an *unretained* ref, the
/// same leak rationale as the calendar permission block.
pub fn setup(app: &AppHandle) {
    let _ = APP.set(app.clone());
    let _ = app.run_on_main_thread(|| {
        let delegate: Retained<NotificationDelegate> =
            unsafe { msg_send![NotificationDelegate::alloc(), init] };
        let center = NSUserNotificationCenter::defaultUserNotificationCenter();
        let proto: &ProtocolObject<dyn NSUserNotificationCenterDelegate> =
            ProtocolObject::from_ref(&*delegate);
        unsafe { center.setDelegate(Some(proto)) };
        std::mem::forget(delegate);
    });
}

/// Deliver a meeting-approach notification whose body click routes to the
/// task with `external_id`. Replaces the plugin's send for meetings only
/// (the sole sendNotification caller) so the click is observable.
#[tauri::command]
pub fn send_meeting_notification(app: AppHandle, title: String, body: String, external_id: String) {
    let _ = app.run_on_main_thread(move || {
        let notification = NSUserNotification::new();
        notification.setTitle(Some(&NSString::from_str(&title)));
        notification.setInformativeText(Some(&NSString::from_str(&body)));
        // Carry the task ref on the identifier (read back in did_activate);
        // avoids building an NSDictionary userInfo just to pass one string.
        notification.setIdentifier(Some(&NSString::from_str(&external_id)));
        let center = NSUserNotificationCenter::defaultUserNotificationCenter();
        center.deliverNotification(&notification);
    });
}
