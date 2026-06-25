# Plan — Explicit note timestamp pills (`@now` / `@today` / `@tomorrow`)

**Branch:** `feat/note-bullet-timestamps`
**Author:** Terse · **Revised:** 2026-06-24
**Status:** BUILT — awaiting **fresh** Verse review.

> ## ⚠ THIS RETIRES THE GUTTER APPROACH (prior Verse approval VOID)
> An earlier revision of this branch auto-stamped **every** bullet on creation and
> displayed the time in a faint **right-hand gutter** via ProseMirror widget
> decorations. Verse approved that design *in principle* (rev 2). **That design is
> RETIRED and its approval is to be treated as VOID.** It is gone from the code —
> no `blockTimestamp.ts`, no `timestampDecorations.ts`, no `showTimestamps` prop,
> no `data-created` attribute, no back-stamp load guard. This document describes
> the design that actually shipped on this branch and supersedes every prior
> revision of this file. Review this from scratch.
>
> **Why the pivot (Nick's call):** the gutter design's entire correctness burden
> came from *auto-stamping* — it had to descend into nested `listItem`s, reserve
> gutter space, collapse same-minute repeats, and (the real hazard) guard against
> `setContent` back-stamping legacy notes with a fake "now" on load. The explicit
> pill design **deletes that whole risk class**: nothing is ever stamped
> automatically, so there is no load-time corruption path to defend.

## Goal

Let Nick drop a timestamp into a note **on purpose**, inline with the text, by
typing a trigger — never automatically. Three triggers:

| Type        | Inserts a pill labelled        | Example          |
|-------------|--------------------------------|------------------|
| `@now`      | current time **·** date        | `4:58 PM · Jun 24` |
| `@today`    | today's date                   | `Jun 24`         |
| `@tomorrow` | tomorrow's date                | `Jun 25`         |

`#` is accepted as an equivalent trigger prefix (`#now` etc.) for muscle-memory.
Nothing appears unless the user types one of these. The value is captured **once
at insertion and frozen** — a pill is a point-in-time stamp, not a live clock.

## Key finding (shapes the design)

Notes are a **single HTML blob** (Tiptap → one `notes TEXT` column on `tasks`).
A pill is therefore **part of the note content** — a Tiptap inline atom node
serialized into that same blob. **No DB migration, no schema change, no DDL** —
this stays entirely outside the migration-discipline gate. The existing debounced
`updateTaskNotes` save path is untouched.

## Design

### 1. The pill — Tiptap inline atom `TimePill` (`src/components/editor/timePill.ts`)
- `inline: true`, `group: "inline"`, `atom: true`, `selectable: true`. As an atom
  it's a single unit: backspace removes the whole pill; it can't be edited into a
  malformed state. Selected → blue `ProseMirror-selectednode` outline.
- **Attributes** (all coerced on parse — see Security):
  - `label` — the frozen display string (`data-label`). This is what renders.
  - `ts` — the captured instant, epoch ms (`data-ts`), integer-coerced.
  - `kind` — `"now" | "today" | "tomorrow"` (`data-kind`), coerced to `"now"`.
- **Insertion — InputRule** `/[@#](now|today|tomorrow)$/`: on match, capture
  `Date.now()`, build the label, replace the typed trigger text with the pill
  node, then insert a trailing space. No menu, no async.
- **Labels** use the shared, logical-day-aware helpers (no bespoke date math):
  - `now` → `formatNoteTimestamp(ms)` → `"2:04 PM · Jun 24"`.
  - `today` / `tomorrow` → `dateLabel(ms, 0|+1)` off `logicalDayIso` → `"Jun 25"`.

### 2. Formatting — `formatNoteTimestamp` (`src/utils/noteTimestamp.ts`)
- Logical day (3am cutoff via `logicalDayIso`) — matches every other surface.
- Same calendar year → `time · Mon DD`; prior year appends it (`Jun 23, 2025`).
- Minute granularity (no seconds): two `@now` pills typed in the same minute carry
  identical labels (asserted in tests).

### 3. Styling — `.note-time-pill` (`src/index.css`)
- Inline rounded chip: `--overlay-pressed` bg, `--text-secondary` text, `0.82em`,
  `tabular-nums`, `user-select:none`, `cursor:default`. It reads as a small inline
  chip sitting in the text flow — **not** an overlay or gutter element.

### 4. Surface scope
- `TimePill` is registered globally in the shared `RichTextEditor`. No opt-in prop
  is needed (unlike the retired gutter design): the pill is **inert until the user
  types a trigger**, so enabling it everywhere costs nothing on surfaces where
  nobody types `@now`. Every note surface (Focus, Task Detail, etc.) gets it.

## Security (Tauri XSS-to-IPC surface — per the untrusted-HTML discipline)
- The label renders as a **TEXT child** of the span (`renderHTML` returns the
  string as a node child), **never `innerHTML`**. A hand-edited or pasted
  `data-label` cannot inject markup; on re-parse the atom ignores its inner DOM
  anyway.
- `ts` is integer-coerced (`coerceTs`: finite integer, `0 < n < ~year 2100`, else
  null). `kind` is whitelist-coerced. A crafted blob can at most produce a
  harmless mislabeled chip — no script, no IPC reach.
- No sanitizer is introduced. (If one is ever added to the notes path, its
  `ALLOWED_ATTR`/`ALLOWED_TAGS` must permit `span[data-time-pill]` +
  `data-label/ts/kind`, or pills silently vanish — see Invariants.)

## Files on this branch
- `src/components/editor/timePill.ts` — the node, input rules, coercion, labels.
- `src/utils/noteTimestamp.ts` (+ `.test.ts`, 5 tests) — the `@now` formatter.
- `src/index.css` — `.note-time-pill` rules.
- `src/components/RichTextEditor.tsx` — registers `TimePill` (3 lines).
- `docs/note-bullet-timestamps-plan.md` — this doc.

## ⚠ Flagged for Verse — bundled unrelated change
- `src/pages/FocusMode.tsx` carries a **single unrelated hunk**: a `-mt-[10px]`
  optical-centering nudge on the Start/Pause button, with a comment explaining it
  aligns the button to the ACTUAL/PLANNED numerals. It rode along in the pivot
  commit and has **nothing to do with timestamps**. Flagging it explicitly rather
  than hiding it — Verse to decide: keep it in this PR, or split it out.

## Validation (self-validated, per standing pref)
- `tsc --noEmit` clean.
- `vitest run src/utils/noteTimestamp.test.ts` — 5/5 green.
- Eyes-on owed (DOM-bound, not unit-testable): type `@now` / `@today` /
  `@tomorrow` (and `#` variants) in a Focus note → correct frozen pill; backspace
  removes the whole pill; reload → pill persists with the same label; copy/paste a
  pill → label survives.

## Invariants (keep true going forward)
- Notes HTML must never be sanitized in a way that strips `span[data-time-pill]`
  or its `data-label/ts/kind` attributes — that would erase every pill.
- The pill label is and must stay **TEXT-only** in `renderHTML`. Never switch it
  to `innerHTML`.

## Risks / rollback
- No migration → zero rollback surface. Revert = remove the `TimePill` import +
  registration and the file; existing notes (plain HTML) are unaffected.

## Cost
$0 — no services, no migration, no new deps (Tiptap/ProseMirror already present).
