# Calendar Integration — Implementation Plan (for Verse review)

**Date:** 2026-05-05
**Author:** Terse
**Revision:** v3 — M0 spike failed, switching to EventKit
**Branch (proposed):** `feat/calendar-integration` (off `main`, separate branch)

> **v3 summary:** the M0 AppleScript spike (see `docs/m0-calendar-spike.md`)
> failed criterion #1 — recurring-event instances collapse to the series
> uid, making the upsert key shape unworkable. Per plan v2's fail
> outcome, M1 swaps `AppleScriptSource` for `EventKitSource`. Everything
> else in v2 (schema, trait shape, Option-X dismissal model, sync
> algorithm, milestones M2-M5) survives unchanged because the trait
> abstraction kept the swap contained.

## Goal

Read events from the user's macOS Calendar.app and surface them as
tasks in VerseDay for the day they're scheduled. One-way pull
(Calendar → VerseDay). User can disable integration at any time. No
event data leaves the device.

---

## Critical decisions

### D1. Bridge to Calendar.app: EventKit (`objc2-event-kit`)

**Outcome of v2's M0 spike**: AppleScript fails — recurring events
collapse to a single uid. Switching to Apple's EventKit framework via
the `objc2-event-kit` Rust binding. The trait abstraction defined
below is unchanged from v2; only the implementation switches.

**Why EventKit handles what AppleScript can't:**
- `EKEvent.eventIdentifier` is per-instance for recurring events
  (today's standup ≠ tomorrow's standup).
- `EKEventStore.predicateForEvents(withStart:end:calendars:)` filters
  by **occurrence date**, returning expanded instances within the
  window.
- `EKEvent.occurrenceDate` exposes the per-instance start.

**New requirements introduced by EventKit:**
- Rust crates: `objc2`, `objc2-foundation`, `objc2-event-kit`,
  `block2`. All in one consistent family from `objc2`'s ecosystem.
- Info.plist key `NSCalendarsUsageDescription` describing why the app
  reads Calendar data. Tauri 2 supports this via
  `tauri.conf.json` → `bundle.macOS.entitlements` /
  `infoPlist`.
- Permission domain is **Calendars** (not Automation). Different prompt
  copy for the user; same end-result.
- **macOS 14+ floor.** EventKit is older, but the modern access-level
  API (`EKEventStore.requestFullAccessToEvents`, replacing the
  pre-14 `requestAccess`) ships on 14+. Older fallback is possible
  but doubles the auth code path; recommending we just declare 14+
  as the floor and skip the fallback.

**Rust-side trait abstraction (defined now, not "later"):**

```rust
pub trait CalendarSource {
    fn permission_status(&self) -> Result<PermissionStatus>;
    fn calendar_list(&self) -> Result<Vec<CalendarMeta>>;
    fn events_for_date(&self, date_iso: &str) -> Result<Vec<CalendarEvent>>;
}

pub enum PermissionStatus { Granted, Denied, Prompt }

pub struct CalendarMeta { pub id: String, pub name: String }

pub struct CalendarEvent {
    pub external_id: String,         // stable per-instance id
    pub calendar_id: String,
    pub calendar_name: String,
    pub title: String,
    pub start_local: String,         // YYYY-MM-DDTHH:MM (local)
    pub end_local: Option<String>,
    pub all_day: bool,
    pub location: Option<String>,
    pub status: EventStatus,         // Confirmed | Cancelled | Tentative
}
```

Implementation:
- `EventKitSource` (M1) — see "Why EventKit handles what AppleScript
  can't" above.

`AppleScriptSource` was explored in M0 and abandoned per
`docs/m0-calendar-spike.md`.

The three `#[tauri::command]` fns take `&dyn CalendarSource`. The
TS-facing surface (`CalendarEvent` JSON shape, error variants) is
identical regardless of source — so a swap is contained to one Rust
file with no TS changes.

### D2. Schema: denormalized columns on `tasks` (unchanged from v1)

`external_source TEXT`, `external_id TEXT`, `external_dismissal_reason
TEXT` directly on the `tasks` table. Partial index on
`(external_source, external_id) WHERE external_source IS NOT NULL`.

