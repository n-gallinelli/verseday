import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";

// #11 — createTask computes sort_order = min(scope) - 1 INSIDE the INSERT as a
// subquery (single atomic statement) instead of SELECT-then-INSERT. This pins
// that the subquery form yields the same top-of-scope ordering and is a single
// statement (no read-then-write window two concurrent creates could race).

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY,
      title TEXT,
      project_id INTEGER,
      date_scheduled TEXT,
      estimated_minutes INTEGER,
      priority TEXT DEFAULT 'medium',
      notes TEXT,
      sort_order INTEGER
    );
  `);
  return db;
}

const INSERT_DATE_SCOPE = `INSERT INTO tasks (title, project_id, date_scheduled, estimated_minutes, priority, notes, sort_order)
  VALUES (?, NULL, ?, NULL, 'medium', NULL,
          (SELECT COALESCE(MIN(sort_order), 1) - 1 FROM tasks WHERE date_scheduled = ?));`;

function sortOrderOf(db: DatabaseSync, title: string): number {
  return (db.prepare("SELECT sort_order AS s FROM tasks WHERE title = ?").get(title) as { s: number }).s;
}

describe("#11 createTask sort_order subquery", () => {
  it("first task in an empty scope gets 0, each next decrements (lands on top)", () => {
    const db = makeDb();
    db.prepare(INSERT_DATE_SCOPE).run("A", "2026-06-10", "2026-06-10");
    db.prepare(INSERT_DATE_SCOPE).run("B", "2026-06-10", "2026-06-10");
    db.prepare(INSERT_DATE_SCOPE).run("C", "2026-06-10", "2026-06-10");
    expect(sortOrderOf(db, "A")).toBe(0);
    expect(sortOrderOf(db, "B")).toBe(-1);
    expect(sortOrderOf(db, "C")).toBe(-2);
    db.close();
  });

  it("scopes are independent (a different date starts fresh at 0)", () => {
    const db = makeDb();
    db.prepare(INSERT_DATE_SCOPE).run("A", "2026-06-10", "2026-06-10");
    db.prepare(INSERT_DATE_SCOPE).run("X", "2026-06-11", "2026-06-11");
    expect(sortOrderOf(db, "A")).toBe(0);
    expect(sortOrderOf(db, "X")).toBe(0); // different date scope, unaffected by A
    db.close();
  });
});
