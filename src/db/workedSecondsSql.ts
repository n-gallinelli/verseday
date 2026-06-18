// Worked-seconds SQL shared between the live queries (queries.ts) and the
// integrity test (workedSeconds.integrity.test.ts). Kept in its own module —
// with NO Tauri/runtime imports — so the test can import the EXACT query text
// and run it against an in-memory SQLite, guaranteeing zero test/prod drift.
//
// Context: #2 + #15 (docs/2026-06-01-stability-hardening-plan.md, Branch B).

/**
 * Raw closed time entries in a start_time WINDOW, for per-LOCAL-day worked-time
 * aggregation. Worked time is bucketed in JS (bucketWorkedByLocalDay) by
 * localDateIso(start_time), NOT by a SQL date group — SQLite date(start_time)
 * is UTC and would split an evening session onto the next day east of UTC, and
 * grouping by t.date_scheduled mis-attributes a multi-day task's whole total to
 * its scheduled date (the bug this replaces). Returns project_id too so the
 * per-project variant can group without a second query.
 *
 * `te.end_time IS NOT NULL` still excludes the open in-progress session (#15):
 * its checkpointed worked_seconds is counted exactly once as the live
 * focus.workedMs at the app layer, so it must not also be summed here.
 *
 * Params: $1 = window start (inclusive 'YYYY-MM-DD'), $2 = window end
 * (exclusive). Callers PAD the window (start−1d … end+2d) so it covers the local
 * range across any UTC offset, then filter to the exact local days AFTER
 * bucketing — the final day filter is on the bucketed LOCAL date, never on the
 * raw UTC start_time.
 */
export const SQL_WORKED_ENTRIES_IN_WINDOW = `SELECT te.start_time, te.worked_seconds, t.project_id
    FROM time_entries te
    JOIN tasks t ON te.task_id = t.id
    WHERE te.start_time >= $1 AND te.start_time < $2
      AND t.recurrence IS NULL AND t.external_dismissal_reason IS NULL
      AND te.end_time IS NOT NULL AND te.worked_seconds > 0`;

/**
 * #2 — close orphaned (open) time entries left by a force-quit/crash. Sets ONLY
 * end_time (capped at start + $1 hours); deliberately leaves worked_seconds
 * intact so the checkpointed value survives and the session re-enters the
 * totals once end_time is set. Params: $1 = max orphan hours, $2 = id to
 * exclude (the live session) or NULL.
 */
export const SQL_CLOSE_ORPHANED_TIME_ENTRIES = `UPDATE time_entries
     SET end_time = datetime(start_time, '+' || $1 || ' hours')
     WHERE end_time IS NULL
       AND (CAST($2 AS INTEGER) IS NULL OR id != $2)`;
