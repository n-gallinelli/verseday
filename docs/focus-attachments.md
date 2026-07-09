# Focus screen attachments (+ notes cursor fix)

**Date:** 2026-07-09
**Status:** MERGED (#75 attachments, #76 notes fix) → main → installed release. Verse-approved.

## Attachments on Focus (#75)

Add view + drop of attachments to the Focus screen without adding weight:
invisible at rest, a quiet `📎 N` line when attachments exist, and a floating
thumbnail popover on hover that never reflows the notes.

- New `src/components/focus/FocusAttachments.tsx` reuses the shared attachments
  module (`useAttachmentsController` / `useAttachmentDrop` / `useAttachmentOpener`
  / `AttachmentDropOverlay`) with owner `("task", viewedTask.id)`. FocusMode
  wiring is three touch points. No DB/store/Tauri change, no migration.
- **Refactor (isolated commit):** `useAttachmentOpener()` extracted verbatim from
  `AttachmentList` so the popover shares one lightbox / one allowlisted
  `open_attachment` path.
- Mounting `useAttachmentDrop` installs the window-level file-drop guard the Focus
  screen lacked — fixes the latent "stray file drop blanks the app" bug.

### Blob discipline (Verse C1–C5)
Thumbnails lazy-fetch only on popover-open, image-mime only, capped at 6 resident
blobs, cached per-open (re-hover never re-queries), released on close, reset on
task switch with an apply-token guard. Non-images / over-cap images stay
glyph-only. F1: popover force-closes when the last attachment is removed.

### Layout lessons
- Empty-state strip is **zero-height** (`h-0`) so notes stay tight to the
  hairline; the drop hint sits in the gap **below** the line, never on it.
- Thumbnail tiles are **inline-sized 56px squares with flex-wrap**, not grid —
  as grid items they stretched to the image's intrinsic size and ballooned.
- Notes editor top spacing trimmed (`mt-1`, `pt-1.5`) so notes sit close under
  the hairline / `📎 N` line.

## Notes cursor reset → bullet list-exit (#76)

On Focus, Enter-twice on an empty bullet kept spawning empty bullets instead of
exiting the list (Task detail / Daily worked — same RichTextEditor). Not keyboard
interception: a re-seed loop unique to Focus. The reseed effect depended on the
whole `viewedTask` object; `saveNotes → primeTaskPatch` rewrites `tasksById` per
keystroke → new `viewedTask` ref → effect reseeds the lagging persisted notes →
RichTextEditor's `setContent` resets the cursor mid-edit → the next Enter splits
instead of lifting.

Fix: key the reseed on `viewedTask?.id` only (seed on task switch). Companion:
re-key the `verseday:task-notes-changed` listener from `focus?.taskId` (running
task) to `viewedTask?.id` (displayed task) — the split gate dropped external
edits to a browsed task and could inject the running task's edit into a different
browsed task's editor, which a keystroke would then persist onto the wrong task.

**Invariant:** anything touching the Focus notes editor (reseed, sync gate,
saveNotes) keys on `viewedTask` (displayed), never `focus.taskId` (running).
