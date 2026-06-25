# Plan — Meeting-start focus switch (pip prompt + reminder)

**Author:** Terse · **Date:** 2026-06-25 · **Status:** PENDING Verse review (no code written)

## Goal (Nick's ask)
When a meeting task is **starting**, VerseDay should:
1. If I'm focusing → show a prompt **on the pip** asking if I want to switch focus. If I say yes, switch my focus to that meeting task.
2. If I'm **not** focusing → a reminder that still pops up.

## What already exists (reuse, don't rebuild)
- **Meeting tasks** = calendar events synced as tasks with `external_source === 'calendar'` (`src/types/index.ts:24-59`), carrying `external_start_local` / `external_end_local` / `external_id`.
- **Approach notifier**: `src/calendar/meetingApproachNotifier.ts` polls every 30s, finds calendar tasks whose start falls in a **lead window** (default 15 min, user-set), and fires a native OS notification via `invoke("send_meeting_notification", …)`. Dedups per `externalId` in localStorage. Mounted globally in `App.tsx:443-446`.
- **Notification → focus jump**: `App.tsx:455-487` listens to `verseday:notification-clicked`, resolves the task by `external_id`, **commits any running session**, and stages it as a focus preview + navigates to Focus. This is already a "switch focus" path.
- **Pip prompt UI precedent**: `FocusPip.tsx:633-686` renders the break prompt (action buttons + snooze/skip, 30s auto-dismiss). PiP state arrives via `PIP_STATE_EVENT`; pip→engine commands via `PIP_CMD_EVENT` (`src/utils/pipEvents.ts`).
- **Task switching mid-session**: `appStore.ts` `handleStartBrowsed` pattern — `endActiveFocusSession()` → new time entry → `previewFocus()` + start. This is exactly "switch focus to task X."
- **Meeting awareness in the engine**: `src/pages/FocusMode.tsx:146-149` already flags `isMeetingRef` from `external_source === 'calendar'`.

## The only genuinely new pieces
1. A **start-time trigger** (T-0), distinct from the existing T-15 lead reminder.
2. A **pip "switch focus?" prompt** phase + its two commands.
3. **Routing** by focus state (pip prompt vs OS reminder).

## Design

### A. Start-time detection (extend the existing notifier)
- Add a second, independent trigger in `meetingApproachNotifier.ts`: fire once when `now ∈ [start − 60s, start + grace]` for a calendar task.
- **Separate dedup key** (`<externalId>:start`) so it never collides with the existing lead-reminder key. Same 24h prune.
- Skips: declined/tentative/dismissed meetings (already filtered upstream by `sync.ts`); and the meeting the user is **already focused on** (compare to active `session.taskId`).

> **§B REVISED per Verse REJECT (2026-06-25):** the notifier is now a **pure detector** with zero store/pip coupling, and a **single always-mounted handler** owns delivery. The old draft put the decision in the poller and keyed the fallback off `highVisibility` — which is the **prominent-pip render flag, not a visible/hidden signal** (`FocusPip.tsx:121`). The real signal is `pipShownRef.current = hasBeenActive && !pipHidden` (`src/pages/FocusMode.tsx:484`) — the same one the chime decider/speaker split routes on.

### B. Detection + delivery (pure detector → single owner)

**Notifier = pure detector** (`src/calendar/meetingApproachNotifier.ts`): on its existing 30s tick, detect T-0 (see window bound below), dedup on `<externalId>:start`, and **emit** `verseday:meeting-starting` `{ externalId, taskId, title, startMs }`. **No store read, no pip-vs-notif decision, holds no subscription.**

**Window bound:** fire only when `now ∈ [startMs − ~60s, startMs + NOTIFY_GRACE_MS]`, where `NOTIFY_GRACE_MS = 90s` already exists (`src/calendar/meetingApproachNotifier.ts:54`). The `+90s` upper bound is **explicit** and **inherits the existing sleep-through-window drop**: if you wake 6 min into a meeting (`now − start > 90s`), it does **not** fire "Switch focus?". Independent of the T-15 lead reminder (separate dedup key, untouched behavior).

**DELIBERATE divergence from the #12 fix (Verse-required note, accepted):** the existing lead reminder marks `<externalId>` notified **only after a confirmed `send_meeting_notification`** (`src/calendar/meetingApproachNotifier.ts:133-157`), so a failed send retries on the next tick. This start trigger instead marks `<externalId>:start` deduped at **EMIT time** — because delivery now happens *later* in App.tsx (and may route to the pip, not a send at all). **Consequence, accepted:** if the OS-notif branch's send fails, there is **no retry** — one missed tick = no prompt. This is intentional: the meeting-start prompt is a **single-shot UX nudge, not a guaranteed-delivery alert**. We do **not** silently inherit #12's retry guarantee for this trigger.

