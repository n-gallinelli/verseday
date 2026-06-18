import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { shouldSuppressEarlyCompletion } from "./queries";

// Early-completion suppression — completing a WEEKLY recurring instance before
// its scheduled day records a skip for the original date so the next
// generateRecurringInstances doesn't recreate it (the bug: a Thursday task done
// Wednesday correctly snapped to Wednesday but Thursday regenerated). Pure
// decision tested directly; the SQL effect + reopen behavior pinned against an
// in-memory SQLite mirroring production (literals substituted for params).

const WEEKLY_THU = JSON.stringify({ freq: "weekly", day: 4 });
const BIWEEKLY_THU = JSON.stringify({ freq: "weekly", day: 4, interval: 2 });
const DAILY = JSON.stringify({ freq: "daily" });
const WEEKDAYS = JSON.stringify({ freq: "weekdays" });

describe("shouldSuppressEarlyCompletion (pure decision)", () => {
  it("suppresses a weekly instance completed before its day", () => {
    // Thursday instance, completed on Wednesday.
    expect(shouldSuppressEarlyCompletion(1, "2026-06-18", WEEKLY_THU, "2026-06-17")).toBe(true);
  });

  it("suppresses regardless of how many days early (no window cap)", () => {
    // 4 days early still satisfies the one weekly occurrence.
    expect(shouldSuppressEarlyCompletion(1, "2026-06-18", WEEKLY_THU, "2026-06-14")).toBe(true);
    // every-other-week behaves the same — suppression is per dated occurrence.
    expect(shouldSuppressEarlyCompletion(1, "2026-06-18", BIWEEKLY_THU, "2026-06-16")).toBe(true);
  });

  it("does NOT suppress when completed on or after its scheduled day", () => {
    // Same day → normal completion.
    expect(shouldSuppressEarlyCompletion(1, "2026-06-18", WEEKLY_THU, "2026-06-18")).toBe(false);
    // A late completion (missed instance, today past its date) → no suppression.
    expect(shouldSuppressEarlyCompletion(1, "2026-06-18", WEEKLY_THU, "2026-06-19")).toBe(false);
  });

  it("does NOT suppress daily or weekdays (next day has its own instance)", () => {
    expect(shouldSuppressEarlyCompletion(1, "2026-06-18", DAILY, "2026-06-17")).toBe(false);
    expect(shouldSuppressEarlyCompletion(1, "2026-06-18", WEEKDAYS, "2026-06-17")).toBe(false);
  });

  it("does NOT suppress a non-recurring task or one with no date", () => {
    expect(shouldSuppressEarlyCompletion(null, "2026-06-18", WEEKLY_THU, "2026-06-17")).toBe(false);
    expect(shouldSuppressEarlyCompletion(1, null, WEEKLY_THU, "2026-06-17")).toBe(false);
    // recurrence_source_id set but template has no/garbage recurrence.
    expect(shouldSuppressEarlyCompletion(1, "2026-06-18", null, "2026-06-17")).toBe(false);
  });
});

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY,
      title TEXT,
      status TEXT DEFAULT 'todo',
      completed_at TEXT,
      date_scheduled TEXT,
      recurrence TEXT,
      recurrence_source_id INTEGER,
      suppressed_cycle_date TEXT
    );
    CREATE TABLE recurring_instance_skips (
      recurrence_source_id INTEGER NOT NULL,
      date_scheduled TEXT NOT NULL,
      PRIMARY KEY (recurrence_source_id, date_scheduled)
    );
  `);
  return db;
}

/** Mirror updateTaskStatus' done-branch sequence: capture pre-snap date, snap
 *  future→today, then insert the suppression skip iff the pure decision says so. */
function completeEarly(db: DatabaseSync, id: number, today: string) {
  const before = db
    .prepare("SELECT date_scheduled, recurrence_source_id FROM tasks WHERE id = ?")
    .get(id) as { date_scheduled: string | null; recurrence_source_id: number | null };
  db.exec(
    `UPDATE tasks SET status='done',
       date_scheduled = CASE WHEN date_scheduled IS NOT NULL AND date_scheduled > '${today}' THEN '${today}' ELSE date_scheduled END
     WHERE id = ${id}`
  );
  if (before.recurrence_source_id != null && before.date_scheduled != null && before.date_scheduled > today) {
    const tmpl = db
      .prepare("SELECT recurrence FROM tasks WHERE id = ?")
      .get(before.recurrence_source_id) as { recurrence: string | null } | undefined;
    if (shouldSuppressEarlyCompletion(before.recurrence_source_id, before.date_scheduled, tmpl?.recurrence ?? null, today)) {
      db.exec(
        `INSERT INTO recurring_instance_skips (recurrence_source_id, date_scheduled) VALUES (${before.recurrence_source_id}, '${before.date_scheduled}') ON CONFLICT DO NOTHING`
      );
      db.exec(`UPDATE tasks SET suppressed_cycle_date = '${before.date_scheduled}' WHERE id = ${id}`);
    }
  }
}

/** Mirror updateTaskStatus' reopen (non-done) branch: if the row carries a
 *  suppressed_cycle_date, restore date + clear marker, then drop the skip. */
function reopen(db: DatabaseSync, id: number) {
  const before = db
    .prepare("SELECT recurrence_source_id, suppressed_cycle_date FROM tasks WHERE id = ?")
    .get(id) as { recurrence_source_id: number | null; suppressed_cycle_date: string | null };
  if (before.suppressed_cycle_date != null && before.recurrence_source_id != null) {
    db.exec(
      `UPDATE tasks SET status='todo', completed_at=NULL, date_scheduled='${before.suppressed_cycle_date}', suppressed_cycle_date=NULL WHERE id = ${id}`
    );
    db.exec(
      `DELETE FROM recurring_instance_skips WHERE recurrence_source_id = ${before.recurrence_source_id} AND date_scheduled = '${before.suppressed_cycle_date}'`
    );
  } else {
    db.exec(`UPDATE tasks SET status='todo', completed_at=NULL WHERE id = ${id}`);
  }
}

function skipCount(db: DatabaseSync, sourceId: number, date: string): number {
  return (
    db
      .prepare("SELECT COUNT(*) AS c FROM recurring_instance_skips WHERE recurrence_source_id = ? AND date_scheduled = ?")
      .get(sourceId, date) as { c: number }
  ).c;
}

describe("early-completion SQL effect", () => {
  it("snaps the instance to today, records a skip, AND stamps suppressed_cycle_date", () => {
    const db = makeDb();
    db.exec(`INSERT INTO tasks (id, title, recurrence) VALUES (1, 'GWBR', '${WEEKLY_THU}')`);
    db.exec("INSERT INTO tasks (id, title, date_scheduled, recurrence_source_id) VALUES (2, 'GWBR', '2026-06-18', 1)");

    completeEarly(db, 2, "2026-06-17"); // done Wednesday for a Thursday instance

    const inst = db.prepare("SELECT status, date_scheduled, suppressed_cycle_date FROM tasks WHERE id = 2").get() as {
      status: string;
      date_scheduled: string;
      suppressed_cycle_date: string | null;
    };
    expect(inst.status).toBe("done");
    expect(inst.date_scheduled).toBe("2026-06-17"); // snapped to the day it was done
    expect(inst.suppressed_cycle_date).toBe("2026-06-18"); // original due day remembered
    expect(skipCount(db, 1, "2026-06-18")).toBe(1); // Thursday's cycle suppressed
    db.close();
  });

  it("does not record a skip for a daily instance completed early", () => {
    const db = makeDb();
    db.exec(`INSERT INTO tasks (id, title, recurrence) VALUES (1, 'Standup', '${DAILY}')`);
    db.exec("INSERT INTO tasks (id, title, date_scheduled, recurrence_source_id) VALUES (2, 'Standup', '2026-06-18', 1)");

    completeEarly(db, 2, "2026-06-17");

    expect(skipCount(db, 1, "2026-06-18")).toBe(0);
    db.close();
  });

  it("reopening fully reverses: restores the due date, clears the marker, drops the skip", () => {
    const db = makeDb();
    db.exec(`INSERT INTO tasks (id, title, recurrence) VALUES (1, 'GWBR', '${WEEKLY_THU}')`);
    db.exec("INSERT INTO tasks (id, title, date_scheduled, recurrence_source_id) VALUES (2, 'GWBR', '2026-06-18', 1)");
    completeEarly(db, 2, "2026-06-17");
    expect(skipCount(db, 1, "2026-06-18")).toBe(1);

    reopen(db, 2);

    const inst = db.prepare("SELECT status, date_scheduled, suppressed_cycle_date FROM tasks WHERE id = 2").get() as {
      status: string;
      date_scheduled: string;
      suppressed_cycle_date: string | null;
    };
    expect(inst.status).toBe("todo");
    expect(inst.date_scheduled).toBe("2026-06-18"); // back to its real Thursday
    expect(inst.suppressed_cycle_date).toBeNull(); // marker cleared
    expect(skipCount(db, 1, "2026-06-18")).toBe(0); // cycle un-suppressed → regenerates
    db.close();
  });

  it("reopening a normal (non-suppressed) done task touches nothing extra", () => {
    const db = makeDb();
    // A plain non-recurring task completed today, then reopened.
    db.exec("INSERT INTO tasks (id, title, status, date_scheduled) VALUES (5, 'Email', 'done', '2026-06-17')");
    reopen(db, 5);
    const t = db.prepare("SELECT status, date_scheduled, suppressed_cycle_date FROM tasks WHERE id = 5").get() as {
      status: string;
      date_scheduled: string;
      suppressed_cycle_date: string | null;
    };
    expect(t.status).toBe("todo");
    expect(t.date_scheduled).toBe("2026-06-17"); // unchanged — no marker, no move
    expect(t.suppressed_cycle_date).toBeNull();
    db.close();
  });
});
