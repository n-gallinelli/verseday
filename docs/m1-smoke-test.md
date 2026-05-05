# M1 Runtime Verification Snippet

After `npm run tauri dev` starts, open DevTools (Cmd+Opt+I in the app) → Console, paste the script below.

This covers Verse's three verification axes:

1. Migration applied cleanly (app loaded → v1→v17 ran)
2. CHECK constraints reject bad input (`day_offset=5`, `minutes=-1`, `minutes=9999`, `status='foo'`)
3. FK enforcement — `ON DELETE CASCADE` actually fires (S2)

## The snippet

```js
(async () => {
  const q = await import("/src/db/queries.ts");
  const { getDb } = await import("/src/db/database.ts");
  const db = await getDb();

  const log = (ok, msg) => console.log(`${ok ? "PASS" : "FAIL"}: ${msg}`);
  const expectThrow = async (label, fn) => {
    try { await fn(); log(false, `${label} should have thrown`); }
    catch (e) { log(true, `${label} rejected — ${String(e).slice(0, 100)}`); }
  };

  console.log("── M1 verification ──");

  // 1. CHECK rejection — day_offset out of range
  await expectThrow("day_offset=5", () =>
    q.setWeeklyPlanCommitment("2026-05-04", 1, 5, 30));

  // 2. CHECK rejection — minutes negative
  await expectThrow("minutes=-1", () =>
    q.setWeeklyPlanCommitment("2026-05-04", 1, 0, -1));

  // 3. CHECK rejection — minutes > 1440
  await expectThrow("minutes=9999", () =>
    q.setWeeklyPlanCommitment("2026-05-04", 1, 0, 9999));

  // 4. CHECK rejection — invalid status
  await expectThrow("status=foo", () =>
    q.setWeeklyPlanProjectStatus("2026-05-04", 1, "foo"));

  // 5. Round-trip + FK CASCADE — create a throwaway project, attach
  // commitments + status, delete the project, verify both rows are gone.
  const created = await db.execute(
    "INSERT INTO projects (name, color) VALUES ('__verify_throwaway', '#809BC2')"
  );
  const projId = created.lastInsertId;
  console.log(`(throwaway project id = ${projId})`);

  const week = "2026-05-04";
  await q.setWeeklyPlanCommitment(week, projId, 0, 30);
  await q.setWeeklyPlanCommitment(week, projId, 2, 60);
  await q.setWeeklyPlanProjectStatus(week, projId, "planned");

  const before = await q.getWeeklyPlanCommitments(week);
  const beforeMap = before.get(projId);
  log(beforeMap?.get(0) === 30 && beforeMap?.get(2) === 60,
      "round-trip — commitments read back as written");

  const beforeStatuses = await q.getWeeklyPlanProjectStatuses(week);
  log(beforeStatuses.get(projId) === "planned",
      "round-trip — status reads back as written");

  // Delete the project — should cascade.
  await db.execute("DELETE FROM projects WHERE id = $1", [projId]);

  const afterCom = await db.select(
    "SELECT COUNT(*) AS n FROM weekly_plan_commitments WHERE project_id = $1",
    [projId]
  );
  log(afterCom[0].n === 0,
      "FK CASCADE — commitments removed when parent project deleted");

  const afterStatus = await db.select(
    "SELECT COUNT(*) AS n FROM weekly_plan_project_status WHERE project_id = $1",
    [projId]
  );
  log(afterStatus[0].n === 0,
      "FK CASCADE — status removed when parent project deleted");

  console.log("── done ──");
})();
```

## Expected output

```
── M1 verification ──
PASS: day_offset=5 rejected — …
PASS: minutes=-1 rejected — …
PASS: minutes=9999 rejected — …
PASS: status=foo rejected — …
(throwaway project id = N)
PASS: round-trip — commitments read back as written
PASS: round-trip — status reads back as written
PASS: FK CASCADE — commitments removed when parent project deleted
PASS: FK CASCADE — status removed when parent project deleted
── done ──
```

If any line is `FAIL`, paste the line back so we can investigate before M2a.

## Cleanup

The throwaway project is deleted by the script itself. Nothing to clean up afterward.

This file lives in `/docs` only as long as M1 verification is needed. It can be removed at the M6 polish milestone or kept as a reference for future migrations.
