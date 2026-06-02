# Canonical Data Remediation — Plan of Record (Terse)

**Date:** 2026-06-02
**Source:** Verse-reviewed canonical-data audit (2026-06-02) — 20 confirmed findings, 0 P0.
**Author:** Terse
**Status:** Plan documented. Phase 1 awaiting go-ahead. Execution is **phased** — one phase (or the 1–2 bundle) at a time, each gated.

## Goal

A foundation where **every surface reads from one canonical source**, so any change propagates everywhere instantly and new features can't break by reading a stale private copy. Today the canonical store owns tasks (`tasksById` + date/week/project indices) but **not** projects or worked-minutes, and several surfaces hold private `useState` copies that only look correct because screens remount on navigation. This work removes those divergence classes.

---

## Ground rules (apply to every phase)

1. **New branch per phase**, never `main`:
   - `canonical/p1-task-reconcile`
   - `canonical/p2-worked-time`
   - `canonical/p3-projects-ById`
   - `canonical/p4-bypass-readers`
   - `canonical/p5-cross-webview`
2. **No DB schema changes / no migrations anywhere.** Every fix is store/selector/event wiring over existing columns + `time_entries`. If a column seems necessary — **STOP and relay the literal DDL to Verse first** (bytes freeze on first apply; see `docs/migration-discipline.md`).
3. **Validate** each phase via: `tsc --noEmit` + `npm run build` + `npm run lint` + `npm test` + `tauri dev` HMR. **Do NOT reinstall to `/Applications`** unless Nick explicitly asks.
4. **Gating** (architectural, so phase gates apply):
   - Phases **1–2** may ship together under **one** Verse review.
   - Phase **3** (`projectsById`) requires a **design sign-off from Verse BEFORE code** — relay the store-shape design first.
   - Phases **4–5** reviewed at completion.
5. Sub-agents may be used but report to Terse; they cannot spawn their own.
6. **Non-negotiable discipline (carry into every phase):** every mutating store action **reconciles to DB truth via `withTaskMutated`/`withProjectMutated` on success, and refetches DB truth on failure.** No shallow map pokes.

### Branch-base note (flag for Nick/Verse before Phase 1 code)
The running/tested app currently builds on an **unmerged feature-branch stack** (`feat/date-range-field` → `feat/objective-colors-palette`, plus `fix/*` and `tweak/*` branches from this session — none merged to `main`). These canonical phase branches conventionally branch from `main`, but `main` lacks all that session work. **Decision needed:** merge the reviewed feature branches into `main` first (clean base for canonical work), or stack the canonical branches on the current feature tip? Recommend merging the approved branches to `main` first. This doc was committed on `canonical/p1-task-reconcile` cut from the current tip to avoid disturbing the live app; rebase once the base is decided.

---

## PHASE 1 — Live task-correctness bugs (surgical, low-risk)

**Branch:** `canonical/p1-task-reconcile`

### 1a. `setTaskStatus` must reconcile (audit finding #8)
- **Where:** `src/stores/appStore.ts` (~1303–1329); DB transform `src/db/queries.ts:558–569`.
- **Bug:** the optimistic patch only flips `status`. It ignores the DB's `completed_at` stamp and the **future-date snap** (a `done` task scheduled in the future is snapped to today by the DB layer). So the store diverges from DB truth on completion.
- **Fix:** on success, refetch via `getTaskById(id)` and route through `withTaskMutated(s, current, fresh)` so `completed_at`, the snapped `date_scheduled`, and the **date/week index transitions** all land. Mirror the existing failure-path refetch.

