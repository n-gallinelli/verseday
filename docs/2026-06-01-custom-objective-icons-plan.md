# Custom objective icons — Terse Plan

**Date:** 2026-06-01
**Status:** PLAN — awaiting review. No code until approved.

## Goal
Attach an icon to an objective (project): either a **standard emoji** or a
**custom uploaded image**, shown before the project name everywhere — replacing
the current "lead the name with an emoji" convention with a real field.

## Data model (REVISED per Verse — real FK, not a `"custom:<id>"` string)
Verse rejected overloading one TEXT column with `"custom:5"` (no referential
integrity; deleting an icon in P2 would orphan `<img>`s). Final shape:
- **`custom_icons`** library table: `id, data (PNG data URI ≤64×64), created_at`.
- **`projects.icon TEXT`** — an emoji grapheme, or NULL.
- **`projects.custom_icon_id INTEGER`** — FK → `custom_icons(id)` ON DELETE SET NULL.
- **Resolution order:** `custom_icon_id` set → render the image; else `icon`
  set → render the emoji; else → today's color dot.

### Migration #25 (literal DDL for sign-off)
Migration #24 is now taken (objectives priority column, shipped). The icon
migration is **#25**. The table is created BEFORE the ALTER that references it.
`created_at` is `NOT NULL` and stamped by the app at insert time
(`new Date().toISOString()`) — not a SQL default (sqlite's CURRENT_TIMESTAMP
format differs from our ISO convention elsewhere).

```sql
CREATE TABLE IF NOT EXISTS custom_icons (
  id INTEGER PRIMARY KEY,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL
);
ALTER TABLE projects ADD COLUMN icon TEXT;
ALTER TABLE projects ADD COLUMN custom_icon_id INTEGER REFERENCES custom_icons(id) ON DELETE SET NULL;
```

### foreign_keys PRAGMA caveat (handled, not assumed)
`tauri-plugin-sql`/sqlx default `PRAGMA foreign_keys = OFF` per connection, so
`ON DELETE SET NULL` may not fire automatically (the existing `objective_id …
ON DELETE SET NULL` at lib.rs:40 is likely decorative for the same reason). So
P2's delete-icon path will **explicitly** `UPDATE projects SET custom_icon_id =
NULL WHERE custom_icon_id = ?` before/with deleting the row — we do NOT rely on
the PRAGMA. The FK declaration stays as intent + safety if the PRAGMA is ever on.

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

## Verse binding conditions (folded in)
3. **Canvas re-encode is mandatory (security).** Never persist or render raw
   uploaded bytes — always `file → canvas → toDataURL("image/png")`, which
   re-rasterizes and strips any SVG/script payload. Add a **pre-decode file-size
   guard** (reject multi-MB inputs before decoding) so a huge image can't OOM
   the resize. Both are hard rules, not incidental.
4. **No icons on focus surfaces (P2).** "No projects on focus screens" stands —
   P2 must not bleed the objective icon onto FocusMode/FocusPip. Icons appear
   only where project name/color already does (ProjectPicker, ProjectDetail,
   Projects list, task-card tooltip).
5. **Library resolves everywhere.** Every surface that renders a
   `custom_icon_id` must have the icon library loaded and refresh on
   `verseday:icons-changed` — no stale per-screen copy that silently fails to
   show. (Load once via a shared fetch + broadcast, mirroring project-changed.)

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
