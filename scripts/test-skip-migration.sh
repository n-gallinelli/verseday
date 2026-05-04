#!/usr/bin/env bash
# Regression test for migration v15 — recurring_instance_skips table +
# the read-side template filter + skip-on-delete write path.
#
# Builds a temp SQLite DB with the subset of the production schema the
# v15 logic touches, exercises each fixture (A–F) against the exact SQL
# the application code uses, and asserts the right state survives.
#
# Usage: bash scripts/test-skip-migration.sh
# Requires: sqlite3 (bundled on macOS, ubiquitous on Linux).

set -euo pipefail

DB="$(mktemp -t verseday-skip-test.XXXXXX.db)"
trap 'rm -f "$DB"' EXIT

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

q() {
  sqlite3 "$DB" "$1"
}

# ── Schema (subset relevant to v15) ────────────────────────────────────────
sqlite3 "$DB" <<'SQL'
PRAGMA foreign_keys = ON;

CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo',
  date_scheduled TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  recurrence TEXT,
  recurrence_source_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL
);

CREATE TABLE recurring_instance_skips (
  recurrence_source_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  date_scheduled       TEXT NOT NULL,
  PRIMARY KEY (recurrence_source_id, date_scheduled)
);
SQL

# Helper: simulate deleteTask() — read row, conditionally insert skip,
# then delete. Mirrors src/db/queries.ts deleteTask exactly.
delete_task() {
  local id="$1"
  local row
  row=$(sqlite3 "$DB" "SELECT IFNULL(recurrence_source_id, 'NULL') || '|' || IFNULL(date_scheduled, 'NULL') FROM tasks WHERE id = $id;")
  local rec_source="${row%|*}"
  local sched_date="${row#*|}"
  if [ "$rec_source" != "NULL" ] && [ "$sched_date" != "NULL" ]; then
    sqlite3 "$DB" "INSERT INTO recurring_instance_skips (recurrence_source_id, date_scheduled) VALUES ($rec_source, '$sched_date') ON CONFLICT DO NOTHING;"
  fi
  sqlite3 "$DB" "PRAGMA foreign_keys = ON; DELETE FROM tasks WHERE id = $id;"
}

# ── Fixtures ───────────────────────────────────────────────────────────────
sqlite3 "$DB" <<'SQL'
-- Template with leaked date_scheduled (Bug A scenario from the field)
INSERT INTO tasks (id, title, recurrence, date_scheduled) VALUES
  (1, 'Recurring template (leaked date)', '{"freq":"daily"}', '2026-05-04');

-- Instance for today, generated from template id=1
INSERT INTO tasks (id, title, recurrence_source_id, date_scheduled) VALUES
  (2, 'Recurring template (leaked date)', 1, '2026-05-04');

-- Regular non-recurring task on the same date
INSERT INTO tasks (id, title, date_scheduled) VALUES
  (3, 'Regular task', '2026-05-04');
SQL

# ── A. Template excluded from "tasks for date AND recurrence IS NULL" ──────
visible_ids=$(q "SELECT GROUP_CONCAT(id) FROM tasks WHERE date_scheduled = '2026-05-04' AND recurrence IS NULL ORDER BY id;")
[ "$visible_ids" = "2,3" ] || fail "A: expected ids '2,3' (instance + regular), got '$visible_ids'"
echo "OK   A → template (id 1) filtered; instance + regular returned"

# ── B. Deleting an instance inserts a skip row ─────────────────────────────
delete_task 2
skip_row=$(q "SELECT recurrence_source_id || '|' || date_scheduled FROM recurring_instance_skips;")
[ "$skip_row" = "1|2026-05-04" ] || fail "B: expected skip (1, 2026-05-04), got '$skip_row'"
echo "OK   B → deleteTask(instance) inserted skip (1, 2026-05-04)"

