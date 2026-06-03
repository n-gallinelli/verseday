import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { ESTIMATE_BACKFILL_ENTRY_TYPE } from "./queries";

// Pins the estimate-backfill behavior (Verse Option 1) at the SQL level — the
// store (setTaskStatus) orchestrates, but these are the exact statements it
// runs. Completing an UNtimed task that has an estimate stamps a tagged
// 'estimate_backfill' entry so its time-spent reflects the estimate; reopening
// strips it; all read queries still count it (no exclusion filters). The guard
// is on RAW worked_seconds, not rounded minutes.
//
// The active-focus skip (`get().focus?.taskId !== id`) is a store-level guard,
// not SQL — it's a plain conditional and is exercised by the store path.

const NOW = "2026-06-03T12:00:00.000Z";
const START = "2026-06-03T11:50:00.000Z";

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE time_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT,
    entry_type TEXT DEFAULT 'tracked',
    worked_seconds INTEGER DEFAULT 0
  );`);
  return db;
}

// Production guard read: raw committed worked seconds (closed entries only).
function workedSeconds(db: DatabaseSync, taskId: number): number {
  return (
    db
      .prepare(
        "SELECT COALESCE(SUM(worked_seconds),0) AS s FROM time_entries WHERE task_id = ? AND end_time IS NOT NULL",
      )
      .get(taskId) as { s: number }
  ).s;
}

function insertTracked(db: DatabaseSync, taskId: number, seconds: number) {
  db.prepare(
    "INSERT INTO time_entries (task_id, start_time, end_time, entry_type, worked_seconds) VALUES (?, ?, ?, 'tracked', ?)",
  ).run(taskId, START, NOW, seconds);
}

// Mirrors setTaskStatus' done hook: backfill iff est>0 AND raw worked == 0.
function completeUntimed(db: DatabaseSync, taskId: number, estMinutes: number) {
  if (estMinutes > 0 && workedSeconds(db, taskId) === 0) {
    db.prepare(
      "INSERT INTO time_entries (task_id, start_time, end_time, entry_type, worked_seconds) VALUES (?, ?, ?, ?, ?)",
    ).run(taskId, START, NOW, ESTIMATE_BACKFILL_ENTRY_TYPE, estMinutes * 60);
  }
}

// Mirrors the reopen branch (done → not-done).
function reopen(db: DatabaseSync, taskId: number) {
  db.prepare(
    "DELETE FROM time_entries WHERE task_id = ? AND entry_type = ?",
  ).run(taskId, ESTIMATE_BACKFILL_ENTRY_TYPE);
}

function backfillEntries(db: DatabaseSync, taskId: number) {
  return db
    .prepare(
      "SELECT worked_seconds FROM time_entries WHERE task_id = ? AND entry_type = ?",
    )
    .all(taskId, ESTIMATE_BACKFILL_ENTRY_TYPE) as { worked_seconds: number }[];
}

describe("estimate backfill (Verse Option 1)", () => {
  it("untimed task with an estimate is backfilled to the estimate", () => {
    const db = makeDb();
    completeUntimed(db, 1, 10);
    expect(workedSeconds(db, 1)).toBe(600); // 10 min
    db.close();
  });

  it("the backfill entry carries entry_type='estimate_backfill'", () => {
    const db = makeDb();
    completeUntimed(db, 1, 10);
    const ents = backfillEntries(db, 1);
    expect(ents.length).toBe(1);
    expect(ents[0].worked_seconds).toBe(600);
    db.close();
  });

  it("a task that already has tracked time is NOT backfilled (no stacking)", () => {
    const db = makeDb();
    insertTracked(db, 1, 300); // 5 min real
    completeUntimed(db, 1, 10);
    expect(workedSeconds(db, 1)).toBe(300); // unchanged
    expect(backfillEntries(db, 1).length).toBe(0);
    db.close();
  });

  it("RAW-seconds guard: 1–29s of real time (rounds to 0 min) still blocks backfill", () => {
    const db = makeDb();
    insertTracked(db, 1, 10); // 10 seconds → rounds to 0 min
    completeUntimed(db, 1, 10);
    expect(workedSeconds(db, 1)).toBe(10); // NOT 10 + 600
    db.close();
  });

  it("no estimate → no backfill", () => {
    const db = makeDb();
    completeUntimed(db, 1, 0);
    expect(workedSeconds(db, 1)).toBe(0);
    expect(backfillEntries(db, 1).length).toBe(0);
    db.close();
  });

  it("reopen strips the backfill (worked returns to 0)", () => {
    const db = makeDb();
    completeUntimed(db, 1, 10);
    expect(workedSeconds(db, 1)).toBe(600);
    reopen(db, 1);
    expect(workedSeconds(db, 1)).toBe(0);
    expect(backfillEntries(db, 1).length).toBe(0);
    db.close();
  });

  it("re-complete after reopen backfills exactly once (no stacking)", () => {
    const db = makeDb();
    completeUntimed(db, 1, 10);
    reopen(db, 1);
    completeUntimed(db, 1, 10);
    expect(workedSeconds(db, 1)).toBe(600); // one estimate, not 1200
    expect(backfillEntries(db, 1).length).toBe(1);
    db.close();
  });

  it("reopen leaves real tracked time intact — only strips the backfill", () => {
    const db = makeDb();
    insertTracked(db, 1, 300);
    completeUntimed(db, 1, 10); // already timed → no backfill
    reopen(db, 1); // strips backfill (none); real time survives
    expect(workedSeconds(db, 1)).toBe(300);
    db.close();
  });
});
