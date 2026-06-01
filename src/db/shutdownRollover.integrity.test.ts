import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { SQL_UPSERT_WEEKLY_SHUTDOWN } from "./shutdownSql";
import {
  SQL_ROLLOVER_CAPTURE,
  SQL_ROLLOVER_MOVE,
  SQL_ROLLOVER_EXPIRE,
} from "./rolloverSql";

// Branch D SQL-contract tests (#6, #10). Run the EXACT production statement
// text (imported, $-params substituted with literals) against in-memory
// node:sqlite, so a future edit that breaks these contracts fails loudly.

// ── #6: weekly shutdown re-completion preserves prior fields ────────────────
describe("upsertWeeklyShutdown is null-preserving (#6)", () => {
  const sql = (week: string, r: string | null, inc: string | null, mood: string | null) =>
    SQL_UPSERT_WEEKLY_SHUTDOWN
      .replace(/\$1/g, `'${week}'`)
      .replace(/\$2/g, r === null ? "NULL" : `'${r}'`)
      .replace(/\$3/g, inc === null ? "NULL" : `'${inc}'`)
      .replace(/\$4/g, mood === null ? "NULL" : `'${mood}'`);

  function makeDb(): DatabaseSync {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE weekly_shutdowns (
      week_start_date TEXT PRIMARY KEY,
      reflections TEXT, incomplete_items TEXT, mood TEXT
    );`);
    return db;
  }
  const row = (db: DatabaseSync) =>
    db.prepare("SELECT reflections, incomplete_items, mood FROM weekly_shutdowns WHERE week_start_date = '2026-06-01'").get() as
      { reflections: string | null; incomplete_items: string | null; mood: string | null };

  it("re-completing with (null,null,null) preserves saved values (the bug)", () => {
    const db = makeDb();
    db.exec(sql("2026-06-01", "reflected", "carry these", "good"));
    db.exec(sql("2026-06-01", null, null, null)); // mark complete again
    expect(row(db)).toEqual({ reflections: "reflected", incomplete_items: "carry these", mood: "good" });
    db.close();
  });

  it("a real value still overwrites; unrelated nulls preserved", () => {
    const db = makeDb();
    db.exec(sql("2026-06-01", "v1", "carry", "ok"));
    db.exec(sql("2026-06-01", "v2", null, null));
    expect(row(db)).toEqual({ reflections: "v2", incomplete_items: "carry", mood: "ok" });
    db.close();
  });
});

// ── #10: rollover moves/expires correctly + renumbers contiguously ──────────
describe("rolloverUnfinishedTasks contract (#10)", () => {
  const TODAY = "2026-06-02";

  function makeDb(): DatabaseSync {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE tasks (
      id INTEGER PRIMARY KEY, date_scheduled TEXT, status TEXT,
      rollover_count INTEGER DEFAULT 0, original_date TEXT,
      recurrence_source_id INTEGER, external_source TEXT, sort_order INTEGER
    );`);
    // A: overdue count0 -> moves (count1)
    db.exec(`INSERT INTO tasks VALUES (1,'2026-05-30','todo',0,NULL,NULL,NULL,5)`);
    // B: overdue count3 -> moves (count4), NOT expired this run (expire at 4, not 3)
    db.exec(`INSERT INTO tasks VALUES (2,'2026-05-29','todo',3,NULL,NULL,NULL,2)`);
    // C: overdue count4 -> expired (date NULL)
    db.exec(`INSERT INTO tasks VALUES (3,'2026-05-28','todo',4,NULL,NULL,NULL,9)`);
    // D: done -> untouched
    db.exec(`INSERT INTO tasks VALUES (4,'2026-05-30','done',0,NULL,NULL,NULL,1)`);
    // E: recurrence instance -> skipped
    db.exec(`INSERT INTO tasks VALUES (5,'2026-05-30','todo',0,NULL,10,NULL,1)`);
    // F: calendar import -> skipped
    db.exec(`INSERT INTO tasks VALUES (6,'2026-05-30','todo',0,NULL,NULL,'calendar',1)`);
    // G: already on today -> existing, keeps sort_order 1
    db.exec(`INSERT INTO tasks VALUES (7,'${TODAY}','todo',0,NULL,NULL,NULL,1)`);
    return db;
  }

  function rollover(db: DatabaseSync) {
    const sub = (s: string) => s.replace(/\$1/g, `'${TODAY}'`);
    const captured = db.prepare(sub(SQL_ROLLOVER_CAPTURE)).all() as { id: number }[];
    db.exec(sub(SQL_ROLLOVER_MOVE));
    db.exec(sub(SQL_ROLLOVER_EXPIRE));
    // Renumber — mirrors queries.ts orchestration exactly.
    if (captured.length > 0) {
      const ids = captured.map((r) => r.id);
      const idList = ids.join(",");
      const base = (db.prepare(
        `SELECT MAX(sort_order) as m FROM tasks WHERE date_scheduled = '${TODAY}' AND id NOT IN (${idList})`
      ).get() as { m: number | null }).m ?? 0;
      const cases = ids.map((id, i) => `WHEN ${id} THEN ${base + i + 1}`).join(" ");
      db.exec(`UPDATE tasks SET sort_order = CASE id ${cases} END WHERE id IN (${idList})`);
    }
    return captured.map((r) => r.id);
  }

  const get = (db: DatabaseSync, id: number) =>
    db.prepare("SELECT date_scheduled, rollover_count, sort_order FROM tasks WHERE id = ?").get(id) as
      { date_scheduled: string | null; rollover_count: number; sort_order: number };

  it("captures to-roll tasks oldest-first (deterministic order)", () => {
    const db = makeDb();
    const rolled = rollover(db);
    expect(rolled).toEqual([2, 1]); // B (05-29) before A (05-30)
    db.close();
  });

  it("moves count<4 to today and increments; expires at 4 not 3", () => {
    const db = makeDb();
    rollover(db);
    expect(get(db, 1)).toMatchObject({ date_scheduled: TODAY, rollover_count: 1 }); // A moved
    expect(get(db, 2)).toMatchObject({ date_scheduled: TODAY, rollover_count: 4 }); // B moved, now 4 — NOT expired
    expect(get(db, 3).date_scheduled).toBeNull(); // C (was 4) expired
    expect(get(db, 3).rollover_count).toBe(4);
    db.close();
  });

  it("skips done / recurrence / calendar tasks", () => {
    const db = makeDb();
    rollover(db);
    expect(get(db, 4).date_scheduled).toBe("2026-05-30"); // done
    expect(get(db, 5).date_scheduled).toBe("2026-05-30"); // recurrence
    expect(get(db, 6).date_scheduled).toBe("2026-05-30"); // calendar
    db.close();
  });

  it("renumbers rolled tasks contiguously AFTER today's existing max, in order", () => {
    const db = makeDb();
    rollover(db);
    // G existing (1), then rolled B (2), A (3) — contiguous, deterministic.
    expect(get(db, 7).sort_order).toBe(1);
    expect(get(db, 2).sort_order).toBe(2);
    expect(get(db, 1).sort_order).toBe(3);
    const order = db.prepare(
      `SELECT id FROM tasks WHERE date_scheduled = '${TODAY}' ORDER BY sort_order`
    ).all() as { id: number }[];
    expect(order.map((r) => r.id)).toEqual([7, 2, 1]);
    db.close();
  });
});
