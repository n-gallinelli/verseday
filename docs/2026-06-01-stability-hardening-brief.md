# Stability Hardening — Brief for Terse

**Date:** 2026-06-01
**From:** Audit + Verse
**To:** Terse
**Status:** BRIEF — not a plan. Terse plans against this, Verse approves the plan before any code.

## Mission

The app is going into full-time daily use. The goal is **reliability only** — tighten what's
broken, change nothing structural, add nothing new. This brief lists confirmed bugs and the
**outcome** each fix must achieve. It does **not** prescribe implementation — that's your plan
to write.

Items are grouped by **risk tier**, not just severity, because the goal is "don't break a working
app." Audit item numbers are kept for traceability.

## Working rules (reminders)

- Plan first, present to Verse, wait for APPROVED before writing code.
- New branch off `main`, never `main` directly. One branch per concern (see sequencing).
- Small modules; document decisions + a changelog in `/docs`.
- Self-validate per Nick's preference: `tsc` + `npm run build` + grep all callers + code review.
  **Exception:** items marked ⚠️ touch time-data integrity and must have a runtime check
  (e.g. a fake-clock unit test) — a static pass is not enough for those. Call this out in your plan.
- One plan, one final Verse review — **except** the P0, which ships and is verified on its own
  branch first.
- Confidence flags: ✓ = verified against source. · = reported; **confirm during planning before
  you trust the framing.**

## Out of scope (deliberately deferred)

