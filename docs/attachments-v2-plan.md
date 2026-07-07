# Attachments v2 — tabbed panel, full-panel drop, box removal, dates shrink

**Author:** Terse (from Nick's brief) · **Date:** 2026-07-07 · **Status:** QUEUED — plan only, NO code. Build **after** (a) v1 attachments lands (post-#42 rebase, see `attachments-decisions.md`) and (b) Verse approves THIS plan.
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

**Open Q (Verse/Nick):** thumbnail grid reintroduces the C1 read-amplification tension (blobs per thumbnail). v1 chose chips-no-thumbnails deliberately. If v2 wants thumbnails, we need an on-demand, capped/lazy thumbnail fetch (NOT in the hydration query, NOT cached in the store) — spec that explicitly and get Verse sign-off, or keep it a text list.

## 3. Full-panel drag-over drop confirmation (the core ask)
Drag a file **anywhere over** the task/objective detail panel → the **entire panel** responds (not a small zone):
- On drag-enter: overlay panel content with a **warm-tinted translucent wash**, a **warm accent border just inside the panel edge**, and centered text "**Drop to attach.**"
- On drag-leave / drop: overlay **fades out 150–200ms**.
- Whole panel is the target — no aiming at a box.
- Works **regardless of active tab**; dropping while on **Notes auto-switches to Attachments** so the user sees the result land.

**Impl notes:** attach `onDragEnter/Over/Leave/Drop` at the panel root (the overlay container in each detail component). Guard against child drag-leave flicker (use a drag-depth counter or `relatedTarget`/`pointer-events`). Route dropped `DataTransfer.files` through the existing `fileToAttachmentPayload` + `addAttachment(...)` path (reuse, don't duplicate). `preventDefault` on dragover to allow drop. Respect the 10 MB cap + error surface already in the ingest path. Ensure the overlay doesn't hijack drags targeting the Notes `RichTextEditor` when a drag is text, not files (check `DataTransfer.types` includes `Files`).

## 4. Shrink the Dates control on the objective panel
`ProjectDetail.tsx` right rail — the "Set dates" control currently sits in an oversized dashed container (`DateRangeField` wrapper).
- Collapse to a **single compact inline row**: small calendar icon + "Set dates" as plain tappable text — or the range once set, e.g. `Jul 7 – Jul 14` — on one line. No dashed box, no large padding.
- Should read like the **task panel's date row**, not a drop target.
- Reclaimed height lets **"This week"** breathe back into the right rail.

**Impl note:** match the Task panel's date-row treatment for consistency; verify the `DateRangeField` popover still positions correctly (see `project_calendar_popover_clipped` — offsetHeight/reposition guard).

## 5. General / non-negotiables
- Warm sunset palette throughout (tab indicator, drag border, drag wash) — **never system blue**.
- Generous, consistent spacing; **fewer visible boxes, more breathing room**.
- **No new visual container language** — lean on space + alignment, not borders.

## Verse review checklist (plan gate)
- Thumbnail-vs-text-list decision for §2 given the C1 blob-read constraint (biggest architectural call here).
- Full-panel drop handler not interfering with `RichTextEditor` text drags / paste (§3).
- Confirm warm accent token (no `--accent-blue`), per the palette rule.
- No DB / migration changes (this is presentational + a store-count read) — confirm none needed.
- Auto-switch-to-Attachments-on-drop UX + crossfade timing.
