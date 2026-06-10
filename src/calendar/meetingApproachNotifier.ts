// Meeting approach notifier (M5).
//
// Polls every 30s. When a synced calendar event starts within the user-
// configured lead window, fires a native macOS notification. Dedups per
// event id, persists the dedup set to localStorage, prunes entries older
// than 24h on mount.
//
// Design: docs/2026-05-21-meeting-approach-notification.md.
//
// IMPORTANT — known limitations (doc §6.2):
//
//  - macOS sleep through the entire lead window → no tick fires; on
//    wake, the event is already in progress and the `now > start` skip
//    filter drops it. Acceptable for v1 (the meeting is in progress).
//
//  - Tauri webview `setInterval` can be throttled when the window is
//    fully hidden. #12 mitigates a single missed tick with NOTIFY_GRACE_MS
//    (a just-started event still fires on the next tick). The 30s poll itself
//    is retained while hidden (cheap settings GETs); the event-driven
//    setTimeout-to-next-event rewrite that would remove the poll entirely is
//    deferred as too structural for this pass (see docs/stability-followups.md).
//    If reliability must be guaranteed, move the scheduler to Rust.
//
// IMPORTANT — Click handling: delivery goes through the native
// `send_meeting_notification` command (notify.rs), NOT the plugin, because
// the plugin discards click results and its `onAction` is mobile-only. A
// body click is observed by our NSUserNotificationCenter delegate, which
// emits `verseday:notification-clicked` {externalId}; App.tsx turns that into
// a jump to the task on the focus screen. The externalId rides the
// notification's identifier. See notify.rs +
// docs/2026-06-10-notification-click-rust-path-plan.md.
//
// IMPORTANT — Cleanup: `start()` returns a stop function that calls
// clearInterval on the tick handle. Callers MUST invoke it on unmount
// (in App.tsx the useEffect returns it directly). Without that, HMR
// leaks intervals and prod re-mounts (theme switches, etc.) double-fire.

import { isPermissionGranted } from "@tauri-apps/plugin-notification";
import { invoke } from "@tauri-apps/api/core";
import { upcomingEvents, localStartToMs } from "./upcomingEvents";
import {
  getEnabled,
  getApproachNotifyEnabled,
  getApproachLeadMinutes,
} from "./settings";

const STORAGE_KEY = "meetingApproachNotifier.notifiedIds";
const TICK_MS = 30 * 1000;
const PRUNE_CUTOFF_MS = 24 * 60 * 60 * 1000;
// #12 — grace for a throttled/missed tick: keep events that started up to this
// long ago in the candidate window so a single skipped 30s tick (even at a
// 1-min lead) doesn't drop the alert entirely. 90s ≈ 3 ticks; large enough to
// survive throttling, small enough not to alert for a meeting well underway.
const NOTIFY_GRACE_MS = 90 * 1000;

interface NotifiedEntry {
  eventId: string;
  /** External-source `startLocal` string (`YYYY-MM-DDTHH:MM…`) — used
   *  for the >24h-past prune on next mount. */
  start: string;
}

function loadNotified(): NotifiedEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is NotifiedEntry =>
        !!e && typeof e.eventId === "string" && typeof e.start === "string",
    );
  } catch {
    return [];
  }
}

function saveNotified(list: NotifiedEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Quota / private-window — non-critical, dedup falls back to
    // in-memory only for this session.
  }
}

/** Drop entries whose event start is more than 24h in the past
 *  (Verse condition §6.1 — prevents unbounded growth). */
function pruneNotified(list: NotifiedEntry[]): NotifiedEntry[] {
  const cutoff = Date.now() - PRUNE_CUTOFF_MS;
  return list.filter((e) => {
    const ms = localStartToMs(e.start);
    if (!Number.isFinite(ms)) return false;
    return ms >= cutoff;
  });
}

/** Start the notifier. Returns a stop function that clears the tick
 *  interval. Idempotent against repeated calls only via the caller's
 *  cleanup — internally, each call mounts a fresh interval. */
export function startMeetingApproachNotifier(): () => void {
  const notified = pruneNotified(loadNotified());
  saveNotified(notified);
  const notifiedSet = new Set(notified.map((e) => e.eventId));

  const tick = async () => {
    try {
      // Cheap guards first — both reads are SQLite GETs (microseconds)
      // but skipping the calendar query and permission probe matters
      // when the integration is off.
      if (!(await getApproachNotifyEnabled())) return;
      if (!(await getEnabled())) return;

      const leadMin = await getApproachLeadMinutes();
      const events = await upcomingEvents(leadMin, NOTIFY_GRACE_MS);
      if (events.length === 0) return;

      // Filter dedup BEFORE the permission probe so we don't probe on
      // every tick once everything's already notified.
      const fresh = events.filter((ev) => !notifiedSet.has(ev.externalId));
      if (fresh.length === 0) return;

      const granted = await isPermissionGranted();
      if (!granted) return;

      let changed = false;
      const now = Date.now();
      for (const ev of fresh) {
        const minutesAway = Math.max(
          1,
          Math.ceil((ev.startMs - now) / 60000),
        );
        // #12 — mark "notified" ONLY after a confirmed send. Previously the
        // dedup set was updated unconditionally right after a fire-and-forget
        // call, so a failed send still suppressed every future retry for that
        // event. Await it and, on failure, leave it un-notified to retry next
        // tick. (await on a void return is harmless.)
        try {
          // Native send (notify.rs) instead of the plugin: the plugin discards
          // click results, so we own delivery to make the body click jump to
          // this event's task (externalId rides the notification identifier).
          await invoke("send_meeting_notification", {
            title: `Meeting in ${minutesAway} min`,
            body: ev.title,
            externalId: ev.externalId,
          });
        } catch (sendErr) {
          console.error(
            "meetingApproachNotifier: sendNotification failed, will retry",
            sendErr,
          );
          continue;
        }
        notifiedSet.add(ev.externalId);
        notified.push({ eventId: ev.externalId, start: ev.startLocal });
        changed = true;
      }
      if (changed) saveNotified(notified);
    } catch (err) {
      // Background notifier failures must never throw to the React
      // tree. Log so we don't ship blind, swallow otherwise.
      console.error("meetingApproachNotifier tick failed:", err);
    }
  };

  // Initial fire so a freshly-mounted app picks up the next meeting
  // immediately rather than waiting 30s.
  void tick();
  const handle = setInterval(() => void tick(), TICK_MS);

  return () => {
    clearInterval(handle);
  };
}
