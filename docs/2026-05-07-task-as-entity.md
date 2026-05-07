# Architectural Brief: Task as Entity, Not as Screen State

**Status:** Awaiting Terse plan
**Date:** 2026-05-07
**Author:** Verse
**Audience:** Terse
**Type:** Architecture directive — informs the next planning doc

---

## Why this exists

The pause-symmetry bug (`docs/2026-05-07-pause-symmetry.md`) is not a one-off. It's the visible tip of a structural problem: **screens currently own state that conceptually belongs to the entity itself.** Each surface (Daily Plan, Focus screen, PiP, Weekly Shutdown, Task Detail Overlay) holds its own view of "the task" and its own copy of session state, then tries to keep them in sync via ad-hoc IPC and prop drilling. They drift. The user notices. We patch. The next surface ships and the same class of bug recurs.

We are going to fix the **class**, not just the instance. Pause symmetry will then land as one application of the new pattern, not as a bespoke fix.

---

## The principle

A task is a **single entity** with a stable identity (its `id`). Every screen is a *view* of that entity. State that belongs to the entity — its fields, whether it's currently focused, whether the focus session is paused, whether the user is viewing its detail — lives in **one canonical place** (the store) and is referenced by ID. Screens subscribe; they do not own.

Stated as an invariant we will enforce in code review:

> If two screens can disagree about the value of X, then X is in the wrong place.

---

## The three rules

### Rule 1 — Entities are canonical, keyed by ID, in the store

Tasks live once, in `appStore`. Screens read by ID and mutate through store actions. No screen holds a copy of task data in `useState` and edits it locally. If a screen needs an editable draft (e.g., the detail overlay's "Save" / "Cancel" pattern), the **draft** is local state, but commit goes through `updateTask(id, patch)` and every other screen re-renders from the canonical record.

### Rule 2 — One mount per cross-screen surface

The task detail overlay is mounted **once**, at the app shell. Any screen that wants to "open the task" calls `openTaskDetail(id)` — which sets `selectedTaskDetailId` in the store. The overlay reads that ID and renders. Click from Daily Plan, Weekly Shutdown, Focus screen, PiP — all paths land at the same component instance reading the same canonical task. No screen renders its own overlay.

Apply the same rule to any other singleton surface (confirm dialogs, project picker, command palette).

### Rule 3 — Cross-screen UX state lives in the store

If more than one surface reacts to a piece of state, it belongs in the store. Concretely: `focus`, `selectedTaskDetailId`, `editingTaskId`, `paused`, `dragTargetId`. Local `useState` is reserved for state genuinely scoped to one screen — hover, expand-this-row, scroll position, open/closed of a screen-local accordion.

The test: *"if I navigate away and back, should this state survive?"* If yes → store. If no → local.

---

## What Terse needs to produce

A single planning doc — `docs/2026-05-07-task-as-entity-plan.md` — covering:

### 1. Audit
Walk every file in `src/pages/` and `src/components/` (currently ~265 `useState` call sites). For each one, classify:
- **(A) Genuinely local** — keep as-is. Justify in one phrase.
- **(B) Should be store state** — name the store field it should become.
- **(C) Ambiguous** — flag for Verse to rule on.

Output as a table grouped by file. Don't quote the code; cite `file.tsx:line` and the variable name.

### 2. Singleton surfaces inventory
List every modal/overlay/picker that more than one screen renders today. For each, name the canonical mount location (almost always `App.tsx`) and the store field that opens/closes it (`selectedTaskDetailId`, `projectPickerTargetId`, etc.). Confirm `TaskDetailOverlay` is in this list.

### 3. Refactor sequencing
Order the lifts so each milestone is independently shippable and reviewable. Suggested cuts (you may revise):
- **M1** — Task detail overlay singleton. Highest user-visible payoff, clearest scope.
- **M2** — Focus / pause state lift. This *is* the pause-symmetry fix, restated. The pause-symmetry doc becomes M2's design.
- **M3** — Remaining (B)-class lifts from the audit, grouped by area.
- **M4** — Add a lint rule or ESLint custom rule that flags `useState<Task>` and `useState<...Task...>` shapes in `pages/` and `components/`. Prevents regression.

Each milestone gets its own commit, on its own branch. Stop for Verse review at every milestone boundary.

### 4. Definition of done
We can call this work complete when all of the following hold:
- Grep for `useState<Task` and `useState<.*Task` in `src/pages/` and `src/components/` returns nothing that owns a task or task-list.
- The task detail overlay is mounted exactly once in the app tree.
- A change made to a task from any screen is visible on every other open screen without a manual reload or refetch.
- Pausing a focus session from any of {Focus screen, PiP, Daily Plan, Weekly Shutdown row} pauses it everywhere.
- The lint rule from M4 is in CI and green.

### 5. Risks to call out
At minimum:
- **Re-render scope.** Lifting state to the store means more components subscribe. Where a screen renders 100+ task rows, use selector functions and `shallow` equality to avoid storms. Call out which screens this matters for.
- **Persistence.** Some lifted state shouldn't persist to localStorage (e.g., `selectedTaskDetailId` should reset on app restart). Be explicit about which new store fields are persisted vs in-memory.
- **Migration of in-flight sessions.** Same concern as the pause-symmetry doc — be explicit per field.

---

## Constraints (non-negotiable)

- **Security:** none introduced — local state architecture only. No new IPC channels beyond what already exists. No new persisted secrets.
- **Budget:** zero. No paid services touched.
- **Migrations:** none. This is store/component refactor only. If you find yourself wanting to touch a SQL file, stop and check with Verse.
- **Branching:** new branch per `/CLAUDE.md` rules. Never main.

---

## Out of scope for this brief

- Server-side or sync-layer changes. The canonical store *is* the canonical client state; how it gets to/from the DB is unchanged.
- Performance optimization beyond the re-render concern called out above. Don't pre-optimize.
- Visual / UX changes. Pure architectural refactor — the user should see the same surfaces, just behaving consistently.
- Rewriting the pause-symmetry doc. It survives as M2's design, with the corrections from my prior review applied.

---

## Process

1. Terse produces `docs/2026-05-07-task-as-entity-plan.md` per §"What Terse needs to produce."
2. Verse reviews. Approves or rejects with specific revisions.
3. Approved plan → branch → M1 → STOP, Ready for Verse review → M2 → ...
4. The corrections required on the pause-symmetry doc fold into M2's design. Re-submit that doc as part of M2.

Ready for Terse.
