// Rollover SQL shared between queries.ts and the integrity test, so the test
// pins the exact statement text (no test/prod drift). No Tauri/runtime imports.
// Context: #10 (docs/2026-06-01-stability-hardening-plan.md, Branch D).
//
// The contract these encode (and the test pins):
//  - a task is MOVED forward while rollover_count < 4 (count++ to at most 4);
//  - on the next missed day it's at count 4 → EXPIRED (date_scheduled = NULL),
//    i.e. expires at 4, not 3;
//  - recurrence rows are never rolled — neither generated instances
//    (recurrence_source_id NOT NULL) NOR templates (recurrence NOT NULL). A
//    template can carry a stale date_scheduled (set recurring then re-dated),
//    so the recurrence_source_id guard alone is insufficient; both guards are
//    required on every statement. This mirrors the `recurrence IS NULL` guard
//    the day-list/project queries already use (queries.ts).
//  - calendar-imported rows (external_source NOT NULL) are never rolled.

/** Param: $1 = today. Capture the to-roll ids in deterministic order BEFORE the
 *  move, so the renumber can append them in a stable sequence. */
export const SQL_ROLLOVER_CAPTURE = `SELECT id FROM tasks
     WHERE date_scheduled < $1
       AND status != 'done'
       AND rollover_count < 4
       AND recurrence_source_id IS NULL
       AND recurrence IS NULL
       AND external_source IS NULL
     ORDER BY date_scheduled ASC, sort_order ASC`;

/** Param: $1 = today. Move overdue, not-done, count<4 tasks to today; count++;
 *  stamp original_date on first rollover. */
export const SQL_ROLLOVER_MOVE = `UPDATE tasks
     SET original_date = COALESCE(original_date, date_scheduled),
         rollover_count = rollover_count + 1,
         date_scheduled = $1
     WHERE date_scheduled < $1
       AND status != 'done'
       AND rollover_count < 4
       AND recurrence_source_id IS NULL
       AND recurrence IS NULL
       AND external_source IS NULL`;

/** Param: $1 = today. Unschedule still-overdue, not-done tasks that have
 *  exhausted their rollovers (count >= 4). */
export const SQL_ROLLOVER_EXPIRE = `UPDATE tasks
     SET date_scheduled = NULL
     WHERE date_scheduled < $1
       AND status != 'done'
       AND rollover_count >= 4
       AND recurrence_source_id IS NULL
       AND recurrence IS NULL
       AND external_source IS NULL`;

/** Param: $1 = today. Capture the rows SQL_ROLLOVER_EXPIRE is about to
 *  unschedule, BEFORE the update, so the caller can emit RolloverMove{toDate:
 *  null} and reconcile the source buckets. This MUST stay predicate-identical
 *  to SQL_ROLLOVER_EXPIRE — it was previously inlined in queries.ts and drifted
 *  (it lacked the recurrence guard). Pinned here so the integrity test holds
 *  the two in lockstep: a count>=4 recurrence row is neither expired nor
 *  reported, so the store never sees a phantom expiry the DB didn't make. */
export const SQL_ROLLOVER_EXPIRE_CAPTURE = `SELECT id, date_scheduled FROM tasks
     WHERE date_scheduled < $1
       AND status != 'done'
       AND rollover_count >= 4
       AND recurrence_source_id IS NULL
       AND recurrence IS NULL
       AND external_source IS NULL`;
