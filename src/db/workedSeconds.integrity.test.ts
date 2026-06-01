import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  SQL_TOTAL_WORKED_MINUTES_FOR_DATE,
  SQL_CLOSE_ORPHANED_TIME_ENTRIES,
} from "./workedSecondsSql";

// Branch B runtime check (#2 + #15). Runs the EXACT production SQL strings
// (imported, not retyped) against an in-memory SQLite, so there is no
// test/prod drift. Params ($1/$2) are substituted with literals — the only
// transform — since the prod binding layer (tauri sqlx) supplies them the same
// way at runtime. Proves: (a) an orphaned session recovers its worked time;
// (b) the live session's seconds are counted exactly once, never twice.

const DATE = "2026-06-01";

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY,
      date_scheduled TEXT,
      recurrence TEXT,
      external_dismissal_reason TEXT
    );
    CREATE TABLE time_entries (
      id INTEGER PRIMARY KEY,
      task_id INTEGER,
      start_time TEXT,
      end_time TEXT,
      worked_seconds INTEGER DEFAULT 0,
      entry_type TEXT DEFAULT 'tracked'
    );
    INSERT INTO tasks (id, date_scheduled) VALUES (1, '${DATE}');
  `);
  return db;
}

function totalMinutes(db: DatabaseSync): number {
  const sql = SQL_TOTAL_WORKED_MINUTES_FOR_DATE.replace(/\$1/g, `'${DATE}'`);
  const row = db.prepare(sql).get() as { total: number };
  return row.total;
}

function insertEntry(
  db: DatabaseSync,
  id: number,
  endTime: string | null,
  workedSeconds: number
): void {
  const end = endTime === null ? "NULL" : `'${endTime}'`;
  db.exec(
    `INSERT INTO time_entries (id, task_id, start_time, end_time, worked_seconds)
     VALUES (${id}, 1, '${DATE}T09:00:00Z', ${end}, ${workedSeconds});`
  );
}

describe("worked-seconds crash integrity (#2 + #15)", () => {
  it("#15: an OPEN row (end_time NULL) contributes 0 to the DB total", () => {
    const db = makeDb();
    // Live session: 40 min checkpointed onto the still-open row (#2 behavior).
    insertEntry(db, 1, null, 2400);
    // DB contributes 0; the live session is counted once via focus.workedMs
    // at the app layer — so it is never double-counted.
    expect(totalMinutes(db)).toBe(0);
    db.close();
  });

  it("#15: a CLOSED row is counted exactly once", () => {
    const db = makeDb();
    insertEntry(db, 1, `${DATE}T09:40:00Z`, 2400);
    expect(totalMinutes(db)).toBe(40);
    db.close();
  });

  it("#2: a force-quit orphan recovers its checkpointed worked time (no silent hole)", () => {
    const db = makeDb();
    // Crash mid-session: open row, 40 min checkpointed, never stopped.
    insertEntry(db, 1, null, 2400);
    expect(totalMinutes(db)).toBe(0); // excluded while open

    // Next boot closes orphans (exclude none): the identical prod UPDATE.
    const closeSql = SQL_CLOSE_ORPHANED_TIME_ENTRIES.replace(/\$1/g, "4").replace(
      /\$2/g,
      "NULL"
    );
    db.exec(closeSql);

    const row = db
      .prepare("SELECT end_time, worked_seconds FROM time_entries WHERE id = 1")
      .get() as { end_time: string | null; worked_seconds: number };
    expect(row.worked_seconds).toBe(2400); // preserved — not clobbered
    expect(row.end_time).not.toBeNull(); // capped at start + 4h
    expect(totalMinutes(db)).toBe(40); // recovered into the total
    db.close();
  });

  it("never double-counts across the live session's lifecycle", () => {
    const db = makeDb();
    // While running: open row checkpointed at 2400s; app layer shows the live
    // focus.workedMs (40 min). DB shows 0 → user sees 40, counted ONCE.
    insertEntry(db, 1, null, 2400);
    const liveFocusMinutes = 40;
    expect(totalMinutes(db) + liveFocusMinutes).toBe(40);

    // On stop: end_time set, worked_seconds final; app layer drops the live
    // value. Still 40, now sourced from the DB — never 80.
    db.exec(`UPDATE time_entries SET end_time = '${DATE}T09:40:00Z' WHERE id = 1;`);
    expect(totalMinutes(db)).toBe(40);
    db.close();
  });

  it("the orphan close preserves a real backfilled value and doesn't reopen closed rows", () => {
    const db = makeDb();
    insertEntry(db, 1, null, 600); // open, checkpointed 10m
    insertEntry(db, 2, `${DATE}T08:00:00Z`, 1800); // already closed, 30m
    const closeSql = SQL_CLOSE_ORPHANED_TIME_ENTRIES.replace(/\$1/g, "4").replace(
      /\$2/g,
      "NULL"
    );
    db.exec(closeSql);
    const rows = db
      .prepare("SELECT id, worked_seconds FROM time_entries ORDER BY id")
      .all() as { id: number; worked_seconds: number }[];
    expect(rows).toEqual([
      { id: 1, worked_seconds: 600 },
      { id: 2, worked_seconds: 1800 },
    ]);
    expect(totalMinutes(db)).toBe(40); // 10 + 30, both closed, each once
    db.close();
  });
});
