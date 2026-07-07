# Focus screen: notes-bleed, dead arrows, phantom completion — fix plan

**Date:** 2026-06-09
**Author:** Terse
**Status:** SHIPPED — all three fixes are live on main (Bug 1 `primeTaskPatch`
task-scoping, Bug 2 editor remount on task change, Bug 3 `handleDone`
error-logging + "NOT advancing" guards). This doc is committed retroactively as
the changelog for that work.

Three bugs reported on the focus screen, all surfacing around the
**complete → advance-to-next-task** flow:

1. Complete a task → next task appears with the **previous task's notes**.
2. After that, the **↑/↓ arrows stop switching tasks**.
3. Complete a task → on the Today screen it's **still un-completed, with no
   worked time** recorded.

Investigation points at three distinct root causes (two of them share the
notes editor). Each is independently fixable.

---

## Bug 1 — Notes bleed onto the next task

### Root cause
`saveNotes` (FocusMode.tsx:319) debounces (600ms) and, when it fires,
calls `updateFocusTask({ notes })`. `updateFocusTask` (appStore.ts:1027)
patches **whatever task focus currently points at** — it reads
`session?.taskId ?? focusView?.taskId` live, it does NOT take a taskId.

Timeline that bleeds:
1. Type notes on task A → `saveNotes` arms a 600ms timer (DB write captures
   `taskId = A` correctly).
2. Click Done → `handleDone` → `previewFocus(B)` → focus now points at B.
3. The 600ms timer fires: the DB write to A is fine, **but
   `updateFocusTask({notes})` stamps A's notes onto B's `tasksById` entry**
   (focus is B now).
4. The notes-sync effect (FocusMode.tsx:278, dep `focusedTask`) sees B's
   cache entry changed → `setNotes(A's notes)` → `RichTextEditor` re-syncs
   (RichTextEditor.tsx:106) → **task B shows A's notes**, and a subsequent
   save can persist them to B's DB row.

`RichTextEditor` itself syncs correctly on external `value` change; the
corruption originates in the store prime targeting the wrong task.

### Fix
Make the notes-save path **task-id-scoped end to end** — never rely on
"current focus" for a write that was initiated against a specific task:

- Add a task-scoped store action, e.g. `primeTaskPatch(taskId, patch)`
  (updates `tasksById.get(taskId)` only), OR give `updateFocusTask` an
  explicit `taskId` guard that no-ops if focus has moved.
- `saveNotes` already captures `taskId` at call time — route BOTH the DB
  write and the cache prime through that captured id.
- Audit the title/estimate auto-saves that also call `updateFocusTask`
  (same hazard if a save straddles an advance) and convert them too.

---

## Bug 2 — ↑/↓ stop switching after a completion

### Root cause
The arrow-nav handler (FocusMode.tsx:984) bails when the active element is
an input/contentEditable (so arrows move the cursor while editing):
```
if (el && (… || el.isContentEditable)) return;
```
The `RichTextEditor` is **not remounted or blurred on task advance** — the
same editor instance persists (it only `setContent`s). If it holds (or
regains) DOM focus across the advance — likely when the user was just
typing notes — `document.activeElement.isContentEditable` stays true, so
every arrow press is treated as "typing in the editor" and **no task
switch happens** until the user clicks elsewhere to blur it.

(Confirmed not a session-state issue: `previewFocus` sets `session:null` +
`focusView` ⇒ mode `preview`, which the handler treats as switchable.)

### Fix
Deterministically drop editor focus when the focused task changes:
- Key the notes `RichTextEditor` by `focus.taskId`
  (`<RichTextEditor key={focus.taskId} … />`) so it remounts per task — the
  old contentEditable is destroyed (focus released) and the new one starts
  blank-then-synced. This ALSO hardens Bug 1's display path.
- **Caveat that must be handled together with Bug 1:** RichTextEditor's
  unmount flush (RichTextEditor.tsx:125) calls the *latest* `onChange`,
  which on an A→B remount runs with B's context → would write A's html to
  B. So keying is only safe once the save path is task-id-scoped (Bug 1
  fix). Do them together.
- Alternative/extra: explicitly `editor.blur()` (or move focus to the
  timer region) in the task-change effect.

---

## Bug 3 — Phantom completion: task not done, no time on Today

### Root cause
`handleDone` (FocusMode.tsx:1133) wraps the commit in a `try { … } catch {}`
that **silently swallows** errors, and then **advances to the next task
regardless** in a separate block:
```
try {
  if (active) { updateTimeEntryWorkedSeconds(); stopTimeEntry(); }
  updateTaskStatus(completedTaskId, "done");
  reconcileTaskFromDb(completedTaskId);
} catch {}            // ← swallows
… load next remaining … previewFocus(next)   // ← runs even if the above threw
```
If anything in the commit throws (suspects: stale/closed
`focus.timeEntryId` passed to `stopTimeEntry`/`updateTimeEntryWorkedSeconds`,
a `getBreakSeconds()` error, or a DB error), the UI still advances — so the
user sees the task "complete and move on" while **the DB never recorded
`done` or the worked time**. On Today it's un-completed with no time. Exact
match for the report.

A secondary contributor to "no time": if the session was in **preview**
(never hit Play), there's no time entry to commit, so zero time is correct
— but the task should still mark `done`. If users expect completing a
previewed task to count its planned/elapsed time, that's a separate policy
question for Verse.

### Fix
1. **Stop swallowing.** Log the error; on failure, do NOT advance — keep
   focus on the task and surface a non-fatal error state so the user
   retries rather than silently losing the completion.
2. **Gate the advance on commit success** (move the advance out of the
   blanket catch; only run it after the writes resolve).
3. **Find the actual throw:** with the catch removed/logged, capture the
   real error (instrument `focus.timeEntryId`, the entry's open/closed
   state, and `getBreakSeconds()`). Strong suspect: the time entry is
   already closed by the 15s checkpoint / a prior stop, so a second
   `stopTimeEntry` on the same id throws.
4. After a successful commit, ensure Today reflects it — `reconcileTaskFromDb`
   + `loadWorkedMinutes` already run; verify they propagate to
   `taskIdsByDate`/`workedByTaskId` for the DailyPlanner subscription.

---

## Sequencing & risk

- **Do Bug 1 + Bug 2 together** (shared editor + save-path coupling; keying
  the editor is unsafe until the save path is task-scoped).
- **Bug 3 is independent** but highest-impact (data loss: lost completions +
  worked time). Recommend landing it first, with the silent-catch removal as
  step one so we capture the real exception in the wild before finalizing.
- No DB schema / DDL changes anticipated for any of the three.
- Validation: `tsc` + `vite build`; targeted reasoning/code review per
  self-validate discipline. The complete→advance race is timing-sensitive —
  call out any spots that warrant an eyes-on pass (Nick mid-session repro).
- Ship together with the already-queued **pip off-screen clamp**, when Nick
  is out of a focus session (rebuild + reinstall quits the app).
