# Plan: Break controls — extend (+5/+10) and confirm-to-end with overtime

**Date:** 2026-06-26
**Author:** Terse
**Status:** Awaiting Verse review (no code written)
**Supersedes:** `2026-06-26-extend-break.md` (extend-only)

## Goals

Two related changes to the in-progress break (`phase === "break"`):

1. **Extend** — `+5 min` / `+10 min` buttons that add time to the current break.
   Taps stack (+10 twice = +20), so a short break can become a 25-min shower break.
2. **Confirm-to-end + overtime** — when the allotted break elapses, the app must
   **not** silently resume work. Instead:
   - It fires the break-up chime once and **stays on the break screen**.
   - The timer flips to counting **up**, showing how far **over** the allocation
     the user is (e.g. "02:14 over").
   - Both the break screen and the **PiP** present an explicit choice:
     **End break** (resume work) or **Continue break** (keep resting).
   - Work resumes **only** when the user picks End break.

## How breaks work today (the bits that matter)

`src/pages/FocusMode.tsx`:
- State `breakDuration` (target ms) + `breakRemaining` (display ms); ref
  `breakStartRef.current` = `Date.now()` at start (`:727`, `:733`, `:1389`).
- 1s tick (`:915`):
  ```ts
  const breakElapsed = now - breakStartRef.current;
  const remaining = breakDuration - breakElapsed;
  setBreakRemaining(remaining);
  if (remaining <= 0) {                 // ← TODAY: auto-resume
    totalBreakTimeRef.current += breakDuration;
    workCycleStartRef.current = workElapsedMs(...);
    setPhase("work"); setBreakRemaining(0); fireChime("end");
  }
  ```
- `handleSkipBreak()` (`:1430`) already ends a break correctly for **any** elapsed:
  it accounts `breakElapsed = Date.now() − breakStartRef`, anchors the work cycle,
  and flips to work. This is exactly the "End break" action we need (works for
  partial *and* over-run).
- `BreakScreen` (`:2112`) is presentational; PiP renders the same `breakRemaining`,
  rebroadcast every tick over `PIP_STATE_EVENT` (`:1018`+). PiP "End early" sends
  the `skipBreak` command (`FocusPip.tsx:773`), received at `FocusMode.tsx:1176`.

**Consequence:** `remaining` is derived fresh each tick from `breakDuration`, so
(a) extending = increasing `breakDuration`, and (b) overtime = simply *not*
flipping to work and letting `remaining` go negative.

## Design

### A. Tick: stop auto-resuming; alert once at the limit

Replace the auto-transition block (`:920`–`:929`) with:

```ts
const remaining = breakDuration - breakElapsed;   // may go negative (overtime)
setBreakRemaining(remaining);
if (remaining <= 0 && !breakLimitChimedRef.current) {
  breakLimitChimedRef.current = true;
  fireChime("end");          // "break's up" alert — fires exactly once
}
// No phase transition here. The user must explicitly End break.
```

New ref `breakLimitChimedRef` (once-guard for the alert).

### B. Handlers

```ts
// End break (the confirmation gate → resume work). Mechanically identical to
// today's handleSkipBreak: accounts actual elapsed (incl. overtime) and flips
// to work. We REUSE handleSkipBreak for both "End early" and "End break".

// Continue break — acknowledge the break-up alert and keep resting. Overtime
// keeps counting; End break stays available. Calms the alert emphasis.
function handleContinueBreak() { setBreakAck(true); }

// Extend — add time; reset the alert guards so a fresh run-out re-alerts.
function handleExtendBreak(addMs: number) {
  if (phase !== "break") return;
  setBreakDuration((d) => d + addMs);
  setBreakRemaining((r) => r + addMs);   // instant UI bump; tick reconciles
  breakLimitChimedRef.current = false;
  setBreakAck(false);
}
```

`handleTakeBreak` (`:1389`) also resets the guards: `breakLimitChimedRef.current
= false; setBreakAck(false);`.

New state `breakAck` (bool) — whether the user pressed Continue (controls whether
the surfaces show the prominent "break's over" prompt vs a calm overtime count).

Constants beside the break settings:
```ts
const EXTEND_SMALL_MS = 5 * 60 * 1000;
const EXTEND_LARGE_MS = 10 * 60 * 1000;
```

### C. PiP command + state

- New command `continueBreak` → `handleContinueBreakRef.current()` (add at
  `FocusMode.tsx:1176` next to `skipBreak`).
