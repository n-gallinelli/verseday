# Pause Symmetry Across Focus Screen, PiP, and Daily Plan

**Status:** Resubmitted to Verse (rev 2) — addresses all six revision items from rev 1
**Date:** 2026-05-07
**Author:** Terse
**Severity:** Behavioral correctness bug + UX inconsistency. No security implications.

---

## Bug report (user-observed)

> Task is running. PiP and Focus screen show it ticking. User leaves Focus screen → lands on Daily Plan → clicks **Pause on the PiP**. The PiP and Focus screen freeze, but the live counter on the Daily Plan task row keeps ticking. They should all behave the same: pause one, all three pause; resume one, all three resume.

User's stated requirement, verbatim:

> if I pause one of them it should pause the other so if I pause the pip it should pause the the task altogether... If I pause it from the daily plan screen, it should pause the pip. They're all the same task. All the behavior should be the same.

---

## Root cause

"Pause" means three different things on three surfaces:

| Surface | What "Pause" button does | DB time entry | Store `focus` |
|---|---|---|---|
| **Focus screen** (`src/pages/FocusMode.tsx:607` `handlePause`) | Soft-pause — flips `useState` `paused` local to FocusMode; counter freezes via `pausedAtRef`/`pausedAccumRef` | stays open | unchanged |
| **PiP** (`src/components/FocusPip.tsx:486` → `sendCommand("pause")` → `src/pages/FocusMode.tsx:492` → `handlePauseRef`) | Same as Focus screen — routes to FocusMode's local `paused` | stays open | unchanged |
| **Daily Plan TaskCard pause button** (`src/components/TaskCard.tsx:404` → `src/pages/DailyPlanner.tsx:523` `handleStopFocus`) | Full **stop** — `stopTimeEntry()` + `stopFocus()` | closed | cleared |

Three problems fall out:

### 1. Soft pause never reaches Daily Plan
The PiP command bus (`localStorage["verseday_pip_cmd"]`) is polled inside `src/pages/FocusMode.tsx:487-519`. FocusMode is persistently mounted while a session is active (`src/App.tsx:385` — `currentPage === "focus" OR focus?.mode === "active"`), so the command IS received. But `handlePause` only flips a `useState` boolean local to FocusMode. The store's `FocusState` has no `paused` field. Daily Plan's `TaskCard` reads `focus` from the store, so it has no signal to freeze.

### 2. Daily Plan's "Pause focus" button is mislabeled
It actually fully stops: closes the time entry, clears focus. The icon and tooltip ("Pause focus", `src/components/TaskCard.tsx:411`) say one thing; the behavior is another. PiP and Focus screen with the same icon do the soft pause.

### 3. Pre-existing: paused time is not deducted from time-entry minutes
The soft pause subtracts paused milliseconds from the *local* on-screen counter only. The time entry's `started_at` timestamp doesn't move, and there's no pause accumulator persisted, so when `stopTimeEntry` finally writes the minutes, paused time is counted as worked. Independent of the symmetry fix but the right fix exposes a clean place to address it.

---

## Proposed fix

Lift pause into the store as a first-class concept on `FocusState`. Make all three surfaces read/write it through one action. The PiP keeps its existing rendering model (renders from incoming `PipState` payload via `localStorage["verseday_pip_state"]`); only the payload-producer changes.

### Store changes (`src/stores/appStore.ts`)

Extend `FocusState`:

```ts
interface FocusState {
  mode: "active" | "preview";
  task: Task;
  timeEntryId: number;
  startedAt: number;           // existing
  previousPage: Page;          // existing
  priorElapsedMs: number;      // existing
  // NEW:
  paused: boolean;
  pausedAtMs: number | null;   // wall-clock when current pause began; null when running
  pausedAccumMs: number;       // total paused time this session, excludes any open pause
}
```

New action:

```ts
togglePauseFocus: () => {
  const f = get().focus;
  if (!f || f.mode !== "active") return;
  const now = Date.now();
  const next: FocusState = f.paused
    ? {
        ...f,
        paused: false,
        pausedAtMs: null,
        pausedAccumMs: f.pausedAccumMs + (f.pausedAtMs ? now - f.pausedAtMs : 0),
      }
    : {
        ...f,
        paused: true,
        pausedAtMs: now,
      };
  persistFocus(next);
  set({ focus: next });
}
```

