// Worked-seconds SQL shared between the live queries (queries.ts) and the
// integrity test (workedSeconds.integrity.test.ts). Kept in its own module —
// with NO Tauri/runtime imports — so the test can import the EXACT query text
// and run it against an in-memory SQLite, guaranteeing zero test/prod drift.
//
// Context: #2 + #15 (docs/2026-06-01-stability-hardening-plan.md, Branch B).

/**
 * #15 — daily worked-minutes total. `te.end_time IS NOT NULL` excludes the
 * in-progress (open) session: under #2 an open row carries a non-zero,
 * checkpointed worked_seconds, so without this guard it would be summed here
 * AND added again as the live focus.workedMs at the app layer (double-count).
 * Param: $1 = date (YYYY-MM-DD).
 */
export const SQL_TOTAL_WORKED_MINUTES_FOR_DATE = `SELECT COALESCE(SUM(te.worked_seconds), 0) / 60.0 as total
    FROM time_entries te
    JOIN tasks t ON te.task_id = t.id
    WHERE t.date_scheduled = $1 AND t.recurrence IS NULL AND t.external_dismissal_reason IS NULL AND te.end_time IS NOT NULL`;

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
