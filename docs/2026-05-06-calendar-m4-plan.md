# Calendar integration — M4 plan (Daily Plan integration)

**Status:** PLAN — awaiting Verse review.
**Branch (proposed):** `feat/calendar-m4-daily-plan`
**Predecessor:** M3 merged on `main` at `954462b`. Settings UI is live;
sync layer is reachable but only fires manually via "Sync now."
**Successor:** M5 (post-dogfood evaluation).

---

## 1. Scope

This is the milestone where calendar events actually appear on the
Daily Plan automatically. Five surfaces:

1. **Auto-sync on Daily Plan mount + date change.** When `DailyPlanner`
   renders for `selectedDate`, fire `syncCalendarEventsForDate(date)`.
2. **Visibility-aware hourly tick** (plan v3 A4). `setInterval(60min)`
   that short-circuits when `document.visibilityState !== 'visible'` —
   we don't burn cycles, EventKit calls, or DB writes when the window
   is hidden.
3. **Permission re-check on focus / hourly tick** (M3 follow-up Verse
   filed). If status flipped from `granted → denied` while the user
   was outside Settings, auto-flip `calendar.enabled='0'` exactly as
   `<CalendarSettings />` does on mount. Architecturally completes
   §3.6 from the M3 plan.
4. **Calendar chip on imported task rows.** Visual indicator — small
   calendar icon in `TaskCard` — so the user can tell calendar-imported
   meetings apart from in-app tasks at a glance.
5. **Loading toast on slow syncs.** Plan v3 says "silent on success;
   loading toast on slow syncs." Implementation: a 3-second-deferred
   toast that auto-clears when the sync resolves.

Delete-as-dismiss is **already wired** at the data layer (M2's
`deleteTask` interception in `queries.ts`). M4 verifies it works
end-to-end through the Daily Plan's existing delete UI; no new code
is expected on that path.

---

## 2. What's already in place

From M2 (sync layer):
- `syncCalendarEventsForDate(dateIso, { force? })` — TTL-gated (5 min,
  cap 64), idempotent via v19 UNIQUE index, soft-delete-aware.
- `useCalendarSync()` returning `{ syncNow }` — manual surface.

From M3 (Settings UI):
- `useCalendarPermission()` — reads status fresh on mount, exposes
  `{ status, refresh, request }`.
- `getEnabled` / `getExcludedCalendarIds` / `setEnabled` — typed
  accessors in `src/calendar/settings.ts`.
- The auto-flip pattern: `if (status === "denied" && enabled) {
  setEnabled(false); }` — currently in `CalendarSettings.tsx:73-79`,
  needs to be applied from M4's hooks too.

From M2 data layer:
- `queries.ts:deleteTask` intercepts `external_source === 'calendar'`
  and calls `markTaskDismissed(id, "user")` instead of `DELETE`.
  Caller (`DailyPlanner.tsx:622`) doesn't need to change.

**M4 does not introduce schema changes, new Rust commands, or new
deps.**

---

## 3. Architecture

### 3.1 New hook: `useCalendarAutoSync(dateIso)`

Lives in `src/calendar/hooks.ts`. Owns the entire auto-sync lifecycle
on Daily Plan. Returns `{ syncing }` so the caller can render a
loading toast on slow syncs.

```ts
export function useCalendarAutoSync(dateIso: string): { syncing: boolean } {
  // 1. Reads enabled + permission status on mount.
  // 2. If !enabled OR status !== 'granted', do nothing — no interval,
  //    no listeners. Cheap when integration is off.
  // 3. Fires sync on:
  //    - Mount (current dateIso)
  //    - dateIso change (re-fire for new date)
  //    - Hourly tick (visibility-gated)
  //    - visibilitychange → visible
  //    - window focus
  // 4. Before any sync, calls checkPermission. If denied, auto-flip
  //    enabled=0 and bail. Same logic as CalendarSettings:73-79.
  // 5. Sets `syncing` true at sync start, false on resolution. The
  //    loading toast in DailyPlanner watches this for the 3s rule.
}
```

**Single fire point:** all five trigger surfaces (mount / date /
hourly / visibility / focus) call the same internal `tick()` function.
Keeps logic in one place; TTL gates redundant calls naturally.

