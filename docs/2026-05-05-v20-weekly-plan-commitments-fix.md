# v20 — weekly_plan_commitments rebuild (v17 dev-DB drift recovery)

**Date:** 2026-05-05
**Branch:** `fix/v17-checksum-recovery`
**Root cause:** intermediate-v17 SQL was applied to one developer's dev DB
during M1-M6 weekly-planning iteration. The SQL committed in `748c01b`
(final v17) added a `<= 1440` upper bound to the `minutes` CHECK
constraint and a comment block that wasn't in the intermediate version.
sqlx-sqlite's checksum validation aborts every `Database.load()` call on
that one DB with `Migration(VersionMismatch(17))`, which prevents v18
onward from running. Universal rule now codified in
[`migration-discipline.md`](./migration-discipline.md).

---

## How we got here

The v17 migration introduced two tables for the weekly-planning feature.
During the M1-M6 iteration window (before `748c01b` was final), the
migration was applied to one developer's dev DB at intermediate bytes
that lacked the `<= 1440` upper bound. By the time the feature merged,
the SQL had been tightened — but the dev DB had already stamped the
intermediate-v17 checksum into `_sqlx_migrations.checksum`, which sqlx
validates against the source bytes on every load.

The first symptom: M2 (calendar) merged with v18 + v19 in the binary,
but the dev binary couldn't apply them because sqlx aborted at v17
checksum validation before reaching them. The visible error in the app
was `no such column: external_source` — a query against v18 columns
landing on a still-v17 schema.

The diagnosis path took longer than it should have. We went through
several wrong theories (stale cargo build, plugin path mismatch, race
on `Database.load()`) before patching the plugin locally with logging
and observing the actual failure mode: `Migration(VersionMismatch(17))`.
That patch was reverted before any commit; see "Audit trail" below.

## What changed structurally between intermediate-v17 and committed-v17

PRAGMA diff against the dev DB vs. a fresh DB with current source's
v17 applied:

```
Dev DB:    minutes INTEGER NOT NULL CHECK (minutes >= 0)
Committed: minutes INTEGER NOT NULL CHECK (minutes >= 0 AND minutes <= 1440)
```

Everything else — column names, types, nullability, defaults, PK
ordering, the `weekly_plan_project_status` table in full — was
identical. The structural drift is exactly one missing upper-bound
CHECK on `weekly_plan_commitments.minutes`.

## Why this matters even with zero current violators

Pre-flight on the dev DB confirmed zero rows currently violate the new
CHECK (`max(minutes) = 50`, well within 1440). So the data is clean.
But the schema invariant assumed by all current TS code (`minutes <=
1440`) was silently weaker on this one machine. A typo in the H:MM
input that landed `9999` would have inserted cleanly on this DB and
been rejected on Cam's or Dan's. That divergence is the bug the
recovery closes.

## The fix — two parts

### 1. v20 migration (this PR)

Standard SQLite rebuild idiom — there's no `ALTER TABLE … ADD CHECK`.
The migration creates a fresh table with the correct CHECK, copies all
rows via `INSERT-SELECT`, drops the old table, renames the new one
into place. See `src-tauri/src/lib.rs` v20 entry for body + comments.

Key design choices:

- **No `WHERE` clause on `INSERT-SELECT`.** Filtering rows would
  silently delete data on machines we haven't pre-flighted. If a row
  violates the new CHECK, `INSERT` fails inside sqlx's implicit
  transaction, the entire rebuild rolls back, and the user gets a
  loud error. Pre-flight on this dev DB returned zero violators (see
  verification below).
- **No `PRAGMA foreign_keys = OFF`.** Verified on a fresh DB with
  `foreign_keys = ON` set: rebuild succeeds, `foreign_key_check` is
  clean. `weekly_plan_commitments` has only outbound FKs (→ projects),
  so the toggling SQLite §7 prescribes for inbound-FK cases isn't
  needed here.
- **No index/trigger preservation logic.** The only index is the
  implicit `sqlite_autoindex_weekly_plan_commitments_1` from the
  PRIMARY KEY clause, auto-recreated by the new `CREATE TABLE`. No
  explicit indexes or triggers were defined in v17; verified via
  `SELECT type, name FROM sqlite_master WHERE tbl_name = 'weekly_plan_commitments'`.

