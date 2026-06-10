mod commands;
// `pub` so the C3 verification example (examples/calendar_recurrence_check.rs)
// can construct an EventKitSource directly. No JS-facing API is exposed
// beyond the four `#[tauri::command]` functions registered in `run()`.
#[cfg(target_os = "macos")]
pub mod calendar;
// Native meeting-notification delivery + click→focus-jump delegate. macOS-only
// (the plugin discards clicks; onAction is mobile-only). See notify.rs.
#[cfg(target_os = "macos")]
mod notify;

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_sql::{Migration, MigrationKind};

/// P4 — copy-on-launch DB backup. Runs at the very start of `run()`, BEFORE the
/// SQL plugin is registered (and therefore before any connection or migration),
/// so a backup always captures the pre-migration state — the recovery point if
/// a migration goes wrong. Best-effort: any failure is swallowed so a backup
/// problem never blocks launch. macOS-only (the app's only target); the path is
/// derived from $HOME + the known bundle identifier rather than the Tauri path
/// resolver, which isn't available this early.
#[cfg(target_os = "macos")]
fn backup_database_on_launch() {
    let home = match std::env::var("HOME") {
        Ok(h) => h,
        Err(_) => return,
    };
    let base =
        std::path::Path::new(&home).join("Library/Application Support/com.verseday.app");
    let src = base.join("verseday.db");
    // Fresh install (no DB yet) → nothing to back up.
    if !src.exists() {
        return;
    }
    let backups = base.join("backups");
    if std::fs::create_dir_all(&backups).is_err() {
        return;
    }
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let dest = backups.join(format!("verseday-{ts}.db"));
    if std::fs::copy(&src, &dest).is_ok() {
        // Pair the journal sidecar(s) with the backup. If the prior session
        // crashed mid-write a hot rollback-journal exists and verseday.db holds
        // a not-yet-rolled-back state — copying only the db would capture a torn
        // snapshot. Copying the sidecar(s) makes the backup a complete,
        // restorable set. We're rollback-journal (not WAL), but copy -wal/-shm
        // defensively. Named to match the db so a restore pairs them. Best-effort.
        for ext in ["-journal", "-wal", "-shm"] {
            let side_src = base.join(format!("verseday.db{ext}"));
            if side_src.exists() {
                let _ = std::fs::copy(
                    &side_src,
                    backups.join(format!("verseday-{ts}.db{ext}")),
                );
            }
        }
        prune_backups(&backups, 5);
    }
}