**Cleanup on unmount + on dateIso change:** clear interval, remove
both DOM listeners. Cancel-on-unmount isn't critical for INSERT-only
sync (rows are idempotent), but a stale-token pattern in the tick
fn prevents post-unmount setState (mirrors M3's `excludeDebounce`
cleanup).

**Visibility implementation:** check `document.visibilityState ===
'visible'` at fire time inside `tick()` rather than subscribing to
`visibilitychange` for the gate. Simpler. The
visibilitychange listener exists separately to fire `tick()` on
becomes-visible — that's a trigger, not a gate.

**Why both `visibilitychange` and `window.focus`?** Verse asked for
window-focus in M3 follow-up. In Tauri's WKWebView, both events
typically fire when the user switches apps. They overlap, but the
TTL guards against double-fires. Lean: keep both for belt-and-
suspenders coverage; document the redundancy.

### 3.2 New component: `<CalendarChip />`

`src/components/CalendarChip.tsx`, ~15 LOC. Small calendar icon (SVG)
+ aria-label. No props beyond `className` for spacing.

Rendered by `TaskCard` when `task.external_source === 'calendar'`.
Position: inline next to the task title, before the title text.
Color: `var(--text-faded)` so it's subtle — calendar tasks aren't
"more important" than in-app tasks, just differently sourced.

### 3.3 `TaskCard` integration

One small change in `src/components/TaskCard.tsx`: render
`<CalendarChip />` conditionally next to the title. Verify the `task`
prop already has `external_source` (it should — M2 added the column
to the `Task` type).

### 3.4 `DailyPlanner` integration

Two additions in `src/pages/DailyPlanner.tsx`:

1. `const { syncing } = useCalendarAutoSync(selectedDate);` near the
   other hooks at the top.
2. A small loading toast — same visual pattern as M3's toast — that
   appears only when `syncing` has been true for ≥3 seconds. Watches
   `syncing` via a setTimeout: start the timer on `syncing → true`,
   show toast when timer fires unless `syncing → false` first; clear
   the timer on `syncing → false`.

Refetch-on-sync-complete: M4 must trigger `getTasksForDate` after a
sync that created rows, otherwise the user sees a stale list until
they navigate away. Simplest: `useCalendarAutoSync` exposes the sync
result, `DailyPlanner` re-runs its task-load effect on result change.
**Open question (Q1) — see §8.**

---

## 4. Trigger / behavior matrix

| Trigger | Frequency | Permission re-check? | TTL respected? | Notes |
|---|---|---|---|---|
| Mount | once per Daily Plan mount | yes | yes | First fetch for the rendered date |
| `dateIso` change | every nav between days | yes | yes | TTL is per-date so a fresh date always fetches |
| Hourly tick | 60 min | yes | yes | Visibility-gated. No fire when window hidden |
| `visibilitychange → visible` | when user returns to window | yes | yes | Catches the "app was hidden 6 minutes" case where TTL is now stale but hourly hasn't fired |
| `window.focus` | when window regains focus | yes | yes | Overlaps with visibilitychange in Tauri. TTL gates the redundancy |

In all five, if `permission !== granted` after re-check, auto-flip
`enabled=0` and exit. No sync attempted. Mirrors M3's §3.6 detection.

---

## 5. The "silent on success / loading toast" rule

Don't toast when sync completes — even if rows were created. The user
sees the rows appear in their list; that's the success signal.

Toast only when sync is taking unusually long. Threshold: 3 seconds.
Implementation:

```ts
useEffect(() => {
  if (!syncing) {
    setSlowSyncToast(false);
    return;
  }
  const t = setTimeout(() => setSlowSyncToast(true), 3000);
  return () => clearTimeout(t);
}, [syncing]);
```

Toast copy: `"Syncing calendar…"`. Auto-dismisses when `syncing →
false`. No user dismiss control needed — the loading state owns it.

If sync errors (Tauri command rejects, EventKit transient), surface
the same "Sync failed" error pattern M3 uses — `errorBanner`-style,
distinct from the loading toast.

---

