//! C3 verification harness (Verse, 2026-05-05) — runtime check that
//! EventKit returns *distinct* per-instance identifiers for recurring
//! events. The AppleScript M0 spike collapsed every "Coffee with Core"
//! into the same uid; that regression is the entire premise of the
//! EventKit pivot, so M1 stays unverified until this passes against a
//! real macOS Calendar.app.
//!
//! Run it on a Mac with Calendar.app populated:
//!     cd src-tauri && cargo run --example calendar_recurrence_check
//!
//! Optional arg: start date (YYYY-MM-DD). Defaults to today. The check
//! sweeps a 14-day window from there.
//!
//! Pass criterion: every title that appears on more than one day comes
//! back with a distinct `external_id` per occurrence.

#[cfg(target_os = "macos")]
fn main() {
    use app_lib::calendar::{
        CalendarEvent, CalendarSource, EventKitSource, PermissionStatus,
    };
    use std::collections::HashMap;

    let args: Vec<String> = std::env::args().collect();
    let start_iso = args.get(1).cloned().unwrap_or_else(today_local_iso);

    eprintln!("== C3 recurrence check — start={} (14-day window) ==", start_iso);

    let source = EventKitSource::new();

    // Permission gate. If not granted, prompt; if denied, exit.
    let initial = source.permission_status();
    eprintln!("permission (initial): {:?}", initial);
    if initial != PermissionStatus::Granted {
        eprintln!("requesting permission (this may surface the system prompt)…");
        match source.request_permission() {
            Ok(s) => eprintln!("permission (post-request): {:?}", s),
            Err(e) => {
                eprintln!("FAIL: request_permission errored: {}", e);
                std::process::exit(2);
            }
        }
        if source.permission_status() != PermissionStatus::Granted {
            eprintln!("FAIL: permission not granted — cannot run check");
            std::process::exit(2);
        }
    }

    let calendars = match source.calendar_list() {
        Ok(cs) => cs,
        Err(e) => {
            eprintln!("FAIL: calendar_list errored: {}", e);
            std::process::exit(2);
        }
    };
    eprintln!("found {} calendar(s)", calendars.len());

    // Sweep the window, grouping (title, all_day) → list of (date, ext_id).
    let dates = next_n_days(&start_iso, 14);
    let mut groups: HashMap<(String, bool), Vec<(String, String)>> = HashMap::new();
    let mut total_events = 0usize;

    for date in &dates {
        let events: Vec<CalendarEvent> = match source.events_for_date(date) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("FAIL: events_for_date({}) errored: {}", date, e);
                std::process::exit(2);
            }
        };
        total_events += events.len();
        for ev in events {
            groups
                .entry((ev.title.clone(), ev.all_day))
                .or_default()
                .push((date.clone(), ev.external_id));
        }
    }

    eprintln!("scanned {} day(s), {} event(s) total", dates.len(), total_events);

    // Recurrence groups = any title that appears on >1 day. (Same title
    // twice on the same day is normal back-to-back booking, not a
    // recurrence — filter dedup by date count, not raw count.)
    let mut recurring: Vec<(&(String, bool), &Vec<(String, String)>)> = groups
        .iter()
        .filter(|(_, v)| {
            let unique_dates: std::collections::HashSet<&String> =
                v.iter().map(|(d, _)| d).collect();
            unique_dates.len() > 1
        })
        .collect();
    recurring.sort_by_key(|((title, _), _)| title.clone());

    if recurring.is_empty() {
        eprintln!();
        eprintln!("INDETERMINATE: no recurring events landed in this 14-day window.");
        eprintln!("  Re-run with a window that covers a known recurring event.");
        eprintln!("  Example: cargo run --example calendar_recurrence_check -- 2026-05-12");
        std::process::exit(3);
    }

    eprintln!();
    eprintln!("recurring titles in window:");
    let mut all_pass = true;
    for ((title, all_day), occurrences) in &recurring {
        let ids: Vec<&str> = occurrences.iter().map(|(_, id)| id.as_str()).collect();
        let distinct: std::collections::HashSet<&str> = ids.iter().copied().collect();
        let pass = distinct.len() == ids.len();
        let tag = if pass { "PASS" } else { "FAIL" };
        eprintln!(
            "  [{}] {:?}{}  — {} occurrences, {} distinct external_ids",
            tag,
            title,
            if *all_day { " (all-day)" } else { "" },
            ids.len(),
            distinct.len()
        );
        for (date, id) in occurrences.iter() {
            eprintln!("        {}  {}", date, short_id(id));
        }
        if !pass {
            all_pass = false;
        }
    }

    eprintln!();
    if all_pass {
        eprintln!(
            "PASS: {} recurring title(s), all per-instance external_ids distinct.",
            recurring.len()
        );
        std::process::exit(0);
    } else {
        eprintln!(
            "FAIL: at least one recurring title returned colliding external_ids."
        );
        eprintln!("This is the AppleScript regression we pivoted to EventKit to avoid.");
        std::process::exit(1);
    }
}

