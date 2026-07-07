# Attachments — decision record & changelog

**Feature:** Files/screenshots on Task details and Objective (Project) details.
**Branch:** `feat/attachments` (merged origin/main incl. #42) · **Migration:** **v28**, contiguous after #42's v27 · **Status:** Code Verse-APPROVED; #42 merged 2026-07-07 → merged into branch → **v28 applied cleanly (success=1), attachments table live**; data + migration runtime-verified. Remaining: human UI click-tests + open PR.

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

## Migration merge-order gate (Verse ruling 2026-07-07)
**✅ RESOLVED 2026-07-07 via path A:** #42 merged to main first (v27) → `git merge origin/main` into feat/attachments → resolved the `lib.rs` migration-vec conflict to contiguous `26, 27(#42), 28(attachments)` → v28 applied cleanly to the real DB (`success=1`). No hole, no out-of-order risk. History below kept for the record.

**The migration number follows MERGE ORDER into main — not the current state of origin/main, and not a local dev-run.** A dev-run that applied PR #42's v27 to one machine contaminates *that machine*; it does **not** freeze v27 on main. Byte-freeze is per-migration-content on whatever DB it touched; the *version integer we ship* is set by which PR merges first.

**Current state:** branch @e37c999 defines migrations `[1..26, 28]` — a **hole at 27**. That is safe **only** under path (A) below. Byte-freeze is clean: sqlx's `VersionMissing(27)` aborted the run before writing `_sqlx_migrations`, so nothing applied and the v28 bytes are not frozen — the integer is still free to change.

**Invariant (hard gate at merge):** at merge time, feat/attachments' migration list must be **gap-free relative to main**. Pick one end-state:

- **(A) Merge AFTER #42 — stays v28 [Nick's choice].** Valid **only after rebase** onto a main that carries #42's v27. The rebase closes the hole → contiguous `26, 27(#42), 28(attachments)`, v28 applies cleanly, and the contaminated dev DB heals (its applied v27 matches #42's checksum). **Do NOT merge the v28-hole branch while v27 is undefined on it** — if it merged first, #42 later merging as v27 would be an out-of-order migration below the high-water mark → tauri-plugin-sql/sqlx (no ignore-missing/out-of-order allowance) **hard-errors on existing users' next launch**, and #42's `suppressed_cycle_date` silently never applies. Shipped production break.
- **(B) Merge BEFORE #42 — revert to v27.** Revert e37c999 → attachments = v27, merge first; #42 then rebases to v28. No wait, no hole.

Either is correct; the **only** danger is a mismatch between the branch's number and the actual merge order.

**Merge checklist:** #42 merges → rebase feat/attachments on main → confirm migration list is contiguous (`26, 27, 28`) → app-launch verify (v28 applies) → human UI clicks → PR (not direct push, per push-authorization rule).

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