**Pause init on session (re)start** — Verse rev 1 #3. `startFocus` (`src/stores/appStore.ts:219`) initializes the three new fields to `false / null / 0` for the new session. The existing `setFocusTask` "swap to next task" path also routes through `startFocus`-equivalent state, so it gets the reset for free. This replaces the reset effect at `src/pages/FocusMode.tsx:177-190` for the pause-related lines (177's `setElapsed(0)`, 179's `setPaused(false)`, 180's `pausedAtRef.current = null`, 181's `pausedAccumRef.current = 0`); break/Pomodoro lines 182-189 stay component-local since they're orthogonal to pause.

**Loader migration** — `loadPersistedFocus` (`src/stores/appStore.ts:110-125`) already does `Partial<FocusState>` defaulting for back-compat (e.g., `mode`). Default-fill the three new fields the same way: `paused: parsed.paused ?? false`, `pausedAtMs: parsed.pausedAtMs ?? null`, `pausedAccumMs: parsed.pausedAccumMs ?? 0`. No special-case logic.

**Adjust-elapsed action** — Verse rev 1 #5. The reverse-engineering path at `src/pages/FocusMode.tsx:759-766` (`applyActualMs`) currently mutates `pausedAccumRef.current` directly to back-solve a desired elapsed. Once `pausedAccumMs` lives on the store, components must not mutate it directly. Add an action:

```ts
adjustFocusElapsed: (desiredElapsedMs: number) => {
  const f = get().focus;
  if (!f || f.mode !== "active") return;
  const now = Date.now();
  const reference = f.paused && f.pausedAtMs !== null ? f.pausedAtMs : now;
  const newAccum = reference - f.startedAt - desiredElapsedMs;
  const next = { ...f, pausedAccumMs: newAccum };
  persistFocus(next);
  set({ focus: next });
}
```

`applyActualMs` becomes a thin call to `adjustFocusElapsed` after computing the desired elapsed, with the existing `Math.max(focus.priorElapsedMs, targetMs)` guard preserved.

### Surface changes — Focus screen (`src/pages/FocusMode.tsx`)

- **`:607` `handlePause`** — delete. The four toggle call sites below all retarget to `togglePauseFocus`.
- **`:492` PiP command receiver** — `if (cmd === "pause") togglePauseFocus()`. (Currently calls `handlePauseRef.current()`.)
- **`:524` `verseday:toggle-pause` Space-key listener** — same retarget to `togglePauseFocus`.
- **`:1063` in-page Pause/Resume button** — Verse rev 1 #2. `onClick={isQueued ? handleStartSession : togglePauseFocus}`. Today binds to the about-to-be-deleted `handlePause`. Without this update the button is a dead reference.
- **`:177-190` reset-on-task-change effect** — drop the three pause-related lines (`setPaused`, `pausedAtRef`, `pausedAccumRef`); pause init now lives in `startFocus`. Break/Pomodoro lines stay.
- **`:328` `useState paused`, plus `pausedAtRef`/`pausedAccumRef`** — delete. Read from `focus.paused` and `focus.pausedAccumMs` directly via the store hook. Every read site (`:373`, `:424`, `:431`, `:436`, `:447`, `:454`, `:763`, `:971`, `:1063`, `:1065`, `:1070`) substitutes accordingly.
- **`:759-766` `applyActualMs`** — rewrite to use `adjustFocusElapsed` per the action above. No direct ref mutation.
- **`:445-453` PiP state broadcast** — read `paused`, `pausedAtMs`, `pausedAccumMs` from `focus` (store) instead of local state. Payload structure described below.

### Surface changes — PiP (`src/components/FocusPip.tsx`)

PiP renders from `localStorage["verseday_pip_state"]` payload (read at `:213-216`, never writes). Verse rev 1 #4 — extend the payload, no architectural change to the PiP itself.

- **`PipState` interface (`:22-29`)** — add `pausedAtMs: number | null` and `pausedAccumMs: number`. `paused: boolean` already present at `:24`. Updated payload shape is what `src/pages/FocusMode.tsx:445-453` writes.
- **PiP render uses `state.paused`** at `:387, :488, :490` — no change needed; `paused` already drives icon/color. The fix is purely upstream: ensure FocusMode broadcasts the store's `paused`, not its (deleted) local `useState`.
- **Why we don't push the elapsed/accum math to the PiP** — keeping `state.elapsed` precomputed by FocusMode (current pattern) avoids replicating the pause math in two places. PiP renders the number; FocusMode does the arithmetic via the new helper below.

