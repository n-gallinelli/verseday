use serde::Deserialize;
use std::sync::Mutex;
use tauri::Manager;

// ── Quick-add focus management ─────────────────────────────────────────
// Stores the bundle ID of the app that was frontmost BEFORE the quick-add
// window was summoned, so we can re-activate it on dismiss.
// All macOS API calls go through objc2 directly — zero subprocesses.

pub struct QuickAddState {
    pub previous_app: Mutex<String>,
}

/// Capture the frontmost app's bundle ID right before showing quick-add.
/// Dispatches to the main thread (NSWorkspace requires MainThreadMarker)
/// and blocks until the result is available (~1μs for the thread hop).
#[tauri::command]
pub fn capture_previous_app(app_handle: tauri::AppHandle, state: tauri::State<QuickAddState>) {
    let (tx, rx) = std::sync::mpsc::channel();
    let _ = app_handle.run_on_main_thread(move || {
        tx.send(platform::get_frontmost_bundle_id()).ok();
    });
    if let Ok(bundle_id) = rx.recv_timeout(std::time::Duration::from_millis(100)) {
        *state.previous_app.lock().unwrap() = bundle_id;
    }
}

/// Hide the quick-add window and re-activate the previously frontmost app.
/// Activates the previous app FIRST (via direct Cocoa call on the main
/// thread), THEN hides the window. This prevents macOS from auto-focusing
/// the main VerseDay window during the hide.
#[tauri::command]
pub fn dismiss_quick_add(app_handle: tauri::AppHandle, state: tauri::State<QuickAddState>) {
    let bundle_id = state.previous_app.lock().unwrap().clone();
    if !bundle_id.is_empty() {
        let (tx, rx) = std::sync::mpsc::channel::<()>();
        let _ = app_handle.run_on_main_thread(move || {
            platform::activate_app_by_bundle_id(&bundle_id);
            tx.send(()).ok();
        });
        // Wait for activation to complete before hiding — prevents the
        // main window from flashing.
        let _ = rx.recv_timeout(std::time::Duration::from_millis(100));
    }
    if let Some(win) = app_handle.get_webview_window("quick-add") {
        let _ = win.hide();
    }
}

// ── Platform-specific implementations ──────────────────────────────────

#[cfg(target_os = "macos")]
mod platform {
    use objc2_app_kit::{NSApplicationActivationOptions, NSWorkspace};
    use objc2_foundation::MainThreadMarker;

    /// Get the bundle ID of the frontmost app via NSWorkspace.
    /// MUST be called on the main thread (MainThreadMarker is checked).
    pub fn get_frontmost_bundle_id() -> String {
        let _mtm = MainThreadMarker::new().expect("must be called on main thread");
        let workspace = NSWorkspace::sharedWorkspace();
        let Some(app) = workspace.frontmostApplication() else {
            return String::new();
        };
        app.bundleIdentifier()
            .map(|s| s.to_string())
            .unwrap_or_default()
    }

