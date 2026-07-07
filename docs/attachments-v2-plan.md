# Attachments v2 — tabbed panel, full-panel drop, box removal, dates shrink

**Author:** Terse (from Nick's brief) · **Date:** 2026-07-07 · **Status:** Verse PLAN-APPROVED 2026-07-07 (presentational only, no bytes/schema). Rulings folded in below. QUEUED — NO code until v1 attachments lands (post-#42 rebase, see `attachments-decisions.md`).
**Depends on:** v1 `src/components/AttachmentsSection.tsx`, `TaskDetailOverlay.tsx`, `pages/ProjectDetail.tsx`.
**Palette rule (global to this work):** warm sunset accent only — active tab indicator, drag wash, drag border. **Never `--accent-blue`.** Confirm the exact warm token in `src/index.css` (sunset/amber/`--focus-break-label` family) before building; do not hardcode a hex.

## 1. Notes / Attachments tab switcher
Replace the standalone Notes section **and** the separate attachments dropzone with **one tabbed panel** at the top of the left content area.
- Two text-label tabs: **Notes** (default/selected on open) and **Attachments**.
- Attachments tab shows a **count** behind the label when >0 — e.g. `Attachments 3` — number in a **quiet de-emphasized weight** beside the label, NOT a loud badge. Zero → just `Attachments`, no number.
- Lightweight text labels; **subtle** active-state: a thin warm underline OR a soft filled pill in the warm neutral surface — **not** a heavy bordered tab.
- Switch = **instant crossfade** of the panel content below (~150ms).
- Selected tab indicator = warm accent; inactive label = muted neutral. **No blue.**
- Applies to **both** Task detail (`TaskDetailOverlay.tsx`, left panel ~ line 887–909) and Objective detail (`ProjectDetail.tsx`, notes block ~ line 1390–1403 + the `AttachmentsSection` mount).

**Impl note:** the left content area currently renders Notes (`RichTextEditor`) then `AttachmentsSection` stacked. v2 makes them two tab panes. Count comes from the existing store slice `attachmentsByOwner.get("<owner>:<id>")?.length` — already metadata-only, no extra fetch.

## 2. Attachments — kill the box
Inside the Attachments tab:
- **Remove** the big permanent dashed dropzone (the current `+ Add file / paste` bordered div in `AttachmentsSection`).
- With items: clean **list or compact thumbnail grid**, generous spacing, **no card per item, no nested containers** (drop the current `bg-elevated` chip container language → lean on space + alignment).
- Empty: a **single quiet line** of warm prompt text (e.g. "Drop a screenshot or file here") — NOT a bordered empty box.
- Adding = a **small inline text action** (`+ Add file`), not a large dashed target.

**RULING (Verse): TEXT LIST + metadata type-icons. No thumbnails in v2.** A lazy/on-demand thumbnail grid does NOT escape C1 — it relocates the read-amplification from hydration to tab-open (pull a full ≤13.3 MB base64 blob across IPC to paint a 64px cell, ×every image). "Not in hydration, not store-cached" doesn't fix the per-blob waste.
- Visual richness the cheap way: a **type icon by extension/mime** (image / pdf / doc / audio / video glyph) + filename + size. Zero blob reads. Satisfies §2 "clean list, generous spacing, no cards."
- Real thumbnails = a **pre-computed downscaled thumb stored at ingest** (separate small column/table) → grid reads only tiny thumbs. That needs a **migration → v3 with its own DDL gate**, not this presentational pass. Deferring it is what keeps §3's "no migration" honest.
- **Only if Nick overrides** and wants image previews now: the sole v2-acceptable form is strictly **viewport-gated (IntersectionObserver) + concurrency-capped + size-skipped (>~2 MB → icon, not thumb) + released after paint + never store-cached** — spec explicitly and Verse re-reviews before code. **Default remains text-list.**

## 3. Full-panel drag-over drop confirmation (the core ask)
Drag a file **anywhere over** the task/objective detail panel → the **entire panel** responds (not a small zone):
- On drag-enter: overlay panel content with a **warm-tinted translucent wash**, a **warm accent border just inside the panel edge**, and centered text "**Drop to attach.**"
- On drag-leave / drop: overlay **fades out 150–200ms**.
- Whole panel is the target — no aiming at a box.
- Works **regardless of active tab**; dropping while on **Notes auto-switches to Attachments** so the user sees the result land.

**Impl notes / Verse-required guards (non-negotiable):**
- **Gate overlay activation on `e.dataTransfer.types.includes("Files")`.** Internal `RichTextEditor` text drags + text-selection drags don't carry `"Files"`, so the overlay never shows and the RTE keeps native drag/drop. This is THE fix to the hijack concern.
- **Drag-depth counter** (increment `dragenter` / decrement `dragleave`, show while >0) for child-leave flicker, AND set **`pointer-events: none`** on the overlay so it can never become a `dragleave` source itself.
- **`preventDefault` on BOTH `dragover` (required for `drop` to fire) and `drop`.**
- **Window-level `dragover`/`drop` `preventDefault` guard.** Dropping a file anywhere the app doesn't handle it makes the webview navigate to `file://…` — a silent footgun that blanks the app. Catch at the window and swallow non-panel drops.
- Route dropped `DataTransfer.files` through the existing **`fileToAttachmentPayload` + `addAttachment(...)`** path (reuse, don't duplicate); the per-file 10 MB cap + error surface already loop correctly.
- Paste routing (image→Notes vs image→Attachments) is a SEPARATE event, out of scope here — just don't regress v1's `imageFilesFromClipboard`.
- **On an oversize/rejected drop, still switch to the Attachments tab** so the error surfaces where the user is looking — don't strand them on Notes with a hidden error.

## 4. Shrink the Dates control on the objective panel
`ProjectDetail.tsx` right rail — the "Set dates" control currently sits in an oversized dashed container (`DateRangeField` wrapper).
- Collapse to a **single compact inline row**: small calendar icon + "Set dates" as plain tappable text — or the range once set, e.g. `Jul 7 – Jul 14` — on one line. No dashed box, no large padding.
- Should read like the **task panel's date row**, not a drop target.
- Reclaimed height lets **"This week"** breathe back into the right rail.

**Impl note:** match the Task panel's date-row treatment for consistency. **Verse: re-verify the `DateRangeField` popover still positions correctly after collapsing the trigger row** — the clipping fix (`bedec70`) measures `offsetHeight` + `useLayoutEffect` reposition off the trigger, so changing the trigger's layout can shift the anchor. Eyes-on that popover.

## 5. General / non-negotiables
- Warm sunset palette throughout (tab indicator, drag border, drag wash) — **never system blue**.
- Generous, consistent spacing; **fewer visible boxes, more breathing room**.
- **No new visual container language** — lean on space + alignment, not borders.

**RULING (Verse) — warm tokens (bind to semantic tokens, never raw hex, never `--accent-blue`):**
- Active-tab indicator + drag border + wash → **`--accent-orange`** (+ `--accent-orange-soft-bg` / `-soft-text` / `-hover`).
- Softer wash / hairline where it fits → **`--nav-tint-focus`** (warm sun) or **`--border-hairline-warm`**.
- **Scope discipline (Verse flag):** `--accent-blue` is the documented global interactive/active primary (UI-consistency pass; warm/pink reserved for weekly shutdown). "Warm, never blue" here is a **deliberate LOCAL exception** for the attachments surface. Keep warm accents **inside the tab switcher + drop overlay + dates row ONLY** — they must NOT leak into other detail-panel controls. (Per Nick's brief item 5 this is scoped to "these controls" — intended.)

## Accessibility (Verse build-time notes)
- Tabs are real tabs → `role="tablist"` / `role="tab"` / `role="tabpanel"` + **arrow-key nav** between tabs.
- The "Drop to attach." overlay text is decorative → **`aria-hidden`**.

## Verse verdict (2026-07-07): APPROVED — presentational only, no bytes/schema
Settled decisions:
- §2 → **text list + type-icons** (no thumbnails; real thumbnails = future v3 w/ migration).
- §3 → full-panel drop **approved** with the required guards above (Files-gate, drag-depth + pointer-events:none, dragover/drop preventDefault, window-level navigation guard, reuse v1 ingest, switch-to-Attachments-on-reject).
- §4 → dates-shrink approved; eyes-on the `DateRangeField` popover anchor after collapse.
- Palette → `--accent-orange` family, scoped-local, never blue.
- **No DB/migration** (holds *because* thumbnails are deferred). Count = `attachmentsByOwner.get("<owner>:<id>")?.length` (already metadata, already loaded).

No re-plan owed. Build order: v1 lands (post-#42 rebase) → then this. Bring a **v3 plan** if/when thumbnails are worth a migration.