On a DB where v17 was applied at the committed bytes (Cam's, Dan's,
any future developer's first-time setup), v20 is a structurally-
equivalent rebuild — same schema in, same schema out. Idempotent.
Wasted I/O, no functional change.

### 2. v17 checksum realignment (one-time, dev DB only)

sqlx validates every applied migration's checksum on every
`Database.load()`. With the wrong v17 checksum stored, sqlx aborts
*before* reaching v20, so v20 can't fix the schema. We need to
realign the stored checksum first.

`scripts/check-v17-checksum.py` handles this:

- Read-only by default. Compares stored v17 checksum against SHA384
  of current source's v17 SQL. Prints "no fix needed" if equal.
- With `--apply`, runs a single `UPDATE _sqlx_migrations SET checksum
  = ? WHERE version = 17` to realign. The new checksum is computed
  from current source bytes, not fabricated.
- Cam and Dan run it as a no-op. Only this dev DB needs the actual
  write.

This is the same intent as `eb154ad` (force source/DB checksum
agreement after byte drift), but applied DB-side rather than source-
side because the original applied bytes are lost.

## Verification trail (this DB, 2026-05-05)

1. **Schema diff** — `weekly_plan_commitments.minutes` CHECK on dev
   DB lacks `<= 1440` upper bound. All other schema elements match.
2. **Pre-flight count** — `SELECT COUNT(*) FROM weekly_plan_commitments
   WHERE minutes > 1440 OR minutes < 0` → 0. Total rows: 5, max
   minutes: 50.
3. **FK-on rebuild test** — fresh DB with `foreign_keys = ON`,
   v17-then-v20 sequence, all rows preserved, `foreign_key_check`
   clean, post-rebuild `INSERT VALUES (..., 9999)` correctly fails
   with `CHECK constraint failed: minutes >= 0 AND minutes <= 1440`.
4. **Diagnostic script smoke test** — runs read-only on dev DB, detects
   drift, prints proposed UPDATE, exits 1 without `--apply`.

## Audit trail (debugging artifacts, all reverted before commit)

Two transient instrumentation paths were used during diagnosis. Both
removed before any commit:

- **Local plugin patch.** Copied `tauri-plugin-sql 2.3.2` from cargo
  registry to `/tmp/tauri-plugin-sql-debug`, added `eprintln!` to
  `commands::load`, wired via `[patch.crates-io]` in `Cargo.toml`. This
  produced the `Migration(VersionMismatch(17))` error message that
  identified the root cause. Reverted: directory deleted, `[patch]`
  block removed from `Cargo.toml`. Confirmed via filesystem audit
  that no third-party sources are modified in the working tree.
- **Cargo.lock dependency upgrade.** Removing the `[patch]` line let
  cargo re-resolve `tauri-plugin-sql` against `^2.3.2`, bumping the
  lock from `2.3.2 → 2.4.0` plus a new `rust_decimal` transitive.
  Reverted via `git checkout HEAD -- src-tauri/Cargo.lock`. The 2.4.0
  upgrade may be revisited as its own deliberate PR with separate
  review. It is not bundled here.

## Things explicitly NOT in this PR

- StrictMode `Database.load()` race fix. Observed only on patched
  plugin; logging changes timing. Filed as a hypothesis to
  reproduce-or-retract later. No clean-tree evidence yet.
- `tauri-plugin-sql 2.3.2 → 2.4.0` upgrade. Caught and reverted
  during this work; deserves its own PR.
- M3 (calendar Settings UI). Held until v17/v20 lands and the dev
  DB shows v17 (correct checksum) + v18 + v19 + v20.

## How to recover on this dev DB after merge

```bash
# 1. Diagnose (read-only)
python3 scripts/check-v17-checksum.py

# 2. Apply the checksum realignment
python3 scripts/check-v17-checksum.py --apply

# 3. Launch dev — sqlx now validates v17, applies v18 + v19 + v20
npm run tauri dev

# 4. Verify final state
sqlite3 ~/Library/Application\ Support/com.verseday.app/verseday.db \
  "SELECT version FROM _sqlx_migrations ORDER BY version;"
# expect: 1 through 20

sqlite3 ~/Library/Application\ Support/com.verseday.app/verseday.db \
  "SELECT sql FROM sqlite_master WHERE name = 'weekly_plan_commitments';"
# expect: CHECK includes "minutes <= 1440"
```
