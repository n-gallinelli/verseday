# Calendar integration — M3 plan (Settings UI)

**Status:** PLAN — awaiting Verse review.
**Branch (proposed):** `feat/calendar-m3-settings`
**Predecessor:** M2 merged on `main` at `deba7ff`. Sync layer is live but
behaviorally inert until this milestone wires the toggle.
**Successor:** M4 (Daily Plan integration). M3 must not assume anything
about M4's mounting strategy — the only consumer of M3 today is the
Settings page itself.

---

## 1. Scope

A "Calendar integration" section on `src/pages/Settings.tsx` that:

1. Toggles the integration on/off (writes `calendar.enabled`).
2. Triggers the EventKit permission prompt **only on toggle-on**, per
   plan v3 A6.
3. Renders a per-calendar exclude list once permission is granted.
4. Provides a manual "Sync now" button (uses today's local date).
5. Shows the last-synced timestamp.
6. Handles the denied / revoked-after-grant states without lying to
   the user.

**Out of scope for M3 (M4 territory):** Daily Plan calendar chip,
delete-as-dismiss wiring, hourly visibility-aware tick, calendar tasks
appearing on any page that isn't Settings.

**Out of scope, period:** macOS notification center prompts, multi-
account support, write-back to calendar, recurrence editing.

---

## 2. Architecture

### 2.1 What's already in place (do not duplicate)

From M1 (`src-tauri/src/calendar.rs`):
- `calendar_check_permission` → `'granted' | 'denied' | 'prompt'`
- `calendar_request_permission` → triggers EventKit prompt, returns
  updated status (or `Err(String)` if the system call fails)
- `calendar_get_calendar_list` → `Vec<{ id, name }>`
- `calendar_get_events_for_date` → used by sync layer

From M2 (`src/calendar/`):
- `syncCalendarEventsForDate(dateIso, { force? })`
- `useCalendarSync()` returning `{ syncNow }`
- TTL Map (5 min, cap 64), format guard, estimated-minutes derivation
- Settings keys: `calendar.enabled`, `calendar.excluded`,
  `calendar.last_synced_at`

### 2.2 New TS surface in M3

| File | Purpose | Lines (est.) |
|---|---|---|
| `src/calendar/permissions.ts` (new) | Thin wrappers around the three `calendar_*_permission` invokes + a `PermissionStatus` literal type | ~30 |
| `src/calendar/hooks.ts` (extend) | Add `useCalendarPermission()` hook returning `{ status, refresh, request }` | +~40 |
| `src/pages/Settings.tsx` (extend) | New `<CalendarSettings />` section component (could inline or split — leaning split for testability) | ~+200 |
| `src/calendar/settings.ts` (new) | `getExcludedCalendarIds()` / `setExcludedCalendarIds(ids)` helpers wrapping JSON serialization. Sync layer's existing private `getExcludedCalendarIds` becomes the canonical reader (un-private it, or move it here and have sync.ts import). | ~25 |

**No new Rust code. No schema changes.** The dev DB is at v17; first
launch on this branch will apply v18 + v19 naturally on first DB
interaction.

### 2.3 No new settings keys

Verse Q2 confirmed: only the three already-named keys.
- `calendar.enabled` — `'1'` or absent (treat absent as off)
- `calendar.excluded` — JSON string array of calendar IDs (M2 already
  reads this; M3 adds the writer)
- `calendar.last_synced_at` — ISO8601 string, written by `sync.ts`
  step 7

No fourth key. Permission status is **not** persisted — it's read live
from EventKit on each Settings mount. Persisting it would invite drift
(user revokes in System Settings → DB still says granted).

---

## 3. Permission UX (Verse Q1, in detail)

This is the new architectural surface. Walking through every state.

### 3.1 First toggle-on (status = `prompt`)

1. User flips toggle. Optimistic UI: toggle visually moves to "on".
2. Call `calendar_request_permission` (the EventKit prompt appears as
   a system modal).
3. Three outcomes:
   - **`granted`** — write `calendar.enabled = '1'`, fetch calendar
     list, render exclude UI, fire one immediate sync of today.
     Toggle stays on.
   - **`denied`** — leave `calendar.enabled` unset. Toggle snaps back
     to off. Render denied-state banner with re-grant instructions
     (see § 3.4). The macOS prompt only appears once per app
     identifier; subsequent attempts return `denied` immediately.
   - **`prompt` (still)** — the OS dismissed the prompt without a
     decision (rare, e.g., MDM-managed device). Treat as denied for
     this session: snap toggle off, show transient toast "Couldn't
     get calendar permission — try again."

### 3.2 Toggle-on after a previous grant (status = `granted`)

Skip the prompt; `calendar.enabled = '1'`, fetch calendar list, fire
one sync of today.

### 3.3 Toggle-off (any prior state)

Write `calendar.enabled = '0'` (explicit `'0'` rather than DELETE so
the row exists for analytics / future debugging). Hide exclude UI and
"Sync now". **Do not** revoke EventKit permission — that's a System
Settings action, not an app action, and silent revocation would
surprise users on next toggle-on.

### 3.4 Denied — display state

Banner inside the Calendar section:

> Calendar access denied. Open **System Settings → Privacy & Security
> → Calendars** and enable VerseDay, then toggle this on again.

**Decision needed (Q1, see § 8): deep-link or plain text?** macOS
supports `x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars`
URLs. Tauri 2's webview blocks navigation to non-HTTP schemes by
default. To open it we'd need `tauri-plugin-opener` added with a
scoped allowlist for `x-apple.systempreferences:` only. **Lean: defer
the deep-link to M5 polish; ship plain-text instructions in M3.** No
new dependency, no new capability surface, denied path still
recoverable.

### 3.5 "Limited access" (Verse Q1.c)

EventKit on macOS 14+ does not expose a "limited" granular state for
read access — it's binary `FullAccess` vs `Denied`. (`WriteOnly`
exists as a separate variant but means the app can write events
without reading them, which is the inverse of what we need; M1's
`map_status` correctly collapses it into `Denied`.) So the "limited
access" question doesn't apply to read-only event reading the way it
applies to Photos / Contacts. **No additional handling needed in M3.**
If Apple changes this in macOS 15+ and adds a `Limited` variant, M1's
`map_status` will collapse it into `Denied` (the `_ =>` arm), so the
Settings UI will treat it as denied — safe default until we explicitly
support partial grants.

