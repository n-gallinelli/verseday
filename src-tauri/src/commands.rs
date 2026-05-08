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

/// macOS only — set `acceptsMouseMovedEvents = YES` on the underlying
/// NSWindow for the named webview window. By default, non-key windows
/// don't receive `mouseMoved:` events on macOS, which means CSS
/// `:hover` doesn't fire on the WkWebView's content when another app
/// is in front. The focus-pip wants to show its hover-revealed icon
/// fan-out even when the user is in another window, so we opt in
/// explicitly.
///
/// No-op on non-macOS platforms.
#[tauri::command]
pub fn enable_window_mouse_moved_events(
    app_handle: tauri::AppHandle,
    label: String,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let window = app_handle
            .get_webview_window(&label)
            .ok_or_else(|| format!("window not found: {}", label))?;
        let ns_window_ptr = window
            .ns_window()
            .map_err(|e| format!("ns_window() failed: {}", e))?;
        // Pass the pointer through as a usize — *mut c_void is !Send,
        // but we need to hop to the main thread (Cocoa requires it).
        let ptr_addr = ns_window_ptr as usize;
        let (tx, rx) = std::sync::mpsc::channel::<()>();
        app_handle
            .run_on_main_thread(move || {
                use objc2::msg_send;
                use objc2::runtime::AnyObject;
                // SAFETY: ns_window() returns a valid NSWindow pointer
                // for the lifetime of the window. The selector exists
                // on NSWindow. We're on the main thread (Cocoa rule).
                let obj = unsafe { &*(ptr_addr as *const AnyObject) };
                unsafe {
                    let _: () = msg_send![obj, setAcceptsMouseMovedEvents: true];
                }
                let _ = tx.send(());
            })
            .map_err(|e| format!("main-thread dispatch failed: {}", e))?;
        let _ = rx.recv_timeout(std::time::Duration::from_millis(200));
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app_handle;
        let _ = label;
    }
    Ok(())
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
