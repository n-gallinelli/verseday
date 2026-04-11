# Task notes — render links instead of markdown brackets

**Author:** Terse
**For review by:** Verse
**Status:** Revision 2 — incorporates Verse's required revisions from review #1

## The user's request

When they paste or type a URL into a task's notes, they want it to become a real
clickable link. Right now they see raw markdown — text wrapped in `[ ]( )` —
because the existing code intercepts URLs on Enter and rewrites them as
`[shortened-label](url)` markdown that's then displayed verbatim in a plain
`<textarea>`.

User-supplied screenshot showed badly nested markdown like:

```
[[miro.com/app/...](https://miro.com/app/board/uXjVIraTsz4=/)](https://miro.com/app/board/uXjVIraTsz4=/)
```

— the result of the auto-linker firing repeatedly on already-shortened text.

## What I did first (and why it didn't fix the problem)

I assumed "task details" meant the `TaskDetailOverlay` modal and:

1. Replaced its `<textarea>` with the existing `RichTextEditor` (Tiptap-based,
   already used for project notes; supports `linkOnPaste` + `autolink`).
2. Removed the `autoLinkOnEnter` import / handler from that file.
3. Added a `convertMarkdownLinks` step to `RichTextEditor.normalizeContent` so
   existing `[text](url)` content loaded from the DB renders as real `<a>` tags.
4. Restructured `RichTextEditor`'s JSX so its placeholder stays positioned to
   the inner content area when callers pass a className with padding/border.

User reports it's "still doing it" — markdown brackets still appearing.

## Root cause of the failed fix

A grep for `autoLinkOnEnter` plus a follow-up grep for `task.notes` and
`placeholder=.Notes` (after Verse pointed out that the original audit only
caught surfaces that imported `autoLinkOnEnter`) revealed **six** distinct
places that edit `task.notes`. I only fixed one.

| # | Location                                                   | Component                       | Status                                     |
|---|------------------------------------------------------------|---------------------------------|--------------------------------------------|
| 1 | Task detail modal overlay                                  | `TaskDetailOverlay.tsx`         | ✅ updated to RichTextEditor (last round)   |
| 2 | Project notes panel                                        | `ProjectDetail.tsx:687`         | ✅ already RichTextEditor (earlier work)    |
| 3 | Inline expanded notes on a task card in lists              | `TaskCard.tsx:253`              | ❌ still plain textarea + `autoLinkOnEnter` |
| 4 | Notes panel inside the focus session screen                | `FocusMode.tsx:477`             | ❌ still plain textarea + `autoLinkOnEnter` |
| 5 | Inline task edit form on the project page                  | `ProjectDetail.tsx:809`         | ❌ still plain textarea (no autolink)       |
| 6 | Inline task edit form on the daily planner *(new finding)* | `DailyPlanner.tsx:740`          | ❌ still plain textarea (no autolink)       |

The user **confirmed** they're running `npm run tauri dev` (live build), so
the brackets they're seeing are real and not from a stale binary. They almost
certainly typed into #3, #4, #5, or #6. All six read/write the same
`task.notes` column, so a single task's notes can be edited from multiple
surfaces — fixing any one in isolation guarantees a confused user.

There's also a meta-issue worth flagging: there's no test. Each surface
re-implements the same field in a slightly different way, with subtle drift.

## Display paths (added in revision 2 per Verse's review #1)

The first revision audited only **edit** paths. Verse correctly flagged that
once notes start being saved as HTML, every **read** path also has to handle
the new format or it'll render `<p>...</p>` blobs as literal text.

A grep of `\.notes` and `parseNotes` across `src/` finds the following
display paths for `task.notes`:

| Location                          | What it does                                                                                                | Format-aware? |
|-----------------------------------|-------------------------------------------------------------------------------------------------------------|---------------|
| `TaskCard.tsx:334`                | Renders the collapsed notes-preview pill via `parseNotes(task.notes)` — plain text + clickable links         | ❌ markdown only |

