# Attachments for Task & Objective details — Plan

**Author:** Terse · **Date:** 2026-07-07 · **Branch:** `feat/attachments` · **Status:** AWAITING VERSE REVIEW (no code written yet)

## Goal
Let the user attach files and screenshots to a **Task**'s details and an **Objective (Project)**'s details. Attachments live in their **own section**, distinct from Notes.

## Scope (v1)
- Add files/screenshots via a file-picker button **and** paste (Cmd+V of a clipboard screenshot).
- Images render as thumbnails; click → in-app lightbox.
- Non-image files render as a chip (name + size); click → open in the OS default app.
- Delete an attachment.
- Works identically on Task details and Objective details via one shared component.
- **No cost — fully local. Nothing leaves the machine.**

Out of scope (v1): drag-and-drop, reordering, renaming, folders, cross-device sync.

## Key architecture decision — where bytes live

| | **A) base64 data-URI in SQLite** *(recommended)* | B) Files on disk (app data dir) |
|---|---|---|
| Durability | **Inherited free** — attachments ride the existing launch-time DB backup (5 snapshots) | Attachments fall **outside** the backup system (durability gap) |
| Precedent | Exact match to `custom_icons` (v25) — proven pattern | New pattern |
| New plugins | **None** | Needs raw-`std::fs` read/write commands (or `fs`/`dialog` plugins) |
| Downside | DB + every backup snapshot grow with attachment bytes | More Rust; attachments not backed up |

**Recommendation: Option A (base64-in-DB).** It inherits the durability guarantees Nick already cares about, matches the `custom_icons` precedent exactly, and adds zero new plugins/capabilities. Mitigations for DB bloat: a **separate `attachments` table** (blob TEXT never drags task/project queries), and a **per-file size cap (proposed 10 MB)**. If bloat becomes real later, migrating A→disk is a contained change.

**The one thing Option A makes awkward:** opening a *non-image* file back out to the OS. Solved with a tiny `open_attachment` Rust command (writes bytes to the OS temp dir, opens with `tauri-plugin-opener` — already installed). Raw `std::fs`, no new plugin. Images avoid this entirely (previewed in-app).

## DDL — migration v27 (ROUTE THROUGH VERSE; bytes freeze on first apply)

```sql
CREATE TABLE IF NOT EXISTS attachments (
  id          INTEGER PRIMARY KEY,
  task_id     INTEGER REFERENCES tasks(id)    ON DELETE CASCADE,
  project_id  INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  filename    TEXT    NOT NULL,
  mime        TEXT    NOT NULL,
  size_bytes  INTEGER NOT NULL,
  data        TEXT    NOT NULL,          -- base64 data-URI
  created_at  TEXT    NOT NULL,
  CHECK ((task_id IS NOT NULL) <> (project_id IS NOT NULL))  -- exactly one owner
);
CREATE INDEX IF NOT EXISTS idx_attachments_task    ON attachments(task_id);
CREATE INDEX IF NOT EXISTS idx_attachments_project ON attachments(project_id);
```

**Migration-number collision watch:** The unmerged early-completion branch (PR #42) is also slated to add a **v27** (`suppressed_cycle_date`). On current `main` the highest applied version is **v26**, so v27 is correct here — but whichever of the two branches merges second must bump to **v28** before its bytes are applied anywhere. Verse to note.

**Open item for Verse:** `ON DELETE CASCADE` only fires if `PRAGMA foreign_keys = ON` on the connection. tauri-plugin-sql does **not** guarantee this. To be safe regardless, the plan **also** deletes attachments explicitly in the app-layer task/project delete actions (belt-and-suspenders). Verse to confirm preferred approach.

## Modules (small, in order)
1. **Migration v27** — the DDL above in `src-tauri/src/lib.rs` (after Verse signs off on bytes).
2. **Query layer** — `src/db/queries.ts`: `createAttachment`, `getAttachmentsForTask`, `getAttachmentsForProject`, `deleteAttachment`; add explicit attachment cleanup to task/project delete paths.
3. **Upload util** — `src/utils/attachmentUpload.ts`: `File`/clipboard blob → validate (type allowlist? size cap) → base64 data-URI. (Unlike `iconUpload.ts`, no canvas re-encode — preserve original bytes for arbitrary files.)
4. **Store actions** — `src/stores/appStore.ts`: `attachmentsByOwner` state + `loadAttachments`, `addAttachment`, `removeAttachment` (optimistic write → DB → refetch truth, matching existing discipline).
5. **Shared UI** — `src/components/AttachmentsSection.tsx`: file-input button + paste handler, image thumbnail grid, non-image chip list, lightbox, delete. Reused by both surfaces.
6. **Open non-image** — small `open_attachment` Rust command (temp-write + `open`/`open -R`). *Implemented entirely Rust-side, so JS never calls open-path → **no capability change at all** (C5 scoping concern moot).*
7. **Wire-in** — drop `<AttachmentsSection ownerType="task" .../>` below Notes at `TaskDetailOverlay.tsx:909`, and `ownerType="project"` below Notes at `ProjectDetail.tsx:1403`.
8. **Docs** — decision record + changelog in `/docs`.

## Verse review checklist
- Migration v27 SQL (freeze-on-apply) — approve bytes.
- FK cascade vs app-layer cleanup for orphan prevention.
- Storage choice (A vs B) and 10 MB cap.
- File-type handling: any allowlist, or accept all? (Security: base64 blob is inert data; the only exec risk is the `open_attachment` temp-write path — filenames are app-sanitized, extension preserved.)
- CSP already allows `img-src 'self' data: blob:` — image previews render without CSP change. Confirm no change needed for non-image object/iframe previews (none planned in v1).