## 6. Delete-as-dismiss verification (no code change expected)

`queries.ts:deleteTask` already routes `external_source === 'calendar'`
to `markTaskDismissed`. The Daily Plan's existing delete UI calls
`deleteTask(id)` (`DailyPlanner.tsx:622`). Therefore:

- User clicks delete on a calendar task → `markTaskDismissed` fires →
  row gets `external_dismissal_reason = 'user'`.
- Daily Plan refetches → `getTasksForDate` filter excludes dismissed
  rows → row disappears from view.
- Next sync sees the row in `getDismissedExternalIds` set → skips
  re-import.

M4 work on this surface: smoke-test it works end-to-end, verify the
toast/banner copy is appropriate (or not — silent dismissal might be
the right call). **Open question (Q2) — see §8.**

---

## 7. State machine summary

```
DailyPlanner mounted with selectedDate
     │
     ▼
useCalendarAutoSync(selectedDate)
     │
     ├── on mount + on dateIso change → tick(dateIso)
     │
     ├── setInterval(60 min) → tick(currentDateIso)
     │
     ├── visibilitychange === visible → tick(currentDateIso)
     │
     └── window.focus → tick(currentDateIso)

tick(dateIso):
     ├── document.visibilityState !== 'visible'? → skip silently
     ├── refresh permission status
     │   └── status === 'denied' && enabled? → auto-flip to '0', exit
     ├── enabled && status === 'granted'?
     │   └── syncCalendarEventsForDate(dateIso, { force: false })
     │       (TTL gates redundant fires; INSERT-only writes; sync.ts
     │        stamps calendar.last_synced_at)
     └── setSyncing(false) on resolution
```

---

## 8. Open questions for Verse

1. **Refetch coordination.** When sync creates rows, `DailyPlanner`
   needs to re-run its task-load effect to render them. Two options:
   (a) `useCalendarAutoSync` exposes `lastResultAt` (timestamp); the
   load effect depends on it. (b) Caller passes a `onSyncResult`
   callback. Lean: (a). Less coupling, more declarative. Verse
   preference?

2. **Delete-as-dismiss feedback.** When the user deletes a calendar
   task, do we surface that it was dismissed (not deleted)? Options:
   - Silent (current behavior, matches in-app delete).
   - Inline toast: "Removed from Daily Plan" — distinguishes from
     "real" delete.
   - Tooltip-on-hover on the chip: "Imported from Calendar — delete
     removes from Daily Plan only."
   Lean: silent for M4; revisit in M5 if dogfood reveals confusion.

3. **Hourly-tick date target.** If user is viewing 5/4 (past) and the
   hourly tick fires, do we re-sync 5/4 (the displayed date) or 5/6
   (today)? Plan v3 says `useCalendarSync(selectedDate)` → displayed
   date. But if the user lingers on a past date for an hour, today's
   events go un-synced until they navigate. Lean: sync the displayed
   date only — M4's mount-on-Daily-Plan already syncs whichever date
   is rendered, and for non-displayed dates the user gets a fresh
   sync on navigation anyway. Verse preference?

4. **Toast vs spinner for slow sync.** Toast is consistent with M3.
   Alternative: subtle spinner in the day-header chrome. Lean: toast.
   Skip unless you'd rather see something else.

5. **Window-focus + visibilitychange redundancy.** Both fire in
   Tauri's WKWebView when user switches apps. TTL guards against
   double-syncing. Should we drop one? Lean: keep both (covers
   browser tab switches too if we ever add a web build) — TTL cost
   is zero. Verse preference?

---

## 9. File-by-file change list

| File | Change | LOC (est.) |
|---|---|---|
| `src/calendar/hooks.ts` (extend) | `useCalendarAutoSync(dateIso)` — owns mount + date-change + hourly tick + visibility + focus + permission re-check + auto-flip | +~90 |
| `src/components/CalendarChip.tsx` (new) | Small calendar icon component for imported tasks | ~20 |
| `src/components/TaskCard.tsx` (extend) | Conditionally render `<CalendarChip />` when `task.external_source === 'calendar'` | +~3 |
| `src/pages/DailyPlanner.tsx` (extend) | Mount `useCalendarAutoSync(selectedDate)`, render slow-sync loading toast, wire refetch-on-sync-result | +~25 |

