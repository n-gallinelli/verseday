# Pause Symmetry Across Focus Screen, PiP, and Daily Plan

**Status:** Resubmitted to Verse (rev 3) — folds in `FocusState.task → FocusState.taskId` correction per task-as-entity plan M2 prep. Rev 2 (six-item fix) preserved below; rev 3 deltas marked inline.
**Date:** 2026-05-07
**Author:** Terse
**Severity:** Behavioral correctness bug + UX inconsistency. No security implications.
**Branch:** `refactor/task-as-entity` (M1 landed; M2 is this doc).
**Depends on:** M1's `selectTaskDetailTask`/`tasksByIdCache` selector pattern. M2 introduces a parallel `selectFocusedTask` reading from the same cache. M3.2 supersedes both with canonical `tasksById`.

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

**Rev 3 correction (folded in for M2 alignment with task-as-entity plan):** `FocusState.task: Task` is replaced by `FocusState.taskId: number`. Every consumer that today reads `focus.task.title`, `focus.task.notes`, `focus.task.estimated_minutes` etc. now reads through a `selectFocusedTask(state)` selector that composes `focus.taskId → tasksByIdCache[id]` (M1 cache; supersedes to canonical `tasksById` in M3.2). This eliminates the snapshot-staleness Verse flagged: a rename made from the detail overlay during a focus session re-renders Focus/PiP/Daily Plan immediately because they read the canonical task, not a frozen copy.

### Store changes (`src/stores/appStore.ts`)

**End-state shape (after M2.2 wire-up retires the transitional `task` field):**

```ts
export type FocusState =
  | {
      mode: "preview";
      taskId: number;              // CHANGED — was `task: Task` (rev 3)
      previousPage: Page;
      priorElapsedMs: number;
    }
  | {
      mode: "active";
      taskId: number;              // CHANGED — was `task: Task` (rev 3)
      timeEntryId: number;
      startedAt: number;
      previousPage: Page;
      priorElapsedMs: number;
      // NEW (rev 2) — only on active branch; pause has no meaning for preview
      paused: boolean;
      pausedAtMs: number | null;   // wall-clock when current pause began; null when running
      pausedAccumMs: number;       // total paused time this session, excludes any open pause
    };
```

**Intermediate shape during M2.1 (additive seam, R5):** both branches additionally carry a transitional `task: Task` field annotated `// TRANSITIONAL — removed in M2.2`. `startFocus`/`previewFocus` write both fields; loaders backfill `taskId` from legacy persisted `task`; selectors prefer cache lookup but fall back to `focus.task` so consumers don't break before M2.2 retargets them. M2.2 retires the field.

The pause fields live only on the active branch — preview has no time entry to pause. `togglePauseFocus` already guards `f.mode === "active"`.

