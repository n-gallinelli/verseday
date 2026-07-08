# Built-in VerseDay logo as an objective icon

**Branch:** `feat/verseday-logo-objective-icon`
**Date:** 2026-07-08
**Status:** built + previewed; shipped on Nick's "install all".

## Intent

Make the VerseDay app logo a first-class, always-available icon choice for an
objective (project), so it can be picked without hunting for / re-uploading an
image.

## Context (icon system)

The app has **no** emoji/glyph catalog. An objective's icon
(`ProjectGlyph.tsx`) resolves in order: uploaded custom image
(`custom_icon_id` → PNG data-URI row in the `custom_icons` table) → emoji
string (`projects.icon`) → color-dot fallback. Custom images already flow
through `createCustomIcon()` (INSERT, no DDL) and render as an `<img>`.

## Change

- **`src/utils/versedayIcon.ts`** (new) — the signed app logo
  (`src-tauri/icons/128x128.png`) inlined as `VERSEDAY_ICON_DATA_URI` (PNG
  data-URI). Trusted first-party static asset, so it's stored directly via
  `createCustomIcon()` rather than the untrusted-upload re-encode in
  `fileToIconDataUri` (that pipeline exists to sanitize user images).
- **`ProjectIconPicker.tsx`** — new **"Built-in"** section with a "VerseDay
  logo" tile. `pickVerseday()` dedupes by `data` (reuses an existing
  `custom_icons` row if one already holds the logo) else seeds one, then
  persists via the normal `onPick(null, id)` → `custom_icon_id` path. Shows a
  blue selection ring when it's the active icon.

No schema change, no migration, no new deps, no new render "kind" — it rides
the existing custom-image path. `tsc` + debug build clean; previewed.