### Surface changes — Daily Plan

- **`src/components/TaskCard.tsx:404` pause button `onClick`** — change from `onStop(task)` to `togglePauseFocus()`. Drop the `onStop` prop binding from this row in `src/pages/DailyPlanner.tsx:1129`. (`handleStopFocus` stays for now; not called from the pause button anymore but still useful if a future Stop button is added — flag for cleanup if unused after M3.)
- **`src/components/TaskCard.tsx:380-401` live pill** — when `focus.paused === true`, freeze `liveText` at the value computed via the new helper (uses `pausedAccumMs` and current `pausedAtMs`). Restyle: drop the live tick when paused, swap pill text color to `text-fg-faded` (matches PiP at `src/components/FocusPip.tsx:387`).
- **`src/components/TaskCard.tsx:413-416` icon** — render the play-triangle SVG when `focus.paused`, the pause-bars when not. Tooltip flips between "Resume focus" / "Pause focus".

### Live counter helper (new utility)

```ts
// src/utils/focusElapsed.ts
export function computeFocusElapsedMs(focus: FocusState, now: number): number {
  const openPause = focus.paused && focus.pausedAtMs !== null
    ? now - focus.pausedAtMs
    : 0;
  return now - focus.startedAt - focus.pausedAccumMs - openPause + focus.priorElapsedMs;
}
```

Used by all three surfaces' tick loops. Replaces three duplicated implementations.

### DB correctness (M4)

`stopTimeEntry` callers compute `actualWorkedMs = computeFocusElapsedMs(focus, now) - focus.priorElapsedMs` and pass the corrected duration. Single integer subtraction at the call sites in `src/pages/FocusMode.tsx` (`handleDone`, `handleStop`) and `src/pages/DailyPlanner.tsx:543` (`handleStopFocus` if retained, or wherever the eventual stop affordance lives). No schema change. Complies with `/docs/migration-discipline.md` — no migration touched.

---

## What the user sees

- Pause from any of {Focus, PiP, Daily Plan} freezes the counter on all three. Resume from any unfreezes all three.
- Daily Plan's pause button now actually pauses (matches its icon). Tooltip + icon flip on resume.
- Worked minutes recorded to the DB exclude paused time. (Quiet correctness improvement.)
- A session paused before app quit restores as paused on next launch (see Relaunch behavior below).

---

## Why this approach (vs alternatives Verse should weigh)

**Alt A — Make PiP/Focus pause buttons fully stop (match Daily Plan today).** Simpler — no new store fields. But removes soft-pause entirely, and "pause" with stop semantics is wrong for the PiP UX (which has a *separate* Stop button at `src/components/FocusPip.tsx:447`). Rejected.

**Alt B — Cross-tab event bus instead of store.** Could broadcast pause events between FocusMode/Daily Plan via `CustomEvent`. Works in-window only. PiP runs in a separate WebviewWindow; we'd still need localStorage IPC. Adds a parallel channel for state that already lives in the store. Rejected.

**Alt C (proposed) — Lift `paused` into `FocusState` in the store.** Single source of truth. PiP's existing localStorage IPC is unchanged structurally; payload extends. Daily Plan auto-reflects via existing store subscription. Future surfaces get the state for free. Selected.

---

## Relaunch behavior — resolved

Verse rev 1 #6 requires resolution, not deferral. **Decision: persist `paused`. Restore as paused.**

- `togglePauseFocus` already writes `paused`/`pausedAtMs`/`pausedAccumMs` through `persistFocus`, which JSON-stringifies the whole `FocusState` to `localStorage[FOCUS_STORAGE_KEY]`. Loader returns it as-is.
- No special-case logic in `loadPersistedFocus`. The default-fill (`paused ?? false`) only triggers for pre-upgrade entries, which by definition were not paused under the old model.
- One subtlety: if the user quits while paused, `pausedAtMs` is a wall-clock from the last run. On restart, `computeFocusElapsedMs` correctly ignores cross-restart wall time — the open pause is `now - pausedAtMs`, but since the counter is *frozen* while paused (the helper subtracts the open pause delta), the displayed elapsed is `now - startedAt - pausedAccumMs - (now - pausedAtMs) + priorElapsedMs` which simplifies to `pausedAtMs - startedAt - pausedAccumMs + priorElapsedMs` — i.e. the elapsed at the moment of pause. Math holds across restarts.
- Test #7 updated to assert this: pause → quit → relaunch → counter shows the same frozen value, paused state, Resume affordance.

