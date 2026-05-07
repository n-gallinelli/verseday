# Pause on Relaunch + Quit-Time Correctness

> **OBSOLETE under the worked-seconds model.** This entire milestone was
> dissolved by the worked-seconds simplification (`docs/2026-05-07-worked-
> seconds-simplification.md`). Under that model, quit time can't leak into
> worked time because `workedMs` is a counter that only increments while
> the app is running and unpaused — there's nothing to clamp, no checkpoint
> heuristic, no orphan-cap math. Auto-pause-on-relaunch became a 3-line
> flag flip in `restoreFocus`. The implementation that actually shipped
> was reverted at `9f2b05d` and replaced by the worked-seconds series
> (S.1 through S.6). This doc is preserved for historical context — it
> documents the wall-clock-era reasoning that motivated the pivot.

---


**Status:** Rev 2 — incorporated Verse review (orphan-cap guard + three minor notes folded in)
**Date:** 2026-05-07
**Author:** Terse
**Branch:** `refactor/task-as-entity` (lands after M2 closes; before merge to main)
**Type:** Standalone milestone, parallel to entity-plan M3.x. Not numbered M2.7 per Verse — this is its own scope.

---

## Why this exists

User report after M2.6 closeout:

> *"whenever i quit the app all tasks should be paused automatically, so that when i restart no task counter is running."*

Two problems in one ask:

1. **Cosmetic** — relaunching with a running session means the timer keeps ticking from before the quit. User mental model is "quit = stop working"; they don't expect a session to silently keep credit while the app isn't open.
2. **Correctness (the bigger issue)** — `computeFocusElapsedMs` counts wall-clock between `focus.startedAt` and `Date.now()` minus the `pausedAccumMs` accumulator. Quit doesn't grow `pausedAccumMs`, so the entire quit-to-relaunch wall-clock counts as worked time. A 30-min session quit at noon, relaunched at 1pm, displays as 1:30 worked. The DB-side worked-minutes query has the same problem (open `time_entries` row tracked until `closeOrphanedTimeEntries`'s 4-hour cap).

M2's pause symmetry left this surface unfixed because M2's design intent was preserve-paused-state-across-restart, not auto-pause-on-restart. This doc handles the missing case.

---

## Design

In `restoreFocus`, when the persisted focus is an unpaused active session, force it paused with `pausedAtMs` set to the best available approximation of "last alive."

The checkpoint effect at `src/pages/FocusMode.tsx:443-450` already writes `time_entries.end_time = now()` every 30 seconds while running. That column is therefore at most 30s stale at quit time — the most accurate "last alive" signal we have without instrumenting the shutdown path (which Tauri's Cmd-Q doesn't reliably expose to JS).

### Algorithm

```
1. const persisted = loadPersistedFocus()
2. if (!persisted) return
3. (existing) prime cache from legacy snapshot or async getTaskById fetch
4. let focus = persisted.focus
5. if (focus.mode === "active") {
6.    // Orphan-cap guard (Verse rev 2). If startedAt is older than the
7.    // ORPHAN_CAP_MS that closeOrphanedTimeEntries uses, drop the
8.    // session entirely. closeOrphanedTimeEntries (called immediately
9.    // after restoreFocus in App.tsx) will close the time entry; if
10.   // we left focus referencing it, a subsequent Resume → Stop would
11.   // call stopTimeEntry on an already-closed row (undefined
12.   // behavior). Clearing focus matches the user's mental model — "I
13.   // was gone too long, of course it's not running" — and lets the
14.   // orphan path finish the cleanup it was already going to do.
15.   if (Date.now() - focus.startedAt > ORPHAN_CAP_MS) {
16.      persistFocus(null)
17.      // Don't set focus or currentPage — caller falls back to
18.      // default (currentPage stays "daily"), focus stays null.
19.      return
20.   }
21.   if (!focus.paused) {
22.      let pausedAtMs: number
23.      try {
24.         const endIso = await getTimeEntryEndTime(focus.timeEntryId)
25.         if (endIso !== null) {
26.            pausedAtMs = new Date(endIso).getTime()  // case A — checkpoint exists
27.         } else {
28.            pausedAtMs = focus.startedAt             // case B — no checkpoint yet
29.         }
30.      } catch {
31.         pausedAtMs = Date.now()                     // case C — DB read failed
32.      }
33.      focus = { ...focus, paused: true, pausedAtMs }
34.      persistFocus(focus)
35.   }
36. }
37. set({ currentPage: "focus", focus })
```

