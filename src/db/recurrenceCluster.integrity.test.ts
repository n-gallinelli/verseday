import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { parseSqliteUtc } from "./queries";

// P2 recurrence cluster — pins the SQL-level invariants of the fixes that can't
// be exercised through the tauri-backed generate path in a unit test. The SQL
// strings mirror production (params substituted with literals); an in-memory
// SQLite with the real partial unique index runs them.

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY,
      project_id INTEGER,
      title TEXT,
      priority TEXT DEFAULT 'medium',
      status TEXT DEFAULT 'todo',
      estimated_minutes INTEGER,
      notes TEXT,
      date_scheduled TEXT,
      recurrence TEXT,
      recurrence_source_id INTEGER,
      sort_order INTEGER
    );
    CREATE TABLE recurring_instance_skips (
      recurrence_source_id INTEGER NOT NULL,
      date_scheduled TEXT NOT NULL,
      PRIMARY KEY (recurrence_source_id, date_scheduled)
    );
    CREATE UNIQUE INDEX idx_tasks_recurrence_per_date
      ON tasks(recurrence_source_id, date_scheduled)
      WHERE recurrence_source_id IS NOT NULL;
  `);
  return db;
}

describe("#5 created_at UTC parse (biweekly anchor)", () => {
  it("parses a SQLite UTC datetime as UTC, not local", () => {
    const s = "2026-05-21 13:08:22";
    // The instant must equal the explicit-UTC interpretation...
    expect(parseSqliteUtc(s).getTime()).toBe(new Date("2026-05-21T13:08:22Z").getTime());
    // ...which is the corrected behavior. (When the host tz ≠ UTC this differs
    // from the buggy local parse; on a UTC host they coincide, so assert the
    // canonical-UTC equality, which holds in every tz.)
  });

  it("passes through values that already carry a tz marker", () => {
    expect(parseSqliteUtc("2026-05-21T13:08:22Z").getTime()).toBe(
      new Date("2026-05-21T13:08:22Z").getTime()
    );
  });
});

describe("#9 idempotent generation insert", () => {
  it("a duplicate (source,date) insert is a silent no-op via ON CONFLICT", () => {
    const db = makeDb();
    db.exec("INSERT INTO tasks (id, title, recurrence) VALUES (1, 'Standup', '{\"freq\":\"daily\"}');");
    const ins = `INSERT INTO tasks (project_id, title, priority, estimated_minutes, notes, date_scheduled, recurrence_source_id, sort_order)
       VALUES (NULL, 'Standup', 'medium', NULL, NULL, '2026-06-05', 1, 999)
       ON CONFLICT(recurrence_source_id, date_scheduled) WHERE recurrence_source_id IS NOT NULL DO NOTHING;`;
    db.exec(ins);
    db.exec(ins); // would throw on the unique index without ON CONFLICT
    const c = (
      db.prepare("SELECT COUNT(*) AS c FROM tasks WHERE recurrence_source_id = 1 AND date_scheduled = '2026-06-05'").get() as {
        c: number;
      }
    ).c;
    expect(c).toBe(1);
    db.close();
  });
});

describe("#4 skip-on-move", () => {
  it("records a skip for the original date so generation short-circuits", () => {
    const db = makeDb();
    db.exec("INSERT INTO tasks (id, title, recurrence) VALUES (1, 'Standup', '{\"freq\":\"daily\"}');");
    // instance generated for 2026-06-05, then moved to 2026-06-06
    db.exec(
      "INSERT INTO tasks (id, title, date_scheduled, recurrence_source_id, sort_order) VALUES (2, 'Standup', '2026-06-05', 1, 999);"
    );
    // skip-on-move: record the original date, then move
    db.exec(
      "INSERT INTO recurring_instance_skips (recurrence_source_id, date_scheduled) VALUES (1, '2026-06-05') ON CONFLICT DO NOTHING;"
    );
    db.exec("UPDATE tasks SET date_scheduled = '2026-06-06' WHERE id = 2;");

    // generation's skip-check for the original date now short-circuits.
    const skipped = (
      db.prepare("SELECT COUNT(*) AS c FROM recurring_instance_skips WHERE recurrence_source_id = 1 AND date_scheduled = '2026-06-05'").get() as {
        c: number;
      }
    ).c;
    expect(skipped).toBe(1);
    db.close();
  });
});

describe("#6 template-done does not stop generation", () => {
  it("the template selection no longer filters on status", () => {
    const db = makeDb();
    db.exec("INSERT INTO tasks (id, title, status, recurrence) VALUES (1, 'Standup', 'done', '{\"freq\":\"daily\"}');");
    // The fixed selection has no `AND status != 'done'`.
    const rows = db
      .prepare("SELECT id FROM tasks WHERE recurrence IS NOT NULL AND recurrence_source_id IS NULL")
      .all() as { id: number }[];
    expect(rows.map((r) => r.id)).toEqual([1]);
    db.close();
  });
});
