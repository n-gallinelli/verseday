# M1 Calendar Recurrence Verification (C3)

**Date:** 2026-05-05
**Status:** ✅ PASS
**Verse ask:** runtime gate that EventKit returns distinct per-instance
identifiers for recurring events, closing the M0 AppleScript failure
mode (recurring events collapsed to series uids — see
`docs/m0-calendar-spike.md`).

## Method

`src-tauri/examples/calendar_recurrence_check.rs` — sweeps a 14-day
window from a start date, groups events by title, and asserts every
title that appears on more than one day comes back with distinct
`external_id` values. Pass criterion: per-day occurrence count equals
distinct-external-id count for every recurring title.

```
cd src-tauri
cargo run --example calendar_recurrence_check
```

## Output (2026-05-05 → 2026-05-18)

```
== C3 recurrence check — start=2026-05-05 (14-day window) ==
permission (initial): Denied
requesting permission (this may surface the system prompt)…
permission (post-request): Granted
found 8 calendar(s)
scanned 14 day(s), 25 event(s) total

recurring titles in window:
  [PASS] "CRO Weekly"  — 2 occurrences, 2 distinct external_ids
        2026-05-07  3897AE39…99871400
        2026-05-14  3897AE39…ogle.com
  [PASS] "Coffee with Core"  — 2 occurrences, 2 distinct external_ids
        2026-05-11  3897AE39…00211600
        2026-05-18  3897AE39…00816400
  [PASS] "Growth Marketing WBR"  — 2 occurrences, 2 distinct external_ids
        2026-05-07  3897AE39…99866000
        2026-05-14  3897AE39…ogle.com
  [PASS] "Macro Funnel Experimentation Weekly"  — 2 occurrences, 2 distinct external_ids
        2026-05-11  3897AE39…00208000
        2026-05-18  3897AE39…00812800
  [PASS] "Weekly Kudos & Recognition Moment" (all-day)  — 2 occurrences, 2 distinct external_ids
        2026-05-08  3897AE39…99891200
        2026-05-15  3897AE39…00496000

PASS: 5 recurring title(s), all per-instance external_ids distinct.
```

## Notable

- **"Coffee with Core"** — the specific event called out in the M0 spike
  as the AppleScript failure case — returned 2 distinct ids on its 2
  occurrences in this window. AppleScript would have collapsed to one.
- 5 recurring titles total, including a mix of timed and all-day
  events; all passed.
- Permission was initially `Denied` then granted via the system
  dialog on the harness's `request_permission` call; the C1 fix
  (`mem::forget(block)` on the completion handler) survived the
  user-takes-time-to-click code path without UAF.
- 8 calendars enumerated, 25 total events across 14 days — non-trivial
  fixture set, not a single contrived event.

## Conclusion

M1 (schema v18 + EventKit Rust bridge) is empirically verified. The
EventKit pivot from AppleScript closes the recurrence-uid collapse
that drove the M0 failure. M2 (TS sync layer) is unblocked for
implementation — pending the rebase of `feat/calendar-integration`
onto post-PR-#1 main, since M2's `localDateIso` import lives on
`feat/weekly-planning`.

## Rerun cadence

Re-run when:
- Bumping `objc2-event-kit` minor (G3 in plan v3).
- Touching anything in `src-tauri/src/calendar.rs` that affects event
  identity (eventIdentifier handling, predicate construction, NSDate
  conversion).
- macOS major version bump (Apple has historically tweaked EventKit
  semantics across releases).