    /// Activate a running app by its bundle ID via NSRunningApplication.
    /// MUST be called on the main thread.
    pub fn activate_app_by_bundle_id(bundle_id: &str) {
        let _mtm = MainThreadMarker::new().expect("must be called on main thread");
        let workspace = NSWorkspace::sharedWorkspace();
        for app in workspace.runningApplications().iter() {
            let Some(bid) = app.bundleIdentifier() else {
                continue;
            };
            if bid.to_string() == bundle_id {
                app.activateWithOptions(NSApplicationActivationOptions(0));
                break;
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    pub fn get_frontmost_bundle_id() -> String {
        String::new()
    }
    pub fn activate_app_by_bundle_id(_: &str) {}
}

// ── PiP hover-without-focus ────────────────────────────────────────────
// macOS gates WKWebView's DOM hover dispatch on the window being key.
// To make the focus pip's icon fan-out fire when the cursor crosses the
// pip from another app, we bypass DOM hover entirely: an NSEvent global
// mouse-moved monitor compares the cursor position against the pip's
// NSWindow.frame() on each fire and emits edge-triggered "pip-hover"
// events that drive an `isExternallyHovered` boolean in JS, which ORs
// with the regular CSS :hover state.
//
// Frame is read inline per fire (no cache + invalidate). The original
// design cached the frame and invalidated on tauri://move via a JS
// roundtrip. That's wrong: NSEvent monitor handlers run ON the main
// thread already, so msg_send![ns_window, frame] inside the block is
// direct memory access — no IPC. The cached approach also raced with
// drag (invalidate is async) and left the rect stale, breaking
// hover-leave detection after a drag. Reading inline is simpler AND
// correct.
//
// We also setAcceptsMouseMovedEvents:YES on the pip's NSWindow at
// start so DOM mousemove fires after the user clicks the pip and it
// becomes key — without this, clicking a button leaves the icons
// stuck visible because the inner-div mouseLeave never triggers.
//
// No-op on non-macOS platforms (struct exists for `manage()` symmetry).

#[cfg(target_os = "macos")]
mod pip_hover {
    use std::sync::Mutex;
    use std::ptr::NonNull;
    use serde::Serialize;
    use tauri::{AppHandle, Emitter, Manager, Runtime};
    use objc2::{class, msg_send};
    use objc2::runtime::AnyObject;
    use objc2_foundation::{NSPoint, NSRect};
    use block2::RcBlock;

    // 1 << NSEventTypeMouseMoved (5) — see AppKit/NSEvent.h.
    const NS_EVENT_MASK_MOUSE_MOVED: u64 = 1u64 << 5;

    struct Entry {
        // Retained NSObject pointer (id) returned by
        // addGlobalMonitorForEventsMatchingMask:. Stored as usize so the
        // surrounding state is Send; we only ever deref on the main
        // thread.
        monitor_handle_ptr: usize,
        last_over: bool,
    }

    pub struct State {
        inner: Mutex<Option<Entry>>,
    }

    impl State {
        pub fn new() -> Self {
            Self { inner: Mutex::new(None) }
        }
    }

    #[derive(Serialize, Clone)]
    struct PipHoverPayload { over: bool }

    /// Read NSWindow.frame() — MUST be called on main thread.
    /// SAFETY: caller must guarantee `ptr` is a valid NSWindow pointer
    /// for the duration of the call.
    unsafe fn read_frame(ptr: usize) -> NSRect {
        let obj = &*(ptr as *const AnyObject);
        msg_send![obj, frame]
    }

    fn ns_window_ptr<R: Runtime>(app: &AppHandle<R>, label: &str) -> Result<usize, String> {
        let window = app
            .get_webview_window(label)
            .ok_or_else(|| format!("window not found: {}", label))?;
        let ptr = window
            .ns_window()
            .map_err(|e| format!("ns_window() failed: {}", e))?;
        Ok(ptr as usize)
    }

    pub fn start<R: Runtime>(app: &AppHandle<R>, label: &str) -> Result<(), String> {
        // Stop any existing monitor first — stale entries can occur if the
        // pip is recreated without an explicit JS-side stop call.
        let _ = stop(app, label);

        let win_ptr = ns_window_ptr(app, label)?;
        let app_for_block = app.clone();
        let label_for_block = label.to_string();

        let (tx, rx) = std::sync::mpsc::channel::<Result<usize, String>>();
        app.run_on_main_thread(move || {
            // Opt the pip's NSWindow into receiving mouseMoved events.
            // Without this, after the pip becomes key (e.g., user clicks
            // a button), DOM mousemove events stop firing, the inner-div
            // mouseLeave never triggers, and cssHovered gets stuck true
            // — leaving icons frozen visible. Setting it once at start
            // is enough; the property persists for the window's life.
            unsafe {
                let win = &*(win_ptr as *const AnyObject);
                let _: () = msg_send![win, setAcceptsMouseMovedEvents: true];
            }

            // The monitor's handler block. Reads the pip's frame inline
            // on every fire (this block runs on the main thread, so the
            // msg_send is direct memory access — not IPC). Compares
            // cursor to frame and emits on edge transitions only.
            let app_for_handler = app_for_block.clone();
            let label_for_handler = label_for_block.clone();
            let block = RcBlock::new(move |_event: NonNull<AnyObject>| {
                let cls = class!(NSEvent);
                // [NSEvent mouseLocation] and NSWindow.frame() are both in
                // global screen coords, origin bottom-left — no Y flip.
                // Multi-screen: both APIs span all displays in a single
                // global coord space, so pip-on-secondary + cursor-on-
                // secondary works through the same intersection without
                // per-display logic.
                let cursor: NSPoint = unsafe { msg_send![cls, mouseLocation] };
                let rect: NSRect = unsafe { read_frame(win_ptr) };

                let over = cursor.x >= rect.origin.x
                    && cursor.x <= rect.origin.x + rect.size.width
                    && cursor.y >= rect.origin.y
                    && cursor.y <= rect.origin.y + rect.size.height;

                let state = app_for_handler.state::<super::PipHoverState>();
                let mut guard = match state.inner.lock() {
                    Ok(g) => g,
                    Err(_) => return,
                };
                let Some(entry) = guard.as_mut() else { return; };

                if over != entry.last_over {
                    entry.last_over = over;
                    let payload = PipHoverPayload { over };
                    let label = label_for_handler.clone();
                    let app = app_for_handler.clone();
                    drop(guard);
                    let _ = app.emit_to(label, "pip-hover", payload);
                }
            });

            let cls = class!(NSEvent);
            let mask: u64 = NS_EVENT_MASK_MOUSE_MOVED;
            let monitor: *mut AnyObject = unsafe {
                msg_send![cls, addGlobalMonitorForEventsMatchingMask: mask, handler: &*block]
            };

            if monitor.is_null() {
                let _ = tx.send(Err(
                    "addGlobalMonitorForEventsMatchingMask returned nil".to_string(),
                ));
                return;
            }
            // Returned object is autoreleased — retain so it survives the
            // pool drain. We release in stop().
            unsafe {
                let _: *mut AnyObject = msg_send![monitor, retain];
            }
            // The block must outlive the monitor. AppKit holds its own
            // reference to the block (independent retain count) and
            // releases it during removeMonitor:. Our std::mem::forget
            // creates a one-block-per-session leak in OUR process —
            // not in AppKit's bookkeeping — so this is not a use-after-
            // free; it's just an orphaned ~100-byte block per focus
            // session. Reversible later via a SendableRcBlock newtype
            // stored in Entry if it ever shows up in profiling.
            std::mem::forget(block);

            let _ = tx.send(Ok(monitor as usize));
        })
        .map_err(|e| format!("main-thread dispatch failed: {}", e))?;

        let monitor_ptr = rx
            .recv_timeout(std::time::Duration::from_millis(500))
            .map_err(|e| format!("monitor registration timed out: {}", e))??;

        let state = app.state::<super::PipHoverState>();
        let mut guard = state
            .inner
            .lock()
            .map_err(|_| "pip-hover state poisoned".to_string())?;
        *guard = Some(Entry {
            monitor_handle_ptr: monitor_ptr,
            last_over: false,
        });
        Ok(())
    }

    pub fn stop<R: Runtime>(app: &AppHandle<R>, _label: &str) -> Result<(), String> {
        let state = app.state::<super::PipHoverState>();
        let entry = {
            let mut guard = state
                .inner
                .lock()
                .map_err(|_| "pip-hover state poisoned".to_string())?;
            guard.take()
        };
        if let Some(e) = entry {
            let h = e.monitor_handle_ptr;
            // removeMonitor: must be on the main thread; same goes for
            // release. Fire and forget — the caller doesn't need to wait.
            let _ = app.run_on_main_thread(move || unsafe {
                let cls = class!(NSEvent);
                let _: () = msg_send![cls, removeMonitor: h as *mut AnyObject];
                let obj = h as *mut AnyObject;
                let _: () = msg_send![obj, release];
            });
        }
        Ok(())
    }

}

#[cfg(not(target_os = "macos"))]
mod pip_hover {
    use tauri::{AppHandle, Runtime};

    pub struct State;
    impl State {
        pub fn new() -> Self { Self }
    }

    pub fn start<R: Runtime>(_: &AppHandle<R>, _: &str) -> Result<(), String> { Ok(()) }
    pub fn stop<R: Runtime>(_: &AppHandle<R>, _: &str) -> Result<(), String> { Ok(()) }
}

pub use pip_hover::State as PipHoverState;

#[tauri::command]
pub fn start_pip_hover_monitor(
    app_handle: tauri::AppHandle,
    label: String,
) -> Result<(), String> {
    pip_hover::start(&app_handle, &label)
}

#[tauri::command]
pub fn stop_pip_hover_monitor(
    app_handle: tauri::AppHandle,
    label: String,
) -> Result<(), String> {
    pip_hover::stop(&app_handle, &label)
}

#[derive(Deserialize)]
struct ContentBlock {
    text: Option<String>,
}

#[derive(Deserialize)]
struct ApiResponse {
    content: Vec<ContentBlock>,
}

#[derive(Deserialize)]
struct ApiErrorDetail {
    message: String,
}

#[derive(Deserialize)]
struct ApiErrorResponse {
    error: ApiErrorDetail,
}

#[tauri::command]
pub async fn generate_summary(
    api_key: String,
    system_prompt: String,
    user_prompt: String,
) -> Result<String, String> {
    let client = reqwest::Client::new();

    let body = serde_json::json!({
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 1024,
        "system": system_prompt,
        "messages": [
            { "role": "user", "content": user_prompt }
        ]
    });

    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    let status = response.status();
    let response_text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    if !status.is_success() {
        if let Ok(api_err) = serde_json::from_str::<ApiErrorResponse>(&response_text) {
            return Err(match status.as_u16() {
                401 => "Invalid API key. Please check your Anthropic key and try again.".to_string(),
                429 => "Rate limited. Please wait a moment and try again.".to_string(),
                _ => format!("API error: {}", api_err.error.message),
            });
        }
        return Err(format!("API returned status {}", status));
    }

    let parsed: ApiResponse =
        serde_json::from_str(&response_text).map_err(|e| format!("Failed to parse response: {}", e))?;

    parsed
        .content
        .first()
        .and_then(|c| c.text.clone())
        .ok_or_else(|| "Empty response from API".to_string())
}

// ── System power: resume-from-sleep notifier (P0-1) ──────────────────────
// Observes NSWorkspaceDidWakeNotification and emits `system-resumed` to JS on
// a real machine wake from sleep. App Nap / DOM-timer throttling NEVER raise
// this notification, so the JS focus tick can use it to drop a suspended span
// (lid-close, sleep) without discarding real occluded-but-working time. See
// docs/2026-06-01-stability-hardening-plan.md, Branch A.
//
// Called once from `setup`, which runs on the main thread (NSWorkspace
// requires it). The observer is retained for the app's lifetime.

#[cfg(target_os = "macos")]
pub fn start_system_resume_notifier(app: &tauri::AppHandle) {
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::{NSObjectProtocol, ProtocolObject};
    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::{NSNotification, NSString};
    use std::ptr::NonNull;
    use tauri::Emitter;

    let app = app.clone();
    let workspace = NSWorkspace::sharedWorkspace();
    let center = workspace.notificationCenter();
    // NSWorkspace notification constants have string values equal to their
    // symbol names, so the literal is the canonical name — no feature-gated
    // constant import needed.
    let name = NSString::from_str("NSWorkspaceDidWakeNotification");

    let block = RcBlock::new(move |_notif: NonNull<NSNotification>| {
        // Fires on the main thread; emit is thread-safe regardless.
        let _ = app.emit("system-resumed", ());
    });

    let observer: Retained<ProtocolObject<dyn NSObjectProtocol>> = unsafe {
        center.addObserverForName_object_queue_usingBlock(Some(&name), None, None, &block)
    };
    // Dropping the observer unregisters the block; keep it for app lifetime.
    std::mem::forget(observer);
}

#[cfg(not(target_os = "macos"))]
pub fn start_system_resume_notifier(_app: &tauri::AppHandle) {}