Other `\.notes` hits in the codebase were verified and **none of them touch
`task.notes`**:
- `DailyPlanner.tsx:170`, `WeeklyPlanner.tsx:456`, `summaryPrompts.ts:156-157`
  → these read `daily_plan.notes` / `weekly_plan.notes`, which are unrelated
  fields with their own editing path. Out of scope.
- `db/queries.ts` hits → SQL parameter binding, format-agnostic. Out of scope.
- `DailyPlanner.tsx:258` and `ProjectDetail.tsx:447` → `setEditNotes(task.notes)`
  → those are the *edit* paths already counted above (#5, #6).

So `TaskCard.tsx:334` is the **only** display path for `task.notes` and it
needs an explicit decision about how to render HTML.

## Proposed plan

### Goal

A user who pastes a URL into *any* notes field anywhere in the app should see
a real clickable link, not bracketed markdown. Existing notes that contain
markdown link syntax in the database should render as links the next time
they're loaded.

### Step 1 — Unify all six surfaces on `RichTextEditor`

Replace surfaces #3, #4, #5, and #6 with `<RichTextEditor>`, mirroring the
change already made to `TaskDetailOverlay`.

For each surface:
- Drop the `<textarea>`
- Drop the `autoLinkOnEnter` import and `onKeyDown` handler (where present)
- Pass styling that matches the surface (the in-list expand has tighter
  padding than the modal, etc.) via the `className` prop
- Keep the same debounce/save semantics already in place

### Step 2 — Update the display path in TaskCard

This is the part that was missing in revision 1.

**Strategy chosen: render HTML notes via a small DOM-walking parser that
preserves clickable links.** Rationale:

- Stripping to plain text would lose the existing UX where users can click
  a link directly inside the collapsed preview pill (`TaskCard.tsx:336-345`).
  That's an existing feature worth keeping.
- A read-only Tiptap instance per task card is overkill — the pill is 11px
  truncated text, not a rich-text surface. Mounting Tiptap N times in a list
  view would also be a measurable perf hit.
- The middle path: a ~20-line `htmlToSegments(html)` function using
  `DOMParser` (always available in the Tauri webview) that walks the parsed
  tree and emits `{ type: "text" }` and `{ type: "link" }` segments — exactly
  the same shape `parseNotes` already returns. The TaskCard renderer is then
  unchanged.

Concrete plan:

1. Add a unified `notesToSegments(raw: string): NoteSegment[]` helper that:
   - Returns `[]` for empty input
   - If `raw` starts with `<`, walks it as HTML via DOMParser, extracting text
     nodes and `<a href="https?://...">` elements
   - Otherwise falls through to the existing `parseNotes` (markdown path) so
     legacy notes that haven't been re-saved still render correctly

2. Update `TaskCard.tsx:334` to call `notesToSegments` instead of `parseNotes`.

3. **Security:** the HTML walker only emits link segments for `href` values
   matching `^https?://` — same allowlist already applied in
   `RichTextEditor.convertMarkdownLinks`. Anything else becomes a plain text
   segment. The output is rendered into React as text/element nodes, never
   `dangerouslySetInnerHTML`, so no XSS surface even if malformed HTML
   slipped through.

### Step 3 — Don't delete linkify.ts yet

Verse correctly pushed back on my "linkify is orphaned" claim. After step 2:

- `parseNotes` is still imported by `notesToSegments` for the legacy markdown
  fallback path → keep it.
- `shortenUrl` is still used internally by `parseNotes` and might be useful
  for the new HTML walker too (link label shortening) → keep it.
- `autoLinkOnEnter` and `convertUrlsToMarkdownLinks` will be unreferenced
  after step 1 → safe to delete those two exports only.

Net effect: `linkify.ts` shrinks to ~30 lines and gains the new
`notesToSegments` / `htmlToSegments` exports. The file is no longer dead;
it's the canonical "how do we render task notes" module.

### Step 3 — Handle the messy legacy data gracefully

The `convertMarkdownLinks` regex in `RichTextEditor.normalizeContent` only
handles a single `[text](url)` per occurrence. The user's existing notes
contain doubly-nested garbage like
`[[label](url)](url)` from earlier auto-link runs.

Two options:

**Option A (lazy):** Ship as-is. Users will see broken-looking rendering on
notes that already contain nested markdown, and can manually clear those
notes and re-paste. Simple, no migration risk.

**Option B (eager):** Run a one-time DB migration that strips outer brackets
and parens around already-shortened markdown links, then re-runs
`convertMarkdownLinks`. Touches user data, needs a backup, harder to undo.

I lean **Option A** unless we know there are more than a handful of corrupted
notes. The new editor prevents the corruption from recurring; the existing
mess is small in scope.

### Step 4 — Build environment confirmed (resolved)

User confirmed they're running `npm run tauri dev`, so they're viewing the
live source build. Stale-binary scenario ruled out. The previous fix really
did only partially solve the problem; the brackets they're seeing are coming
from one of the four still-broken surfaces.

(Keeping this step in the doc as a closed item, not a TODO.)

## Files this plan would touch

- `src/components/TaskCard.tsx` — replace textarea with RichTextEditor;
  switch the preview pill from `parseNotes` to `notesToSegments`
- `src/pages/FocusMode.tsx` — replace textarea with RichTextEditor
- `src/pages/ProjectDetail.tsx` — replace inline task-edit textarea (~line 809)
- `src/pages/DailyPlanner.tsx` — replace inline task-edit textarea (~line 740)
- `src/utils/linkify.ts` — add `htmlToSegments` and `notesToSegments`; remove
  `autoLinkOnEnter` and `convertUrlsToMarkdownLinks` (no longer referenced
  after step 1); keep `parseNotes` and `shortenUrl`
- (no further changes needed in `RichTextEditor.tsx` or `TaskDetailOverlay.tsx`
  unless review uncovers issues)

## Verse's review #1 — items addressed in this revision

| # | Verse's required revision                                              | Status                                                               |
|---|------------------------------------------------------------------------|----------------------------------------------------------------------|
| 1 | Audit display paths, not just edit paths                               | ✅ done — see *Display paths* section above                          |
| 2 | Decide HTML-in-preview strategy and justify it                         | ✅ done — Step 2 picks DOM-walker preserving link interactivity      |
| 3 | Don't delete `linkify.ts` until display-path audit confirms it orphaned | ✅ done — Step 3 keeps `parseNotes` + `shortenUrl`, deletes only the two unreferenced helpers |
| ✱ | Confirm dev-vs-installed-app question with the user                    | ✅ user confirmed `npm run tauri dev`; bug is real                   |

Verse also offered guidance on the four scrutiny items from revision 1.
Folding it in:

1. **HTML sanitization** — confirm Tiptap's `Link.configure` includes
   `HTMLAttributes: { rel: "noopener noreferrer nofollow" }`. Currently it
   does not (`RichTextEditor.tsx:38-42` only sets `openOnClick`, `autolink`,
   `linkOnPaste`). Will add the rel attribute as part of Step 1.
2. **Storage format change** — addressed by Steps 2 and 3.
3. **Multi-surface sync** — out of scope per Verse. Note in a follow-up doc.
4. **Kill the markdown layer entirely** — out of scope per Verse. Future PR.

Legacy data: Option A (lazy) confirmed by Verse. The new editor stops the
corruption from recurring; existing nested-bracket notes are bounded and the
user can hand-fix them.

## Decision needed from Verse

APPROVED / REJECTED on revision 2. If APPROVED, I'll proceed to implement in
the order: Step 1 (TaskCard) → Step 1 (FocusMode) → Step 1 (ProjectDetail
inline) → Step 1 (DailyPlanner inline) → Step 2 (linkify additions +
TaskCard preview update) → Step 3 (linkify cleanup) → manual smoke test in
the running dev build.
