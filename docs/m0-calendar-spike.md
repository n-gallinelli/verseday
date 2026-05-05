# M0 — Calendar Recurring-Event ID Spike

**Status:** RUN — **FAIL**
**Date:** 2026-05-05
**Outcome:** AppleScript cannot disambiguate recurring-event instances. Plan v2 path aborted; revise to EventKit (plan v3).

---

## What we ran

The script in this doc's prior version, run twice via `osascript`
querying every calendar in Calendar.app for events between
`today (00:00 local)` and `today + 14 days`. Output JSON-encoded.

## What we found

### 1. Recurring events COLLAPSE to the series uid

Three recurring events in the user's calendar appeared multiple
times in the output, but each occurrence shared the same `uid`
**and** the same `start date`:

| Title | uid | Occurrences in window | Repeated `start` |
|---|---|---|---|
| Macro Funnel Experimentation Weekly | `03123425-…E978AE` | 2 rows | 2026-05-04 12:00 |
| Coffee with Core | `0D144FB9-…3FF624` | 3 rows | 2026-05-11 13:00 |
| Weekly Kudos & Recognition Moment | `2A734756-…C8D5B8` | 2 rows | 2026-04-10 00:00 |

→ Distinct occurrences are *indistinguishable* from the AppleScript
output. The upsert key (`external_id`) collapses them to a single
task; the second-occurrence INSERT becomes a no-op against the
partial index. **Pass criterion #1 fails.**

### 2. Date-range filter operates on series anchor, not occurrences

Multiple events with `start` dates *well outside* the queried 14-day
window were returned (e.g., March 24, March 26, April 8, April 10,
April 16, November 12, 2025). The `whose start date >= startDate
and start date < endDate` filter is matching the **series's original
anchor**, not the occurrence dates. Even with a 14-day window, we
got events with anchors months in the past whose recurrence
*happened* to extend into our window.

→ The natural AppleScript query shape leaks unrelated past-anchor
data while still failing to disambiguate the actual occurrences we
want.

### 3. uids are stable across runs

Run 1 and Run 2 produced byte-identical JSON. The "stable across
launches" criterion (#3) passes — but it's moot given #1.

### 4. Calendar.app launch behavior — unverified

The Bash session can't observe whether Calendar.app bounced into
the dock during the read. This is the one criterion that wasn't
verified objectively. Less critical now that the path is being
abandoned.

---

## Verdict

**FAIL** per plan v2 criterion #1.

Per plan v2 fail-path: "abort the AppleScript path, switch to
EventKit binding (`objc2-event-kit`), update the plan, re-submit to
Verse."

---

## Why EventKit fixes this

EventKit's `EKEventStore.events(matching:)` API returns
`EKEvent` objects where:
- `eventIdentifier` includes a recurrence-instance suffix for events
  in a recurring series, so today's standup and tomorrow's standup
  are distinct identifiers.
- The query's `NSPredicate` filters by **occurrence date**, not
  series anchor. We get exactly the events that occur in the
  window.
- `occurrenceDate` is exposed per-instance.

Trade-offs:
- Adds Rust crate dependency (`objc2`, `objc2-foundation`,
  `objc2-event-kit`, `block2` — all in the same family).
- Tauri Info.plist needs `NSCalendarsUsageDescription`.
- Permission model is now "Calendars" (not "Automation"); same UX
  end-result for the user but a different prompt.
- macOS 14+ floor (Verse already flagged in plan v2 risks).

---

## Action items

1. Plan v3 written: replace `AppleScriptSource` with `EventKitSource`.
2. Re-submit plan v3 to Verse for approval before M1 starts.
3. /tmp/m0-calendar-spike.applescript can be removed; this doc
   captures everything we needed from it.

---

## Cleanup

```bash
rm -f /tmp/m0-calendar-spike.applescript
```
