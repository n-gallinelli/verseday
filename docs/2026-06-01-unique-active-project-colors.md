# Unique colors for active projects

**Date:** 2026-06-01
**Branch:** `feat/unique-active-project-colors`
**Author:** Terse
**Status:** IMPLEMENTED — Verse APPROVED (with conditions, satisfied below)

## Requirement

No two **active** projects may share the same color. Enforced permanently,
going forward ("verseday" = from now on, confirmed with Nick).

## Definition of "active"

In this codebase, `getProjects(false)` filters by `archived = 0` only;
`completed` is a separate flag that does **not** remove a project from the
active list. So **active = `archived = 0`**. A completed-but-not-archived
project still counts as active and reserves its color. Archived projects are
free to share colors with anyone (and with each other).

## Decisions

1. **Enforce at the DB/query layer** (`src/db/queries.ts`), not via a SQL
   constraint. There is no canonical project store (each screen loads its own
   `useState<Project[]>`), so the query layer is the single real choke point
   every create/edit flows through. This also avoids a new migration — the
   migration-discipline rule keeps applied migrations frozen, and a partial
   unique index isn't worth a migration here. (Optional future hardening: a
   `CREATE UNIQUE INDEX ... WHERE archived = 0` partial index in a *new*
   migration. Out of scope for now.)

2. **Guard helper** `assertColorAvailable(color, excludeId?)`: queries active
   projects for that color, throws a typed error if another active project
   (≠ excludeId) already uses it. Reuses the existing throw-on-invalid pattern
   alongside `validateColor`.

3. **Enforcement points:**
   - `createProject` — new project must not reuse an active color.
   - `updateProject` — exclude the project's own id; changing a color can't
     collide with another active project.
   - `archiveProject(id, false)` (un-archiving / re-activating) — a project
     coming back to active must not collide. If it does, throw so the caller
     can prompt for a recolor.
   - `completeProject` — no guard needed (completing keeps it active but
     doesn't change color; un-completing doesn't change archived state).

4. **UI:** color pickers (`NewProjectPanel`, `Projects` inline add,
   `ProjectDetail` header) disable/hide colors already taken by other active
   projects, and surface the thrown error as a clear message instead of a
   silent failure. `pickDefaultColor` already prefers unused colors — keep it,
   but the DB guard is now the source of truth.

5. **Palette capacity caveat:** the primary picker shows 8 colors. With ≥8
   active projects every primary color is taken and the picker would be empty.
   The 16 legacy preset colors remain valid via `validateColor`, so we fall
   back to offering those before showing "no colors available". Flag to Verse:
   hard cap of 24 active projects before colors are exhausted — acceptable for
   a single-user app.

## Modules / changes (small, isolated)

- `src/db/queries.ts` — add `assertColorAvailable`; call it in
  `createProject`, `updateProject`, `archiveProject` (un-archive path).
- `src/components/NewProjectPanel.tsx` — disable taken colors in picker.
- `src/pages/Projects.tsx` — disable taken colors in inline add.
- `src/pages/ProjectDetail.tsx` — disable taken colors; show error on conflict.
- This doc + changelog entry.

## Verse conditions

- **Condition 1 (BLOCKING) — undo-archive must handle the throw.** Done.
  The undo toast at `Projects.tsx` wraps `archiveProject(id, false)` in
  try/catch and routes the conflict to the existing `ErrorBanner` with a
  clear, recoverable message ("That color is already used by another active
  project — pick a different one."). No thrown stack, no silent no-op.
- **Condition 2 (document) — SELECT-then-INSERT race.** Documented in
  "Known limitations" below and in a comment on `assertColorAvailable`.
- **Note — fallback ordering.** Inline create prefers the 8 primaries, then
  the legacy presets, then the default. Primaries stay preferred.
- **Minor — caller reconciliation.** Confirmed: `NewProjectPanel.tsx` has **no
  importers** — it's a dead component. Not touched. The live create path is
  `Projects.tsx` (inline create → `createProject`). The only color *editor* is
  the `ColorPicker` in `ProjectDetail.tsx`, which now disables taken colors.

## Known limitations

- **Not transactional.** `assertColorAvailable` reads then the caller writes,
  with no enclosing transaction. Two near-simultaneous writes could both pass
  the check. Accepted for a single-user local SQLite app. The real fix, if it
  ever matters, is a partial unique index
  (`CREATE UNIQUE INDEX ... WHERE archived = 0`) in a *new* migration —
  noted, out of scope.
- **Palette ceiling.** 24 preset colors → at most 24 active projects before
  colors are exhausted. Creating beyond that throws a clear error rather than
  silently reusing a color.
- **No backfill.** Existing active projects that already share a color are
  left untouched ("going forward" scope). The rule only blocks *new*
  collisions.

## Backlog (not this PR)

- **Silent close-flush revert.** In the narrow race where another project
  claims a color *after* `loadData` ran, a user can pick that color, close the
  modal before the 600ms debounce fires, and see it quietly snap back on
  reopen with no explanation. Data-safe, single-user, narrow. Verse note: if
  the partial unique index ever lands as the real fix, fold a visible
  flush-failure toast in at the same time.

## Cost

Zero — local SQLite query, no new services. No money flag.

## Verification

`tsc` + `npm run build` + targeted code review (no manual UI test per Nick's
self-validate preference). Grep for all `createProject`/`updateProject`/
`archiveProject` callers to confirm every path is covered.
