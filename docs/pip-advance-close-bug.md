# Plan — Fix: PiP closes on "next task" completion instead of advancing

**Author:** Terse
**Date:** 2026-06-17
**Status:** PENDING Verse review (no code written yet)
**Branch (proposed):** `fix/pip-advance-mount` (off `build/combined-install`)
**Scope:** One-line mount-condition change in `App.tsx` (+ destructure). No logic in the
focus engine, no store change, no flag, no DDL.

---

## Symptom

Completing the current task **from the PiP** with the post-completion setting on
**"Next task"** (advance) closes the PiP instead of keeping it open and advancing to the
next task. Completing the same task **on the focus screen** behaves correctly.

## Root cause — FocusMode mount gate, not the completion logic

`App.tsx:561`:
```jsx
{(currentPage === "focus" || !!session) && <FocusMode visible={currentPage === "focus"} />}
```

The focus engine (FocusMode) is the single persistent mount that owns the PiP window, its
IPC channel, the per-second state broadcast, and the heartbeat. Its mount lifetime is gated
on **`currentPage === "focus"` OR an active `session`**.

On advance-mode completion, `handleDone` (`FocusMode.tsx:1335`) calls
`previewFocus(next, …)`, which stages the next task as a **preview** (`focusView`) and
**clears `session`** (session and focusView are mutually exclusive — the XOR invariant).

So if completion came from the PiP while the main window is on another page
(`currentPage !== "focus"`), the gate evaluates `false || false` → **FocusMode unmounts**.
Its unmount cleanup (`FocusMode.tsx:944-948`) does `emit(PIP_STATE_EVENT, null)`. The PiP's
state listener (`FocusPip.tsx:306-318`) receives that null mid-completion-beat, sets
`pendingCloseRef = true` (deferring to the beat's end timer), and the timer
(`FocusPip.tsx:165`) then **closes the window** — even though the advance succeeded.

**Why pip-only:** completing on the focus screen keeps `currentPage === "focus"`, so the gate
stays true and FocusMode never unmounts.

**Why this is a latent inconsistency:** the broadcast effect already explicitly supports
preview state (`FocusMode.tsx:871` — "mirror for preview too … offer a Start button"). The
mount gate simply never got the matching `focusView` clause, so the engine is torn down in
exactly the state it's designed to keep feeding the PiP.

## Fix

`App.tsx` — add the preview pointer to the mount gate (and destructure `focusView` from the
store, alongside the existing `session`):
```jsx
{(currentPage === "focus" || !!session || !!focusView) && (
  <FocusMode visible={currentPage === "focus"} />
)}
```
- `visible` prop is unchanged (`currentPage === "focus"`) — a preview on another page stays a
  hidden engine, exactly as today.
- Update the mount-lifetime comment to read "focus page open OR active session OR pending
  preview".

## Why the genuine close cases still work

`stopFocus` clears **both** `session` and `focusView`. So:
- **Close mode** → `handleDone` schedules `stopFocus` → both null → gate false → unmount →
  PiP closes. ✓ (unchanged)
- **Advance, no next task** → `remaining.length === 0` → `stopFocus` → both null → unmount →
  PiP closes. ✓ (unchanged)
- **Advance, has next task** → `previewFocus(next)` → `focusView` set → gate **stays true** →
  FocusMode stays mounted → no spurious null → PiP stays open on the queued task. ✓ (the fix)

## Risk / blast radius

- One render condition. The only behavioral change: FocusMode now also stays mounted while a
  **preview** (queued task) is pending off the focus page — which is precisely when the PiP
  needs it alive. The XOR invariant means `focusView` is non-null only during a live
  preview; when the user fully stops, both clear and the gate falls false as before.
- No change to the focus engine, the PiP, the completion path, or the store.

## Self-validation
- `tsc --noEmit` clean → `tauri build --debug`.
- Trace re-check: confirm `focusView` is the store field `selectFocusedTask` /
  `readFocus` read, and that `stopFocus` clears it (so close cases still unmount).
- **Eyes-on (the real check):** start a task, open the PiP, navigate the main window OFF the
  focus page, complete from the PiP in "Next task" mode with another task on today's list →
  PiP must stay open showing the queued next task (Start button), NOT close. Then repeat the
  close-mode and last-task cases → PiP must still close.

## Note (separate, possible follow-up — NOT in this fix)
`handleDone` looks up the next task via `getTasksForDate(todayString())` (`FocusMode.tsx:1320`),
i.e. only **today's** incomplete tasks. If the user expected to advance to an unscheduled or
future-dated task, `remaining` is empty → stopFocus → PiP closes "correctly" by today's
definition. If that's also surprising, it's a separate scoping decision — flag to Nick, do
not fold into this mount fix.
