# Meeting approach notification

**Status:** design — APPROVED by Verse 2026-05-21 with 5 conditions, addressed below.
**Branch:** `feat/meeting-approach-notification`
**Owner:** Terse, with Verse review per milestone.

## 1. Problem

When a calendar meeting is a few minutes out, the user wants a heads-up — and,
if they're heads-down in a focus session, the option to stop the timer without
hunting for the app. Calendar M4 already imports events into the Daily Plan;
this builds the active-attention layer on top of that passive surface.

## 2. Behavior

- **Surface:** native macOS notification via `tauri-plugin-notification`.
- **Lead time:** configurable in Settings → Calendar integration. Default 3 min.
  Range 1–15. Setting key: `meeting_approach_lead_minutes`.
- **Toggle:** `meeting_approach_notify_enabled`. Off by default. Flipping on
  triggers the macOS notification permission flow.
- **Trigger:** every 30s tick, scan upcoming events. Fire when
  `start - now ≤ leadMinutes && start > now`. Skip all-day events. Skip events
  already started (`now > start`). Always fires — focus state has no bearing
  on whether the notification appears.
- **Content:** title `Meeting in N min`, body `<event title>`.
- **Action button:** `Stop focus` — present only when a focus timer is running.
  Clicking ends the active time entry. See §6.3 for the fallback if Tauri's
  action-button support is flaky on macOS.
- **Body click:** brings VerseDay to front.
- **Dedup:** in-memory `notifiedEventIds: Set<string>`, persisted to
  `localStorage` under key `meetingApproachNotifier.notifiedIds`. Persisted as
  `{ eventId, start: ISO8601 }[]` so we can prune on startup (see §6.1).

## 3. Modules

| File | Purpose | LOC budget |
| --- | --- | --- |
| `src/calendar/upcomingEvents.ts` | Selector: events starting in next N min, excluding all-day. | ~40 |
| `src/calendar/meetingApproachNotifier.ts` | 30s tick, dedup, dispatch, permission probe, cleanup. | ~120 |
| `src/components/settings/CalendarSettings.tsx` | Add toggle + stepper. Render "Notifications blocked" hint on denial. | +~50 |
| `src-tauri/Cargo.toml` + `tauri.conf.json` + capabilities | Wire `tauri-plugin-notification`. | small |
| `src/App.tsx` | Mount notifier once globally. | +~5 |

## 4. Data flow

```
Calendar M2 sync → calendar_events table
                        ↓
                  upcomingEvents() selector
                        ↓
              meetingApproachNotifier tick (30s)
                        ↓
        for each event in window not in notifiedIds:
            check permission → dispatch → add to notifiedIds → persist
                        ↓
        on user action: "Stop focus" → stopFocusAction()
        on body click:  bring window to front
```

## 5. Settings UI sketch

Under existing **CALENDAR INTEGRATION** section, below the calendar checkboxes:

```
[ Approach notifications ]                              ◯ off / ● on
Notify N minutes before a meeting starts.

Lead time:  − [ 3 ] min +
```

If permission is denied:
```
⚠ Notifications blocked in System Settings.
```

## 6. Verse conditions — disposition

### 6.1 Prune the dedup set on startup

On notifier mount, read `meetingApproachNotifier.notifiedIds` from localStorage
and drop every entry whose `start` is more than 24 hours in the past. Write the
pruned list back immediately. Without this the set grows unbounded across
sessions; with it, the steady-state size is bounded by 24h of events.

```
const pruneCutoff = Date.now() - 24 * 60 * 60 * 1000;
notifiedIds = notifiedIds.filter(e => Date.parse(e.start) >= pruneCutoff);
```

### 6.2 Sleep / throttle limitations

Two known cases, called out so future-us doesn't debug them as bugs:

- **macOS sleep through the entire lead window.** If the machine is asleep
  between `start - leadMinutes` and `start`, no tick fires, the event passes
  the `now > start` skip filter on wake, and no notification ever appears.
  Acceptable for v1 — the user is asleep, the meeting is in progress, the
  notification would arrive too late to be useful anyway.
- **Tauri webview `setInterval` throttling.** When the VerseDay window is
  fully hidden (occluded, minimized), macOS may throttle JS timers to ~1Hz
  or lower. At a 30s tick + 3min lead, even a throttled timer still hits the
  window in practice. If reliability ever needs to be guaranteed, move the
  scheduler to Rust (a `tokio::time::interval` in `src-tauri`).

Both limitations documented in code comments at the top of
`meetingApproachNotifier.ts`.

### 6.3 Action-button support — verification gate + fallback

Before committing the "Stop focus" action button as shipping behavior, S.1
includes a 10-min spike: send a test notification with one action via
`tauri-plugin-notification`, on macOS, and confirm the button appears in
Notification Center and that clicking it dispatches an event we can handle.

If the spike passes → ship as planned.
If the spike fails (button missing, event doesn't fire, requires extra
entitlement we don't have) → fall back to:

- No action button on the notification.
- Body click still brings VerseDay to front.
- The existing in-app focus pill / focus bar already exposes a one-tap stop,
  so the user is one click away from stopping the timer once the app is
  foreground.

Either outcome is shipped — no half-working button.

### 6.4 Cleanup on unmount

The `useEffect` in `App.tsx` that mounts the notifier returns a cleanup that
calls `clearInterval(handle)`. Without this, HMR in dev leaks an interval per
edit and prod re-mounts (theme switches, route changes that re-render App)
would double-fire. Standard React hygiene, but called out in the module
header comment so it isn't dropped during refactors.

### 6.5 Permission denial path

The flow:

1. User flips toggle on → call `requestPermission()` from
   `tauri-plugin-notification`.
2. Outcome stored in `meeting_approach_notify_enabled`:
   - `granted` → toggle stays on, notifier active.
   - `denied` → toggle stays on (intent is on), but render a one-line hint
     under the toggle: `Notifications blocked in System Settings.` Notifier
     becomes a no-op until permission flips.
3. On notifier mount, re-check permission status. If denied, render the hint
   without prompting again (macOS won't re-prompt after denial — user has to
   go to System Settings).

Hint text intentionally bland; no deep-link to System Settings in v1 (Tauri
can do it but adds a Rust command — not worth the surface area for a
one-liner).

## 7. Milestones

| Step | Scope | Verse gate |
| --- | --- | --- |
| **S.1** | Wire `tauri-plugin-notification`. Permission probe + send-test helper. 10-min macOS action-button spike (§6.3). | ✓ |
| **S.2** | `upcomingEvents.ts` selector + unit test against fixture event rows. | ✓ |
| **S.3** | `meetingApproachNotifier.ts` — tick, dedup, prune on mount, dispatch, cleanup. | ✓ |
| **S.4** | Settings UI — toggle, stepper, denied-hint. Wire setting reads into notifier. | ✓ |
| **S.5** | Mount in `App.tsx`. End-to-end manual test: create a test event 4 min out, watch for notification at the 3 min mark. | ✓ |

After each S.x I stop and say "Ready for Verse review."

## 8. Non-goals (v1)

- Sound customization.
- Per-calendar lead times.
- Repeat / snooze on the notification.
- Notifying for events on tomorrow / not-today (the upcoming-events selector
  is bounded to `start - now ≤ leadMinutes`, so future days never qualify).
- Deep-link to System Settings on denial.
- Windows / Linux parity (this app is macOS-only per Tauri config).
