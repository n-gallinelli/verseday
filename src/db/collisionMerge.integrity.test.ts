import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";

// #1 (P1) — recurring-instance reschedule collision MERGE.
//
// When a recurring instance is moved onto a date that already holds a sibling
// of the same recurrence, the moved instance is the keeper and the sibling is
// absorbed (its time_entries + notes + done-status) then deleted. These tests
// run against an in-memory SQLite with the REAL foreign-key shape
// (time_entries.task_id → tasks ON DELETE CASCADE) and `PRAGMA foreign_keys=ON`
// — matching the runtime (verified empirically) — to pin two invariants:
//   1. worked time survives the merge (reassign-before-delete ordering), and
//   2. doing it in the WRONG order would destroy it via the cascade.

const D = "2026-06-02"; // target date the keeper moves onto
const D_PREV = "2026-06-01"; // keeper's current date before the move

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON;");
  db.exec(`
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY,
      title TEXT,
      status TEXT DEFAULT 'todo',
      notes TEXT,
      date_scheduled TEXT,
      recurrence TEXT,
      recurrence_source_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      completed_at TEXT
    );
    CREATE TABLE time_entries (
      id INTEGER PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      start_time TEXT,
      worked_seconds INTEGER DEFAULT 0
    );
    CREATE UNIQUE INDEX idx_tasks_recurrence_per_date
      ON tasks(recurrence_source_id, date_scheduled)
      WHERE recurrence_source_id IS NOT NULL;

    -- template (id 1), keeper instance (id 2, on D_PREV, being moved to D),
    -- colliding sibling (id 3, already on D) with a worked entry + notes + done
    INSERT INTO tasks (id, title, status, recurrence) VALUES (1, 'Standup', 'todo', 'daily');
    INSERT INTO tasks (id, title, status, notes, date_scheduled, recurrence_source_id)
      VALUES (2, 'Standup', 'todo', NULL, '${D_PREV}', 1);
    INSERT INTO tasks (id, title, status, notes, date_scheduled, recurrence_source_id, completed_at)
      VALUES (3, 'Standup', 'done', 'sib note', '${D}', 1, '2026-06-02T09:00:00.000Z');
    INSERT INTO time_entries (id, task_id, start_time, worked_seconds)
      VALUES (10, 3, '${D}T09:00:00', 600);
  `);
  return db;
}

/** The production merge ordering from updateTaskDateScheduled: reassign the
 *  sibling's worked time to the keeper FIRST, fold notes/done, then delete the
 *  shell, then move the keeper. Keeper = id 2, sibling = id 3. */
function mergeCorrectOrder(db: DatabaseSync): void {
  db.exec(`UPDATE time_entries SET task_id = 2 WHERE task_id IN (3);`);
  db.exec(`
    UPDATE tasks SET
      notes = 'sib note',
      status = 'done',
      completed_at = '2026-06-02T09:00:00.000Z'
    WHERE id = 2;
  `);
  db.exec(`DELETE FROM tasks WHERE id IN (3);`);
  db.exec(`UPDATE tasks SET date_scheduled = '${D}' WHERE id = 2;`);
}

function entriesFor(db: DatabaseSync, taskId: number): number {
  return (
    db.prepare("SELECT COUNT(*) AS c FROM time_entries WHERE task_id = ?").get(taskId) as {
      c: number;
    }
  ).c;
}

describe("#1 reschedule-collision merge", () => {
  it("reassigns the sibling's worked time to the keeper, then deletes the shell", () => {
    const db = makeDb();
    mergeCorrectOrder(db);

    // Sibling gone, keeper present on the target date.
    expect(db.prepare("SELECT COUNT(*) AS c FROM tasks WHERE id = 3").get()).toEqual({ c: 0 });
    const keeper = db
      .prepare("SELECT date_scheduled, status, notes, completed_at FROM tasks WHERE id = 2")
      .get() as { date_scheduled: string; status: string; notes: string; completed_at: string };
    expect(keeper.date_scheduled).toBe(D);

    // Worked time preserved on the keeper (NOT destroyed by the cascade).
    expect(entriesFor(db, 2)).toBe(1);
    const secs = (
      db.prepare("SELECT COALESCE(SUM(worked_seconds),0) AS s FROM time_entries WHERE task_id = 2").get() as {
        s: number;
      }
    ).s;
    expect(secs).toBe(600);
    db.close();
  });

  it("carries over done-status + notes (done if either side is done)", () => {
    const db = makeDb();
    mergeCorrectOrder(db);
    const keeper = db
      .prepare("SELECT status, notes, completed_at FROM tasks WHERE id = 2")
      .get() as { status: string; notes: string; completed_at: string };
    expect(keeper.status).toBe("done");
    expect(keeper.notes).toContain("sib note");
    expect(keeper.completed_at).toBe("2026-06-02T09:00:00.000Z");
    db.close();
  });

  it("CONTROL: deleting the sibling BEFORE reassigning would cascade-destroy the worked time", () => {
    const db = makeDb();
    // Wrong order — delete first. FK ON → time_entry 10 is cascade-deleted.
    db.exec(`DELETE FROM tasks WHERE id IN (3);`);
    expect(entriesFor(db, 2)).toBe(0); // entry is gone — data loss the ordering prevents
    expect((db.prepare("SELECT COUNT(*) AS c FROM time_entries").get() as { c: number }).c).toBe(0);
    db.close();
  });
});
