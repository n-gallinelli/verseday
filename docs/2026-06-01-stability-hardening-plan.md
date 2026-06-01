# Stability Hardening — Terse Plan

**Date:** 2026-06-01
**Author:** Terse
**Against:** `docs/2026-06-01-stability-hardening-brief.md`
**Status:** PLAN — awaiting Verse review. **No code until APPROVED.**

Reliability only. Nothing structural, nothing new (the only additions are
**dev-only test tooling** for the ⚠️ items — zero runtime/app cost, no money).
`#3` (project propagation) is **not touched**. Each item below states the
*how*; the brief owns the *outcome*.

---

## Verification tooling (prereq for the ⚠️ items)

There is **no test harness today** (no vitest/jest in `package.json`). The two
⚠️ items require a runtime/fake-clock check, so Branch A adds, as **devDependencies only**:

- **vitest** — fake-clock unit tests (pure logic).
- **better-sqlite3** — a local, synchronous, in-memory SQLite so the #2/#15 SQL
  can be exercised for real. To avoid test/prod SQL drift, the aggregate +
  recovery SQL strings get exported as named constants from `queries.ts` and the
  test runs the **identical** strings against an in-memory DB.

Both are local, free, no network → **no cost flag**. Add a `"test": "vitest run"`
script. Everything else stays on Nick's static path (`tsc` + `npm run build` +
grep callers + review).

---

## Branch A — P0-1: sleep/lid-close inflates worked time ⚠️ (ships + verified first)

> **REVISED after Verse review.** The original 10s pure-delta discard is
> **rejected**: a delta-size threshold can't distinguish "machine asleep"
> (discard) from "app occluded / timer throttled while the user works in another
> app" (keep). The primary tray flow — start focus, hide VerseDay, work
> elsewhere — is exactly the case macOS background throttling / App Nap stretch
> ticks past 10s, so a 10s discard would silently zero **real** worked time.

**Finding.** `FocusMode.tsx:491-494` feeds `delta = Date.now() - lastTickRef`
into `tickFocus` (`appStore.ts:1004`), which does `workedMs + deltaMs`
unbounded. A suspended interval adds the whole wake gap.

**Crucial distinction the fix must honor:**
- **System sleep / lid-close** → machine suspended, user is *not* working →
  the span must contribute **0**. Signalled by a real OS wake event.
- **App Nap / background throttle** → machine awake, VerseDay occluded, user
  *may be working* on the focused task elsewhere → the span must be **kept**
  (this is the "stalled tick catches up" behavior the delta model exists for).

A pure delta-size rule conflates these; an OS resume signal separates them
cleanly (only a true wake fires it; App Nap does not).

### Primary mechanism — OS sleep/resume signal (confirmed reachable)

`objc2-app-kit` is already a dependency **with the `NSWorkspace` feature on**
(`Cargo.toml:46`), and `NSWorkspace::sharedWorkspace()` is already used in
`commands.rs:61/74`. The Rust→JS event channel is already proven by `pip-hover`
(`app.emit_to(label, …)` → JS `getCurrentWebviewWindow().listen(…)` +
`unlisten`, `FocusPip.tsx:283`). So this is **additive, not structural**:

- **Native (`src-tauri`):** in `setup`, register an observer on
  `NSWorkspace::sharedWorkspace().notificationCenter()` for
  `NSWorkspaceDidWakeNotification` (the wake-from-sleep signal); on fire,
  `app.emit("system-resumed", …)` to the main window. (Optionally also observe
  `WillSleep` purely to log; not required.)
- **JS (store):** `getCurrentWebviewWindow().listen("system-resumed", …)` sets a
  one-shot `resumeSkipRef`/flag. The next `tickFocus` after a resume resets the
  reference and contributes **0** for that single delta (the suspended span),
  then resumes normal counting. Throttle/App-Nap catch-up — which fires **no**
  wake event — is preserved in full. Listener gets an `unlisten` on teardown
  (mirrors `FocusPip`).

This drops **only** the suspended span and never touches occluded-but-working
time.

### Backstop (defense-in-depth) — large cap, no live run required

> **Update:** Nick declined the manual measurement run. Rather than guess a
> threshold a priori (which Verse rightly rejected), the design now makes the
> backstop a **last-resort net, not the mechanism** — so its exact value is not
> safety-critical, and a defensible bound from documented behavior is enough.

