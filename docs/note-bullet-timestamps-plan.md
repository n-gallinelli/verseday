# Plan — Unobtrusive per-bullet note timestamps

**Branch:** `feat/note-bullet-timestamps`
**Author:** Terse · **Date:** 2026-06-24
**Status:** PLAN (rev 2, post-Verse) — Verse-approved in principle; revised for
the 3 blocking/required corrections below. Awaiting clear-to-build (no code yet).

## Goal

When Nick adds a note bullet (Focus screen + Task Detail), stamp it with its
creation time. Show that time **unobtrusively in a faint right-hand gutter**
aligned to the bullet; it **brightens on hover**. A burst of bullets written in
one sitting shows the time **once** (repeats collapse); a bullet written hours
or days later shows its own distinct time. Same-day → `2:04 PM`; earlier →
`Jun 23`.

## Key finding (shapes everything)

Notes are a **single HTML blob** (Tiptap → one `notes TEXT` column on `tasks`).
There are no per-bullet rows. Therefore we store each bullet's creation time as
an **HTML attribute on that bullet's block node** — `data-created="<epoch ms>"`
— living inside the same blob.

**Consequence: NO database migration, NO schema change.** The existing save path
(`updateTaskNotes`, debounced) is untouched. This stays out of the migration
discipline / DDL gate entirely. (Flagging for Verse: confirm you're comfortable
that per-bullet metadata rides in the HTML attribute rather than a normalized
table — chosen deliberately to avoid a migration for a cosmetic feature.)

## Design

### 1. Stamping — Tiptap extension `BlockTimestamp`
- Adds a **global attribute** `createdAt` to block nodes (`paragraph`,
  `listItem`, `heading`), parsed from / rendered to `data-created`.
- `parseHTML` **coerces to a safe integer** (non-numeric / out-of-range →
  null). A pasted or hand-edited `data-created` can never inject markup; we only
  ever read a number and render formatted text. (Security note for Verse.)
- An `appendTransaction` hook stamps **newly created** blocks that lack
  `createdAt` with the current time (`Date.now()`), so pressing Enter for a new
  bullet stamps it. The appended stamping transaction sets
  **`addToHistory:false`** (stamps are not undo steps).

#### Back-stamp guard (Verse blocking #1 — corruption path, fully specified)
The naive build **silently corrupts data**: `setContent`
(`RichTextEditor.tsx:119`) is itself a transaction, so `appendTransaction`
fires on load; every loaded block looks "new" and gets stamped `now`. Worse, the
appended stamp transaction is a **separate dispatch that DOES fire `onChange`**
even though `setContent` used `emitUpdate:false` — so fake "now" stamps would be
**persisted onto legacy bullets permanently**.

Required mechanism:
- The extension is configured with an **`isProgrammaticLoad` ref** (shared with
  `RichTextEditor`).
- `RichTextEditor` sets `isProgrammaticLoad.current = true` **immediately before**
  every `setContent` (initial mount content + the external-sync effect at
  `:119`) and resets it in a **`finally`**.
- `appendTransaction` **early-returns** while the flag is set → no stamping on
  load.
