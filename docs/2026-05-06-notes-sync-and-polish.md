# Notes sync fix + focus check polish

Branch: `polish/shutdown-alignment-spacing` (continuing)

## 1. Notes weren't persisting on focus re-entry

**Root cause:** `RichTextEditor` (Tiptap wrapper) was effectively uncontrolled
after mount. `value` was passed once into `useEditor({ content: ... })`, then
never re-synced. So when:

- `FocusMode` re-mounted and the boot effect later populated `focus.task.notes`
  (via `previewFocus`), the React `notes` state updated but the editor doc
  stayed empty.
- The cross-surface `verseday:task-notes-changed` broadcast triggered
  `setNotes(...)` on a sibling editor — state updated, displayed content did
  not.

User typed into the (wrongly-empty) editor, overwriting the saved notes.

**Fix (`src/components/RichTextEditor.tsx`):** track the most recent HTML the
editor itself emitted in `lastEmittedRef`. On every `value` change, if it
differs from `lastEmittedRef.current`, call
`editor.commands.setContent(normalizeContent(value), { emitUpdate: false })`
and update the ref. Self-echoes from `onChange` no-op.

`{ emitUpdate: false }` keeps the sync from triggering the editor's own
`onUpdate`, so external content doesn't bounce back through `onChange`.

## 2. Focus-screen check button

`src/pages/FocusMode.tsx` — the round "mark done" button was too faint and
the green hover state didn't read as "circle + check turn green".

- Default ring `border-line-soft → border-fg-faded` (more visible at rest)
- Default check `stroke-fg-faded → stroke-fg-secondary`
- Check stroke `2 → 2.25` for slightly more weight
- Hover ring opacity dropped (`/60 → full`) so the green ring is solid
- Hover bg fill `/10 → /15` for a touch more feedback
- Hover check now uses `accent-green-bright` (matches ring) instead of the
  darker `accent-green-deep` — both elements turn the same green together

## Verification
- `tsc --noEmit` clean.
- Manual: type notes in focus → leave → re-enter same task → notes persist.
- Manual: edit notes in detail overlay while focus is open → focus editor
  reflects the change without remount.