### D3. Sync direction: one-way pull only (unchanged)

### D4. Cancelled vs dismissed (Verse B3) — TEXT enum, not boolean

Replaced the v1 `external_dismissed INTEGER` with
`external_dismissal_reason TEXT`. Two values today: `'user'` (user
deleted the task locally) and `'cancelled'` (calendar reported the
event cancelled). Differentiating preserves the option to re-import a
cancelled-then-uncancelled event without overriding the user's "no,
keep it gone" decision. Schema cost is identical.

### D5. M5 deferral (Verse) — simple-implementation now, not later

Per Verse: "preserve user-edited title once a sync has happened" does
**not** need per-field provenance. **M2 onward: the sync UPSERT only
INSERTs new tasks; it never UPDATEs existing ones.** Time/duration
changes in Calendar do not propagate after the first import. Acceptable
for v1; revisit in M5 with usage data.

This eliminates the "M2-M5 leak" Verse called out in B4 — there's no
UPDATE branch to leak through.

(`tasks` has no `updated_at` column today; verified at `lib.rs`. Don't
plan around one that doesn't exist.)

---

## M0 — Spike (RUN; FAIL; archived)

Status: **complete, fail**. See `docs/m0-calendar-spike.md` for full
findings.

Headline: AppleScript's `every event` returns series, not occurrences,
and `uid` is the series uid — both today's and tomorrow's standup
share `03123425-…E978AE`. Plan switched to EventKit per v2's
fail-path. No further M0 work.

---

## Schema migration (v18, additive only)

```sql
-- Origin tracking on tasks. NULL for in-app tasks.
ALTER TABLE tasks ADD COLUMN external_source TEXT
  CHECK (external_source IS NULL OR external_source = 'calendar');
ALTER TABLE tasks ADD COLUMN external_id TEXT;

-- Dismissal reason: 'user' = user deleted locally, 'cancelled' = the
-- calendar reported the event cancelled. NULL = active import.
ALTER TABLE tasks ADD COLUMN external_dismissal_reason TEXT
  CHECK (external_dismissal_reason IS NULL
         OR external_dismissal_reason IN ('user', 'cancelled'));

-- Partial index: only indexes rows that came from an external source,
-- so the upsert lookup is O(log n_imported), not O(log n_total).
CREATE INDEX IF NOT EXISTS idx_tasks_external
  ON tasks (external_source, external_id)
  WHERE external_source IS NOT NULL;
```

**B2 fix applied** (Verse): CHECKs use `IS NULL OR x = 'value'` form,
not `IN (..., NULL)` (which silently fails as NULL is never `IN` a list
in SQLite).

Settings rows (existing `settings` table, key/value):
- `calendar_integration_enabled`: `'1' | '0'`
- `calendar_last_synced_at`: ISO timestamp
- `calendar_excluded_calendars`: JSON array of excluded calendar names

---

## Rust side

### `src-tauri/Cargo.toml` additions

```toml
objc2 = "0.5"
objc2-foundation = "0.2"
objc2-event-kit = "0.2"
block2 = "0.5"
```

(Versions are placeholders — pin to whatever the latest 0.x line
publishes when implementing.)

### `src-tauri/src/calendar.rs` (new)

- `CalendarSource` trait + `EventKitSource` impl + types listed in D1.
- Permission flow: call
  `EKEventStore::requestFullAccessToEvents:completion:` (macOS 14+).
  Map result to `PermissionStatus`. Block on the completion via a
  `block2::Block` + condvar so the Tauri command returns synchronously.
- `events_for_date(date_iso)`:
  1. Parse `date_iso` (YYYY-MM-DD) via `chrono` (already a transitive
     dep) into a local-tz `NaiveDateTime` for the day boundaries.
  2. Convert to `NSDate` via `objc2-foundation`.
  3. Build predicate: `predicateForEvents(withStart:end:calendars:nil)`.
  4. Call `events(matching:)` — returns `[EKEvent]` already expanded
     to per-instance.
  5. Map each `EKEvent` to our `CalendarEvent` struct, using
     `eventIdentifier` (per-instance) for `external_id`.
- All `objc2` autorelease-pool semantics confined to this file.
- No subprocess. No string interpolation. (B1 from v2 is now moot —
  no AppleScript exists.)
- Error mapping: typed errors for `Denied`, `NotDetermined`,
  `Restricted`. No stringly-typed parsing.

### `src-tauri/src/lib.rs`

- Migration v18 (unchanged from v2).
- Register Tauri commands (unchanged from v2):
  - `calendar_check_permission`
  - `calendar_get_calendar_list`
  - `calendar_get_events_for_date`
- **No** capability changes (no shell, no extra permissions). Only
  the three named Tauri commands cross the JS boundary (Verse A5).

### `src-tauri/tauri.conf.json`

Add the macOS Info.plist key:

```json
"bundle": {
  "macOS": {
    "infoPlist": {
      "NSCalendarsUsageDescription": "VerseDay reads your Calendar.app events to surface them as tasks for the day. Data stays local to this device and is never sent anywhere."
    }
  }
}
```

Wording is user-facing — Apple's permission prompt shows it verbatim.

---

## TS side

### `src/calendar/types.ts`

Mirror of `CalendarEvent` from Rust.

### `src/calendar/sync.ts`

```ts
export async function syncCalendarEventsForDate(
  dateIso: string,
  opts: { force?: boolean } = {}
): Promise<{ created: number; skipped: number }>
```

Behavior:
1. If integration disabled → return `{ created: 0, skipped: 0 }`.
2. **TTL guard (Verse A1/A2)**: unless `opts.force`, skip if
   `last_sync_for_date[dateIso]` < 5 minutes ago.
3. Invoke `calendar_get_events_for_date(dateIso)` Tauri command.
4. Filter out events from excluded calendars + any with status =
   `Cancelled`.
5. For each remaining event, call `upsertCalendarTask` —
   **INSERT-only**. Existing rows with matching `external_id` are
   skipped (counted as `skipped`).
6. Stamp `calendar_last_synced_at` setting.

### `src/db/queries.ts` additions

- `upsertCalendarTask(event)` — `INSERT INTO tasks (...) ON CONFLICT
  DO NOTHING` keyed on the partial index. Returns boolean (inserted
  or skipped).
- `markTaskDismissed(taskId, reason)` — **soft-delete via column**
  (Verse pre-M2 ask): keeps the row, sets
  `external_dismissal_reason = reason`. Existing user-facing task
  queries gain a `WHERE external_dismissal_reason IS NULL` filter so
  dismissed rows disappear from the UI but remain as tombstones for
  the sync loop to consult. No new tables, no separate registry.
- `getDismissedExternalIds(dateIso)` — `SELECT external_id FROM tasks
  WHERE date_scheduled = $1 AND external_source = 'calendar' AND
  external_dismissal_reason = 'user'`. Used by M2's sync to skip
  re-importing tasks the user explicitly removed.

### `src/calendar/hooks.ts`

`useCalendarSync(date)` — fires sync on mount + on date change +
hourly. **Hourly tick is focus-aware from M4 (Verse A4)**:
`document.visibilityState === "visible"` check before invoking.

### Date handling (Verse A3)

All date string conversions in `sync.ts` use
`localDateIso(d)` from `src/utils/dates.ts` — explicit. No raw
`toISOString().split("T")[0]` in the calendar pipeline.

---

## Behavior

### Sync triggers
- Daily Plan mount (TTL-guarded)
- `selectedDate` change (TTL-guarded; also debounced via the TTL)
- Manual "Sync now" button in Settings (`force: true`)
- Hourly `setInterval` while app is open AND visible

### Sync algorithm (final)
1. Disabled → exit.
2. TTL hit → exit (unless forced).
3. Get events for `dateIso` from Tauri.
4. Drop excluded calendars.
5. Drop events with `status === 'Cancelled'`. (Already-imported
   tasks for these stay in DB; user-visible behavior covered in M5.)
6. Get dismissed external_ids for the date.
7. For each remaining event: skip if `external_id` is in dismissed
   set; else `upsertCalendarTask` (INSERT-only).
8. Stamp `calendar_last_synced_at`.

### Permission flow (Verse A6)
- Toggle is OFF by default. Settings shows pre-prompt copy explaining
  what the toggle does and that data stays local.
- **Permission is requested only after user clicks the toggle on**,
  not at app launch and not on the hourly tick before opt-in.
- macOS shows the **Calendars** prompt (not Automation; switched
  with the EventKit move). If denied, `permission_status` returns
  `Denied`; we set `calendar_integration_enabled=0` and surface
  "Permission denied — open System Settings → Privacy & Security →
  Calendars to grant access" with a deep-link button to
  `x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars`.

### Visual treatment
- Small calendar SVG chip on imported task rows (Daily Plan +
  Schedule). Tooltip: "From Calendar.app — [calendar name]".
- Same task chrome otherwise; they should feel native.
- Delete on imported task → `markTaskDismissed(id, 'user')`. Re-sync
  for that date won't recreate.

---

## Milestones

### M0 — Recurring-event spike — ✅ COMPLETE (failed)

See `docs/m0-calendar-spike.md`. AppleScript can't disambiguate
recurring instances; v3 uses EventKit. No further M0 work.

### M1 — Schema + Rust bridge (EventKit)
- Migration v18 (additive; CHECKs in correct SQLite syntax).
- Add `objc2-event-kit` and friends to `src-tauri/Cargo.toml`.
  **G3 (Verse)**: pin to specific minor versions (e.g. `=0.5.x` form
  rather than `^0.5`) and document the known-good minor in
  `calendar.rs`. A surprise minor bump during a future
  `cargo update` could break the binding silently.
- Add `NSCalendarsUsageDescription` to `tauri.conf.json` Info.plist.
- `calendar.rs` with `CalendarSource` trait + `EventKitSource` impl
  + the three Tauri commands.
- **G2 (Verse) — explicit `EKAuthorizationStatus → PermissionStatus`
  mapping** as a comment + unit test in M1:

  | EventKit value | Our enum | Notes |
  |---|---|---|
  | `notDetermined` | `Prompt` | First run, no decision yet |
  | `restricted`    | `Denied` | MDM/parental restriction; no in-app recovery |
  | `denied`        | `Denied` | User said no |
  | `fullAccess`    | `Granted` | What we want |
  | `writeOnly`     | `Denied` | Unusable for read-only sync |

- **G1 (Verse) — completion-block threading**: Apple docs note
  `requestFullAccessToEvents`'s completion runs on an arbitrary
  queue. We block via `block2::Block` + condvar so the Tauri command
  returns synchronously. Tauri 2 dispatches commands on a worker
  pool (not main thread), so the block-wait is safe — but verify
  empirically in M1 by triggering the prompt and confirming the UI
  doesn't freeze.
- A5: only the three Tauri commands cross JS boundary.
- Verification:
  - Migration applies on fresh DB and on populated v17 DB.
  - `cargo check` clean against the new crate set.
  - Permission prompt fires on first call to
    `calendar_check_permission` after toggle-on; UI does not freeze
    while the user decides (G1 check).
  - Denied state surfaces typed `PermissionDenied` error.
  - Events for a date that includes a recurring event return one
    `CalendarEvent` per occurrence with **distinct** `external_id`s.
    (The exact failure mode M0 caught.)

### M2 — Sync layer (TS)
- `syncCalendarEventsForDate` with TTL guard.
- `upsertCalendarTask` (INSERT-only — no UPDATE branch).
- `markTaskDismissed` + `getDismissedExternalIds`.
- A3: all date strings via `localDateIso`.
- Verification: insert events, run sync, confirm tasks created;
  re-run, confirm 0 created and 0 modified; modify event time,
  re-run, confirm task untouched (intentional in v1).

### M3 — Settings UI
- "Calendar integration" section.
- Toggle (off by default). Pre-prompt copy.
- A6: trigger permission only on toggle-on.
- Per-calendar exclude checkboxes (loaded after permission grant).
- "Sync now" button.
- Last-synced timestamp.
- Permission-denied state with deep-link.

### M4 — Daily Plan integration
- `useCalendarSync(selectedDate)` mounted on Daily Plan.
- Calendar icon chip on imported task rows.
- Delete-task path → `markTaskDismissed(id, 'user')`.
- A4: hourly setInterval is `document.visibilityState`-aware from
  this milestone, not deferred.
- Loading toast on slow syncs; silent on success.

### M5 — Polish + evaluation
- **Two weeks of dogfood usage**, then:
- Evaluate whether INSERT-only sync feels right or whether
  time/duration updates need to flow through.
- Evaluate whether `'cancelled'` dismissal reason should hide tasks
  (current default: tasks for cancelled events stay; user can
  delete).
- Per-calendar opt-in vs opt-out wording — usage data tells.
- Auto-sync cadence tuning if hourly is wrong.
- No code shipped in M5 unless evaluation surfaces a real gap.

---

## Risks

1. **Tauri entitlements / hardened runtime** — Tauri's default
   bundling enables a hardened runtime. EventKit reads should work
   under default sandboxing once `NSCalendarsUsageDescription` is
   declared, but worth a clean test build to verify before declaring
   M1 done.
2. **macOS 14+ floor** (Verse, plan v2) — confirmed: switching to
   EventKit's modern auth API commits us to macOS 14+. Older fallback
   exists (`requestAccess(to:.event)`) but doubles auth complexity;
   recommending we just declare 14+ as the minimum.
3. **`objc2-event-kit` API surface drift** — the `objc2-*` family is
   pre-1.0 (currently 0.x). API changes between minor versions.
   Pin versions and review release notes before bumping.
4. **Permission prompt UX** — the system prompt copy comes from
   `NSCalendarsUsageDescription`; we control wording but not styling
   or timing of the OS dialog. First click on the toggle triggers it
   (Verse A6).
5. **Recurring-instance id stability** (Verse / B5) — addressed by
   EventKit's per-instance `eventIdentifier`. M0 confirmed AppleScript
   couldn't satisfy this. M1 verification re-confirms with EventKit.
6. **Time zones** — handled by EventKit's `NSDate` predicate plus
   `localDateIso` on the TS side. Documented in code.
7. **iCloud-only events vs local Calendar.app** — EventKit aggregates
   all sources Calendar.app sees; per-calendar opt-out lets user
   filter.
8. **Privacy posture** — All data stays local. Settings copy states
   this explicitly. Permission description string also states this.

---

## Out of scope

- Bidirectional sync.
- Google / Outlook OAuth integrations.
- Calendar event creation from VerseDay tasks.
- Reminders.app integration.
- Non-macOS platforms.

---

## Summary of deltas vs v2

- **D1** — implementation switched from `AppleScriptSource` to
  `EventKitSource`. Trait shape unchanged (the abstraction earned
  its keep). `objc2-event-kit` + friends added to Cargo.
- **B1** — moot. No subprocess, no string interpolation, nothing to
  inject into.
- **M0** — done, archived. Outcome documented at
  `docs/m0-calendar-spike.md`.
- **M1** — Cargo + Info.plist additions; verification step now
  explicitly checks recurring-event distinct `external_id`s.
- **Risks** — Calendar.app-launch risk dropped (no AppleScript).
  Replaced with `objc2-*` API drift + Tauri hardened-runtime check.
- **macOS 14+ floor** — now committed, not just flagged.
- Everything else from v2 (schema v18, Option-X dismissal,
  INSERT-only sync, A1-A6, M2-M5 milestones) survives unchanged.

## Summary of deltas vs v1

(Captured in v2; preserved here for reviewer continuity.)

- **D2** — `external_dismissal_reason TEXT` replaces boolean; CHECK
  uses correct SQLite enum syntax.
- **D5** — M5 reframed as "evaluate the simple rule" not "build per-
  field provenance"; M2 onward is INSERT-only (no UPDATE branch).
- **B2** — CHECK constraints use `IS NULL OR x = 'val'` form.
- **B4** — eliminated by D5 (no UPDATE branch exists).
- **A1/A2** — TTL guard (5min default) on sync.
- **A3** — `localDateIso` mandated for all date strings in calendar
  pipeline.
- **A4** — focus-aware setInterval from M4, not M5.
- **A5** — only 3 named Tauri commands cross JS boundary.
- **A6** — permission prompt fires on toggle-click only.