The **resume signal is the fix.** It is what zeroes a real sleep span, and it
fires on the actual OS wake — so it cannot be fooled by throttle magnitude. The
backstop below only ever matters in a *double fault*: a delta larger than the
cap **and** no wake event received (a missed/dropped `NSWorkspaceDidWake`).

```ts
export function clampWorkedDelta(deltaMs: number, resumeJustFired: boolean): number {
  if (deltaMs <= 0) return 0;
  if (resumeJustFired) return 0;            // explicit OS wake → drop the span
  return deltaMs > MAX_TICK_DELTA_MS ? 0 : deltaMs; // missed-wake net only
}
```

**Why 5 min (300_000) is safe without a live measurement:**
- WKWebView throttles timers on a *hidden* page by aligning them to ~1s — which
  is already our tick cadence. That alignment alone never produces a multi-minute
  delta.
- The only source of larger coalescing is macOS **App Nap**, whose timer
  coalescing for a running app is on the order of seconds to ~1 min, not minutes.
- 5 min is ~5× that worst case, so the backstop **cannot** discard a plausible
  occluded-but-working delta. And because the resume signal — not the backstop —
  handles real sleep, the backstop firing at all requires the rare missed-wake
  double fault, where discarding a >5-min unexplained gap is the safe choice.

If we ever want to remove the throttle question entirely (rather than bound it),
the escalation is an App-Nap-disable activity assertion during active focus
(`NSProcessInfo beginActivityWithOptions`, keeping the tick at ~1s while hidden).
That's additional native lifecycle code; **proposed as out-of-scope for the P0**
and only worth it if real-world inflation is ever observed despite the above.