---

## Risks & concerns for Verse

- **Persistence migration.** Existing pre-upgrade `FocusState` JSON gets defaulted on read (paused=false, pausedAtMs=null, pausedAccumMs=0). No rewrite of disk format; first `persistFocus` after upgrade backfills. Safe.
- **Resume race.** Pause from PiP and resume from Daily Plan within the 200ms PiP polling tick: `togglePauseFocus` is read-modify-write against the latest `focus` via `get()` and Zustand `set`. Atomic. No race.
- **PiP IPC reliability.** Same channel, extended payload. Latency unchanged.
- **`adjustFocusElapsed` and concurrent pauses.** If the user opens the actual-time popover while paused and submits, `adjustFocusElapsed` uses `pausedAtMs` as reference — preserves the existing semantic of `applyActualMs`. Verified against the current implementation at `src/pages/FocusMode.tsx:763`.
- **"Stop" availability on Daily Plan row.** No longer one click after this fix. Stop remains accessible via PiP's stop button (`src/components/FocusPip.tsx:447`) and Focus screen. Acceptable per user's stated mental model. Follow-up only if user complains.
- **No security surface.** No new IPC channels, no new persisted secrets, no new external calls. Local state only.
- **No paid services touched.** Budget impact: zero.

---

## Milestones

Each lands on its own commit, on a new branch (per Terse rules — never main).

- **M1** — Store: extend `FocusState`, add `togglePauseFocus` and `adjustFocusElapsed`, initialize new fields in `startFocus`, default-fill in `loadPersistedFocus`. Add `computeFocusElapsedMs` helper. Tests for action transitions including pause→resume→pause accumulation. → STOP, Ready for Verse review.
- **M2** — Wire Focus screen + PiP downward IPC.
  - Retarget `src/pages/FocusMode.tsx:492, :524, :1063` to `togglePauseFocus`.
  - Delete `handlePause`, local `useState paused`, `pausedAtRef`, `pausedAccumRef`.
  - Drop the three pause-related lines from the `:177-190` reset effect.
  - Rewrite `applyActualMs` to use `adjustFocusElapsed`.
  - Update PiP state broadcast (`:445-453`) to source pause fields from `focus` and include `pausedAtMs`/`pausedAccumMs` in the payload.
  - Extend `PipState` interface in `src/components/FocusPip.tsx`.
  - Replace the duplicated elapsed math with `computeFocusElapsedMs`. → STOP, Ready for Verse review.
- **M3** — Wire Daily Plan TaskCard pause button.
  - `src/components/TaskCard.tsx:404` `onClick` → `togglePauseFocus`.
  - Live pill freezes when `focus.paused`, switches color to `text-fg-faded`.
  - Icon swaps Pause ↔ Play; tooltip flips. → STOP, Ready for Verse review.
- **M4** — `stopTimeEntry` minute correction. All callers pass corrected duration via `computeFocusElapsedMs` minus `priorElapsedMs`. → STOP, Ready for Verse review.

## Test plan

Manually verify each milestone in `npm run tauri dev`:

1. Start focus from Daily Plan (no nav). Open Focus screen, open PiP. All three counters tick in sync.
2. Pause from PiP. All three freeze at the same value within one tick.
3. Resume from Daily Plan. All three resume from the same value.
4. Pause from Focus screen. All three freeze. Navigate to Daily Plan. Counter is still frozen, icon shows Play.
5. Resume from PiP. All three resume.
6. Stop session. Time entry's recorded minutes equal total elapsed *minus* paused time.
7. **Updated**: pause session → kill the app → relaunch. Persisted focus restores as paused, counter shows the frozen value at quit, Resume button shows on all three surfaces. Click Resume → all three resume from the frozen value.
8. While paused, open the actual-time adjust popover on Focus screen, submit a new value. `pausedAccumMs` recomputes against `pausedAtMs` (not `now`). Counter reads the new value; it stays frozen until Resume.

## Out of scope

- Adding a stop button to the Daily Plan row.
- Touching `FocusMode`'s break/prompt/snooze flow — orthogonal to pause symmetry.
- Removing `handleStopFocus` / `onStop` plumbing if unused after M3 — flag during M3 review, defer to follow-up cleanup if confirmed dead.
