# Focus screen — browse tasks while the timer keeps running (decoupled view)

**Date:** 2026-06-16
**Author:** Terse
**Status:** PENDING Verse review — no code written yet
**Branch:** `feat/focus-arrow-nav-decoupled` (off main @ b21c434)

## Goal (Nick's ask)

On the focus screen, ↑/↓ should scroll through the day's tasks **even while the
timer is running**, without moving the timer off the task it's accumulating on.
When the viewed task ≠ the running task:
- a banner at the bottom shows the timer is still running for a *different* task
  (and names it);
- clicking the banner returns the view to the running task;
- pressing **Start** on the viewed (different) task **stops + saves the running
  one and starts the viewed one**.

## Current model (from the store)

`src/stores/appStore.ts`:
- `session: SessionState | null` — the canonical running time_entry (source of
  truth). `focusView: FocusView | null` — a preview (staged, no time entry).
  **Mutually exclusive**; `readFocus()` returns active if session, else preview.
- `selectFocusedTask` = `session?.taskId ?? focusView?.taskId` → the ONE task the
  screen renders. So view and session are locked together.
- Arrow keys (`FocusMode.tsx` ~1046–1110) are **gated off during an active
  session** — they only navigate in preview/null, via `previewFocus`.
- Start/Pause (`FocusMode.tsx` ~1726): `isQueued ? handleStartSession :
  handleTogglePause`. `handleStartSession` creates a time entry → `activateFocus`.
- Switching tasks already commits cleanly via `endActiveFocusSession()` →
  `stopFocusedSessionForTask()` (writes worked_seconds, closes the row).
- The **pip** reads `selectFocusedTask` (session precedence) — must keep showing
  the RUNNING task, not the browsed one.

## Design — add a third "browsed" dimension

Introduce a transient view pointer that's independent of the session:

- New store field `browsedTaskId: number | null` (never persisted; cleared
  whenever focus is entered fresh / session ends).
- New selector `selectViewedTask` = `browsedTaskId` (if set) → that task, else
  `selectFocusedTask` (existing). **The focus SCREEN renders `selectViewedTask`.**
- `selectFocusedTask` stays as-is and keeps driving the **session + pip** (so the
  pip and the live counter always track the running task).
- Derived flags:
  - `runningTaskId = session?.taskId ?? null`
  - `viewingRunning = browsedTaskId == null || browsedTaskId === runningTaskId`
  - `timerElsewhere = session != null && !viewingRunning` → drives the banner.

### Arrow nav (`FocusMode.tsx` keydown ~1046–1110)
- Preview/null (no session): unchanged (re-`previewFocus`).
- **Active session: ↑/↓ now move `browsedTaskId`** through the day's non-done
  tasks (`getTasksForDate(todayString())`, sort_order — same source the existing
  handler uses), WITHOUT touching `session`. Landing back on the running task
  sets `browsedTaskId = null` (→ no banner, normal running controls).

### Screen render (switch the per-task bindings from `focusedTask` → viewedTask)
- Title (edit), notes (auto-save), worked/estimated bind to **viewedTask** so you
  edit the task you're looking at.
- Time area:
  - viewing the running task → live counter + Pause/Resume (unchanged).
  - browsing a non-running task → that task's static worked/estimated + a
    **Start** button (it's not running).

### Start / switch behavior
- Start button when browsing a non-running task → if a session is running on
  another task, `await endActiveFocusSession()` (commit+save), then the existing
  `handleStartSession` path (create time entry → `activateFocus`) on the viewed
  task; clear `browsedTaskId`. Net: the timer moves to the viewed task.
- Pause/Resume only ever controls the running session (shown only when viewing it).

### Banner (new, bottom of focus screen)
- Rendered when `timerElsewhere`: e.g. "⏱ Still timing **<running task title>** —
  click to return." Click → `browsedTaskId = null` (return view to running task).
- Quiet, single-line, on-brand; doesn't block the viewed task's controls.

### Session-end while browsing
- On stop/complete of the running session while `browsedTaskId` is set and points
  elsewhere: after the commit, convert the browsed task to a preview
  (`previewFocus(browsedTask)`) and clear `browsedTaskId`, so the screen stays on
  what you were looking at (now in preview, ready to Start).

## Risk / review focus
- **Pip + live counter must keep tracking the running task** — only the SCREEN
  reads `selectViewedTask`; `selectFocusedTask`/PipState stay session-bound.
  Explicitly verify the pip title doesn't follow the browse pointer.
- **No accidental time fragmentation:** browsing never opens/closes a time_entry;
  only the explicit Start-switch commits, through the proven
  `endActiveFocusSession` path.
- **Editing while browsing** writes to the viewed task (title/notes/estimate) —
  intended, but confirm the auto-save targets viewedTask.id, not the session's.
- **browsedTaskId lifecycle:** cleared on focus-enter, on return-to-running, on
  Start-switch, and on session end; can't leak across sessions or persist.
- Tasks list source matches the existing arrow handler (getTasksForDate + sort
  order); wrap behavior consistent.
- No DB / no migration / no Rust. Zero cost.

## Verification plan
- `tsc` + `eslint` + `vite build` clean.
- Manual: start a timer on task A → ↑/↓ to task B (timer keeps counting on A, pip
  still shows A) → banner shows "Still timing A" → click banner returns to A →
  arrow to B again → Start on B stops+saves A and starts B (pip now B). Edit B's
  notes/title while browsing → saves to B. Stop while browsing B → B becomes a
  preview.