`ORPHAN_CAP_MS = 4 * 60 * 60 * 1000` — matches the constant in `closeOrphanedTimeEntries` (`/src/db/queries.ts:692`, `MAX_ORPHAN_HOURS = 4`). Both values must stay in sync; if the orphan cap ever changes, the auto-pause guard must change with it. Best to define `ORPHAN_CAP_MS` once and import it, but for this milestone a co-located comment + matching literal is sufficient (one of the two will be updated by the same hand if the policy ever changes).

ISO parsing is `new Date(endIso).getTime()` — inline expression, no helper needed.

`restoreFocus` becomes `async`. The single caller (`src/App.tsx:109`) is already inside `async function startup()`, so adding `await` is one-character. `closeOrphanedTimeEntries`, called immediately after, already uses `await`.

### New DB query

```ts
// src/db/queries.ts
export async function getTimeEntryEndTime(id: number): Promise<string | null> {
  const db = await getDb();
  const rows: { end_time: string | null }[] = await db.select(
    "SELECT end_time FROM time_entries WHERE id = $1 LIMIT 1",
    [id]
  );
  return rows[0]?.end_time ?? null;
}
```

Single-row read, parameterized, returns the ISO string or null.

### Why `pausedAtMs` works without `pausedAccumMs` adjustment

`computeFocusElapsedMs` is:

```
elapsed = now - startedAt - pausedAccumMs - openPause + priorElapsedMs
        where openPause = paused ? now - pausedAtMs : 0
```

