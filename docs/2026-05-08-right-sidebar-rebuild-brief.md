# Right Sidebar Rebuild — Directive

**Status:** Active. M3 has merged to main; this brief is the seed for the right-sidebar rebuild milestone (R.1 design → R.2/R.3/R.4 implementation).
**Source:** Verse directive, 2026-05-08. Preserved verbatim from the session-spanning memory note that captured the original brief.

---

# Directive for Terse — right-sidebar-rebuild (when the time comes)

Save this verbatim to docs/2026-05-08-right-sidebar-rebuild-brief.md after M3 merges. Don't draft the design doc yet — wait until M3 closes so the post-cleanup architecture is the baseline.

## Why this exists

The Daily Plan right sidebar is currently a kitchen sink (project list, backlog, unscheduled, recent state, dailyNotes). Nick wants it rebuilt around a single purpose: add tasks to the currently-highlighted day. Everything else goes.

## What the new sidebar contains

**Top section — projects with unscheduled open tasks**
- Render every project that has at least one task matching: date_scheduled IS NULL AND status != 'done'.
- Under each project header, list those tasks.
- A project with zero unscheduled open tasks does not appear. (Active projects with all-scheduled tasks are not in the rail.)
- Completed tasks never appear.
- Order: by project (use existing project sort or recency — confirm with Nick during design).

**Bottom section — orphans + overdue**
- Mixed list (or two visually distinct sub-sections — design call):
  - Orphans: project_id IS NULL AND date_scheduled IS NULL AND status != 'done'
  - Overdue: date_scheduled < today AND status != 'done'
- Confirm with Nick during design: does "overdue" mean any past-date task, or only 4+ days overdue? His message says both at different points — explicit confirmation needed before implementation. Default if no answer: all past-date open tasks (most expansive; user can filter later if too noisy).

## What goes away

- The current "Task backlog" rail (rollover-based concept).
- The project-stats list with progress bars (the existing top section showing % complete).
- Any dailyNotes text area, if it lives in the right sidebar today.
- The dual unscheduled/overdue sections with separate semantics.

If dailyNotes lives in the right sidebar, flag this with Nick — the directive scopes it to "tasks only" but he might want notes preserved or moved. Confirm before deleting.

## Pull-to-day behavior

- Click on a task row → adds task to selectedDate (the currently-highlighted day, which may not be today).
  - "Highlighted on Wednesday → click adds to Wednesday." Use the existing selectedDate from store.
- 10-second undo window. Same UX rhythm as the current rails — recent-state styling, "Undo" affordance, auto-dismiss after 10s.
- Pull mechanism uses the post-b.5 store action (whatever that ends up being — setTaskDateScheduled or extended updateTask). Don't re-introduce SQL-direct paths.

## Visual design

Match Versaday's current design language. Compact (right sidebar is collapsible and narrow).

Before designing, audit the existing design tokens and patterns:
- Project rail styling (project header + task rows).
- Recent-state styling (bg-accent-blue/[0.07], text-fg-faded, "Undo" label).
- Section headers (bg-overlay-hover/60, text-fg-muted, disclosure caret).
- The new design language Nick has been polishing across recent commits — pull from the most recent UI work, not the older project rail.

Density rules for the compact rail:
- Row height ~28px (current rows are ~24-28px).
- Task title truncated.
- Project headers: collapsed-by-default disclosure caret, task count, project color dot.
- Hover-only secondary affordances (e.g., a chevron to open the detail overlay, mirroring the backlog rail fix at 75a6d9e).

## Data wiring (post-M3 architecture)

- All reads through canonical-store selectors. No legacy SQL functions in the component.
- New selectors needed:
  - selectUnscheduledTasksByProject(state) — returns Map<projectId, Task[]> filtered to unscheduled+open. Memoized at the selector level.
  - selectOrphanAndOverdueTasks(state, today) — returns flat list. Today comes from a derived utility, not from the component.
- Plus the existing pullTaskToDay equivalent through the post-b.5 store action.

If those selectors don't exist post-b.5, they're part of this milestone's scope. Add them to the design doc.

## Sub-milestones (suggested)

1. R.1 — Design doc. Visual mockup or detailed spec (no code). Verse review before any implementation.
2. R.2 — Selectors + data hooks. Add the new selectors to appStore.ts. No UI changes.
3. R.3 — Rebuild the right-sidebar component. Replace existing JSX in DailyPlanner.tsx. Single commit unless it balloons.
4. R.4 — Polish + edge cases. Empty states (no projects with unscheduled tasks; no orphans/overdue), long lists (scroll handling), animation, keyboard nav.

## Things to clarify with Nick during R.1 design

1. Overdue threshold — any past-date task, or 4+ days overdue specifically?
2. Project ordering in top section — alphabetical, recency, custom sort?
3. Task ordering within a project — sort_order, priority, alphabetical?
4. dailyNotes — does it live in the right sidebar today? If yes, where does it move?
5. What replaces the project-stats list? (If anything — Nick may have wanted it gone too, or moved.)
6. Empty-state copy — what does the user see when no projects have unscheduled tasks AND no orphans/overdue exist?
7. Drag-drop interaction — click-to-add is specified; should drag-drop also work, or keep it click-only for the compact rail?

Don't start design without these answers.

## Constraints

- New branch from main: refactor/right-sidebar-rebuild. Never main directly.
- No DB schema change, no migration.
- No new IPC, no security surface.
- Budget: zero.
- Architecturally clean: post-M3 store API only. No legacy SQL paths. No cacheTasks. No verseday listeners.

---
## What Terse does next (right now)

Don't start anything sidebar-related yet. The immediate path is:

1. Wait for Nick's M3.2.b.2 test results.
2. If pass, start M3.2.b.3 design (Weekly + Shutdown surfaces) — heads-up to Verse before commit per the discipline rule.
3. Then b.4, then b.5, then merge M3 to main.
4. Then the sidebar rebuild — fresh branch, fresh design doc, verbatim from this brief.

If anything in the sidebar bothers Nick badly enough that he wants it before M3 closes, escalate — Verse will weigh whether it's pull-forward-able or wait-for-b.5 territory. Default: wait.
