# Plan — Four PiP / break follow-ups

**Author:** Terse
**Date:** 2026-06-17
**Status:** PENDING Verse review (no code written yet)
**Branch (proposed):** `feat/pip-break-followups` (off `build/combined-install`)
**Scope:** Presentational + behavioral. **No DB migration** (uses existing columns). No flag.

Four independent changes, shipped in one pass (small/medium features → final review only).

---

## 1. Distinct chime when a break ENDS

**Today:** `src/utils/sounds.ts` exports one `playBreakChime()` (synthesized oscillator,
*descending* G arpeggio G5→D5→G4), imported as `playChime` (FocusMode) / `playCalm`
(FocusPip). It fires for BOTH break-start and break-end:
- FocusMode `:757/:765` (work→prompt, break offered) and `:780` (break→work, break over).
- FocusPip `:322-323`: `if (next.phase === "prompt" || (prev.phase === "break" && next.phase === "work")) playCalm()`.

**Change:** add `playBreakEndChime()` to `sounds.ts` — an *ascending* arpeggio (G4→D5→G5),
the timbral inverse of the start chime so "break over → back to work" is unmistakable.
Mirror the existing trigger points (don't add new ones, so the play-count per window is
unchanged):
- FocusMode `:780` → `playBreakEndChime()` (leave `:757/:765` as the start chime).
- FocusPip `:322-323` → split the branch: `prompt` keeps `playCalm()`; the
  `break→work` branch calls `playBreakEndChime()`.

## 2. "End of break" text in the PiP for a few seconds

**Reuse the existing transient `pendingAck` overlay** (FocusPip `:505-524`, rendered before
the phase layouts; `flashAck` at `:188-196` is the same idea but also dispatches a command).

**Change:** add a command-less helper `flashMessage(msg, ms)` that sets `pendingAck` and
clears it after `ms`. In the FocusPip state listener, on the `break→work` transition (same
condition as #1), call `flashMessage("End of break", 2000)`. The pip shows "End of break"
for ~2s, then falls through to the normal work readout. (Pairs naturally with the #1 chime.)

## 3. Suppress the break prompt during calendar meetings

**No migration needed.** Tasks already carry `external_source` (`"calendar"` for imported
meetings, `null` for in-app) — `src/types/index.ts`, migrations v18–v21, already shipped.

**Today:** the work-cycle timer (FocusMode `:750-766`) sets `phase: "prompt"` + plays the
chime when a pomodoro boundary is hit, regardless of task type.

**Change:** gate the two prompt branches on "focused task is NOT a calendar meeting." The
timer runs in an interval whose closure would capture a stale `focusedTask`, so add a ref
`isMeetingRef` updated from `focusedTask?.external_source === "calendar"` (a tiny effect),
and read it in the tick. When the boundary is hit for a meeting: **skip the prompt** — do
NOT `setPhase("prompt")` / chime; instead advance `workCycleStartRef.current` to the current
work-elapsed so the cycle re-arms cleanly and doesn't re-fire every tick. Net effect: a
meeting never interrupts you with a break offer; the timer just keeps running.

## 4. Click the PiP body / logo → raise VerseDay to the Focus screen on the current task

**Today:** the pip-body `onClick={focusMainWindow}` was deliberately removed in `185d928`
("drop pip-body onClick") during the hover-geometry rework — leaving the comments at
FocusPip `:657/:661/:676` describing an "outer focus-on-click" that no longer exists. The
only survivor is the hover-revealed VerseDay logo button (`:687`), and `focusMainWindow`
(`:51-58`) only does `main.setFocus()` — it raises the window but never routes to the Focus
screen or the current task.

**Change (two parts):**
- **New command path.** Add `openFocusScreen()` in FocusPip: `sendCommand("openFocus")` then
  raise the main window (the existing `main.setFocus()`). Wire it to the logo button (replace
  the bare `focusMainWindow`) AND restore it on the running-readout body container (`:625`)
  as `onClick={openFocusScreen}`. The buttons already `stopPropagation`, so body-click vs
  button-click stays clean.
- **Click-vs-drag guard.** `185d928` dropped the body onClick on purpose, so re-add it
  safely: record the pointer-down x/y in `handlePipMouseDown` and only fire `openFocusScreen`
  if the click ends within a few px of down (a real click, not the tail of a drag). This is
  the piece the original lacked.
- **Main-window handler.** In the `PIP_CMD_EVENT` switch (FocusMode `:980-996`) add
  `else if (cmd === "openFocus")` → `setPage("focus")` and clear `browsedTaskId` (so
  `selectViewedTask` falls back to the session/preview task and the screen shows the task the
  pip is timing, not a stale browse pointer).

---

## Risk / blast radius

- **#1/#2:** additive — one new sound fn, one new transient message; the only edits to
  existing behavior are swapping the break-END timbre and adding a 2s message on the same
  transition. No phase-machine change.
- **#3:** one guarded branch in the existing timer; meetings skip the prompt and keep
  counting. Non-meeting behavior byte-identical (ref defaults to false). No DDL.
- **#4:** re-introduces a deliberately-removed handler — mitigated by the click-vs-drag
  guard the original lacked, and it now routes through a command instead of a bare setFocus.
  Watch: ensure a pip DRAG never triggers navigation, and that `openFocus` while already on
  the focus page is a no-op-ish (setPage idempotent + browse cleared).

## Self-validation

- `tsc --noEmit` clean → `tauri build --debug`.
- Confirm play-count parity (no new double-chime): break-end fires the new chime exactly
  where the old one did.
- **Eyes-on:** (1) take a break, let it end → hear the *new* ascending chime, distinct from
  the start; (2) "End of break" shows in the pip ~2s on break end; (3) focus a calendar
  meeting, run past a pomodoro boundary → NO break prompt (normal task still prompts);
  (4) click the pip body (not a button) and the logo → VerseDay raises onto the Focus screen
  showing the timed task; a pip DRAG does NOT navigate.

## Out of scope
- The "Next task = today-only" lookup ([[project_next_task_today_only]]) — separate ticket,
  awaiting Nick's scope decision. Not touched here.
- Any change to how meetings are imported, or the break duration/cycle math.