### 1b. `setTaskHighlight` must reconcile
- **Where:** `src/stores/appStore.ts`.
- **Fix:** route the success patch through `withTaskMutated(s, current, next)` instead of a direct map set, so any future index-membership transition happens automatically. (This is the anti-example for Guardrail #2.)

**Validate:** `build` + `lint` + existing `workedSeconds.integrity` / `shutdownRollover.integrity` tests. Then **"Ready for Verse review"** (bundled with Phase 2).

---

## PHASE 2 — Make worked-minutes canonical

**Branch:** `canonical/p2-worked-time`

Worked-minutes today lives in `time_entries` + a live focus tick + **per-screen private `workedMap`s** that diverge (row pill says 25m, day total says 0m).

### 2a. Store-owned worked index
Add canonical `workedByTaskId: Map<number, number>` (committed minutes per task) to `appStore`, plus selectors. `setTaskWorkedMinutesAction` updates it and reconciles to DB truth, so all consumers re-render off one source.

### 2b. One "worked incl. live session" derivation
A single canonical helper = committed DB minutes + live focus contribution for the active task. Consume it in **all** worked-minutes surfaces:
- `src/pages/DailyPlanner.tsx` — row pills + day-total header
- `src/pages/Dashboard.tsx`
- `src/pages/ProjectDetail.tsx` — per-task badge
- `src/components/TaskDetailOverlayHost.tsx`

This removes the divergence class (one definition of "worked").

### 2c. Fix the inline-complete race
- **Where:** `src/pages/DailyPlanner.tsx` + `src/pages/FocusMode.tsx` auto-stop.
- **Bug:** completing the live-focused task can read worked-minutes before the async auto-stop commits `end_time`, under-counting the day.
- **Fix:** settle worked-time through a store action that resolves **only after** the entry is committed; have `toggleTask` **await** it before reading totals.

**Validate** as Phase 1. **"Ready for Verse review"** (completes the 1–2 bundle).

---

## PHASE 3 — Lift projects into `projectsById` (KEYSTONE)

**Branch:** `canonical/p3-projects-ById` — **DESIGN SIGN-OFF FROM VERSE REQUIRED BEFORE CODE.** Relay the store-shape design first.

### 3a. Canonical projects store
Add `projectsById: Map<number, Project>` to `appStore` with secondary indices (active, archived) and `withProjectInserted/Mutated/Removed` transitions — **mirror the `tasksById` pattern exactly.**

### 3b. Selectors
Expose `selectProjectById`, `selectActiveObjectiveOptions` (replacing `activeObjectiveOptions` + the hand-replicated `getProjects()` filters), `selectProjectsByStatus`.

### 3c. Route every project mutation through reconciling store actions
create / rename / recolor / complete / archive / delete / reorder / set-icon. **On delete, mirror the DB's `ON DELETE SET NULL`** — clear `project_id` on affected tasks in `tasksById` (fixes a real latent orphan divergence the audit found).

### 3d. Replace all 12 private project copies with selectors
`useState<Project[]>` / `useState<Project|null>` in: SummaryOverlay, TaskDetailOverlayHost, PastShutdowns, Projects, WeeklyShutdown, Dashboard, DailyPlanner, ProjectDetail, weekly-plan/PlanTab, weekly-plan/ScheduleTab, DailyShutdown, QuickAdd. **Retire the in-window `verseday:project-changed` DOM bus** (cross-webview handled in Phase 5).

### 3e. Lint guard
Add an eslint rule banning `useState<Project>` (clone the existing `useState<Task>` guard in `eslint.config.js`).

**Validate** + **"Ready for Verse review."**

---

## PHASE 4 — Convert the bypass readers (kill the remount crutch)

**Branch:** `canonical/p4-bypass-readers`

These render correct **only** because screens remount on navigation. Convert to store selectors so they're correct without remount:
- **Dashboard** `weekTasks` / `recentCompleted` → `selectTaskIdsByWeek(selectedWeek)` + `tasksById` (`src/pages/Dashboard.tsx`; migration noted in a comment ~line 165).
- **SummaryOverlay** three lists → `selectTaskIdsByDate` / `selectTaskIdsByWeek` (`src/components/SummaryOverlay.tsx`).
- **RepeatingTasksSettings** templates → store selector / refresh on store change (`src/components/settings/RepeatingTasksSettings.tsx`); and **route recurrence edits through store actions** — `setTaskRecurrence` must refetch the template via `getTaskById` + `withTaskMutated` (NULLing `date_scheduled` must drop it from date/week buckets).

**Validate** + **"Ready for Verse review."**

---

## PHASE 5 — Cross-webview bridge (QuickAdd seam)

**Branch:** `canonical/p5-cross-webview`

DOM `CustomEvent`s can't cross Tauri webviews; QuickAdd stays fresh only via focus-refetch, and its custom-icon library is frozen to app-boot state (see memory: QuickAdd is a separate webview).
- Promote `verseday:project-changed` and `verseday:icons-changed` to **Tauri events** (mirror the existing `system-resumed` pattern). QuickAdd listens and reloads (projects + icon library) — or reads the canonical store hydrated from the shared DB on focus.
- Fold in the already-Verse-approved `verseday:task-created` emit/listen (QuickAdd → main window `loadTasksForDate`) — it belongs to this seam. (Currently committed on `fix/task-adders`; consolidate here.)

**Validate** + **"Ready for Verse review."**

---

## Guardrails that keep it at 100% (apply throughout; verify at final review)

1. **eslint bans both** `useState<Task>` **and** `useState<Project>`.
2. **Every mutating store action:** reconcile via `with*Mutated` on success, refetch DB truth on failure — **no direct map pokes** (the `setTaskHighlight` pattern is the anti-example).
3. **One propagation mechanism:** store subscription in-window; Tauri events **only** for the cross-webview seam. The DOM-CustomEvent bus is retired.
4. **Any new DB write fn must have a store action that reconciles it.** A raw `queries.ts` write called directly from a component is the bug pattern (e.g. FocusMode's raw `updateTaskStatus`); audit for these in the final pass.

## Out of scope / flagged to Verse

- **No schema changes.** If worked-time canonicalization tempts a new column — **stop, relay DDL to Verse.**
- **Calendar-sync and rollover write the DB directly** (audit confirmed: real divergences masked by remount). **Not** in these 5 phases. They are the **next** canonical target after Phase 4 removes the remount crutch — they'll need the same store-action reconciliation treatment, and **Verse should scope that separately.**

## Validation log (filled in per phase as work lands)

| Phase | Branch | tsc | build | lint | test | HMR | Verse |
|---|---|---|---|---|---|---|---|
| 1 | canonical/p1-task-reconcile | ✅ | ✅ | 21 (0 new) | 30/30 | ✅ | APPROVED (bundled w/ 2) — merged to main 2026-06-02 |
| 2 | canonical/p2-worked-time | ✅ | ✅ | 21 (0 new) | 34/34 (+4) | ✅ | APPROVED — merged to main 2026-06-02 |
| 3 | canonical/p3-projects-ById | — | — | — | — | — | design APPROVED (derived selectors + useShallow); code staged 3a–c then 3d |
| 4 | canonical/p4-bypass-readers | — | — | — | — | — | pending |
| 5 | canonical/p5-cross-webview | — | — | — | — | — | pending |

**Lint baseline:** 21 errors on post-cleanup main (pre-existing unused-vars in the deferred-#9 ProjectDetail subsystem + a broken `react-hooks/exhaustive-deps` rule ref). Each phase holds at 21 with 0 new. Phase 3 adds the `useState<Project>` ban.

**Cleanup re-derivation** (`cleanup/dead-code-rederive`) merged to main 2026-06-02 (−321 net); plus the session's reviewed fixes (task-adders, date-range-field, duration, palette, dashboard, recurring-collision + ghost-row, settings). All local — **not pushed**.

**Phase 3 design conditions (Verse, 2026-06-02):** derived selectors consumed with `useShallow` for list-returning ones (`selectActiveObjectiveOptions`, `selectProjectsByStatus`) — non-optional; `selectProjectById` needs no wrapper. Preserve each consumer's existing sort (objective options name-ordered; grid by sort_order/priority). `setProjectIconAction` reconciles icon + custom_icon_id. `reorderProjectsAction` wraps existing `updateProjectSortOrders` (non-optimistic SQL-then-map). Retire the in-window `verseday:project-changed` bus entirely (listeners AND emitters, ~50 sites); QuickAdd's focus-refetch stays until Phase 5.