#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("calendar_recurrence_check only runs on macOS.");
    std::process::exit(2);
}

#[cfg(target_os = "macos")]
fn today_local_iso() -> String {
    use objc2::msg_send;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2_foundation::NSString;
    unsafe {
        let formatter_cls = AnyClass::get(c"NSDateFormatter").expect("NSDateFormatter");
        let formatter: *mut AnyObject = msg_send![formatter_cls, new];
        let fmt = NSString::from_str("yyyy-MM-dd");
        let _: () = msg_send![formatter, setDateFormat: &*fmt];
        let date_cls = AnyClass::get(c"NSDate").expect("NSDate");
        let now: *mut AnyObject = msg_send![date_cls, date];
        let s_ptr: *mut NSString = msg_send![formatter, stringFromDate: now];
        let result = Retained::retain(s_ptr)
            .map(|s| s.to_string())
            .unwrap_or_default();
        let _: () = msg_send![formatter, release];
        result
    }
}

#[cfg(target_os = "macos")]
fn next_n_days(start_iso: &str, n: usize) -> Vec<String> {
    use objc2::msg_send;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2_foundation::{NSDate, NSString};

    unsafe {
        let cal_cls = AnyClass::get(c"NSCalendar").expect("NSCalendar");
        let calendar: *mut AnyObject = msg_send![cal_cls, currentCalendar];

        let comp_cls = AnyClass::get(c"NSDateComponents").expect("NSDateComponents");
        let parts: Vec<&str> = start_iso.split('-').collect();
        let y: i64 = parts[0].parse().expect("year");
        let m: i64 = parts[1].parse().expect("month");
        let d: i64 = parts[2].parse().expect("day");

        let components: *mut AnyObject = msg_send![comp_cls, new];
        let _: () = msg_send![components, setYear: y];
        let _: () = msg_send![components, setMonth: m];
        let _: () = msg_send![components, setDay: d];
        let _: () = msg_send![components, setHour: 0_i64];
        let _: () = msg_send![components, setMinute: 0_i64];
        let _: () = msg_send![components, setSecond: 0_i64];
        let start_ptr: *mut NSDate = msg_send![calendar, dateFromComponents: components];
        let _: () = msg_send![components, release];
        let start: Retained<NSDate> = Retained::retain(start_ptr).expect("start NSDate");

        let formatter_cls = AnyClass::get(c"NSDateFormatter").expect("NSDateFormatter");
        let formatter: *mut AnyObject = msg_send![formatter_cls, new];
        let fmt = NSString::from_str("yyyy-MM-dd");
        let _: () = msg_send![formatter, setDateFormat: &*fmt];

        let mut out = Vec::with_capacity(n);
        for i in 0..n {
            let interval: f64 = (i as f64) * 86_400.0;
            let next_ptr: *mut NSDate =
                msg_send![&*start, dateByAddingTimeInterval: interval];
            let s_ptr: *mut NSString = msg_send![formatter, stringFromDate: next_ptr];
            if let Some(s) = Retained::retain(s_ptr) {
                out.push(s.to_string());
            }
        }
        let _: () = msg_send![formatter, release];
        out
    }
}

#[cfg(target_os = "macos")]
fn short_id(id: &str) -> String {
    if id.len() <= 18 {
        id.to_string()
    } else {
        format!("{}…{}", &id[..8], &id[id.len() - 8..])
    }
}