- **#3 Project-edit propagation** (stale color/name across screens until reload). This is a ~12-file
  refactor and the bug is cosmetic, not data loss or instability — the wrong risk/reward for a
  "make it reliable" pass. Stays deferred (it's the existing M5 work). If it becomes annoying, we do
  the **lightweight** version later as its own small task: a single `verseday:project-changed`
  broadcast that holders re-fetch on, mirroring the retired task-event pattern — **no** store rewrite.
  Do not touch this now.

---

## TIER 1 — Surgical, low risk (isolated, additive; static validation is sufficient)

### P0-1. Worked time is inflated by sleep / lid-close ✓ ⚠️
*(Low-risk change, but time-integrity → runtime check required. Ship on its own branch, first.)*
- **Issue:** `FocusMode.tsx:491-494` feeds `delta = Date.now() - lastTickRef` into `tickFocus`
  (`appStore.ts:1004`), which does `workedMs + deltaMs` with no upper bound. The interval is
  suspended during sleep, so the first tick on wake adds the whole gap.
- **Repro:** Start a timer, close the laptop 2 hours, reopen → a 5-minute task reads ~2h5m.
- **Outcome we want:** A wall-clock gap from sleep/suspend/long stall is **not** counted as worked
  time. After a multi-hour sleep with a running timer, recorded time grows by ~0 for that span.
  Normal sub-second event-loop catch-up must still work — do not over-clamp and lose real seconds.
- **Done when:** A delta far larger than the tick cadence is discarded as not-worked, proven by a
  fake-clock check (a 2h delta must not add 2h; a 1s delta must still add 1s).

### 4. Editing worked-minutes on the active task doesn't update the live readout ·
- **Issue:** `appStore.ts:1290` writes the DB but never calls `setFocusPriorElapsedMs`.
- **Repro:** Edit worked-minutes on the in-focus task → the focus timer shows the old baseline until
  you stop and re-enter.
- **Outcome we want:** Editing worked-minutes for the in-focus task updates the on-screen elapsed
  readout immediately; displayed time matches the DB.

### 5. "Today" and date paging use UTC, diverging from the local-tz helpers ✓
- **Issue:** `DailyPlanner.tsx:868` (`isToday`) and `:862-865` (`changeDate`) use
  `new Date().toISOString()` instead of the `utils/dates` local helpers.
- **Repro:** After ~5pm Pacific the UTC date is already tomorrow → "today" highlight points at the
  wrong day; arrows mis-step in UTC-positive zones; tasks added while paging can land on the wrong day.
- **Outcome we want:** "Today" and the day arrows always resolve to the user's local calendar day,
  and tasks write to the day being viewed. Consistent with `todayString()` / `localDateIso()`.

### 9. `completed_at` compared in UTC against local week bounds ✓
- **Issue:** `queries.ts:1071-1093` compares a UTC timestamp against local-tz date strings.
- **Outcome we want:** Tasks completed near midnight are counted in the correct **local** week's
  shutdown summary; the "X tasks done this week" count is right at day boundaries.

### 8. PiP command interval rebuilt every second ✓
- **Issue:** `FocusMode.tsx:623-655` has `elapsed` in its deps but doesn't read it in the body, so the
  200ms poller is torn down/recreated each tick. Same churn at `DailyPlanner.tsx:275` and `:294-333`.
- **Outcome we want:** The interval rebuilds only on a real dependency change; the per-tick window
  where a PiP pause/stop click can be dropped is closed. No behavior change otherwise.

### 13. Global quick-add shortcut never unregistered ·
- **Issue:** `App.tsx:128` registers but never unregisters.
- **Outcome we want:** Teardown unregisters; no double-registration or stale handler after the effect
  re-runs. (Mostly a dev-stability win.)

### 14. `setState`-after-unmount in async loaders ·
- **Issue:** `ProjectDetail.tsx:578-617`, `DailyPlanner.tsx:375-427` set state after awaits with no
  mounted guard.
- **Outcome we want:** Fast date/project switching during slow reads never flashes stale data or
  warns. Use the `cancelled`-ref pattern already in the codebase.

---

## TIER 2 — Contained but touches shared paths / data (verify carefully, one at a time)

### 2 + 15. Crash / force-quit erases the session's time ✓ ⚠️
*(Touches the time-write path — the data you care most about. Runtime check required.)*
- **Issue:** `closeOrphanedTimeEntries` (`queries.ts:749`) sets `end_time` but never `worked_seconds`;
  `startTimeEntry` inserts none. All aggregates `SUM(worked_seconds)`, so an orphaned entry contributes
  **0 minutes** despite real work. (#15: the read aggregates also don't enforce `end_time IS NOT NULL`,
  so they rely on open rows being 0 rather than guaranteeing it.)
- **Repro:** Work 40 min, force-quit, relaunch → the session is absent from daily/weekly totals.
- **Outcome we want:** An abnormally-ended session retains its worked time — worst case the user loses
  only the seconds since the last checkpoint, never the whole session. No silent holes in totals after
  a crash. And no path can ever double-count: an open row's seconds must never enter an aggregate twice.
- **Done when:** A fake-clock/unit check proves (a) an orphaned entry recovers a sensible worked value,
  and (b) a live session's seconds are counted exactly once across the DB total + live focus value.
- **Caution:** This is the highest-care item. The fix edits the code that writes your time data — a bug
  here corrupts the thing the whole effort is protecting. Keep it isolated; do not bundle with unrelated
  changes.

### 7. RichTextEditor flushes notes on every unmount, even with no pending edit ·
- **Issue:** `RichTextEditor.tsx:111-123` calls `onChange(editor.getHTML())` on every unmount regardless
  of a pending edit; can re-save stale notes over a value another surface just changed.
- **Caution:** Shared by every notes surface (focus, daily plan, task detail, project) — a regression
  spreads. Verify across all of them.
- **Outcome we want:** Closing an editor with no pending edit writes nothing; a note edited on one
  surface is never clobbered by a stale flush from another; real pending edits still flush on close.

### 6. Re-running a shutdown can wipe prior fields ·  ← confirm upsert semantics first
- **Issue:** `WeeklyShutdown.tsx:343` calls `upsertWeeklyShutdown(week, null, null, null)`. If the upsert
  is a plain replace, a second completion nulls `incomplete_items` — read by ScheduleTab as next week's
  carry-forward note. DailyShutdown has no re-submit guard either.
- **First step:** Read `upsertWeeklyShutdown`/`upsertDailyShutdown` and report whether re-submit is
  actually destructive. If it's already idempotent, this becomes just a clarity guard.
- **Outcome we want:** Completing a shutdown twice never destroys previously-saved data; re-visiting a
  shutdown is safe.

### 10. Rollover doesn't renumber `sort_order` ·
- **Issue:** `queries.ts:211` moves overdue tasks to today without renumbering, causing colliding/arbitrary
  order. (Also reconcile the documented-vs-actual rollover-count off-by-one.)
- **Outcome we want:** Rolled-over tasks land in a stable, deterministic order; a later drag-reorder
  persists the order the user actually saw.

### 11. `tasksById` grows unbounded ·
- **Issue:** the canonical task map is never pruned.
- **Caution:** Eviction that's too aggressive drops entries a screen still needs. Be conservative — only
  evict tasks not referenced by any current view.
- **Outcome we want:** Memory and per-mutation scan cost stay flat across a multi-day always-open session,
  with no task ever missing from a view that needs it.

### 12. Meeting notifier reliability ·
- **Issue:** `meetingApproachNotifier.ts:99-145` — a single throttled 30s tick can step past the whole
  lead window and drop the alert; an event is marked "notified" even on a failed send; the notifier polls
  SQLite every 30s while hidden in the tray.
- **Outcome we want:** Alerts fire reliably even at a 1-minute lead; an event is marked "notified" only on
  a confirmed send; no needless background polling while the window is hidden.

---

## Sequencing (Terse to finalize in the plan)

1. **Branch A — P0-1** alone. Ship + verify first (runtime check); highest-impact integrity fix.
2. **Branch B — #2 + #15** (worked-seconds integrity pair). Isolated, runtime-verified.
3. **Branch C — Tier 1 remainder** (#4, #5, #9, #8, #13, #14). Surgical batch, static validation.
4. **Branch D — Tier 2 remainder** (#7, #6, #10, #11, #12). Each verified per its caution note.

`#3` is **not** in any branch — deferred, see Out of Scope.

## Definition of done

- Each item meets its stated outcome. Tier 1 validated statically; ⚠️ items (P0-1, #2/#15) have a
  passing runtime/fake-clock check. Tier 2 items verified per their caution notes.
- `/docs` has a changelog entry per branch and a decision note where you confirmed #6's upsert behavior.
- Nothing structural changed, nothing new added — confirm this in the final summary.
- Final Verse review passes.
