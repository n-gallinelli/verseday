# Changelog — Branch D: Tier-2 batch

**Branch:** `fix/tier2-batch` (off `main`)
**Items:** #7, #6, #10, #11, #12 from `docs/2026-06-01-stability-hardening-brief.md`.
Each verified per its caution note (static + review; the data items reasoned to
their stated outcome).

## #7 — RichTextEditor unmount flush (corrects the brief)
**Finding:** the brief's "flushes on every unmount regardless of a pending edit"
is inaccurate — the cleanup is already guarded by `if (debounceRef.current)`.
The real bug is the effect deps `[editor, onChange]`: callers pass inline
`onChange` closures, so the effect re-ran every parent render and its cleanup
could fire an **early flush mid-edit** (and, with the cross-surface broadcast,
re-emit a stale value).
**Fix:** read `editor`/`onChange` through refs and make the flush effect deps
`[]` (true mount/unmount only). Pending edits still flush on close; an idle
close writes nothing; no mid-life flush. Shared component — applies to all 7
mount sites (focus, daily plan, task detail, project ×2, daily-planner ×2).

## #6 — re-running a shutdown wiped prior fields (weekly only)
**Re-confirmed finding:** the sole `upsertWeeklyShutdown` caller passes
`(null, null, null)` to mark the week complete; **no code writes a non-null
`incomplete_items`** (only `ScheduleTab` reads it). The plain-replace upsert
nulled it (and reflections/mood) on every (re-)completion.
**Fix (weekly ONLY):** `ON CONFLICT DO UPDATE SET col = COALESCE($n, col)` — a
null arg now preserves the stored value, so re-completing never destroys data; a
future non-null writer still wins. **`upsertDailyShutdown` deliberately left as a
plain replace** — its callers always pass the full current mood+reflection and
the user must be able to clear a reflection to null (COALESCE would block that).

## #10 — rollover didn't renumber sort_order
**Finding:** moved overdue tasks kept their prior-day `sort_order`, colliding
with today's; a later drag-reorder then persisted an order the user never saw.
The documented counting (move on misses 1–4, unschedule on the 5th) actually
matches the code — only the rambling inline comment was off; reconciled.
**Fix:** capture the to-roll ids in a deterministic order (oldest first, then
prior sort_order) before the move, then renumber them contiguously **after**
today's existing max `sort_order` — appending them in a stable order while
preserving today's manual order. Idempotent (a second same-day run finds
nothing `< today`).

## #11 — `tasksById` grew unbounded (conservative eviction)
**Finding (caution):** `loadSidebarPool` **pure-primes** the rail pool into
`tasksById` with NO index entry — the rail selectors scan the whole map by
predicate. So a naive "evict anything not in an index" would drop the sidebar
pool — the exact over-eviction the caution warns against.
**Fix:** `pruneTasksById()` keeps the union of (a) the three id indices,
(b) focus / open-detail / pending-detail refs, and (c) **the ids the rail
selectors actually return** (computed by invoking `selectUnscheduledTasksByProject`
+ `selectOrphanAndOverdueTasks` — so the keep-set can't drift from the views).
Runs only when `tasksById.size > 1500`, and only from `loadSidebarPool` (the
Daily Planner path) — never during Projects search, whose primed-but-unindexed
results live in component-local state the store can't see. Logs the evicted
count (no silent cap).
**Residual (documented):** transient component-local holders (Projects search
`matchingTaskIds`) aren't in the keep-set; the high cap + Daily-Planner-only
trigger keep the prune away from active search. Flagged for the relay.

## #12 — meeting notifier reliability
**Fixes:**
- **Mark-on-success only:** `sendNotification` is now awaited in try/catch; the
  dedup set is updated only after a confirmed send. A failed send no longer
  suppresses all future retries for that event.
- **Grace window:** `upcomingEvents(leadMin, NOTIFY_GRACE_MS=90s)` keeps an event
  that started up to 90s ago in the candidate window, so a single throttled/
  missed 30s tick (even at a 1-min lead) still fires once (dedup prevents
  repeats). `graceMs` defaults to 0 → no behavior change for any other caller.
- **Polling-while-hidden:** the structural event-driven rewrite is **deferred**
  (decision b, Verse-approved) — the 30s poll is cheap; logged in
  `docs/stability-followups.md`.

## Files
- `src/components/RichTextEditor.tsx` (#7)
- `src/db/queries.ts` (#6 weekly upsert, #10 rollover)
- `src/stores/appStore.ts` (#11 pruneTasksById + interface)
- `src/calendar/upcomingEvents.ts` (#12 grace param)
- `src/calendar/meetingApproachNotifier.ts` (#12 await + grace + comment)
- `docs/stability-followups.md` (logged deferrals)

## Validation
- `npx tsc --noEmit` clean · `npm run build` clean · `npm test` 11/11
  (unchanged) · `eslint` on changed files: 0 errors.
- Grep-verified each item (see relay). No schema/migration/native changes.
- **No money cost.**
- Offer: #6 (COALESCE) and #10 (rollover renumber) are SQL contracts I can lock
  in with node:sqlite tests (same harness as Branch B) if you want belt-and-
  suspenders — not added preemptively since Tier 2 was scoped to static.
