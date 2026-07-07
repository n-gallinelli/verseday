# Attachments — decision record & changelog

**Feature:** Files/screenshots on Task details and Objective (Project) details.
**Branch:** `feat/attachments` · **Migration:** v27 · **Status:** BUILT, awaiting Verse code/diff review. Migration NOT yet applied to any DB (version-freeze gate).

## Decisions (post Verse plan-approval)

### D1 — Storage: base64 data-URI in a dedicated `attachments` table
Corrected rationale (per Verse): the choice is **transport-forced**, not an appeal to the `custom_icons` precedent (icons are ~1000× smaller). tauri-plugin-sql returns rows as JSON over IPC, which can't carry raw BLOBs efficiently (they arrive as int arrays, ~6–7× bloat), so base64 TEXT is the pragmatic representation — and it keeps durability as a **single atomic DB backup/restore**. Disk storage (Option B) would split durable state across the DB + loose files that can desync from a restored DB — a real regression for a recovery-via-DB app.

### D2 — Blob read discipline (Verse C1/C2)
- `attachments.data` is read by exactly **one** function: `getAttachmentData(id)`, used only in the open/preview path.
- Every list query (`getAttachmentsForTask` / `getAttachmentsForProject`) and the store slice carry **metadata only** (`id, owner, filename, mime, size_bytes, created_at`). No blob ever rides a detail-hydration query.
- The UI shows a **chip list, not thumbnails** — deliberately, to avoid the read amplification of pulling every blob to render a grid. Inline thumbnails are a possible follow-up (would need an on-demand, capped fetch), flagged for Verse/Nick.

### D3 — Orphan cleanup: app-layer, not FK cascade (Verse C2/C3)
`ON DELETE CASCADE` is kept in the DDL as documented intent, but is **not relied upon** — tauri-plugin-sql pools connections with `PRAGMA foreign_keys` off. Deletion is handled explicitly in the app layer.

### D4 — Binding identity (Verse C3)
An attachment binds to a **concrete, persistent row** via `task_id` XOR `project_id` (enforced by the DDL `CHECK`). Consequences across the task lifecycle:

| Path | File:site | Behavior |
|---|---|---|
| Single task delete | `queries.ts` `deleteTask` | `DELETE FROM attachments WHERE task_id = ?` before the task row is removed. |
| Recurring-sibling **merge** | `queries.ts` `updateTaskDateScheduled` (shell delete) | Attachments on merged-away shells are **re-parented to the keeper** (`UPDATE attachments SET task_id = <keeper>`) before the shells are deleted — same non-lossy move as notes/time_entries. A screenshot survives a recurring merge. |
| Recurring **generation / rollover** | `queries.ts` generate loop | INSERT-only; **never deletes** task rows, so it can neither drop nor leak attachments. Instances are distinct persistent rows; an attachment stays on the exact instance it was added to. |
| Objective delete | `queries.ts` `deleteProject` | `DELETE FROM attachments WHERE project_id = ?`. Tasks of that project survive with `project_id` nulled; their task-bound attachments ride along untouched. |

### D5 — Opening files (Verse C4/C5/C6)
Non-image files are materialized to `$TMPDIR/verseday-attachments/` and handed to the OS by the `open_attachment` Rust command. No new Tauri plugin/capability — `open`/`open -R` via `std::process::Command` (macOS), path passed as discrete argv (no shell). Safeguards:
- **C4** filename sanitized to `"<id>-<sanitized>"`; separators/`..` stripped, leading dots/spaces trimmed, length-clamped. Raw stored name never written verbatim.
- **C5** bytes only ever land under the app-private temp subdir.
- **C6 / B1** the open-vs-reveal decision is an **allowlist**, not a denylist (Verse B1): only known-inert document/media extensions (pdf, txt/rtf/md/csv/json/xml, office, iWork, images, audio, video) are handed to `open`. **Everything else** — executables, scripts, installers (`.pkg/.mpkg/.dmg`), location files (`.webloc/.inetloc/.fileloc/.url`, an `open`-follows-target RCE vector), archives, unknown/extensionless — is **revealed in Finder**, never launched. An allowlist is durable: it doesn't rot when Apple adds a new launchable type. Decision is by **extension**, not the caller-supplied mime. `.svg` is deliberately excluded (would open in a browser where its script can run).

Images never touch disk — they preview in an in-app lightbox that fetches the single blob on demand and discards it on close.

### D6 — Immutability
Attachments are create/delete only. No `updated_at`, no edit path — confirmed with Verse.

## Migration gate (Verse)
Bytes freeze on first apply, including any dev DB. **v27 has NOT been applied** — the app has not been launched against a DB since the migration was written (validated via `tsc` + `cargo check` + `vite build`, none of which run migrations). Before first launch: confirm PR #42 (which also wants v27) has not merged; if it has, renumber to **v28** first.

## Follow-up tickets (Verse non-blocking notes)
- **Temp-file lifetime (privacy):** decoded attachments linger in `$TMPDIR/verseday-attachments/` after open/reveal. Can't unlink immediately after `open` (it returns once the file is *launched*, before the target app reads it — a race). Right fix is a **sweep on app launch** (mirroring `prune_backups`), not an inline unlink. Ticketed, not done.
- **Aggregate-size guardrail:** only a per-file 10 MB cap exists. Fine for single-user; revisit if the DB/backup growth becomes real (see D1).

## Changelog
- `src-tauri/src/lib.rs` — migration v27 (`attachments` table + indices); register `open_attachment`.
- `src-tauri/src/commands.rs` — `open_attachment` command + `sanitize_filename` / `extension_of` / `platform::open_or_reveal`.
- `src-tauri/Cargo.toml` — add `base64 = "0.22"`.
- `src/types/index.ts` — `Attachment`, `AttachmentOwnerType`.
- `src/db/queries.ts` — attachment CRUD + `getAttachmentData`; cleanup/re-parent in `deleteTask` / `updateTaskDateScheduled` / `deleteProject`.
- `src/stores/appStore.ts` — `attachmentsByOwner` slice + `loadAttachments` / `addAttachment` / `removeAttachment`; project-delete slice eviction.
- `src/utils/attachmentUpload.ts` — File→payload (10 MB cap pre-read), clipboard image extraction.
- `src/components/AttachmentsSection.tsx` — shared section (both surfaces).
- `src/components/TaskDetailOverlay.tsx`, `src/pages/ProjectDetail.tsx` — mount the section below Notes.