/// Keep only the newest `keep` `.db` backups (filenames are epoch-stamped, so a
/// lexical sort is chronological). Each removed db takes its journal sidecars
/// with it so they don't accumulate (the `.db` filter excludes `.db-journal`
/// etc., so they'd otherwise never be pruned). Best-effort.
#[cfg(target_os = "macos")]
fn prune_backups(dir: &std::path::Path, keep: usize) {
    let mut backups: Vec<std::path::PathBuf> = match std::fs::read_dir(dir) {
        Ok(rd) => rd
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| n.starts_with("verseday-") && n.ends_with(".db"))
                    .unwrap_or(false)
            })
            .collect(),
        Err(_) => return,
    };
    if backups.len() <= keep {
        return;
    }
    backups.sort(); // oldest first (epoch-stamped names)
    let remove = backups.len() - keep;
    for p in backups.into_iter().take(remove) {
        let _ = std::fs::remove_file(&p);
        // Remove this backup's paired sidecars (verseday-<ts>.db-journal, etc.).
        for ext in ["-journal", "-wal", "-shm"] {
            let mut side = p.clone().into_os_string();
            side.push(ext);
            let _ = std::fs::remove_file(std::path::PathBuf::from(side));
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "macos")]
    backup_database_on_launch();

    let migrations = vec![
        Migration {
            version: 1,
            description: "create initial tables",
            sql: "
                CREATE TABLE IF NOT EXISTS projects (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    color TEXT NOT NULL DEFAULT '#6366f1',
                    archived INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS objectives (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
                    title TEXT NOT NULL,
                    description TEXT,
                    status TEXT NOT NULL DEFAULT 'active',
                    target_date TEXT,
                    notes TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS tasks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
                    objective_id INTEGER REFERENCES objectives(id) ON DELETE SET NULL,
                    title TEXT NOT NULL,
                    description TEXT,
                    priority TEXT NOT NULL DEFAULT 'medium',
                    status TEXT NOT NULL DEFAULT 'todo',
                    estimated_minutes INTEGER,
                    date_scheduled TEXT,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    notes TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS time_entries (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                    start_time TEXT NOT NULL,
                    end_time TEXT,
                    entry_type TEXT NOT NULL DEFAULT 'tracked'
                );

                CREATE TABLE IF NOT EXISTS daily_plans (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    date TEXT NOT NULL UNIQUE,
                    notes TEXT,
                    hour_budget REAL NOT NULL DEFAULT 8.0
                );

                CREATE TABLE IF NOT EXISTS weekly_plans (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    week_start_date TEXT NOT NULL UNIQUE,
                    focus_areas TEXT,
                    notes TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS weekly_shutdowns (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    week_start_date TEXT NOT NULL UNIQUE,
                    reflections TEXT,
                    incomplete_items TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS shutdown_checklist_items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    label TEXT NOT NULL,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    is_default INTEGER NOT NULL DEFAULT 1
                );

                CREATE TABLE IF NOT EXISTS links (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    entity_type TEXT NOT NULL,
                    entity_id INTEGER NOT NULL,
                    url TEXT NOT NULL,
                    label TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                -- Seed default shutdown checklist
                INSERT INTO shutdown_checklist_items (label, sort_order) VALUES
                    ('Review completed tasks', 1),
                    ('Process incomplete tasks', 2),
                    ('Review next week''s calendar', 3),
                    ('Update objectives', 4),
                    ('Clear inbox', 5),
                    ('Write weekly reflection', 6);
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add description, target_date, notes to projects; remove objectives dependency",
            sql: "
                ALTER TABLE projects ADD COLUMN description TEXT;
                ALTER TABLE projects ADD COLUMN target_date TEXT;
                ALTER TABLE projects ADD COLUMN notes TEXT;

                -- Update shutdown checklist seed
                UPDATE shutdown_checklist_items SET label = 'Update projects' WHERE label = 'Update objectives';
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "add break_seconds to time_entries for accurate work time",
            sql: "
                ALTER TABLE time_entries ADD COLUMN break_seconds INTEGER NOT NULL DEFAULT 0;
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "add weekly_plan_projects join table for project timelines",
            sql: "
                CREATE TABLE IF NOT EXISTS weekly_plan_projects (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    week_start_date TEXT NOT NULL,
                    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    UNIQUE(week_start_date, project_id)
                );
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "add start_date to projects for date ranges",
            sql: "
                ALTER TABLE projects ADD COLUMN start_date TEXT;
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "add sort_order to projects for custom ordering",
            sql: "
                ALTER TABLE projects ADD COLUMN sort_order INTEGER;
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "add completed flag to projects",
            sql: "
                ALTER TABLE projects ADD COLUMN completed INTEGER NOT NULL DEFAULT 0;
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "add mood and reflection to daily_plans for daily shutdown",
            sql: "
                ALTER TABLE daily_plans ADD COLUMN mood TEXT;
                ALTER TABLE daily_plans ADD COLUMN reflection TEXT;
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "add recurrence and recurrence_source_id to tasks for recurring tasks",
            sql: "
                ALTER TABLE tasks ADD COLUMN recurrence TEXT;
                ALTER TABLE tasks ADD COLUMN recurrence_source_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL;
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "add mood to weekly_shutdowns",
            sql: "
                ALTER TABLE weekly_shutdowns ADD COLUMN mood TEXT;
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "add rollover tracking to tasks",
            sql: "
                ALTER TABLE tasks ADD COLUMN original_date TEXT;
                ALTER TABLE tasks ADD COLUMN rollover_count INTEGER NOT NULL DEFAULT 0;
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 12,
            description: "add task highlights and settings table for AI summaries",
            sql: "
                ALTER TABLE tasks ADD COLUMN is_highlight INTEGER NOT NULL DEFAULT 0;

                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 13,
            description: "track when a task was completed (for weekly shutdown wins-by-day)",
            sql: "
                ALTER TABLE tasks ADD COLUMN completed_at TEXT;
                UPDATE tasks SET completed_at = date_scheduled
                  WHERE status = 'done' AND completed_at IS NULL AND date_scheduled IS NOT NULL;
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 14,
            description: "dedupe recurring task instances and add partial unique index",
            // Cleanup must run before the index — the index would fail to
            // create against rows that already violate uniqueness. sqlx wraps
            // each migration in an implicit transaction (sqlx-sqlite
            // migrate.rs:131), so any failure rolls back the entire body —
            // do NOT add explicit BEGIN/COMMIT here, that would error.
            //
            // Keeper ranking per (recurrence_source_id, date_scheduled) group:
            //   1. has linked time_entries (preserves logged work)
            //   2. higher total worked minutes among rows with entries
            //   3. has non-empty notes
            //   4. status = 'done'
            //   5. is_highlight = 1
            //   6. higher id (newest insert ≈ currently-rendered row)
            //
            // time_entries.task_id is reassigned from losers to the keeper
            // BEFORE deletion (ON DELETE CASCADE on time_entries means
            // delete-first would discard logged work). See test fixtures in
            // scripts/test-dedup-migration.sh for the exhaustive case set.
            //
            // OPERATIONAL NOTE: this entry is byte-identical to the v14
            // migration on fix/recurring-task-duplicates. It's included
            // here so a binary built from THIS branch can run against a
            // user DB that already has v14 applied — sqlx validates
            // applied-migration checksums against the source list, so
            // omitting v14 from a binary that runs against a v14-applied
            // DB causes "applied migration not found" and the entire
            // load fails. The body is idempotent — CREATE INDEX IF NOT
            // EXISTS, and the cleanup CTEs reduce to no-ops when no
            // duplicates remain — so re-running has no effect. v15 still
            // has zero LOGICAL dependency on v14 per Verse; this is a
            // checksum/coexistence concern only.
            sql: "
                WITH worked AS (
                  SELECT te.task_id,
                         COALESCE(SUM(
                           CAST((julianday(te.end_time) - julianday(te.start_time)) * 1440 AS INTEGER)
                         ), 0) AS minutes
                  FROM time_entries te
                  WHERE te.end_time IS NOT NULL
                  GROUP BY te.task_id
                ),
                all_entries AS (
                  SELECT task_id, COUNT(*) AS entry_count
                  FROM time_entries
                  GROUP BY task_id
                ),
                ranked AS (
                  SELECT
                    t.id,
                    t.recurrence_source_id,
                    t.date_scheduled,
                    ROW_NUMBER() OVER (
                      PARTITION BY t.recurrence_source_id, t.date_scheduled
                      ORDER BY
                        CASE WHEN ae.entry_count IS NOT NULL THEN 1 ELSE 0 END DESC,
                        COALESCE(w.minutes, 0)                                    DESC,
                        CASE WHEN t.notes IS NOT NULL AND TRIM(t.notes) != '' THEN 1 ELSE 0 END DESC,
                        CASE WHEN t.status = 'done' THEN 1 ELSE 0 END             DESC,
                        t.is_highlight                                            DESC,
                        t.id                                                      DESC
                    ) AS rn
                  FROM tasks t
                  LEFT JOIN all_entries ae ON ae.task_id = t.id
                  LEFT JOIN worked      w  ON w.task_id  = t.id
                  WHERE t.recurrence_source_id IS NOT NULL
                ),
                keepers AS (
                  SELECT recurrence_source_id, date_scheduled, id AS keeper_id
                  FROM ranked WHERE rn = 1
                ),
                losers AS (
                  SELECT r.id AS loser_id, k.keeper_id
                  FROM ranked r
                  JOIN keepers k
                    ON k.recurrence_source_id = r.recurrence_source_id
                   AND k.date_scheduled       = r.date_scheduled
                  WHERE r.rn > 1
                )
                UPDATE time_entries
                SET task_id = (SELECT keeper_id FROM losers WHERE losers.loser_id = time_entries.task_id)
                WHERE task_id IN (SELECT loser_id FROM losers);

                WITH worked AS (
                  SELECT te.task_id,
                         COALESCE(SUM(
                           CAST((julianday(te.end_time) - julianday(te.start_time)) * 1440 AS INTEGER)
                         ), 0) AS minutes
                  FROM time_entries te
                  WHERE te.end_time IS NOT NULL
                  GROUP BY te.task_id
                ),
                all_entries AS (
                  SELECT task_id, COUNT(*) AS entry_count
                  FROM time_entries
                  GROUP BY task_id
                ),
                ranked AS (
                  SELECT
                    t.id,
                    t.recurrence_source_id,
                    t.date_scheduled,
                    ROW_NUMBER() OVER (
                      PARTITION BY t.recurrence_source_id, t.date_scheduled
                      ORDER BY
                        CASE WHEN ae.entry_count IS NOT NULL THEN 1 ELSE 0 END DESC,
                        COALESCE(w.minutes, 0)                                    DESC,
                        CASE WHEN t.notes IS NOT NULL AND TRIM(t.notes) != '' THEN 1 ELSE 0 END DESC,
                        CASE WHEN t.status = 'done' THEN 1 ELSE 0 END             DESC,
                        t.is_highlight                                            DESC,
                        t.id                                                      DESC
                    ) AS rn
                  FROM tasks t
                  LEFT JOIN all_entries ae ON ae.task_id = t.id
                  LEFT JOIN worked      w  ON w.task_id  = t.id
                  WHERE t.recurrence_source_id IS NOT NULL
                )
                DELETE FROM tasks WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

                CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_recurrence_per_date
                  ON tasks(recurrence_source_id, date_scheduled)
                  WHERE recurrence_source_id IS NOT NULL;
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 15,
            description: "track skipped recurring-instance dates so deletes are not regenerated",
            // Additive only — one new table, no UPDATE/DELETE. Records the
            // user's intent when they delete a recurring instance so the
            // next call to generateRecurringInstances respects the skip
            // instead of re-creating the row. ON DELETE CASCADE keeps the
            // skip table in sync when the user deletes the template itself.
            sql: "
                CREATE TABLE IF NOT EXISTS recurring_instance_skips (
                    recurrence_source_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                    date_scheduled       TEXT NOT NULL,
                    PRIMARY KEY (recurrence_source_id, date_scheduled)
                );
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 16,
            description: "add due_date column to tasks (separate from date_scheduled)",
            // Additive only — nullable column, no destructive ops. due_date
            // is when the task is *due* (deadline), distinct from
            // date_scheduled (when the user plans to work on it).
            sql: "
                ALTER TABLE tasks ADD COLUMN due_date TEXT;
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 17,
            description: "weekly planning tab: per-(week,project,day) commitments + per-(week,project) review status",
            // Additive only — two new tables, no UPDATE/DELETE on existing
            // data. CHECK constraints enforce Mon–Fri (day_offset 0..4),
            // valid status enum, and non-negative minutes at the DB layer.
            // ON DELETE CASCADE keeps both tables in sync when a project is
            // deleted. See docs/2026-05-05-weekly-planning-plan.md for the
            // approved plan and Verse review notes.
            sql: "
                CREATE TABLE IF NOT EXISTS weekly_plan_commitments (
                    week_start_date TEXT NOT NULL,
                    project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                    day_offset      INTEGER NOT NULL CHECK (day_offset BETWEEN 0 AND 4),
                    -- 1440 = 24h cap. The Plan tab's H:MM input format is
                    -- implicitly sub-day; this CHECK guards against typo /
                    -- stepper bugs landing absurd values that would later
                    -- need a v18 migration to re-constrain.
                    minutes         INTEGER NOT NULL CHECK (minutes >= 0 AND minutes <= 1440),
                    PRIMARY KEY (week_start_date, project_id, day_offset)
                );

                CREATE TABLE IF NOT EXISTS weekly_plan_project_status (
                    week_start_date TEXT NOT NULL,
                    project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                    status          TEXT NOT NULL CHECK (status IN ('planned', 'skipped')),
                    reviewed_at     TEXT NOT NULL DEFAULT (datetime('now')),
                    PRIMARY KEY (week_start_date, project_id)
                );
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 18,
            description: "calendar integration: external_source/id/dismissal_reason on tasks + partial index",
            // Additive only — three nullable columns + one partial
            // index. NULL on all three means "task created in-app"
            // (the existing default for every row pre-v18). The
            // partial index keeps lookup O(log n_imported) without
            // bloating row writes for in-app tasks.
            //
            // CHECKs use `IS NULL OR x = 'val'` form (SQLite IN
            // doesn't handle NULL the way you'd want, see Verse v2 B2).
            // See docs/2026-05-05-calendar-integration-plan.md.
            sql: "
                ALTER TABLE tasks ADD COLUMN external_source TEXT
                  CHECK (external_source IS NULL OR external_source = 'calendar');

                ALTER TABLE tasks ADD COLUMN external_id TEXT;

                ALTER TABLE tasks ADD COLUMN external_dismissal_reason TEXT
                  CHECK (external_dismissal_reason IS NULL
                         OR external_dismissal_reason IN ('user', 'cancelled'));

                CREATE INDEX IF NOT EXISTS idx_tasks_external
                  ON tasks (external_source, external_id)
                  WHERE external_source IS NOT NULL;
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 19,
            description: "calendar integration: upgrade idx_tasks_external to UNIQUE for ON CONFLICT binding",
            // v19: upgrade idx_tasks_external from non-unique (v18) to UNIQUE.
            // v18 shipped non-unique by mistake; ON CONFLICT(external_source, external_id)
            // requires a UNIQUE index/constraint to bind. M2 is the first writer of
            // calendar tasks, so no rows can violate uniqueness at migration time.
            //
            // SQLite has no ALTER INDEX … ADD UNIQUE — drop+recreate is the only path.
            // Reusing the name `idx_tasks_external` keeps a single canonical index
            // for this purpose; two indexes with different names for the same job
            // is the kind of debt that costs an hour of confusion six months out.
            //
            // The runner (sqlx-sqlite) wraps each migration body in an implicit
            // transaction (sqlx-sqlite migrate.rs:131) — see v14 doc — so if
            // CREATE UNIQUE INDEX fails on a hypothetical machine that has
            // duplicate (external_source, external_id) rows, the DROP rolls back
            // too. No silent half-state.
            sql: "
                DROP INDEX IF EXISTS idx_tasks_external;

                CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_external
                  ON tasks (external_source, external_id)
                  WHERE external_source IS NOT NULL;
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 20,
            description: "weekly_plan_commitments: rebuild with full minutes CHECK (corrects v17 dev-DB drift)",
            // Recovery migration for v17 checksum/structural drift. See
            // docs/2026-05-05-v20-weekly-plan-commitments-fix.md.
            //
            // On Cam/Dan's DBs (and any DB where v17 was applied at the
            // committed bytes), this is a structurally-equivalent rebuild —
            // new table has identical schema to the existing one, all rows
            // INSERT-SELECT cleanly. Idempotent.
            //
            // On Nick's dev DB (where intermediate-v17 with CHECK
            // (minutes >= 0) was applied during M1-M6 iteration), this
            // adds the missing `<= 1440` upper bound. Pre-flight on the
            // dev DB confirmed zero existing rows violate the new CHECK
            // (max minutes = 50). If a violator existed, INSERT would
            // fail inside sqlx's implicit transaction and the entire
            // rebuild would roll back — loud failure, not silent data
            // loss. No WHERE clause on INSERT-SELECT for that reason.
            //
            // FK behavior verified on a fresh DB with PRAGMA foreign_keys
            // = ON: rebuild succeeds, foreign_key_check returns clean.
            // weekly_plan_commitments has only outbound FKs (→ projects),
            // so no PRAGMA toggling is needed.
            //
            // Index/trigger preservation: the only index is the implicit
            // sqlite_autoindex from PRIMARY KEY, auto-recreated by the
            // new CREATE TABLE. No explicit indexes, no triggers.
            sql: "
                CREATE TABLE weekly_plan_commitments_v20 (
                    week_start_date TEXT NOT NULL,
                    project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                    day_offset      INTEGER NOT NULL CHECK (day_offset BETWEEN 0 AND 4),
                    minutes         INTEGER NOT NULL CHECK (minutes >= 0 AND minutes <= 1440),
                    PRIMARY KEY (week_start_date, project_id, day_offset)
                );

                INSERT INTO weekly_plan_commitments_v20
                  SELECT * FROM weekly_plan_commitments;

                DROP TABLE weekly_plan_commitments;

                ALTER TABLE weekly_plan_commitments_v20
                  RENAME TO weekly_plan_commitments;
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 21,
            description: "calendar metadata: notes, location, url, attendees, organizer, calendar_name on tasks",
            // v21 adds the per-task calendar metadata captured by the
            // M-next sync layer. EKEvent surfaces description (notes),
            // location, URL, attendees, and organizer in addition to
            // title — the right-rail of TaskDetailOverlay renders
            // these for `external_source = 'calendar'` rows.
            //
            // All columns are TEXT and nullable; existing rows
            // (calendar imports from before this migration) are
            // back-filled by the next sync pass via the upserted
            // UPDATE branch. Attendees stored as a JSON array string —
            // SQLite has no native array type, and we don't need to
            // query individual attendees from SQL.
            sql: "
                ALTER TABLE tasks ADD COLUMN external_notes TEXT;
                ALTER TABLE tasks ADD COLUMN external_location TEXT;
                ALTER TABLE tasks ADD COLUMN external_url TEXT;
                ALTER TABLE tasks ADD COLUMN external_attendees TEXT;
                ALTER TABLE tasks ADD COLUMN external_organizer_email TEXT;
                ALTER TABLE tasks ADD COLUMN external_calendar_name TEXT;
                ALTER TABLE tasks ADD COLUMN external_start_local TEXT;
                ALTER TABLE tasks ADD COLUMN external_end_local TEXT;
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 22,
            description: "worked-seconds simplification: directly-stored worked_seconds on time_entries",
            // v22 adds a directly-stored worked-seconds counter to
            // time_entries, replacing the wall-clock derivation
            // ((end_time - start_time) - break_seconds) used by the
            // worked-minutes queries. Closed rows are backfilled one
            // time from the existing wall-clock formula; open rows
            // (end_time IS NULL) keep the default 0 — the running
            // session writes its workedMs / 1000 on stop going forward.
            //
            // start_time / end_time / break_seconds columns stay
            // populated for audit, reports, and debugging. Reads
            // switch to worked_seconds in S.5; writes still set
            // end_time on stop for the audit trail.
            //
            // The MAX(0, ...) guard handles edge data where
            // break_seconds exceeded the wall-clock duration (corrupt
            // / pre-existing rows; shouldn't exist in practice).
            // CAST(ROUND(...) AS INTEGER) gives integer seconds with
            // proper round-half-to-even (SQLite's default).
            //
            // Design: docs/2026-05-07-worked-seconds-simplification.md
            // (rev 2 — Verse-approved).
            sql: "
                ALTER TABLE time_entries ADD COLUMN worked_seconds INTEGER NOT NULL DEFAULT 0;

                UPDATE time_entries
                SET worked_seconds = MAX(
                  0,
                  CAST(ROUND((julianday(end_time) - julianday(start_time)) * 86400) AS INTEGER)
                    - COALESCE(break_seconds, 0)
                )
                WHERE end_time IS NOT NULL;
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 23,
            description: "worked-seconds simplification S.5 sweep: backfill any rows closed via legacy stopTimeEntry between v22 (S.1) and S.5",
            // Between S.1 (v22 backfill of pre-existing closed rows) and
            // S.5 (this commit's stop-side worked_seconds write), any
            // session stopped via the legacy stopTimeEntry codepath had
            // its end_time set but worked_seconds left at the v22
            // default (0). This sweep catches those rows.
            //
            // Safe formula: under the dual-write S.4 (which never
            // happened — S.3 absorbed the relevant write, see doc rev 4
            // header), break_seconds continued to capture pause time
            // exactly as M2.4 intended. So wall-seconds - break_seconds
            // gives the right worked seconds for these transitional rows.
            //
            // The `worked_seconds = 0` predicate guarantees we only fill
            // never-written rows — never clobbering the v22 backfill or
            // any S.5 stop-side write (those are non-zero by
            // construction; v22 only wrote 0 for legitimately
            // zero-worked sessions, which the formula will also yield 0
            // for, so re-running it is idempotent for that edge case).
            sql: "
                UPDATE time_entries
                SET worked_seconds = MAX(
                  0,
                  CAST(ROUND((julianday(end_time) - julianday(start_time)) * 86400) AS INTEGER)
                    - COALESCE(break_seconds, 0)
                )
                WHERE end_time IS NOT NULL AND worked_seconds = 0;
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 24,
            description: "add projects.priority (0 = normal, 1 = high) for objective prioritization",
            sql: "ALTER TABLE projects ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 25,
            description: "custom objective icons: custom_icons library + projects.icon / custom_icon_id",
            sql: "
                CREATE TABLE IF NOT EXISTS custom_icons (
                  id INTEGER PRIMARY KEY,
                  data TEXT NOT NULL,
                  created_at TEXT NOT NULL
                );
                ALTER TABLE projects ADD COLUMN icon TEXT;
                ALTER TABLE projects ADD COLUMN custom_icon_id INTEGER REFERENCES custom_icons(id) ON DELETE SET NULL;
            ",
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:verseday.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .manage(commands::QuickAddState {
            previous_app: std::sync::Mutex::new(String::new()),
        })
        .manage(commands::PipHoverState::new())
        .manage({
            #[cfg(target_os = "macos")]
            {
                calendar::CalendarState {
                    source: Box::new(calendar::EventKitSource::new()),
                }
            }
            #[cfg(not(target_os = "macos"))]
            {
                // Placeholder for non-macOS — calendar commands return
                // PermissionStatus::Denied if ever invoked.
                ()
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::generate_summary,
            commands::capture_previous_app,
            commands::dismiss_quick_add,
            commands::start_pip_hover_monitor,
            commands::stop_pip_hover_monitor,
            commands::get_last_backup_at,
            #[cfg(target_os = "macos")]
            calendar::calendar_check_permission,
            #[cfg(target_os = "macos")]
            calendar::calendar_request_permission,
            #[cfg(target_os = "macos")]
            calendar::calendar_get_calendar_list,
            #[cfg(target_os = "macos")]
            calendar::calendar_get_events_for_date,
            #[cfg(target_os = "macos")]
            notify::send_meeting_notification,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Pre-create the global quick-add window at startup so the
            // hotkey can summon it instantly. Hidden until the JS shortcut
            // handler calls .show()/.set_focus() on it. See
            // docs/global-quick-add.md for the (a)/(b)/(c) lifecycle
            // decision rationale.
            WebviewWindowBuilder::new(
                app,
                "quick-add",
                WebviewUrl::App("index.html#quick-add".into()),
            )
            .title("VerseDay — Quick Add")
            .inner_size(760.0, 400.0)
            .resizable(false)
            .decorations(false)
            .transparent(true)
            // No native window shadow: macOS draws its own shadow around the
            // window's non-transparent pixels, which on this transparent
            // window traces a faint gray halo at the edge of the card's CSS
            // shadow (a doubled-shadow artifact). The card already carries
            // its own box-shadow (var(--shadow-modal)) for the float effect,
            // so the OS shadow only adds the stray outline. Drop it.
            .shadow(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .center()
            .visible(false)
            .focused(false)
            .build()?;

            // Path A lifecycle fix (per docs/global-quick-add.md rev 4):
            // intercept the main window's red-X close, prevent it, and
            // hide the window instead of letting it propagate. The app
            // keeps running in the background so JS-side state — including
            // the global quick-add hotkey registration — survives. Cmd+Q
            // and "Quit VerseDay" from the menu still quit normally
            // because they go through the app-level quit path, not the
            // window close event.
            if let Some(main) = app.get_webview_window("main") {
                let main_clone = main.clone();
                main.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = main_clone.hide();
                    }
                });
            }

            // P0-1 — emit `system-resumed` on a real wake from sleep so the
            // focus tick drops the suspended span instead of inflating worked
            // time. setup() runs on the main thread (required by NSWorkspace).
            commands::start_system_resume_notifier(&app.handle());

            // Install the NSUserNotification click delegate (macOS) so a
            // meeting-notification body click emits verseday:notification-clicked.
            #[cfg(target_os = "macos")]
            notify::setup(&app.handle());

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Reopen handler (per Verse review #3, mandatory companion to
            // the hide-on-close behavior above): when the user clicks the
            // dock icon while no windows are visible, re-show the main
            // window. Without this, hide-on-close traps users — they'd
            // have no way to get back to the app short of Cmd+Q+relaunch.
            if let RunEvent::Reopen { has_visible_windows, .. } = event {
                if !has_visible_windows {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        });
}
