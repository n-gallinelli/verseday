# Focus Screen — Two-Column Layout + Inline-Edit Readouts

Date: 2026-05-06
Branch: `tweak/focus-two-column` (squash-merged into main)

## What changed

The single rounded timer box on the focus screen was replaced with a **two-column composition**:

- **Left**: VerseDay logo, then a flex row containing the Done check + task title + Actual / Planned readouts + Start/Pause pill (all top-aligned to the title's first line). A hairline divider beneath, then a full-width notes editor.
- **Right column** in the prior layout is gone — there's no real right column anymore. The "right side" of the row is the Actual/Planned/Start cluster.

The Actual + Planned numerals each sit above an uppercase label (number-first, label-second), and each opens a shared popover (typable input + presets + Clear) when clicked. The notes block spans the full content width below.

## Decisions worth remembering

### Two-column collapse → single row

The intermediate iteration kept Actual/Planned as their own right column with `items-start` against a left title column. The user kept hitting alignment issues because the columns had different intrinsic heights (multi-line title vs short numerals + label). Final shape is a **single flex row with `items-start`**, where check + title + times all anchor to the title's first-line cap-top. Per-child `mt` offsets compensate for line-height + font-metric differences:

- Check button `mt-[5px]` so its 14px icon centered in 28px button drops to title cap-top.
- Times block `mt-[6px]` so the 26px-leading-none numerals' cap-top meets the same line.
- Title `leading-tight` (1.25) so its first-line cap sits ~10px from row top.

### Inline-edit pattern

Three reusable patterns landed:

1. **TitleEditor** (`<textarea>` autosizes via `scrollHeight`). Replaces a single-line `<input>` so the title wraps live as the user types. Enter commits, Esc cancels, blur saves. Reuse this for any auto-resizing inline title field elsewhere.

2. **TimePopover** (`{ title, initialInput, currentMinutes, minMinutes, onCommitInput, onSelectPreset, onClear, onClose }`). Header has a typable input with a "↵ Return to save" hint, body is the preset list (5/10/15/20/25/30/45/60 min) with a check on the active one and out-of-range presets dimmed via `minMinutes`, footer is a blue "Clear {title.toLowerCase()}" link. Each caller owns the parser + commit logic — one for ms (Actual), one for integer minutes (Planned).

3. **Click-to-edit** on numerals/title — the resting display is a `<button>` (or `<h1>`) that flips state to render the editor. Pattern: `editing === null ? <Display onClick={...} /> : <Editor onCommit={...} />`.

### Cross-surface notes sync

New custom event:
- **Name**: `verseday:task-notes-changed`
- **Payload**: `{ taskId: number, html: string }` on `event.detail`
- **Dispatch**: from FocusMode's debounced save (600ms) and TaskDetailOverlay's onChange.
- **Listener guard**: `if (ce.detail.taskId !== task.id) return; if (ce.detail.html === notes) return;` — both checks required to prevent self-echo loops on dispatching surface.

Both surfaces also write to DB via `updateTaskNotes`. The event is the in-memory keep-alive; DB is the source of truth on cold start.

The same pattern can be used for cross-surface sync of any other task-level field if the need arises (title, estimate). Today these don't need it because they're only edited from one surface at a time, but the recipe is here.

### Done auto-loads next task (B2)

Completing a task on the focus screen now:
1. Closes the current time entry (`stopTimeEntry`)
2. Marks the task done (`updateTaskStatus`)
3. Loads today's next remaining task via `getTasksForDate` + filter
4. Calls `previewFocus(next, ...)` — preview mode, no time entry yet
5. Bumps `zoomKey` to remount the wrapper that owns `animate-focus-tunnel-in`, replaying the zoom

If no remaining tasks exist, falls back to `stopFocus()` (returns to previous page). The next task lands paused — user explicitly hits Start when ready, matching the standing preference that focus screen entry never auto-starts a time entry.

### Session-state reset on `focus.task.id` change (B3)

A `useEffect` keyed on `focus?.task.id` resets all session-relative state (`elapsed`, `paused`, `pausedAccumRef`, `pausedAtRef`, `totalBreakTimeRef`, `workCycleStartRef`, `completedPomodoros`, `phase`, break refs) whenever the task identity changes.

**Audit**: only four code paths write `focus`:
- `previewFocus` — sets a brand-new task, identity changes → reset fires ✓
- `activateFocus` — promotes preview → active, same task identity → reset doesn't fire ✓
- `startFocus` — sets a brand-new task (DailyPlanner / ProjectDetail / ⌘F entry) → reset fires ✓
- `updateFocusTask(patch)` — patches `task.{notes,title,estimated_minutes,...}`, identity unchanged → reset doesn't fire ✓

So the reset only fires on real task transitions, not on field edits. Verified at the call sites.

### Actual-edit divergence (B1) — exit (1)

Verse caught this and rejected the original "MVP-with-doc" stance. The popover originally allowed reducing Actual below `priorElapsedMs` (the time logged in earlier sessions for this task) by mutating the in-memory baseline. The display would show the new value, but `time_entries` rows were unchanged — Daily Plan / TaskDetailOverlay would show the old (higher) total. **Cross-surface mental-model break.**

**Decision**: Floor `applyActualMs` at `focus.priorElapsedMs`. Out-of-range presets render disabled with a "Below the X-min logged baseline" tooltip. "Clear actual" floors at prior (discards only the current session's contribution), not zero.

The store action `setFocusPriorElapsedMs` was added in the original implementation and removed in this exit — kept the store minimal. Truly destructive Actual reductions (rewriting `time_entries`) are queued as a follow-up branch with its own plan + Verse review cycle.

### Auto-link icon in notes

`.tiptap a::before` renders a chain glyph via CSS mask, picking up the link's currentColor. Only fires once Tiptap's autolink wraps a URL in `<a>` (on space/enter), so typing a URL reads as plain text until the line is committed. Applies anywhere notes render through `RichTextEditor`.

## DB + store additions

- `updateTaskTitle(id, title)` — single-field UPDATE.
- `updateTaskEstimate(id, minutes)` — single-field UPDATE.
- `updateFocusTask(patch: Partial<Task>)` — patches `focus.task` in-place + persists. Used by saveNotes / commitTitle / setPlannedMinutes so edits survive navigating away and back.

No schema changes.

## Test plan

- **Entry**: focus icon → preview, ⌘0 → preview, ⌘F (no tasks) → empty boot.
- **Inline edits**: title (Enter / Esc / blur), Actual (popover input + presets + clear), Planned (popover input + presets + clear).
- **Actual floor (B1)**: with prior-logged time on a task, open Actual popover → confirm presets below the baseline are dimmed. Type a value below the baseline and Enter → confirm clamps to baseline. Pick "Clear actual" → confirm display = baseline (not zero). Stop session → open Daily Plan + TaskDetailOverlay → confirm totals match the focus screen.
- **Notes sync**: type in focus → open detail → confirm new value present. Type in detail → focus already open → confirm new value present.
- **Done auto-loads next**: complete with multiple tasks remaining → next loads in preview, zoom replays, timer paused. Complete with no tasks remaining → stopFocus, returns to previous page.
- **Done transition cleanliness (A2)**: open the Actual or Planned popover, then click Done → confirm popover dismisses cleanly, no zombie state. Start typing a title edit, then Done → confirm draft discards. Type into notes (within debounce window), then Done → confirm pending save flushes (Tiptap unmount flush handles this).
- **Pip drag (A3)**: with active session, hover pip → overlay covers; mouse-leave → reverts to title+time. Drag from the resting state (cursor on title/time area) → confirm window moves.
- **Persistence**: edit title + notes + planned, ⌘R → all restored from localStorage.

## Out of scope (queued for follow-up)

- **Destructive Actual reduction** — rewriting `time_entries` so the user can lower Actual below the prior baseline and have it reflected everywhere. Verse's exit (3). Needs its own plan + review cycle. Not in this PR.