**Runtime checks (required), fully static / fake-clock — no app run:**
vitest fake-clock on `clampWorkedDelta` —
(i) `resumeJustFired=true` → 0 for any delta (sleep span dropped, the bug);
(ii) a normal 1s delta → 1000 (don't lose real seconds);
(iii) a 90s "App-Nap-throttled but working" delta with no resume → **kept** in
full (proves we don't discard throttled work — the regression Verse blocked);
(iv) a 2h delta with no resume → 0 (missed-wake safety net).
Cases (ii)+(iii) substitute for the live measurement: they assert the design
keeps throttled work up to well past any documented coalescing interval.

---

## Branch B — #2 + #15: crash/force-quit erases the session's time ⚠️ (isolated, highest care)

**Findings (verified):**
1. The periodic checkpoint effect (`FocusMode.tsx:550-559`) depends on the whole
   `focus` object. `tickFocus` replaces `focus` every second, so the 30s
   (`CHECKPOINT_INTERVAL_MS`) interval is **torn down and recreated every tick
   and never fires.** Checkpointing is effectively dead.
2. Even when it fires, `checkpointTimeEntry` (`queries.ts:724`) writes only
   `end_time`, **never `worked_seconds`**. `startTimeEntry` inserts none. So an
   orphaned row carries `worked_seconds = 0` → contributes 0 to every aggregate
   (the #2 hole).
3. Read aggregates that `SUM(worked_seconds)` **without** `end_time IS NOT NULL`:
   `queries.ts:778, 844, 870, 1149, 1165, 1179`. (Lines 631 and 1201/1203
   already have the filter.) They rely on open rows being 0 rather than
   guaranteeing it (the #15 gap).

**Why the two must ship together:** the moment we checkpoint `worked_seconds`
onto the *open* row (fix for #2), any aggregate lacking `end_time IS NOT NULL`
would count that open row's seconds **and** the live `focus.workedMs` added at
the app layer → double-count. #15 closes that exact door.

**How.**
- **#2a — make the checkpoint fire.** Rework the effect to depend on stable
  primitives (`focusTaskId`, `focusMode`) and read live state via
  `useAppStore.getState().focus` inside the interval (same pattern the tick
  effect at 483-547 already uses). It then runs every 30s as intended.
- **#2b — checkpoint `worked_seconds`.** On each fire (when not paused) write
  `updateTimeEntryWorkedSeconds(timeEntryId, round(focus.workedMs/1000))`
  (this fn already exists, R1/S.5). Keep the `end_time` checkpoint too (bounds
  the orphan window). Now a force-quit leaves a recent `worked_seconds`; worst
  case lost = seconds since the last 30s checkpoint. `closeOrphanedTimeEntries`
  already only sets `end_time` and **preserves** `worked_seconds` → the orphan
  recovers its checkpointed value. No change needed there.
- **#15 — guarantee single-count.** Add `AND te.end_time IS NOT NULL` (alias as
  appropriate) to the six aggregates above. Open row → 0 in DB totals; the live
  session is counted exactly once via `focus.workedMs` at the app layer; once
  closed, the DB value takes over.

**Caller sweep:** confirm every consumer of those six aggregates already adds
the live `focus.workedMs` where it wants the in-progress session (DailyPlanner
does, `:622`), so the filter doesn't *drop* the live session from any view.

**Runtime check (required), via better-sqlite3 on the exported SQL:**
- (a) Insert an open row, checkpoint `worked_seconds=2400` (40m), force-close it
  the way `closeOrphanedTimeEntries` does → the recovered row reports 40m.
- (b) One open row (checkpointed) + the live `focus.workedMs` for the same
  session → DB aggregate (with the new filter) counts it **0**; app-layer total
  = exactly one count. After close, DB counts it once, app layer stops adding.
  Asserts "never twice."
- Plus a fake-clock test that the reworked checkpoint effect actually fires at
  30s (guards against the regression that started this).

---

## Branch C — Tier 1 remainder (static validation: tsc + build + grep + review)

### #4 — editing worked-minutes on the active task doesn't update the live readout
**Finding.** `setTaskWorkedMinutesAction` (`appStore.ts:1290`) writes the DB but
never updates `priorElapsedMs`. The `TaskDetailOverlay` path happens to call
`setFocusPriorElapsedMs` itself (`:828/837/881/896`), but the **ProjectDetail**
path (`:1366`) does not → stale readout there.
**How.** Centralize: in `setTaskWorkedMinutesAction`, after the DB write, call
`get().setFocusPriorElapsedMs(id, minutes*60*1000)`. The setter already no-ops
unless `focus.taskId === id`, so it's safe for non-focused edits and idempotent
with the overlay's existing calls (same value). Leaves overlay calls in place
(harmless) to keep the diff minimal.

### #5 — UTC "today"/paging diverges from local helpers
**Finding.** `DailyPlanner.tsx:868` (`isToday`), `:862-865` (`changeDate`), **and
`:379`** (rollover gate `todayIso`) all use `new Date().toISOString()`.
**How.** Replace with `utils/dates`: `isToday → selectedDate === todayString()`;
`changeDate → localDateIso(d)`; `:379 → todayString()`. (`getTomorrowDate` in
DailyShutdown.tsx:202-206 has the same smell — I'll fix it in the same pass for
consistency since it's a one-liner and feeds task dates.)

### #9 — `completed_at` (UTC) compared against local week-bound strings
**Finding.** `queries.ts:1071-1093` compares a full UTC ISO `completed_at`
against local date strings (`mondayIso`, and a hand-appended `…T23:59:59.999Z`).
A task done Sun-night/Mon-morning local lands in the wrong week.
**How.** Add two small `utils/dates` helpers — `localDayStartUtc(dateIso)` and
`localDayEndUtc(dateIso)` (parse `dateIso + "T00:00:00"` / `"T23:59:59.999"` in
local tz, return `.toISOString()`) — and compare `completed_at` against those
**UTC instants**. Keep the `date_scheduled` fallback branch on local date
strings (that column is a local date). No schema change.

### #8 — intervals/listeners rebuilt every tick
**Findings.** `FocusMode.tsx:623-655` PiP-command interval lists `elapsed` in
deps but never reads it → 200ms poller rebuilt every render; a pause/stop click
can be dropped in the teardown window. `DailyPlanner.tsx:294-333` keydown
listener lists `tasks` in deps but the body doesn't read `tasks` (Space-on-hover
was removed) → listener re-binds on every task mutation. `:275` `projectMap` is
a per-render `Map` (not an interval) — I'll `useMemo` it for cleanliness, no
behavior change.
**How.** Drop `elapsed` from the PiP deps (keep `SHORT_BREAK_MS`,
`CYCLES_BEFORE_LONG_BREAK`, which *are* read). Drop `tasks` from the keydown
deps (already has the `exhaustive-deps` disable + rationale; the rationale now
becomes true). Verify the PiP handlers all read live state via refs (they use
`*Ref.current` — confirmed) so nothing stale is captured.

### #13 — global quick-add shortcut never unregistered
**Finding.** `App.tsx:128` `register("CmdOrCtrl+Shift+A", …)` with no teardown.
**How.** `import { unregister }` and return a cleanup from the startup effect
that calls `unregister("CmdOrCtrl+Shift+A").catch(() => {})`. Guard against the
effect's `startupDone` ref so we only unregister what we registered. Mostly a
dev-stability win (StrictMode/double-mount).

### #14 — setState-after-unmount in async loaders
**Finding.** `ProjectDetail.tsx` `loadData` (563-617) and `DailyPlanner.tsx`
`loadData` (375-427) set state after awaits with no mounted guard.
**How.** Apply the existing `cancelled`-ref pattern (verbatim from
`TaskDetailOverlayHost.tsx:49-57`): `let cancelled = false` in the effect,
guard every `set*` after an await with `if (!cancelled) …`, and the effect
cleanup sets `cancelled = true`. Both are `useCallback`-wrapped loaders called
from effects — I'll move the guard into the calling effect or thread a flag.

---

## Branch D — Tier 2 remainder (one at a time; verified per caution)

### #6 — re-running a shutdown wipes prior fields — **upsert finding (required first step)**
**Read both upserts. Verdict:**
- **`upsertWeeklyShutdown` (`queries.ts:943`) IS destructive.** Plain replace:
  `ON CONFLICT DO UPDATE SET reflections=$2, incomplete_items=$3, mood=$4`.
  `WeeklyShutdown.tsx:343` calls it with `(null,null,null)` to "mark complete"
  → nulls all three, including `incomplete_items` (read by
  `ScheduleTab.tsx:624` as the carry-forward note). *Note:* no code currently
  writes a non-null `incomplete_items`, so today's live damage is latent — but
  the next writer would be silently wiped on re-completion. Fix it now.
- **`upsertDailyShutdown` (`queries.ts:597`) is NOT destructive.** Both callers
  (`DailyShutdown.tsx:155` debounced, `:241` complete) always write the **full
  current** `mood` + serialized `reflection`. Re-submit re-writes the same
  state. **Important:** COALESCE would be *wrong* here — the user clearing their
  reflection to empty must persist as null. **Leave daily untouched.**

**How (weekly only).** Make the weekly upsert null-preserving:
`SET reflections = COALESCE($2, reflections), incomplete_items = COALESCE($3, incomplete_items), mood = COALESCE($4, mood)`.
Now `(null,null,null)` = "ensure the row exists / mark complete" without
destroying anything; a real future writer passes non-null and wins. Sole caller
verified (`WeeklyShutdown.tsx:343`); no caller relies on null-to-clear.

### #7 — RichTextEditor unmount flush — **confirm finding**
**Finding (corrects the brief).** The unmount flush (`:111-123`) is **already
guarded** by `if (debounceRef.current)` and flushes the *current* `getHTML()`,
not stale content — so "flushes on every unmount regardless of a pending edit"
is **inaccurate**. The genuine bug: the effect deps are `[editor, onChange]`,
and callers pass **inline** `onChange` closures (e.g. ProjectDetail/DailyPlanner)
→ the effect re-runs every parent render and its cleanup can fire an **early
flush mid-edit**, and (with the cross-surface broadcast) re-emit.
**How.** Ref-stabilize: keep `onChangeRef`/`editorRef` updated each render, and
make the flush effect deps `[]` so the cleanup runs **only on true unmount**.
Pending edits still flush on close; no mid-life flush, no churn.
**Caution (shared component):** verify all 7 mount sites (TaskDetailOverlay,
TaskCard, ProjectDetail ×2, FocusMode, DailyPlanner ×2) still: (a) flush a real
pending edit on close, (b) write nothing when idle, (c) accept external `value`
updates (that separate effect at `:102-108` is unchanged).

### #10 — rollover doesn't renumber sort_order
**Finding.** `queries.ts:203-239` moves overdue tasks to `today` via two
`UPDATE`s without touching `sort_order` → rolled tasks keep prior-day
`sort_order`, colliding with today's. The count comment (198-227) is muddled but
the **behavior** is: increment then, on a later pass, unschedule at `>= 4`.
**How.** After the roll-forward UPDATE, renumber: select today's tasks in a
deterministic order (existing today's tasks by current `sort_order`, then
newly-rolled by `COALESCE(original_date, date_scheduled)` then old `sort_order`)
and rewrite contiguous `sort_order` via the existing batch
`updateTaskSortOrders`-style `CASE` update. Rolled tasks append after today's
existing tasks, stable across re-runs (idempotent: a second same-day rollover
finds nothing `< today` to move). **Reconcile the comment** to match actual
counting (no behavior change to the count itself — that's out of scope risk).

### #11 — `tasksById` grows unbounded
**Finding.** No eviction anywhere (grep confirms). The Map only grows.
**How (conservative).** Add `pruneTasksById()` to the store: compute the
referenced-id set = union of all `taskIdsByDate` + `taskIdsByProject` +
`taskIdsByWeek` values, plus `focus.taskId`, `selectedTaskDetailId`,
`pendingDetailTask?.id`; rebuild `tasksById` keeping only those. Call it
**gated on size** (e.g. only when `tasksById.size > 1000`) at the tail of the
load actions (`loadTasksForDate/Project/Week`) so it's not a per-mutation cost.
**Caution:** every `tasksById.get(id)` site must take its `id` from one of those
indices/refs. **Static proof:** grep all `tasksById.get(` call sites and confirm
the id provenance before enabling. If any site reads an id from outside the
tracked set, that id joins the keep-set or prune stays off for it.

### #12 — meeting notifier reliability
**Findings (`meetingApproachNotifier.ts:99-150`):**
1. `sendNotification(...)` is **not awaited**, and `notifiedSet.add` +
   `notified.push` + `changed=true` run unconditionally right after → an event
   is marked "notified" even if the send throws.
2. A throttled/missed 30s tick can let an event leave the `upcomingEvents(leadMin)`
   window (it starts, `startMs < now`) before any tick sees it → dropped alert,
   worst at a 1-min lead.
3. Polls SQLite every 30s regardless of window visibility.
**How (1 & 2 — safe, firm):**
- Wrap each send in `try/await/catch`; only `add`/`push`/`changed` **on
  confirmed success**. A failed send stays un-notified and retries next tick.
- Add a small **grace window**: treat an event as fireable if it starts within
  `[now - GRACE, now + leadWindow]` (GRACE ≈ one lead window, capped) so a meeting
  that just started between ticks still fires once; `notifiedSet` dedup prevents
  double-fire. (Requires reading `upcomingEvents`/its query to widen the lower
  bound — confined to the calendar module.)
**How (3 — needs a Verse decision, see Open Questions):** flagged below.

---

## Open questions for Verse

1. **P0-1 — RESOLVED in the revised Branch A above.** Verse rejected the 10s
   discard; the design is now: OS resume signal as the primary fix (confirmed
   reachable — `NSWorkspace` already a dep), + a 5-min missed-wake backstop
   justified from documented WebKit/App-Nap behavior. Nick declined the live
   throttle run, so fake-clock cases (ii)+(iii) stand in for it (assert
   throttled work up to 90s is kept). **This is the item needing Verse's spot
   re-approval.**
2. **#12 sub-issue 3 ("no needless polling while hidden"):** a naive
   "pause while `document.hidden`" would suppress exactly the tray alerts the
   feature exists for. Two real options:
   (a) **Event-driven**: replace the blind 30s poll with a `setTimeout` scheduled
   to the next event's lead time (recomputed on calendar sync / settings change).
   Eliminates polling, keeps alerts — but it's the **largest** change in this
   pass and brushes "structural."
   (b) **Defer sub-issue 3**, ship only 1 & 2 now (reliability wins with no
   risk), and treat the polling cost as a separate, later optimization.
   **Recommendation: (b)** for this hardening pass; do (a) as its own task.
   Need your call before I build #12.
3. **Dev deps (vitest + better-sqlite3):** approving the runtime-check tooling.

---

## Sequencing & validation summary

- **A** P0-1 — ships + fake-clock verified **first**, on its own branch.
- **B** #2+#15 — isolated; better-sqlite3 + fake-clock runtime checks.
- **C** #4, #5, #9, #8, #13, #14 — static (tsc + build + grep callers + review).
- **D** #7, #6, #10, #11, #12 — one at a time, each verified per its caution.
- `#3` in **no** branch. A `/docs` changelog per branch; this doc records the #6
  upsert finding. Final summary will confirm nothing structural/new shipped
  (sole additions = dev-only test deps). **No money cost anywhere.**
