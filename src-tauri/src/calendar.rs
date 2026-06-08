//! Calendar integration — macOS only.
//!
//! Bridges Apple's EventKit framework into Tauri commands. The
//! `CalendarSource` trait abstracts the underlying source so a future
//! swap (e.g. to a different OS or back to AppleScript if Apple ever
//! fixes its recurrence semantics) is contained to this file.
//!
//! See `docs/2026-05-05-calendar-integration-plan.md` (v3) for the
//! approved design and `docs/m0-calendar-spike.md` for the AppleScript
//! failure mode that drove the EventKit choice.
//!
//! ## Permission flow
//! `request_permission` invokes `requestFullAccessToEvents`
//! synchronously by blocking on its completion via `block2::RcBlock` +
//! a condvar. Tauri 2 dispatches commands on a worker pool, so this
//! never deadlocks the main thread (G1, plan v3). 30s timeout caps
//! the wait — generous for "user reads dialog" but bounded for
//! stuck-prompt edge cases.
//!
//! ## Versioning (G3, plan v3)
//! Pinned to `objc2 0.6` / `objc2-foundation 0.3` /
//! `objc2-event-kit 0.3` / `block2 0.6`. Bump intentionally and
//! re-test against a real recurring event when updating.

#![cfg(target_os = "macos")]

use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use block2::RcBlock;
use objc2::msg_send;
use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, Bool};
use objc2_event_kit::{
    EKAuthorizationStatus, EKCalendar, EKEntityType, EKEvent, EKEventStatus, EKEventStore,
    EKParticipant, EKParticipantStatus,
};
use objc2_foundation::{NSArray, NSDate, NSError, NSPredicate, NSString, NSURL};
use serde::Serialize;

// ───────────────────────────────────────────────────────────────────
// Public types
// ───────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PermissionStatus {
    Granted,
    Denied,
    Prompt,
}

#[derive(Debug, Serialize, Clone)]
pub struct CalendarMeta {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Attendee {
    /// Display name from EKParticipant. May be missing on external
    /// invitees whose contacts the OS doesn't know about.
    pub name: Option<String>,
    /// Email parsed from the participant's `URL` (typically a
    /// `mailto:` URL). None if the URL didn't parse as mailto.
    pub email: Option<String>,
    /// `"accepted" | "declined" | "tentative" | "pending" | "unknown"`.
    pub status: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvent {
    /// Per-instance identifier. EventKit's `eventIdentifier` includes
    /// a recurrence suffix so today's standup ≠ tomorrow's standup.
    pub external_id: String,
    pub calendar_id: String,
    pub calendar_name: String,
    pub title: String,
    /// Local-tz `YYYY-MM-DDTHH:MM`.
    pub start_local: String,
    pub end_local: Option<String>,
    pub all_day: bool,
    /// `"confirmed" | "tentative" | "cancelled" | "none"`.
    pub status: String,
    /// Event description / body. Often contains conference dial-in,
    /// agenda, links — surfaced as the right-rail's primary text.
    pub notes: Option<String>,
    /// Free-form location field. Sometimes a Zoom URL, sometimes a
    /// physical address, sometimes empty.
    pub location: Option<String>,
    /// EKEvent.URL — typically the canonical conference / meeting link
    /// when set by the calendar source (Google Calendar populates it
    /// for events with a video conference attached).
    pub url: Option<String>,
    /// Attendees (excluding the organizer — that's its own field).
    /// Empty array if EKEvent.attendees is nil.
    pub attendees: Vec<Attendee>,
    /// Organizer email parsed from EKEvent.organizer.URL (mailto:),
    /// when present. Distinct from `attendees` because EventKit
    /// surfaces them separately.
    pub organizer_email: Option<String>,
    /// The *current user's* relationship to this event, used by the sync
    /// layer to import only events the user has accepted. One of:
    ///   - `"accepted" | "declined" | "tentative" | "pending"` — the
    ///     current user is an invitee with that RSVP (via the attendee
    ///     flagged `isCurrentUser`).
    ///   - `"organizer"` — the current user organized the event (their
    ///     own event; nothing to accept).
    ///   - `"none"` — no current-user participant could be identified
    ///     (a solo personal block with no attendees, or an event where
    ///     EventKit didn't flag us). Treated as importable.
    ///   - `"unknown"` — current user matched but the status enum was
    ///     unrecognized. Treated as importable.
    pub self_status: String,
}

// ───────────────────────────────────────────────────────────────────
// CalendarSource trait
// ───────────────────────────────────────────────────────────────────

pub trait CalendarSource: Send + Sync {
    fn permission_status(&self) -> PermissionStatus;
    fn request_permission(&self) -> Result<PermissionStatus, String>;
    fn calendar_list(&self) -> Result<Vec<CalendarMeta>, String>;
    fn events_for_date(&self, date_iso: &str) -> Result<Vec<CalendarEvent>, String>;
}

// ───────────────────────────────────────────────────────────────────
// EventKitSource — macOS 14+ implementation
// ───────────────────────────────────────────────────────────────────

pub struct EventKitSource {
    store: Retained<EKEventStore>,
}

// Apple documents EKEventStore as thread-safe ("EventKit objects can
// be created on any thread, and you can use them from any thread").
// objc2's wrappers are conservatively !Send / !Sync; we opt in here.
unsafe impl Send for EventKitSource {}
unsafe impl Sync for EventKitSource {}

impl EventKitSource {
    pub fn new() -> Self {
        let store = unsafe { EKEventStore::new() };
        Self { store }
    }