New selector at module level (mirrors M1's `selectTaskDetailTask`):

```ts
export function selectFocusedTask(state: AppState): Task | null {
  if (!state.focus) return null;
  return state.tasksByIdCache.get(state.focus.taskId) ?? null;
}
```

The same `tasksByIdCache` lookup pattern from M1 applies. M3.2 reroutes both selectors to canonical `tasksById` in one commit and retires the cache.

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

**Action signature changes (rev 3):**
- `startFocus(task: Task, ...)` → `startFocus(taskId: number, ...)`. Callers that today have a Task in scope pass `task.id`. The action also calls `cacheTasks([task])` against `tasksByIdCache` so the selector resolves synchronously without a fallback fetch — same pattern M1's overlay open uses.
- `previewFocus(task, ...)` → `previewFocus(taskId, ...)`. Same treatment.
- `updateFocusTask(patch)` (`src/stores/appStore.ts:205-210`) — **delete**. No longer needed; mutations to the focused task go through the standard `updateTask(id, patch)` DB write + `cacheTasks` (or M3.2's `tasksById`-owning action). The focus selector picks up the change automatically.
- `setFocusPriorElapsedMs(taskId, priorMs)` — guard now reads `f.taskId === taskId` instead of `f.task.id === taskId`.

**Pause init on session (re)start** — Verse rev 1 #3. `startFocus` initializes the three pause fields to `false / null / 0` for the new session, alongside the existing `priorElapsedMs` setup. The "swap to next task" path also routes through this. This replaces the reset effect at `src/pages/FocusMode.tsx:177-190` for the pause-related lines (177's `setElapsed(0)`, 179's `setPaused(false)`, 180's `pausedAtRef.current = null`, 181's `pausedAccumRef.current = 0`); break/Pomodoro lines 182-189 stay component-local since they're orthogonal to pause.

**Loader migration** — `loadPersistedFocus` (`src/stores/appStore.ts:110-125`) already does `Partial<FocusState>` defaulting for back-compat (e.g., `mode`). Two new defaulting paths in M2.1:

```ts
// Pause field defaults (rev 2)
paused: parsed.paused ?? false,
pausedAtMs: parsed.pausedAtMs ?? null,
pausedAccumMs: parsed.pausedAccumMs ?? 0,

// Migration shim: legacy persisted shape carries `task: Task` instead
// of `taskId: number` (rev 3). Adopt the id, drop the snapshot, and
// prime tasksByIdCache so the selector resolves on first read after
// upgrade.
if (parsed.task && parsed.taskId === undefined) {
  parsed.taskId = parsed.task.id;
  // The cache is on the same store; prime via a side-effect set after
  // load completes (the loader returns the FocusState; the caller
  // — restoreFocus or initial useAppStore() — also calls cacheTasks).
  // Implementation note: rather than mixing concerns inside the loader,
  // restoreFocus runs `cacheTasks([parsed.task])` then `set({ focus: parsedWithoutTask })`.
}
delete parsed.task;
```

The cache priming on migration is the only subtle bit — without it, the first render after an upgrade-while-active-focus would briefly see no task. Calling `cacheTasks([parsed.task])` from `restoreFocus` before clearing `parsed.task` covers that. No DB hit needed.

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
- **`focus.task.X` reads (rev 3)** — every reference to `focus.task.title`, `focus.task.notes`, `focus.task.estimated_minutes`, `focus.task.id`, etc. routes through `selectFocusedTask` now. Targeted sites: `:152` notes seed (subscribes to selector), `:170-171` `useEffect` dep (`focus?.task.id` → `focus?.taskId`), title rendering, status checks. The selector returns `Task | null` — components handle the null case (already do, since `focus` itself can be null).
- **`:445-453` PiP state broadcast (Verse rev 1 #4 + rev 2 R2)** — the effect reads from the **composed selector** `selectFocusedTask(useAppStore.getState())` (or via a `useAppStore(selectFocusedTask)` subscription so the effect re-fires when the canonical task mutates). The resolved task object goes in the effect's dep array. Without this dep, a rename made to the focused task from the detail overlay would not re-broadcast and the PiP would show the stale title — re-introducing snapshot drift on the very surface this refactor is fixing. Payload structure described below.

### Surface changes — PiP (`src/components/FocusPip.tsx`)

PiP renders from `localStorage["verseday_pip_state"]` payload (read at `:213-216`, never writes). Verse rev 1 #4 — extend the payload, no architectural change to the PiP itself.

- **`PipState` interface (`:22-29`)** — add `pausedAtMs: number | null` and `pausedAccumMs: number`. `paused: boolean` already present at `:24`. Updated payload shape is what `src/pages/FocusMode.tsx:445-453` writes.
- **PiP render uses `state.paused`** at `:387, :488, :490` — no change needed; `paused` already drives icon/color. The fix is purely upstream: ensure FocusMode broadcasts the store's `paused`, not its (deleted) local `useState`.
- **Task title resolution (rev 3)** — the broadcast at `:445-453` resolves the task via `selectFocusedTask` and writes `taskTitle` / `estimatedMinutes` from the resolved task into the payload. PiP keeps consuming pre-resolved strings (no architectural change to FocusPip). The PiP can't subscribe to Zustand from a separate WebviewWindow; pre-resolution preserves correctness without crossing that boundary.
- **Why we don't push the elapsed/accum math to the PiP** — keeping `state.elapsed` precomputed by FocusMode (current pattern) avoids replicating the pause math in two places. PiP renders the number; FocusMode does the arithmetic via the new helper below.

### Surface changes — Daily Plan

- **`src/components/TaskCard.tsx:404` pause button `onClick`** — change from `onStop(task)` to `togglePauseFocus()`. Drop the `onStop` prop binding from this row in `src/pages/DailyPlanner.tsx:1129`. (`handleStopFocus` stays for now; not called from the pause button anymore but still useful if a future Stop button is added — flag for cleanup if unused after M3.)
- **`src/components/TaskCard.tsx:380-401` live pill** — when `focus.paused === true`, freeze `liveText` at the value computed via the new helper (uses `pausedAccumMs` and current `pausedAtMs`). Restyle: drop the live tick when paused, swap pill text color to `text-fg-faded` (matches PiP at `src/components/FocusPip.tsx:387`).
- **`src/components/TaskCard.tsx:413-416` icon** — render the play-triangle SVG when `focus.paused`, the pause-bars when not. Tooltip flips between "Resume focus" / "Pause focus".

### Live counter helper (new utility)

```ts
// src/utils/focusElapsed.ts
export function computeFocusElapsedMs(
  focus: FocusState & { mode: "active" },
  now: number,
): number {
  const openPause = focus.paused && focus.pausedAtMs !== null
    ? now - focus.pausedAtMs
    : 0;
  return now - focus.startedAt - focus.pausedAccumMs - openPause + focus.priorElapsedMs;
}
```

Type-narrowed to active mode (preview has no `startedAt`). Callers gate with `focus?.mode === "active"` first. Used by all three surfaces' tick loops; replaces three duplicated implementations.

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

- **Persistence migration (rev 2 + rev 3).** Existing pre-upgrade `FocusState` JSON has two missing pieces: (a) the three pause fields default-fill to `false / null / 0` on read; (b) the legacy `task: Task` snapshot is migrated to `taskId: number` by `restoreFocus`, which also primes `tasksByIdCache` from the snapshot before discarding it. No rewrite of disk format; first `persistFocus` after upgrade writes the new shape. Safe.
- **Resume race.** Pause from PiP and resume from Daily Plan within the 200ms PiP polling tick: `togglePauseFocus` is read-modify-write against the latest `focus` via `get()` and Zustand `set`. Atomic. No race.
- **PiP IPC reliability.** Same channel, extended payload. Latency unchanged.
- **PiP staleness on rename (rev 3 R2).** The broadcast effect must re-fire when `selectFocusedTask(state)` changes — i.e. the resolved task object, not just `focus`, is in the dep array. Without this, a rename from the detail overlay during a focus session leaves the PiP showing the old title. Test #9 added.
- **`adjustFocusElapsed` and concurrent pauses.** If the user opens the actual-time popover while paused and submits, `adjustFocusElapsed` uses `pausedAtMs` as reference — preserves the existing semantic of `applyActualMs`. Verified against the current implementation at `src/pages/FocusMode.tsx:763`.
- **"Stop" availability on Daily Plan row.** No longer one click after this fix. Stop remains accessible via PiP's stop button (`src/components/FocusPip.tsx:447`) and Focus screen. Acceptable per user's stated mental model. Follow-up only if user complains.
- **No security surface.** No new IPC channels, no new persisted secrets, no new external calls. Local state only.
- **No paid services touched.** Budget impact: zero.

---

## Milestones

Per the entity plan, this whole document is M2. Sub-milestones M2.1–M2.4 land on the existing branch `refactor/task-as-entity` (M1 already landed). Each opens with a seam-only first commit and a wire-up second commit per Verse rev 1 R5.

- **M2.1 — Store seam.**
  - Replace `FocusState.task: Task` with `FocusState.taskId: number` on both branches of the discriminated union (rev 3).
  - Add `paused`, `pausedAtMs`, `pausedAccumMs` to the active branch (rev 2).
  - Add `togglePauseFocus`, `adjustFocusElapsed`, `selectFocusedTask`.
  - `startFocus` and `previewFocus` accept `taskId` instead of `task`. Both call `cacheTasks([task])` against the M1 cache before setting focus, so the selector resolves on first read.
  - Delete `updateFocusTask`. (Mutations to focused task now go via `updateTask` + cache update.)
  - `loadPersistedFocus` defaults the three pause fields. `restoreFocus` runs the `task → taskId` migration shim and primes the cache.
  - `computeFocusElapsedMs(focus, now)` helper at `src/utils/focusElapsed.ts`.
  - **No surface changes yet.** FocusMode still has its local `paused`/`pausedAtRef`/`pausedAccumRef` and reads `focus.task.X` (compile error). The seam adds the new fields; the wire-up in M2.2 retires the old. Build green only after M2.2.

  *Seam-discipline note:* a naive M2.1 that replaces `task` with `taskId` would break every `focus.task.X` consumer and the wire-up commit can't go green incrementally. To honor R5, M2.1 is **purely additive** — it adds `taskId` *alongside* the existing `task` field on both branches of the union. Both are kept in sync: `startFocus(task)` writes both `task: task` and `taskId: task.id`; loaders that find legacy `task` without `taskId` backfill `taskId = parsed.task.id`. The selector reads `tasksByIdCache.get(focus.taskId) ?? focus.task` so existing consumers keep working until M2.2 retires the snapshot. The `task` field carries a `// TRANSITIONAL — removed in M2.2` annotation, mirroring M1's `tasksByIdCache` pattern (Verse rev 1 R1). M2.2 deletes the `task` field as the wire-up commit's final step.

  → STOP, Ready for Verse review.

- **M2.2 — Focus screen + PiP wire-up.**
  - Retarget `src/pages/FocusMode.tsx:492, :524, :1063` to `togglePauseFocus`.
  - Delete `handlePause`, local `useState paused`, `pausedAtRef`, `pausedAccumRef`.
  - Drop the three pause-related lines from the `:177-190` reset effect.
  - Rewrite `applyActualMs` to use `adjustFocusElapsed`.
  - Replace every `focus.task.X` read with the resolved task from `selectFocusedTask` (component-level subscription).
  - Update PiP broadcast at `:445-453`: read from `selectFocusedTask`, include resolved `taskTitle` / `estimatedMinutes` in payload alongside `paused` / `pausedAtMs` / `pausedAccumMs`. Add the resolved task object to the effect's dep array (Verse rev 2 R2).
  - Extend `PipState` interface.
  - Replace duplicated elapsed math with `computeFocusElapsedMs`.
  - **Remove the M2.1 transitional `task` bridge field** alongside this wire-up.
  → STOP, Ready for Verse review.

- **M2.3 — Daily Plan wire-up.**
  - `src/components/TaskCard.tsx:404` pause button → `togglePauseFocus`.
  - Live pill freezes when `focus.paused`, switches color to `text-fg-faded`.
  - Icon swaps Pause ↔ Play; tooltip flips between "Pause focus" / "Resume focus".
  → STOP, Ready for Verse review.

- **M2.4 — DB minute correction.**
  - All `stopTimeEntry` call sites pass `computeFocusElapsedMs(focus, now) - focus.priorElapsedMs` so paused time is excluded from recorded worked minutes.
  → STOP, Ready for Verse review.

- **M2 capstone** — confirm all four sub-milestones merged, run the eight-step manual test plan end-to-end. STOP, Ready for Verse review.

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
9. **Rev 3 — rename-while-focused.** Start a focus session on a task. Open the detail overlay for that task from any other surface (Daily Plan or Project Detail), rename it, save. Within one tick, the new title appears on Focus screen, Daily Plan row, and PiP. (R2 verification — proves the PiP broadcast effect re-fires when the resolved task changes.)

## Out of scope

- Adding a stop button to the Daily Plan row.
- Touching `FocusMode`'s break/prompt/snooze flow — orthogonal to pause symmetry.
- Removing `handleStopFocus` / `onStop` plumbing if unused after M3 — flag during M3 review, defer to follow-up cleanup if confirmed dead.