### 3.6 Revoked-after-grant (Verse Q1.d)

User granted permission, then revoked it via System Settings while the
app was running.

- **On Settings mount:** `useCalendarPermission()` calls
  `calendar_check_permission` and renders fresh state. If status is
  now `denied` while `calendar.enabled === '1'`, render a separate
  "Calendar access was revoked" banner (distinct copy from § 3.4) and
  flip `calendar.enabled` to `'0'` automatically. Toggle visually
  snaps off.
- **In-flight on other pages (M4 territory):** Out of scope for M3.
  M3 only owns the Settings page surface. M4's hourly tick will read
  `calendar.enabled = '0'` and short-circuit on its own.

The auto-flip is deliberate: leaving `enabled = '1'` while permission
is `denied` would mean the M4 sync layer keeps trying and failing. The
DB-level state should match physical reality.

---

## 4. Toggle-off-mid-sync semantics (Verse Q3)

**Choice: complete in-flight, block next call.** Matches Verse's lean.

Rationale: `syncCalendarEventsForDate` reads `calendar.enabled` once
at step 1 and runs to completion. There is no abort path and adding
one would require either a cancellation token threaded through invoke
(Tauri doesn't support that natively) or a mid-loop check-and-bail
(introduces partial-write states). Since the rows being inserted are
idempotent (ON CONFLICT DO NOTHING) and dismissable
(`markTaskDismissed`), the worst case of a completed-after-disable
sync is N rows the user can delete — not a destructive surprise.

The next call (Sync now, M4 hourly tick, M4 mount) reads
`calendar.enabled = '0'` and returns `{ created: 0, skipped: 0 }` per
sync.ts step 1. **No code change in `sync.ts` for this — the existing
behavior is correct.**

One UI nuance: if the user clicks Sync now, then immediately toggles
off before the invoke returns, the in-flight result toast might say
"Synced 3 events" while the toggle is now off. Acceptable —
truthful (the sync did happen), and the toast auto-dismisses in 3s.

---

## 5. "Sync now" button (Verse Q4)

Reuses `useCalendarSync().syncNow(todayIso)` — exact same code path as
M4's manual refresh. **No parallel implementation.**

- Today's local date is computed via the existing project-wide local-
  date helper (used by the daily-shutdown / local-date-fix commits).
  M3 imports that helper rather than reinventing.
- Button is disabled when `calendar.enabled !== '1'` OR
  `permission !== 'granted'` OR a sync is currently in flight.
- In-flight state: button text becomes "Syncing…", spinner, disabled.
- On result: toast `"Synced N events"` (created), or `"Up to date"`
  (created === 0 && skipped > 0), or `"No events for today"`
  (created === 0 && skipped === 0).
- After result: re-render last-synced-at from the freshly-stamped
  `calendar.last_synced_at`.

`syncNow` already passes `force: true`, which bypasses the TTL guard.
A user clicking Sync now expects work to happen even if we synced 30
seconds ago.

---

## 6. Per-calendar exclude UI (Verse Q5)

**Rust command exists** (`calendar_get_calendar_list` from M1) — no
scope addition needed.

Behavior:
- Loaded only after `permission === 'granted'`.
- Each calendar gets a checkbox; **default checked = include** (i.e.,
  `calendar.excluded` defaults to `[]`).
- Checkbox toggle writes the new array via debounced (400 ms, matching
  the focus-settings pattern) `setSetting('calendar.excluded', JSON.stringify(ids))`.
- The list re-fetches on Settings mount (calendars can be added /
  removed in macOS Calendar.app between sessions).
- Excluded IDs that no longer correspond to a calendar are silently
  dropped on save (prevents stale IDs accumulating forever).

**Storage shape unchanged** — JSON array of string IDs in
`calendar.excluded`. The sync layer's existing
`getExcludedCalendarIds()` parser already handles malformed JSON and
non-string entries gracefully.

**Edge case:** If the user excludes every calendar, sync still runs
but produces zero rows. Acceptable — explicit user choice. No "you've
excluded everything" warning in M3.

---

## 7. State machine summary

```
┌─────────────────────────────────────────────────────────────────┐
│ Settings mount: read enabled + check permission live            │
└──────────────┬──────────────────────────────────────────────────┘
               │
   ┌───────────┴───────────┐
   │                       │
   ▼                       ▼
permission = granted   permission = denied
   │                       │
   ├─ enabled = '1'        ├─ enabled = '1' (revoked) ─ flip to '0', show "revoked" banner
   ├─ enabled = '0'/null   ├─ enabled = '0'/null      ─ no banner, toggle off
   │                       │
   ▼                       ▼
[on toggle-on]         [on toggle-on]
   no prompt             call request_permission
   set enabled=1            │
   fetch calendars          ├─ granted  → as left column
   sync today               ├─ denied   → snap off, show § 3.4 banner
                            └─ prompt   → snap off, transient toast
```

---

## 8. Open questions for Verse

1. **Deep-link to System Settings?** Plan v3 line 401 says yes. M3
   plan leans defer to M5 to avoid adding `tauri-plugin-opener` mid-
   stream. Override?
2. **"Sync now" date in M3.** M3 has no date context (no Daily Plan
   integration yet). Today's local date is the obvious choice. Confirm
   no objection — M4 will replace this with `selectedDate` from the
   Daily Plan view.
3. **Auto-flip `calendar.enabled = '0'` on revoked-after-grant
   detection.** § 3.6 argues for this. Alternative: leave `enabled`
   alone and let the user manually toggle. Verse preference?
4. **Toast vs inline result** for Sync now. M3 leans toast (matches
   the rest of the app). If you'd rather see inline-text result, say
   so before code.
5. **Component split:** put calendar-settings in
   `src/pages/Settings.tsx` directly, or extract into
   `src/components/settings/CalendarSettings.tsx`? Split improves
   testability but adds one file. Lean: split.

---

## 9. File-by-file change list

| File | Change |
|---|---|
| `src/calendar/permissions.ts` (new, ~30 LOC) | `checkPermission()`, `requestPermission()`, `PermissionStatus` literal type |
| `src/calendar/settings.ts` (new, ~25 LOC) | `getExcludedCalendarIds()`, `setExcludedCalendarIds()`, `getEnabled()`, `setEnabled()` |
| `src/calendar/hooks.ts` (extend, +~40 LOC) | `useCalendarPermission()`: returns `{ status, refresh, request }`; reads on mount, refresh on focus |
| `src/components/settings/CalendarSettings.tsx` (new, ~180 LOC) — pending Q5 | Whole calendar section. Receives no props; owns its own state |
| `src/pages/Settings.tsx` (extend, +~5 LOC) | Render `<CalendarSettings />` below focus settings |

**No changes to:** `src/calendar/sync.ts`, `src-tauri/src/*`,
`src/types/index.ts`, migrations.

---

## 10. Test plan

- [ ] First launch on dev DB: v18 + v19 apply (already proven in M2
      rehearsal; just need to confirm again on this branch's first
      boot)
- [ ] Toggle-on with `prompt` status → EventKit modal appears
- [ ] Toggle-on with `prompt` → grant → toggle stays on, calendar list
      renders, today's events sync
- [ ] Toggle-on with `prompt` → deny → toggle snaps off, denied banner
      appears
- [ ] Toggle-off with `granted` status → calendar list hides, Sync now
      hides, EventKit permission untouched (verify via System
      Settings → Privacy)
- [ ] Revoke permission in System Settings while app open → return to
      Settings → "revoked" banner appears, `calendar.enabled` is now
      `'0'`
- [ ] Per-calendar exclude: uncheck a calendar, fire Sync now, verify
      no rows from that calendar created
- [ ] Sync now while no events for today → "No events for today" toast
- [ ] Sync now twice in quick succession → second click ignored
      (button disabled during in-flight)
- [ ] `tsc --noEmit` clean
- [ ] `cargo check` clean (no Rust changes, but verify nothing breaks)

---

## 11. Risk register

- **Permission prompt UX is OS-controlled.** We can't customize copy
  or styling. Pre-prompt copy in the Settings UI (above the toggle)
  sets expectations: "VerseDay reads your Mac calendar to surface
  meetings as scheduled tasks. Nothing leaves your device."
- **EventKit calendar list can be large.** Some users have 30+
  calendars (work + personal + shared + holidays per locale). Render
  scrollable section, not unbounded. Cap visual height at ~360px,
  vertical scroll inside.
- **Race: revocation between mount and a render.** Mitigated by
  reading status fresh on every mount and on every Sync now click.
  Not bulletproof — a long-lived Settings tab with a backgrounded
  app could go stale — but a Settings page is a foreground action;
  acceptable.
- **JSON corruption in `calendar.excluded`.** Already handled: sync
  layer's parser swallows bad JSON and returns an empty Set, so worst
  case is "exclusion gets reset to none" — annoying, not destructive.
  M3's writer always JSON.stringify's a clean array, so this can only
  happen via external DB tampering.

---

Ready for Verse review.
