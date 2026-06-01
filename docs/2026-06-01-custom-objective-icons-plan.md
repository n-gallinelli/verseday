# Custom objective icons — Terse Plan

**Date:** 2026-06-01
**Status:** PLAN — awaiting review. No code until approved.

## Goal
Attach an icon to an objective (project): either a **standard emoji** or a
**custom uploaded image**, shown before the project name everywhere — replacing
the current "lead the name with an emoji" convention with a real field.

## Data model
- **`projects.icon TEXT` (nullable)** — holds one of:
  - an emoji grapheme (e.g. `"🍾"`), or
  - `"custom:<id>"` referencing an uploaded image, or
  - `NULL` (no icon → today's color dot only).
- **New table `custom_icons`** (reusable library so one upload can be used on
  many objectives): `id INTEGER PK, data TEXT NOT NULL, created_at TEXT`.
  `data` = a small PNG **data URI** (resized to ≤64×64, target <~30KB).
- **Migration 24** (next version after the current 23 — a NEW migration;
  applied migrations stay frozen per the discipline rule):
  `ALTER TABLE projects ADD COLUMN icon TEXT;` + `CREATE TABLE custom_icons(...)`.

## Upload (no new native plugin, no cost)
A hidden `<input type="file" accept="image/*">` in the webview (works in the
Tauri WKWebView). On select: draw to a canvas at max 64×64 (preserve aspect),
`toDataURL("image/png")`, size-guard, insert into `custom_icons`. Avoids
`plugin-dialog`/`plugin-fs` — pure web APIs. Base64-in-DB keeps it simple and
travels with the DB backup.

## Picker UI (ProjectDetail header, beside the color dot)
A small icon button (shows current icon / placeholder). Click → popover with:
1. an emoji field — type or use the macOS emoji picker (Cmd-Ctrl-Space) for any
   standard emoji;
2. the custom-icon **library** grid (previously uploaded);
3. an **Upload** button (adds to library + selects);
4. a **Remove** option (icon → NULL).
Writes `projects.icon` via the existing `updateProject` path.

## Display surfaces
Render the icon before the name wherever a project shows: resolve an emoji
directly, or a `custom:<id>` to an `<img>` from the loaded icon library.
Surfaces (same set as the project-propagation holders): ProjectPicker
(trigger + dropdown), ProjectDetail header, Projects list, and the task-card
project tooltip. The custom-icon library is loaded once and refreshed on a
`verseday:icons-changed` broadcast (mirrors `verseday:project-changed`).

## Phasing (recommended)
- **P1:** migration + `custom_icons` + `projects.icon`; ProjectDetail picker
  (emoji + upload + library); render in ProjectPicker + Projects list. This
  delivers the core: set an icon, see it where you assign objectives.
- **P2:** render on task cards / summaries; library management (delete an
  uploaded icon).

## Validation
`tsc` + build + the migration applies cleanly on a fresh DB and on the current
DB (test:skip-migration discipline). Manual: upload an image → it resizes,
saves, and shows; pick an emoji → shows; remove → back to dot. (Upload/canvas
is hard to unit-test; I'll verify in the running app.)

## Decisions to confirm before building
1. **Scope of P1** as above (set in ProjectDetail + show in picker/list), P2
   later — or do you want it everywhere at once?
2. **Existing name-prefix emojis** (e.g. "🍾 Increase…"): leave as-is (this is a
   new optional field; don't auto-migrate the emoji out of names), correct?
   Auto-detecting/stripping a leading emoji from names is heuristic and risky —
   I recommend NOT doing it; you can move them to the icon field manually.
3. **Storage**: base64-in-DB (recommended, simple) vs files on disk. OK with
   base64 at ≤64px?
4. **No money cost** — local only, no new deps. Confirm acceptable.