    /// G2 mapping (plan v3). `Authorized` is deprecated in favor of
    /// `FullAccess` on macOS 14+; we don't list it (compiler warns
    /// since the discriminant is also used by FullAccess).
    fn map_status(status: EKAuthorizationStatus) -> PermissionStatus {
        match status {
            EKAuthorizationStatus::NotDetermined => PermissionStatus::Prompt,
            EKAuthorizationStatus::FullAccess => PermissionStatus::Granted,
            // Restricted, Denied, WriteOnly, future unknown → Denied.
            _ => PermissionStatus::Denied,
        }
    }
}

impl CalendarSource for EventKitSource {
    fn permission_status(&self) -> PermissionStatus {
        let status =
            unsafe { EKEventStore::authorizationStatusForEntityType(EKEntityType::Event) };
        Self::map_status(status)
    }

    fn request_permission(&self) -> Result<PermissionStatus, String> {
        // Pair: Some(true|false) once EventKit's completion fires.
        let pair: Arc<(Mutex<Option<bool>>, Condvar)> =
            Arc::new((Mutex::new(None), Condvar::new()));
        let pair_cb = pair.clone();

        // RcBlock holds a heap-allocated block compatible with
        // Objective-C completion-handler conventions. The closure args
        // must match what EventKit calls back with: `BOOL granted` and
        // `NSError * _Nullable error`. objc2 maps these to `Bool` and
        // a non-null reference (or absence via `*mut`).
        let block = RcBlock::new(move |granted: Bool, _err: *mut NSError| {
            let (lock, cvar) = &*pair_cb;
            let mut guard = lock.lock().unwrap();
            *guard = Some(granted.as_bool());
            cvar.notify_one();
        });

        // The binding signature takes `*mut Block<...>`. RcBlock
        // derefs to `Block<...>`; we cast through const to mut here
        // because EventKit doesn't mutate the block — it just
        // retains and invokes it.
        let block_ptr: *mut block2::Block<dyn Fn(Bool, *mut NSError)> =
            &*block as *const _ as *mut _;
        unsafe {
            self.store.requestFullAccessToEventsWithCompletion(block_ptr);
        }

        // C1 fix (Verse, 2026-05-05): leak the block to eliminate UAF
        // risk on the timeout path. The completion handler is async —
        // if the user lets the prompt sit past our 30s condvar timeout,
        // this function returns Err and the local RcBlock would drop,
        // decrementing its retain count to zero. Apple's convention is
        // that frameworks Block_copy completion handlers they store, so
        // in practice the block survives via EventKit's own retain. But
        // the binding signature is `*mut Block` (no auto-retain), and
        // any future binding change or undocumented Apple behavior that
        // skipped Block_copy would silently regress to a use-after-free
        // when EventKit eventually invokes the closure. Leak is bounded
        // memory — one block per session, <1 KB — and trades a trivial
        // residual for closing the unsafe foot-gun.
        std::mem::forget(block);

        let (lock, cvar) = &*pair;
        let guard = lock
            .lock()
            .map_err(|e| format!("lock poisoned: {}", e))?;
        let (guard, _timeout) = cvar
            .wait_timeout_while(guard, Duration::from_secs(30), |g| g.is_none())
            .map_err(|e| format!("wait poisoned: {}", e))?;

        if guard.is_none() {
            return Err("Permission prompt timed out".to_string());
        }

        // Re-read via the system source-of-truth API rather than
        // returning the bool from the closure — the closure's bool is
        // informative but `authorizationStatus` is what other code
        // will see.
        Ok(self.permission_status())
    }