**No changes to:** `sync.ts`, `permissions.ts`, `settings.ts`,
`queries.ts`, Rust, schema, deps.

---

## 10. Test plan

- [ ] Daily Plan mount with `enabled=1` + `granted` → today's calendar
      events appear in the task list within ~2 seconds
- [ ] Navigate from today to tomorrow → tomorrow's events appear
- [ ] Navigate back to today within TTL window → no fetch (verify via
      DB `calendar.last_synced_at` timestamp unchanged)
- [ ] Daily Plan mount with `enabled=0` → no sync, no interval
      registered (verify via no `last_synced_at` change)
- [ ] Daily Plan mount with `enabled=1` + `denied` → no sync, auto-flip
      fires, `calendar.enabled` is `'0'` in DB
- [ ] Hide window for ~5 seconds, return → visibility trigger fires a
      sync (verify via `last_synced_at` update)
- [ ] Calendar chip renders on imported tasks with `external_source =
      'calendar'`; does NOT render on in-app tasks
- [ ] Delete a calendar task on Daily Plan → row disappears, DB has
      `external_dismissal_reason = 'user'`, next manual Sync now from
      Settings does not re-import
- [ ] Slow-sync simulation: artificially delay invoke (manual step or
      throttle) → "Syncing calendar…" toast appears after ~3s
- [ ] `tsc --noEmit` clean
- [ ] `cargo check` clean (no Rust changes, but verify nothing breaks)

**Deferred to production-build verification (per M3's deferred
items — same dev-mode TCC quirk):** the §3.6 auto-flip path through
M4's hourly tick / focus / visibility triggers cannot be exercised
end-to-end in dev mode because dev-binary TCC tracking returns
`granted` after `tccutil reset Calendar com.verseday.app`. The code
path is identical to M3's already-deferred §3.6 path; same Cam/Dan
follow-up obligation covers both.

---

## 11. Risk register

- **Multiple Daily Plan mounts in rapid succession.** TTL handles
  redundant fires. INSERT-only sync is idempotent.
- **Date-change race.** User clicks `← → ← →` rapidly. Each fires
  `tick(newDate)`. The 5/4 sync may resolve after the 5/7 sync. Each
  writes its own date's rows. No corruption. UX-level only — a stale
  toast might briefly show. The cleanup token in `useEffect` clears
  pending state when `dateIso` changes, so post-stale-resolution
  setStates are dropped.
- **Hourly tick fires while sync from a previous tick is still in
  flight.** Both invoke `calendar_get_events_for_date` for the same
  date in parallel. Each completes independently. ON CONFLICT DO
  NOTHING absorbs duplicate inserts. No corruption; small wasted
  work.
- **`window.focus` doesn't fire on first window creation in Tauri.**
  `mount` covers the first-load case explicitly, so this isn't a gap.
- **`document.visibilityState` may stay `'visible'` even when the
  Tauri window is fully occluded behind another window.** macOS's
  WKWebView reports visibility based on whether the webview itself is
  rendering, not whether it's pixel-visible. Acceptable — the user
  interacting elsewhere is browser-visibility-API correct semantics.

---

## 12. Things explicitly NOT in this PR

- **M5** — post-dogfood evaluation: INSERT-only vs update-flow,
  cancelled-event behavior, deep-link to System Settings.
- **Calendar chip with calendar-name on hover.** Could surface the
  calendar source ("Work — meetings") on hover. Lean: skip in M4 —
  the per-calendar exclude UI in Settings already lets the user
  understand the routing. Add only if dogfood asks.
- **Manual refresh button on Daily Plan.** Settings already has "Sync
  now"; Daily Plan's auto-sync covers the visibility-becomes-visible
  case which is functionally equivalent. Skip unless real users miss
  it.
- **Re-prompt for permission from Daily Plan.** The "denied" state
  path is owned by `<CalendarSettings />`. Daily Plan auto-flip exits
  silently; user has to visit Settings to re-grant. M5 polish if
  needed.

---

Ready for Verse review.