- Loaded blocks with no `data-created` render **no timestamp** (honest — we
  don't know when they were written). Editing an existing bullet does **not**
  restamp it (only creation stamps).

**Required proof test:** load a legacy blob (no `data-created`), assert
`editor.getHTML()` still contains **zero** `data-created` AND `onChange` did
**not** fire. That assertion is the gate that #1 is fixed.

### 2. Display — ProseMirror widget decorations
- The plugin **descends into `listItem`** — bullets are **nested** inside
  `bulletList`/`orderedList`, NOT top-level (Verse required-correction #2).
  Collapse + gutter positioning happen **per `listItem`** (and per top-level
  `paragraph`/`heading` for non-list notes). A naive top-level-only walk would
  build the wrong thing.
- For each stamped block whose **displayed** time (rounded to the minute)
  differs from the previous stamped block in document order, it appends a
  **widget decoration** — a child element of that block, absolutely positioned
  into a reserved **right gutter** (editor gets `padding-right` for the gutter).
- Because the widget is a child of the block, **hover brightening is pure CSS**:
  faint by default (`opacity ~0.35`), `block:hover → ~0.85`. No JS hover
  plumbing, survives reflow.
- Collapse logic gives the "same 5 min = one stamp" behavior for free: minute
  granularity + suppress-if-same-as-previous.

### 3. Formatting — `formatNoteTimestamp(epochMs)` (Verse required-correction #3)
- "Same day" uses the app's **logical day**, not raw midnight:
  `logicalDayIso(new Date(epochMs), 3) === logicalDayIso(new Date(), 3)`
  (3am cutoff, `src/utils/dates.ts:31`) — matches every other surface.
- Same logical day → time (`2:04 PM`). Earlier → **`formatMonthDay`**
  (`dates.ts:70`) on the stamp's `logicalDayIso` → `Jun 23`. Prior year →
  append the year. No bespoke date math; reuse the shared helpers.

### 4. Surface scope — opt-in prop
- `RichTextEditor` is shared (FocusMode, TaskDetailOverlay, TaskCard,
  DailyPlanner, ProjectDetail). Add a `showTimestamps?: boolean` prop, **default
  off**. Enable only on **FocusMode** and **TaskDetailOverlay** (the real note
  surfaces). TaskCard quick-edit and planner/project notes stay unchanged.

## Modules (small, per Terse)
1. `src/components/editor/blockTimestamp.ts` — stamping extension.
2. `src/components/editor/timestampDecorations.ts` — gutter widget plugin.
3. `src/lib/formatNoteTimestamp.ts` — formatter (or reuse existing util).
4. `RichTextEditor.tsx` — wire `showTimestamps`, gutter CSS.
5. FocusMode + TaskDetailOverlay — pass `showTimestamps`.

## Milestones (single Verse gate at the end — small feature)
- **M1** Stamping extension + `isProgrammaticLoad` guard; `data-created`
  round-trips through save/load. **Gate:** the Verse proof test — load a legacy
  blob, assert `getHTML()` has zero `data-created` AND `onChange` did not fire.
- **M2** Gutter decorations + formatting + collapse + hover CSS.
- **M3** Wire FocusMode + TaskDetailOverlay; `tsc` + build clean.

## Validation (self-validate, per standing pref)
- `tsc`/build clean; grep for the new attr round-trip.
- Manual sanity: add bullets in a burst (one stamp), wait/simulate a later
  bullet (new stamp), reload (stamps persist), open same task in Task Detail
  (stamps match). Confirm legacy notes show no false "now".

## Non-blocking, documented (Verse-flagged, intentional)
- **Paste carries original time:** pasting a bullet that already has
  `data-created` keeps that earlier time (the guard only suppresses stamping
  *during programmatic load*, not user paste). **Intentional** — pasted content
  retains its provenance; a fresh bullet you then type gets `now`.
- **Empty trailing block:** a new empty bullet is stamped on creation; its
  widget shows once it differs from the block above. An empty trailing block may
  briefly carry a stamp — harmless, and it collapses against its neighbor.
- **Storage-is-display-only ceiling (Verse-noted):** `data-created` is a
  cosmetic display attribute in the HTML blob, not queryable note metadata. If a
  future feature needs to *query/sort/report* on per-note times, that's a real
  normalized-table migration — out of scope here, acknowledged ceiling.

## Risks / edge cases
- Back-stamping legacy notes (guarded above) — the main correctness risk.
- Splitting a bullet (Enter mid-line) → new node gets a fresh stamp, original
  keeps its own. Acceptable.
- `Date.now()` is the app runtime (not a sandbox) — fine here.
- No migration → zero rollback surface; revert = delete the extension + prop.

## Cost
$0 — no services, no migration, no new deps (Tiptap/ProseMirror already
present).

---

## Build outcome (M1–M3 complete — for final Verse gate)

Files:
- `src/components/editor/blockTimestamp.ts` — stamping extension + pure
  `blocksToStamp` / `stampDecision` / `coerceTimestamp`.
- `src/components/editor/blockTimestamp.test.ts` — **M1 gate** (7 tests, green).
- `src/components/editor/timestampDecorations.ts` — gutter widget plugin.
- `src/utils/noteTimestamp.ts` + `.test.ts` — formatter (5 tests, green).
- `src/index.css` — `.note-ts` gutter rules (opt-in via `.note-ts-on`).
- `src/components/RichTextEditor.tsx` — `showTimestamps` prop, load guard.
- `FocusMode.tsx` + `TaskDetailOverlay.tsx` — `showTimestamps` enabled.

Validation: `tsc` (app + test) clean · full vitest suite **152 passed** (12
new) · `npm run build` clean.

Build-time decisions worth flagging for review:
1. **Stamping is a ProseMirror plugin's `appendTransaction`** (via
   `addProseMirrorPlugins`), not an Extension-config hook — Tiptap has no
   top-level `appendTransaction`. Logic is identical to the plan; it mirrors the
   official `@tiptap/extension-unique-id` pattern (`combineTransactionSteps` +
   `getChangedRanges` + `findChildrenInRange`).
2. **Editing a never-stamped legacy block adopts the current time** (it's in the
   changed range and has no prior stamp). This is the one refinement of "editing
   existing doesn't restamp": it applies ONLY to legacy null blocks the user
   actively edits; untouched siblings are never touched, and a block that
   already has a real stamp is never restamped. Chosen over fragile
   new-vs-edited detection. Behaviour is asserted in the M1 test.
3. M1 proof is asserted at the **model level** (no DOM in the node test env):
   `stampDecision(..., isProgrammaticLoad=true) === []` ⇒ no appended tx ⇒
   onChange cannot fire ⇒ loaded doc keeps zero `data-created`. The DOM-bound
   gutter rendering/hover is eyes-on, not unit-tested.