When we set `paused: true` and `pausedAtMs = lastCheckpoint`, leaving `pausedAccumMs` at its persisted value (almost always 0 in this path — the user wasn't paused before quit), the open-pause term simplifies away:

```
elapsed = now - startedAt - 0 - (now - lastCheckpoint) + priorElapsedMs
        = lastCheckpoint - startedAt + priorElapsedMs
```

That's the value at the last checkpoint, frozen. Wall-clock `now` cancels through the open-pause subtraction — same identity Verse already verified for the relaunch-while-paused case in pause-symmetry rev 3.

When the user resumes, `togglePauseFocus` adds `now - pausedAtMs = now - lastCheckpoint` to `pausedAccumMs`. That delta is the entire quit-to-resume window, correctly excluded from worked time going forward.

---

## Verse's six checklist items

### 1. No-checkpoint-yet edge case (case B)

Session created at T0, user quits at T0 + 10 seconds — before the 30-second checkpoint fires. `time_entries.end_time` is still null.

Resolution: `pausedAtMs = focus.startedAt`. Worst-case the user loses up to ~30 seconds of work credit on a freshly-started session that they then quit immediately. Acceptable trade-off: the alternative is treating `end_time === null` as "session never had a checkpoint, so use Date.now()" which would over-credit the quit window. Under-counting on a fresh session is preferable to over-counting.

### 2. Checkpoint lookup failure (case C)

DB read errors — SQLite locked, file corruption, plugin version mismatch.

Resolution: catch all errors from `getTimeEntryEndTime`, fall back to `pausedAtMs = Date.now()`. The auto-pause UX still lands; the quit-time correction degrades to "no correction" (entire quit window appears worked, same as pre-this-milestone behavior). The user sees a paused session on relaunch — better than crashing or rendering nothing.

Logged via the existing per-call `.catch()` pattern; no new error UX.

### 3. Read-only / migration compliance

`getTimeEntryEndTime` is `SELECT end_time FROM time_entries WHERE id = $1`. Reads an existing column on an existing row. No DDL. No INSERT/UPDATE/DELETE. Compliant with `/docs/migration-discipline.md` — no migration touched, no schema change.

### 4. M2.4 break_seconds math under this flow

Concrete walkthrough using Verse's example: start at T0, last checkpoint at T0+5min, quit at T0+5:30, relaunch at T0+65min, resume, work 5min, stop at T0+70min.

Numerical setup:
- `startedAt = T0`
- `priorElapsedMs = 0` (fresh task)
- `time_entries.end_time = T0 + 5min` after the last checkpoint at T0+5
- App quits at T0+5:30. Persisted focus has `paused: false, pausedAtMs: null, pausedAccumMs: 0`.

**Relaunch at T0+65min:**

`getTimeEntryEndTime` returns `T0+5min`. Auto-pause:
- `pausedAtMs = T0 + 5*60000`
- `paused = true`
- `pausedAccumMs = 0` (unchanged)
- Persisted.

Displayed elapsed at relaunch:
```
elapsed = (T0+65min) - T0 - 0 - ((T0+65min) - (T0+5min)) + 0
        = 65min - 60min
        = 5min ✓
```

User sees 5:00 frozen, Resume button. Correct.

**Resume at T0+65min:**

`togglePauseFocus`:
- `now = T0 + 65min`
- New `pausedAccumMs = 0 + (now - pausedAtMs) = 65min - 5min = 60min`
- `paused = false, pausedAtMs = null`

**Work 5min, stop at T0+70min:**

`getBreakSeconds()` in FocusMode (M2.4):
```
total = totalBreakTimeRef.current (0) + focus.pausedAccumMs (60min)
      + (paused ? now - pausedAtMs : 0) (0)
      = 60min
breakSeconds = 60 * 60 = 3600
```

`stopTimeEntry(timeEntryId, 3600)` writes:
- `end_time = T0 + 70min`
- `break_seconds = 3600`

Downstream `getWorkedMinutesForTask` query:
```
worked = (julianday(T0+70min) - julianday(T0)) * 1440 - 3600/60
       = 70 - 60
       = 10 min ✓
```

User gets **10 minutes credit**, not 70, not 65, not 10+1hr. The 60-minute quit window is correctly excluded both from the displayed counter and from the recorded DB worked time.

The math holds because pause-on-relaunch reuses M2.1's `pausedAtMs`/`pausedAccumMs` machinery and M2.4's `break_seconds` correction — no new arithmetic, just a different trigger for setting `paused: true` and `pausedAtMs`.

### 5. Test plan

Each test runs against `npm run tauri dev`. Manual verification.

**Test (a) — running → quit → relaunch shows paused at last-checkpoint value.**
Start a session. Wait ≥30 seconds (so a checkpoint fires). Note the displayed elapsed (e.g. 0:35). Cmd-Q. Wait 60 seconds wall-clock. Relaunch.
*Pass:* All three surfaces show paused. Counter shows ~0:30 (the value at the last checkpoint, ±30s). NOT 1:35 (which would be wall-clock-included). Resume button on Focus + row.

**Test (b) — running → quit → relaunch → resume → stop reports correct worked minutes.**
Start a session. Work for 5min (so a checkpoint at T+5 captures end_time). Cmd-Q. Wait 1 hour. Relaunch (auto-pauses at ~5min). Click Resume. Work 5min. Stop.
*Pass:* Open the task's detail overlay → Worked field shows ~10 min, not ~70 min. The 1-hour quit window is excluded.

**Test (c) — freshly-started → quit-before-checkpoint → relaunch shows paused at startedAt.**
Start a session. Cmd-Q within 30 seconds (before the first checkpoint).
*Pass:* On relaunch, all three surfaces show paused. Counter shows 0:00 (or very close — `pausedAtMs = startedAt` means displayed elapsed = startedAt - startedAt + 0 + priorMs = priorMs, which is 0 for a fresh task). Acceptable per case-B trade-off.

**Test (d) — already-paused → quit → relaunch is unchanged from current M2 behavior.**
Start a session. Pause it (focus.paused = true). Cmd-Q. Relaunch.
*Pass:* Counter shows the same frozen value as before quit — i.e. the value at the original pause. Identical to the M2 capstone Test #7 behavior. The auto-pause guard at line 5 of the algorithm (`!focus.paused`) ensures it doesn't double-pause or overwrite the original `pausedAtMs`.

**Test (e) — running → quit → relaunch >4 hours later. (Verse rev 2)**
Start a session. Cmd-Q. Wait > 4 hours (or shorten `MAX_ORPHAN_HOURS` temporarily to test). Relaunch.
*Pass:* No focus session on relaunch. The orphan-cap guard at lines 15–20 of the algorithm calls `persistFocus(null)` and returns without setting `focus` or `currentPage`, so the store stays at its initialized default (`currentPage: "daily"`, `focus: null`). `closeOrphanedTimeEntries` then closes the time entry on disk via the existing 4-hour cap. No reference to a closed `timeEntryId` survives in the store; no crash, no double-write.

### 6. Daily Plan top-right pill (Finding A from M2.6)

After M2.6 lands, the pill at `DailyPlanner.tsx:854` already gates on `focus?.mode === "active" && focus.paused`. Auto-pause-on-relaunch sets `focus.paused = true` through the same store action path that M2.3/M2.6 read. No additional pill work needed in this milestone — the rendering is correct for free.

Confirmed: zero changes to `DailyPlanner.tsx`, `TaskCard.tsx`, `FocusMode.tsx`, or `FocusPip.tsx` beyond what M2 already shipped. The fix is store-internal.

---

## Risks & concerns for Verse

- **`restoreFocus` becomes async.** Single caller, already in async context. No fan-out concern.
- **One DB read on app boot.** Bounded by 1 row, indexed by primary key. Sub-millisecond. Doesn't block the user from clicking around — `App.tsx:109` already awaits things like `closeOrphanedTimeEntries`.
- **Time spent paused is now unconditionally not counted.** Pre-this-milestone, a user who quit while running and relaunched within minutes might have wanted to count that wall-clock as worked (e.g., they were actively working but the app crashed). Post-this-milestone, they'd need to manually adjust via the actual-time popover. Trade-off: the user has explicitly asked for this conservative default. The popover gives them an escape hatch.
- **Durability of the load-bearing reads.** Two persistence layers in play:
  - `localStorage[FOCUS_STORAGE_KEY]` — the persisted `FocusState`. WebKit-backed; flush on Cmd-Q is best-effort but validated by user testing during M2 capstone Test #7 (the JSON survives quit-relaunch correctly).
  - `time_entries.end_time` in SQLite — written by `checkpointTimeEntry` every 30s while running. SQLite writes go through Tauri's `tauri-plugin-sql` (rusqlite under the hood); `db.execute` returns after the WAL/journal commit completes, so each checkpoint is durably on disk before the next 30-second tick. Even an unclean kill loses at most the last 30 seconds — exactly the accuracy bound this design targets.
- **Checkpoint is gated on `!focus.paused`.** Confirmed at `src/pages/FocusMode.tsx:463` — the checkpoint interval only writes `end_time = now()` when the session is running. So `time_entries.end_time` doesn't advance during paused stretches, which means the checkpoint we read on relaunch reflects the last *running* tick, not the last wall-clock tick. This is correct for case A: we want `pausedAtMs` to track when the user was last actually working, not when the app last happened to be alive. (In test (d), this is moot — the auto-pause guard skips the case-A read entirely when the persisted focus is already paused, so the original `pausedAtMs` survives untouched.)
- **No security surface.** No new IPC, no new persisted secrets, no new external calls. Local refactor.
- **Budget impact: zero.**

---

## Implementation milestones

Single-commit milestone — small enough that the M1/M2 seam-then-wire-up split would be ceremony.

- **M-relaunch.1** — Add `getTimeEntryEndTime` query. Make `restoreFocus` async. Add the auto-pause logic. Update `App.tsx` to `await restoreFocus()`. Run the four-test plan in `npm run tauri dev`. → Verse review → merge to refactor branch.

If Verse prefers two commits (read-only query + auto-pause logic separately), happy to split.

---

## Out of scope

- Instrumenting the shutdown path (Tauri-side hooks for graceful Cmd-Q). The checkpoint heuristic gives us within-30-seconds accuracy without coupling to platform internals.
- Per-task auto-pause notifications ("Your session was auto-paused due to app quit"). Could add later as a small UX toast; not load-bearing.
- Crash recovery beyond the existing `closeOrphanedTimeEntries` 4-hour cap. Pre-existing safety net; orthogonal to this milestone.
