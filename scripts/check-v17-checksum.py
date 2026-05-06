#!/usr/bin/env python3
"""Diagnose / correct v17 sqlx checksum drift on a dev DB.

Background: see /docs/2026-05-05-v20-weekly-plan-commitments-fix.md.
The short version is that intermediate-v17 SQL was applied to one
developer's dev DB during M1-M6 weekly-planning iteration; the SQL
shipped on main (748c01b) differs by one CHECK constraint and a
comment block, so sqlx-sqlite's checksum validation aborts at v17
on every Database.load() — preventing v18 onward from running.

This script is read-only by default. It compares the v17 checksum
stored in `_sqlx_migrations` against the SHA384 of the current
source's v17 SQL. If they match, your DB is consistent — no fix
needed. If they differ, the script prints the proposed UPDATE and
exits non-zero. Pass `--apply` to actually run the UPDATE.

The corrective UPDATE realigns the stored checksum with current
source bytes. The schema drift itself is fixed by v20 (which runs
automatically on next `tauri dev` once the checksum gate clears).

Usage:
    python3 scripts/check-v17-checksum.py            # read-only
    python3 scripts/check-v17-checksum.py --apply    # run the UPDATE
    python3 scripts/check-v17-checksum.py --db PATH  # override DB path
"""
import argparse
import hashlib
import re
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
LIB_RS = REPO_ROOT / "src-tauri" / "src" / "lib.rs"
DEFAULT_DB = (
    Path.home() / "Library" / "Application Support" / "com.verseday.app" / "verseday.db"
)
TARGET_VERSION = 17


def extract_v17_sql_from_source() -> str:
    """Pull the exact bytes of v17's `sql:` field from lib.rs.

    sqlx-sqlite computes the migration checksum over the SQL string
    bytes verbatim, so this must produce the same string the Rust
    compiler embeds in the binary — including leading whitespace and
    the trailing whitespace inside the closing quote.
    """
    src = LIB_RS.read_text()
    # Match: `version: 17,` followed (anywhere later, but inside the same Migration{}) by `sql: "..."`,
    # non-greedy so we stop at the first closing `",` after v17.
    pat = re.compile(
        r"version:\s*17\s*,.*?sql:\s*\"(.*?)\"\s*,",
        flags=re.DOTALL,
    )
    m = pat.search(src)
    if not m:
        sys.exit("error: couldn't locate v17 sql block in lib.rs")
    return m.group(1)


def hex_to_blob_literal(hex_str: str) -> str:
    """Format hex bytes for a SQLite BLOB literal: X'...' (uppercase)."""
    return f"X'{hex_str.upper()}'"


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--apply", action="store_true", help="run the UPDATE (default: read-only)")
    p.add_argument("--db", default=str(DEFAULT_DB), help=f"DB path (default: {DEFAULT_DB})")
    args = p.parse_args()

    db_path = Path(args.db)
    if not db_path.exists():
        sys.exit(f"error: DB not found at {db_path}")

    sql_bytes = extract_v17_sql_from_source().encode()
    expected = hashlib.sha384(sql_bytes).hexdigest().upper()

    conn = sqlite3.connect(str(db_path))
    try:
        row = conn.execute(
            "SELECT hex(checksum) FROM _sqlx_migrations WHERE version = ?",
            (TARGET_VERSION,),
        ).fetchone()
        if row is None:
            print(f"v{TARGET_VERSION} not yet applied to this DB — nothing to check.")
            return 0
        stored = row[0]

        if stored == expected:
            print(f"v{TARGET_VERSION} checksum matches current source. No fix needed.")
            return 0

        print(f"v{TARGET_VERSION} checksum DRIFT detected.")
        print(f"  stored:   {stored}")
        print(f"  expected: {expected}")
        print()
        print("Proposed UPDATE (run with --apply to execute):")
        print(
            f"  UPDATE _sqlx_migrations SET checksum = {hex_to_blob_literal(expected)} "
            f"WHERE version = {TARGET_VERSION};"
        )
        print()

        if not args.apply:
            print("Re-run with --apply to commit the change.")
            return 1

        conn.execute(
            "UPDATE _sqlx_migrations SET checksum = ? WHERE version = ?",
            (bytes.fromhex(expected), TARGET_VERSION),
        )
        conn.commit()
        # Re-read for confirmation.
        row = conn.execute(
            "SELECT hex(checksum) FROM _sqlx_migrations WHERE version = ?",
            (TARGET_VERSION,),
        ).fetchone()
        if row[0] == expected:
            print(f"✓ Updated. Stored checksum now matches current source.")
            print(f"  Next `tauri dev` will validate v{TARGET_VERSION} cleanly and apply v18+v19+v20.")
            return 0
        sys.exit(f"error: post-write checksum is {row[0]}, expected {expected}")
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
