// Shutdown upsert SQL shared between queries.ts and the integrity test, so the
// test runs the EXACT query text (no test/prod drift). No Tauri/runtime imports.
// Context: #6 (docs/2026-06-01-stability-hardening-plan.md, Branch D).

/**
 * #6 — null-preserving weekly-shutdown upsert. `COALESCE($n, col)` keeps the
 * stored value when the arg is null, so marking a week complete with
 * (null, null, null) — the sole caller — never wipes a previously-saved
 * `incomplete_items` (the carry-forward note ScheduleTab reads). A future
 * caller passing a real value still overwrites. Params: $1 week_start_date,
 * $2 reflections, $3 incomplete_items, $4 mood.
 *
 * NOTE: weekly only. upsertDailyShutdown stays a plain replace — its callers
 * always pass the full current state and the user must be able to clear a
 * reflection to null.
 */
export const SQL_UPSERT_WEEKLY_SHUTDOWN = `INSERT INTO weekly_shutdowns (week_start_date, reflections, incomplete_items, mood) VALUES ($1, $2, $3, $4)
     ON CONFLICT(week_start_date) DO UPDATE SET
       reflections = COALESCE($2, reflections),
       incomplete_items = COALESCE($3, incomplete_items),
       mood = COALESCE($4, mood)`;