# ── C. Generation pre-check skips when skip exists ─────────────────────────
# Re-run the exact SELECT generateRecurringInstances does before its INSERT.
skipped=$(q "SELECT COUNT(*) FROM recurring_instance_skips WHERE recurrence_source_id = 1 AND date_scheduled = '2026-05-04';")
[ "$skipped" = "1" ] || fail "C: pre-check should find skip, got count=$skipped"

# Simulate what generateRecurringInstances would do: if skip count > 0, continue
# (do NOT insert). Verify by running the conditional INSERT — must be a no-op.
sqlite3 "$DB" "INSERT INTO tasks (title, recurrence_source_id, date_scheduled, sort_order)
  SELECT 'should-not-appear', 1, '2026-05-04', 999
  WHERE NOT EXISTS (
    SELECT 1 FROM recurring_instance_skips
    WHERE recurrence_source_id = 1 AND date_scheduled = '2026-05-04'
  );"
inserted=$(q "SELECT COUNT(*) FROM tasks WHERE title = 'should-not-appear';")
[ "$inserted" = "0" ] || fail "C: NOT EXISTS guard should have prevented insert, got count=$inserted"
echo "OK   C → generation respects skip (no row inserted)"

# ── D. Deleting a template doesn't insert a skip ───────────────────────────
# Reset to a fresh template with no instance, no skip yet.
sqlite3 "$DB" "DELETE FROM tasks; DELETE FROM recurring_instance_skips;"
sqlite3 "$DB" "INSERT INTO tasks (id, title, recurrence) VALUES (10, 'Template only', '{\"freq\":\"daily\"}');"
delete_task 10
template_skips=$(q "SELECT COUNT(*) FROM recurring_instance_skips;")
[ "$template_skips" = "0" ] || fail "D: deleting a template should not insert skip, got count=$template_skips"
echo "OK   D → deleteTask(template) did not insert skip"

# ── E. Deleting a regular task doesn't insert a skip ───────────────────────
sqlite3 "$DB" "INSERT INTO tasks (id, title, date_scheduled) VALUES (20, 'Regular only', '2026-05-04');"
delete_task 20
regular_skips=$(q "SELECT COUNT(*) FROM recurring_instance_skips;")
[ "$regular_skips" = "0" ] || fail "E: deleting a regular task should not insert skip, got count=$regular_skips"
echo "OK   E → deleteTask(regular) did not insert skip"

# ── F. Cascade — deleting a template removes its skip rows ─────────────────
sqlite3 "$DB" "DELETE FROM tasks; DELETE FROM recurring_instance_skips;"
sqlite3 "$DB" <<'SQL'
PRAGMA foreign_keys = ON;
INSERT INTO tasks (id, title, recurrence) VALUES (30, 'Template for cascade', '{"freq":"daily"}');
INSERT INTO tasks (id, title, recurrence_source_id, date_scheduled) VALUES (31, 'Instance', 30, '2026-05-04');
INSERT INTO recurring_instance_skips (recurrence_source_id, date_scheduled) VALUES (30, '2026-05-03');
INSERT INTO recurring_instance_skips (recurrence_source_id, date_scheduled) VALUES (30, '2026-05-04');
SQL
pre_skips=$(q "SELECT COUNT(*) FROM recurring_instance_skips WHERE recurrence_source_id = 30;")
[ "$pre_skips" = "2" ] || fail "F setup: expected 2 skip rows for template 30, got $pre_skips"
sqlite3 "$DB" "PRAGMA foreign_keys = ON; DELETE FROM tasks WHERE id = 30;"
post_skips=$(q "SELECT COUNT(*) FROM recurring_instance_skips WHERE recurrence_source_id = 30;")
[ "$post_skips" = "0" ] || fail "F: ON DELETE CASCADE should have removed skips, got $post_skips"
echo "OK   F → ON DELETE CASCADE removed skip rows when template was deleted"

echo
echo "All v15 skip-migration assertions passed."