**Single delivery owner = `src/App.tsx`** (always mounted; FocusMode is **not** — `App.tsx:569` mounts FocusMode only when `currentPage === "focus" || !!session || !!focusView`). The handler listens for `verseday:meeting-starting` and reads a **synchronous read-only snapshot** via `useAppStore.getState()` (zustand, `src/stores/appStore.ts:1025`) — `{ session, pipShown }`:
- meeting **is** the current focused task (`session?.taskId === taskId`) → **no-op**.
- **active session AND `pipShown`** → set store field `meetingPromptRequest = { externalId, taskId, title }`; FocusMode reflects it into the pip (C). *(Requires a live session, so FocusMode is guaranteed mounted to reflect it.)*
- **otherwise** (no session, or session but pip not shown — hidePip / focus-screen foreground) → **OS notification** via the existing `send_meeting_notification` path; its click already commits the running session and jumps to focus (`App.tsx:455-487`).

**Visibility truth stays where the pip lives:** FocusMode publishes `pipShown` (mirror of its `pipShownRef`) into the store; App.tsx only *reads* it. One listener of the detector event = no double-fire; `session && pipShown` means a stale `pipShown` can never mislead once a session has ended (FocusMode resets it on unmount).

### C. Pip "switch focus?" prompt
- New `PipState.phase` value `"meetingPrompt"` + payload `{ title, startLabel, externalId }` (`FocusPip.tsx` PipState, `pipEvents.ts`).
- `FocusMode` reflects the store's `meetingPromptRequest` into the pip phase `meetingPrompt` (only ever set by App.tsx in the active-session+pipShown branch, so the meeting is never the current task here).
- Pip renders (mirrors break-prompt styling): **"<Meeting> is starting"** + **[Switch focus]** / **[Not now]**. Auto-dismiss after 45s (longer than the 30s break prompt; a missed switch matters more) → reverts to running display.
- New `PIP_CMD_EVENT` values:
  - `switchToMeeting` → FocusMode resolves the meeting task, commits the current session (`endActiveFocusSession`), then `previewFocus(meetingTask)` + start — the existing `handleStartBrowsed` flow. **DECIDED (Nick, 2026-06-25): the meeting task becomes the new running focus session — the timer runs ON the meeting immediately (one-click), not a stage-and-pause.**
  - `dismissMeetingPrompt` → clear phase back to `work`.

### D. Settings (no DDL)
- **DECIDED (Verse, 2026-06-25): reuse the existing "calendar notifications enabled" gate. No new toggle for v1.**

## Explicitly OUT of scope / non-goals
- No new calendar provider work, no change to sync/import.
- No change to the lead (T-15) reminder behavior.
- No "join meeting" / deep-link to Zoom/Meet (could be a later follow-up).

## Risk / safety notes for Verse
- **No DB schema change. Zero DDL / no migration.** Reuses existing task columns + key-value settings + the existing Rust `send_meeting_notification` command.
- **No new cost.** Native macOS notifications only — nothing billable. (Budget = zero respected.)
- **Untrusted-data rendering:** the meeting title is external data. It is rendered as a **React text node** in the pip (inherently escaped) — no `innerHTML`, no sanitizer needed, consistent with the htmlToSegments discipline. Attendee emails are not shown.
- **No double-switch / loops:** guard against prompting for the task already focused; dedup the start trigger; "Switch focus" reuses the audited `endActiveFocusSession` → preview → start path (canonical session reconciliation preserved).
- **Cross-webview:** one new window event (`verseday:meeting-starting`, main-process-internal) + two new `PIP_CMD` strings + one new `PipState.phase` + one ephemeral store field (`meetingPromptRequest`) + one published store boolean (`pipShown`). No new Tauri windows.

## Known v1 behavior (not a defect)
- On the **focus screen** with the pip not shown, a meeting start delivers the **OS notification** (the `pipShown` fallback), not an in-screen prompt. A focus-screen-native prompt is a possible follow-up; out of scope for v1.

## Rough work breakdown (post-approval, on a new branch `feat/meeting-focus-switch`)
1. `src/utils/pipEvents.ts` — extend `PipState.phase` + `meetingPrompt` payload + two `PIP_CMD` strings (`switchToMeeting`, `dismissMeetingPrompt`).
2. `src/calendar/meetingApproachNotifier.ts` — **pure-detector** T-0 trigger: `[start−60s, start+NOTIFY_GRACE_MS]` window, `<externalId>:start` dedup, emit `verseday:meeting-starting`. No store/pip coupling.
3. `src/App.tsx` — **single delivery owner**: listen for `verseday:meeting-starting`; read `useAppStore.getState()` `{ session, pipShown }`; route (no-op / set `meetingPromptRequest` / OS notif).
4. `src/stores/appStore.ts` — add ephemeral `meetingPromptRequest` field + setter, and a `pipShown` boolean published by FocusMode (reset on unmount).
5. `src/pages/FocusMode.tsx` — publish `pipShown`; reflect `meetingPromptRequest` into pip phase; handle `switchToMeeting` (commit current → `previewFocus` + start, meeting becomes the running session) / `dismissMeetingPrompt`.
6. `src/components/FocusPip.tsx` — render the `meetingPrompt` phase (buttons, 45s auto-dismiss).
7. Manual eyes-on: meeting start while focusing+pip-shown (switch + not-now), while idle/no-session (OS notif), already-focused-on-the-meeting (no-op), session-but-pip-hidden (OS-notif fallback), woke-in-late >90s (no fire).
