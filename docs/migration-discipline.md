# Migration discipline

**Once a migration's SQL has been applied to any DB anywhere — even a single
dev DB — its source bytes are frozen. Schema changes go in the next migration.**

That's the rule. The rest of this doc is why and how.

---

## Why

`tauri-plugin-sql` (sqlx-sqlite under the hood) stores a SHA384 checksum of
each migration's SQL string in `_sqlx_migrations.checksum` at the moment the
migration is applied. On every subsequent `Database.load()`, sqlx validates
each already-applied migration's stored checksum against the SHA384 of the
current source's SQL. If any historical migration's bytes have drifted —
even by one whitespace character — sqlx aborts the entire migration run with
`Migration(VersionMismatch(<version>))`. New migrations don't apply. The app
boots into a half-state where the binary expects schema vN but the DB is at
vN-k.

This isn't a sqlx quirk to work around. It's a feature: it forces source
and DB to agree on the history of every change. Without it, two developers
could apply different SQL with the same migration version and silently
diverge.

The cost of maintaining this invariant is one extra migration per "I want
to fix that wording / add a missing CHECK / clean up that whitespace."
That cost is much smaller than the recovery cost when it breaks. See
`docs/2026-05-05-v20-weekly-plan-commitments-fix.md` for the recovery
incident that motivated this rule.

## What "applied" means

A migration's bytes are frozen as soon as **any** of these is true:

- It's been merged to `main`.
- It's been pushed to a shared branch that another developer has pulled.
- It's been applied to your local dev DB during normal `tauri dev` use.

The third bullet is the easy one to forget. If you're iterating on a
migration during M1 of some feature — running `tauri dev`, applying it,
deciding the SQL needs an upper-bound CHECK, editing the SQL, restarting —
you've already poisoned your local checksum. Once that happens, the path
back is either:

1. Wipe your local DB and reapply from scratch (loses real data), or
2. Write a corrective migration vN+1 that brings the schema into agreement
   with the new vN source bytes (requires a one-time `_sqlx_migrations`
   checksum update on dev DBs that had the intermediate-vN drift).

## How to iterate on a migration without poisoning your DB

While drafting a new migration:

- Iterate against a `mktemp` SQLite, not the dev DB. Apply v17 from current
  source to the temp DB, then run your work-in-progress vN against it.
- Only apply against the dev DB after Verse review and final SQL is locked.
- If you've already applied work-in-progress to the dev DB, restore from a
  pre-migration snapshot before merging.

## When a migration must change post-application

Don't edit the source. Write the next migration:

- vN+1 explicitly transforms vN's schema to the desired shape.
- Use SQLite's standard rebuild idiom for tables that need new CHECK
  constraints, column type changes, or PRIMARY KEY shape changes:
  `CREATE TABLE new (...) → INSERT-SELECT FROM old → DROP old → ALTER RENAME`.
- The rebuild idiom for a table with only outbound FKs (no inbound
  references) is safe under the runtime's `foreign_keys = ON` (sqlx's
  default; verified empirically — see the audit-remediation plan). Verify
  `foreign_key_check` is clean on a fresh DB before merging.
- **Do NOT** try to disable enforcement by prepending
  `PRAGMA foreign_keys = OFF;` to a migration body: **that PRAGMA is a no-op
  inside a transaction**, and sqlx wraps every migration in one, so it
  silently does nothing (#12). If a table has INBOUND FKs and you must
  rebuild it, you cannot toggle enforcement mid-migration. Use one of:
  (a) `PRAGMA legacy_alter_table = ON` + the standard 12-step table-rebuild
  procedure (which is safe with FKs on), or (b) `PRAGMA foreign_keys` set at
  the connection level *before* migrations run (outside any transaction).
  Whichever you pick, run `foreign_key_check` after and confirm it's clean.
- Pre-flight any data loss: query for rows that will violate the new
  CHECK before merging, surface the count, get explicit acknowledgment.
  Do **not** add `WHERE` clauses to the INSERT-SELECT that silently drop
  rows. Let the new CHECK be the loud guardrail.
- Document the incident in `/docs/<date>-vN-<topic>.md` if a checksum
  divergence is involved, so future developers can trace the trail.

## When the rule is allowed to bend

Almost never. The few legitimate cases:

- **Same-day, never-applied:** the migration was committed within the
  current dev session and you are the only person with a binary that ran
  it. Wipe your DB, edit the SQL, reapply. This is the only safe edit-
  in-place case, and it's distinguishable from the unsafe case only
  because you can prove no other DB has applied this migration.
- **Mechanical reformatting via tooling that all developers run on
  identical input.** Theoretically safe; in practice this never happens
  for SQL strings because Rust formatters don't touch string contents.

If you're uncertain, the answer is "write the next migration." The cost
is small.