    fn calendar_list(&self) -> Result<Vec<CalendarMeta>, String> {
        let calendars: Retained<NSArray<EKCalendar>> =
            unsafe { self.store.calendarsForEntityType(EKEntityType::Event) };

        let mut out = Vec::with_capacity(calendars.len());
        for cal in calendars.iter() {
            let id = unsafe { cal.calendarIdentifier() }.to_string();
            let name = unsafe { cal.title() }.to_string();
            out.push(CalendarMeta { id, name });
        }
        Ok(out)
    }

    fn events_for_date(&self, date_iso: &str) -> Result<Vec<CalendarEvent>, String> {
        // Quick permission gate — if not granted, surface a typed
        // error so the JS layer can route the user to System Settings
        // rather than blow up on a NULL predicate result.
        if self.permission_status() != PermissionStatus::Granted {
            return Err("permission_not_granted".to_string());
        }

        let (year, month, day) = parse_date_iso(date_iso)?;
        let start_ns = nsdate_for_local(year, month, day)?;
        let end_ns = nsdate_for_local_plus_one_day(&start_ns)?;

        let predicate: Retained<NSPredicate> = unsafe {
            self.store
                .predicateForEventsWithStartDate_endDate_calendars(&start_ns, &end_ns, None)
        };
        let events: Retained<NSArray<EKEvent>> =
            unsafe { self.store.eventsMatchingPredicate(&predicate) };

        let mut out = Vec::with_capacity(events.len());
        for event in events.iter() {
            // eventIdentifier is the only one of these accessors the
            // objc2-event-kit binding marks Optional (Apple's header
            // says it can be nil for unsaved events). Skip the row if
            // it's missing — better to drop one than fail the sync.
            let external_id = match unsafe { event.eventIdentifier() } {
                Some(s) => s.to_string(),
                None => continue,
            };

            let (calendar_id, calendar_name) = match unsafe { event.calendar() } {
                Some(cal) => (
                    unsafe { cal.calendarIdentifier() }.to_string(),
                    unsafe { cal.title() }.to_string(),
                ),
                None => (String::new(), String::new()),
            };

            let title = unsafe { event.title() }.to_string();

            let all_day = unsafe { event.isAllDay() };

            let start_date = unsafe { event.startDate() };
            let start_local = nsdate_to_local_iso_minute(&start_date);

            // endDate is non-Optional in the binding too. For events
            // with no end (rare; usually only happens for journal-style
            // entries) Apple returns a sentinel; the formatter still
            // produces a string. Wrap in Some() for the JS-facing
            // type.
            let end_date = unsafe { event.endDate() };
            let end_local = Some(nsdate_to_local_iso_minute(&end_date));

            let status = match unsafe { event.status() } {
                EKEventStatus::Confirmed => "confirmed",
                EKEventStatus::Tentative => "tentative",
                EKEventStatus::Canceled => "cancelled",
                _ => "none",
            }
            .to_string();

            // Optional metadata: notes (event description), location,
            // url, attendees, organizer email. EKEvent inherits these
            // from EKCalendarItem. All accessors are Option<…>; treat
            // empty strings as None too so the JS layer doesn't have to
            // distinguish "" from missing.
            let notes = unsafe { event.notes() }
                .map(|s| s.to_string())
                .filter(|s| !s.is_empty());
            let location = unsafe { event.location() }
                .map(|s| s.to_string())
                .filter(|s| !s.is_empty());
            let url = unsafe { event.URL() }.and_then(nsurl_to_string);

            let attendees = match unsafe { event.attendees() } {
                Some(arr) => arr.iter().map(participant_to_attendee).collect(),
                None => Vec::new(),
            };

            let organizer_email = unsafe { event.organizer() }
                .and_then(|p| email_from_participant(&p));

            let self_status = self_participation_status(&event);

            out.push(CalendarEvent {
                external_id,
                calendar_id,
                calendar_name,
                title,
                start_local,
                end_local,
                all_day,
                status,
                notes,
                location,
                url,
                attendees,
                organizer_email,
                self_status,
            });
        }

        Ok(out)
    }
}

// ───────────────────────────────────────────────────────────────────
// EKParticipant / NSURL helpers
// ───────────────────────────────────────────────────────────────────

/// Convert an NSURL to a String via `absoluteString`. Skip empty
/// strings so the caller can treat them as None.
fn nsurl_to_string(url: Retained<NSURL>) -> Option<String> {
    url.absoluteString()
        .map(|ns| ns.to_string())
        .filter(|s| !s.is_empty())
}

/// EKParticipant.URL is typically a `mailto:foo@bar.com` URL — pull
/// out the email portion. Returns None if the URL doesn't parse as
/// mailto or the local part is empty.
fn email_from_participant(p: &EKParticipant) -> Option<String> {
    let url = unsafe { p.URL() };
    let raw = url.absoluteString()?.to_string();
    raw.strip_prefix("mailto:")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Map EKParticipantStatus → the lowercase string the JS layer expects.
fn participant_status_str(status: EKParticipantStatus) -> &'static str {
    match status {
        EKParticipantStatus::Accepted => "accepted",
        EKParticipantStatus::Declined => "declined",
        EKParticipantStatus::Tentative => "tentative",
        EKParticipantStatus::Pending => "pending",
        _ => "unknown",
    }
}

fn participant_to_attendee(p: Retained<EKParticipant>) -> Attendee {
    let name = unsafe { p.name() }
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty());
    let email = email_from_participant(&p);
    let status = participant_status_str(unsafe { p.participantStatus() }).to_string();
    Attendee { name, email, status }
}

/// Resolve the current user's relationship to an event so the sync layer
/// can import only accepted events. EventKit flags the current user on
/// the relevant `EKParticipant` via `isCurrentUser`.
///
/// Precedence: organizer-is-me wins ("organizer" — your own event, no
/// RSVP to make), then the current-user attendee's RSVP, then "none"
/// (no current-user participant — a solo block, or EventKit couldn't
/// identify us; importable by default). See the `self_status` field doc.
fn self_participation_status(event: &EKEvent) -> String {
    if let Some(org) = unsafe { event.organizer() } {
        if unsafe { org.isCurrentUser() } {
            return "organizer".to_string();
        }
    }
    if let Some(attendees) = unsafe { event.attendees() } {
        for p in attendees.iter() {
            if unsafe { p.isCurrentUser() } {
                return participant_status_str(unsafe { p.participantStatus() }).to_string();
            }
        }
    }
    "none".to_string()
}

// ───────────────────────────────────────────────────────────────────
// Date helpers — local-tz NSDate ↔ ISO conversion via NSCalendar.
// ───────────────────────────────────────────────────────────────────

fn parse_date_iso(s: &str) -> Result<(i32, u32, u32), String> {
    let parts: Vec<&str> = s.split('-').collect();
    if parts.len() != 3 {
        return Err(format!("invalid date_iso: {}", s));
    }
    let y: i32 = parts[0]
        .parse()
        .map_err(|_| format!("invalid year in date_iso: {}", s))?;
    let m: u32 = parts[1]
        .parse()
        .map_err(|_| format!("invalid month in date_iso: {}", s))?;
    let d: u32 = parts[2]
        .parse()
        .map_err(|_| format!("invalid day in date_iso: {}", s))?;
    Ok((y, m, d))
}

// #40 — the only caller ever passed 0/0/0 for time-of-day (local midnight), so
// the hour/minute/second params were dead. Set them to 0 literals inside.
fn nsdate_for_local(year: i32, month: u32, day: u32) -> Result<Retained<NSDate>, String> {
    unsafe {
        let cal_cls = AnyClass::get(c"NSCalendar")
            .ok_or_else(|| "NSCalendar class not found".to_string())?;
        let calendar: *mut AnyObject = msg_send![cal_cls, currentCalendar];
        if calendar.is_null() {
            return Err("currentCalendar returned nil".to_string());
        }

        let comp_cls = AnyClass::get(c"NSDateComponents")
            .ok_or_else(|| "NSDateComponents class not found".to_string())?;
        let components: *mut AnyObject = msg_send![comp_cls, new];
        let _: () = msg_send![components, setYear: year as i64];
        let _: () = msg_send![components, setMonth: month as i64];
        let _: () = msg_send![components, setDay: day as i64];
        let _: () = msg_send![components, setHour: 0i64];
        let _: () = msg_send![components, setMinute: 0i64];
        let _: () = msg_send![components, setSecond: 0i64];

        let date_ptr: *mut NSDate = msg_send![calendar, dateFromComponents: components];
        let _: () = msg_send![components, release];
        if date_ptr.is_null() {
            return Err("dateFromComponents returned nil".to_string());
        }
        Retained::retain(date_ptr).ok_or_else(|| "retain failed".to_string())
    }
}

// #39 — add ONE CALENDAR DAY (not a fixed 86400s) so the day-end lands on the
// next LOCAL midnight even across the two DST-transition days each year, where a
// local day is 23h or 25h. NSCalendar handles the shift.
fn nsdate_for_local_plus_one_day(start: &NSDate) -> Result<Retained<NSDate>, String> {
    unsafe {
        let cal_cls = AnyClass::get(c"NSCalendar")
            .ok_or_else(|| "NSCalendar class not found".to_string())?;
        let calendar: *mut AnyObject = msg_send![cal_cls, currentCalendar];
        if calendar.is_null() {
            return Err("currentCalendar returned nil".to_string());
        }
        // NSCalendarUnitDay = 1 << 4 = 16; options 0.
        let next_ptr: *mut NSDate = msg_send![
            calendar,
            dateByAddingUnit: 16usize,
            value: 1isize,
            toDate: start,
            options: 0usize,
        ];
        if next_ptr.is_null() {
            return Err("dateByAddingUnit returned nil".to_string());
        }
        Retained::retain(next_ptr).ok_or_else(|| "retain failed".to_string())
    }
}

fn nsdate_to_local_iso_minute(date: &NSDate) -> String {
    unsafe {
        let formatter_cls = match AnyClass::get(c"NSDateFormatter") {
            Some(c) => c,
            None => return String::new(),
        };
        let formatter: *mut AnyObject = msg_send![formatter_cls, new];
        let format = NSString::from_str("yyyy-MM-dd'T'HH:mm");
        let _: () = msg_send![formatter, setDateFormat: &*format];

        let s_ptr: *mut NSString = msg_send![formatter, stringFromDate: date];
        let result = if s_ptr.is_null() {
            String::new()
        } else if let Some(s) = Retained::retain(s_ptr) {
            s.to_string()
        } else {
            String::new()
        };
        let _: () = msg_send![formatter, release];
        result
    }
}

// ───────────────────────────────────────────────────────────────────
// Tauri commands — only these cross the JS boundary (Verse A5).
// ───────────────────────────────────────────────────────────────────

pub struct CalendarState {
    pub source: Box<dyn CalendarSource>,
}

#[tauri::command]
pub fn calendar_check_permission(
    state: tauri::State<'_, CalendarState>,
) -> PermissionStatus {
    state.source.permission_status()
}

#[tauri::command]
pub fn calendar_request_permission(
    state: tauri::State<'_, CalendarState>,
) -> Result<PermissionStatus, String> {
    state.source.request_permission()
}

#[tauri::command]
pub fn calendar_get_calendar_list(
    state: tauri::State<'_, CalendarState>,
) -> Result<Vec<CalendarMeta>, String> {
    state.source.calendar_list()
}

#[tauri::command]
pub fn calendar_get_events_for_date(
    state: tauri::State<'_, CalendarState>,
    date_iso: String,
) -> Result<Vec<CalendarEvent>, String> {
    state.source.events_for_date(&date_iso)
}