- `End break` on the PiP reuses the existing `skipBreak` command.
- (Optional, for extend-from-pip parity later: `extendBreak5/10` — **out of scope
  this round**; extend lives on the break screen only for now.)
- Add `breakAck: boolean` to the broadcast `PipState` (`:1018`+) so the PiP can
  calm its prompt after Continue.

### D. BreakScreen UI (`:2112`)

New props: `onExtend(addMs)`, `onContinue()`, `acknowledged: boolean`
(`onSkip` stays = End break/End early).

- **Within allocation** (`remainingMs >= 0`):
  - "BREAK" · green count**down** · "ends HH:MM"
  - Row: `[+5 min] [+10 min]` (quiet ghost pills)
  - `[End early]` (unchanged)
- **Overtime** (`remainingMs < 0`):
  - Warm "BREAK OVER" label · count**up** `formatOvertime(remainingMs)` →
    "MM:SS over" (warm/amber, not the calm green)
  - Primary `[End break]` + secondary `[Continue break]`
  - Keep `[+5 min] [+10 min]` (extending snaps back to a normal countdown)
  - `acknowledged` softens the "BREAK OVER" emphasis (no pulse) once Continue is
    pressed; the overtime keeps counting and End break stays available.

Add pure helper `formatOvertime(ms)` = `formatCountdown(Math.abs(ms))` + " over".

### E. PiP UI (`FocusPip.tsx:737`)

- **Within allocation:** unchanged (Break / ends, countdown, End early →
  `skipBreak`).
- **Overtime** (`state.breakRemaining < 0`):
  - Warm "OVER" label + overtime count
  - `[End break]` (`skipBreak`) + `[Continue]` (`continueBreak`)
  - Until `state.breakAck`, give a subtle emphasis (e.g. accent ring/pulse) so a
    glance at the pip shows the break ran out; after Continue, calm it.

## Why this is safe / correct

- **Extend is cumulative for free** (functional `setBreakDuration`).
- **No silent resume** — the only path to `phase = "work"` from a break is the
  explicit End break (existing `handleSkipBreak`); the tick no longer transitions.
- **Chime fires once** per run-out via `breakLimitChimedRef`; extending resets the
  guard so a second run-out re-alerts. No double-fire (the chime decider /
  `__chimeFirer` split is untouched).
- **Accounting stays correct** — End break accounts actual elapsed
  (`Date.now() − breakStartRef`), which includes overtime; `workElapsedMs`
  subtracts `totalBreakTime`, so overtime is counted as break, never as work.
- **PiP stays in sync** — it already renders `breakRemaining` (now possibly
  negative) each tick; only the new `breakAck` field and the overtime branch are
  added.
- **Pause-safe** — pause/resume adjusts `breakStartRef`; extend touches only
  `breakDuration`; the overtime derivation is unaffected.

## Decisions taken (not asking)

- **No upper cap** on extend; user controls it via taps.
- **+5 / +10 only** (no custom-minutes input); extend on the **break screen only**
  this round (pip parity is a possible follow-up).
- **Overtime counts indefinitely** until the user acts — that's the point; there's
  no auto-resume safety timeout.
- **No persistence change** — break state is ephemeral today (lost on reload),
  including overtime; out of scope.

## Open question for Verse

- **`Continue break` semantics.** Proposed: pure acknowledgement — calms the alert,
  overtime keeps counting, End break stays available (no time added; +5/+10 is the
  "add time" path). Acceptable, or do you want Continue to *also* add a fixed chunk
  (e.g. another short-break length)? I lean acknowledgement-only to keep one
  obvious "add time" affordance.

## Scope / risk

- Touches: tick block + 2 small handlers + 2 guards/state in `FocusMode.tsx`; one
  new PiP command + one `PipState` field; `BreakScreen` and `FocusPip` break
  branches; one pure formatter. **No deps, no IPC transport change, no DB, no
  migration, nothing that costs money.**
- Atomic, revertible in one commit; no flag.
- New feature branch off `main`, not `main`.

## Verification

- `tsc` + `tauri build --debug` → run the `.app` bundle.
- Eyes-on:
  1. Start break → `+10` twice → countdown jumps +20, "ends" updates, PiP matches.
  2. Let a (short) break run out → chime fires once, screen stays, timer flips to
     "MM:SS over" counting up; **work does not resume**.
  3. PiP shows OVER + End break / Continue; Continue calms it, overtime keeps going.
  4. End break → work resumes; pomodoro cadence intact.
  5. Extend during overtime → snaps back to a normal countdown; running out again
     re-alerts (chime once).
