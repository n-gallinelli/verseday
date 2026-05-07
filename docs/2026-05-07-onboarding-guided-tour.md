# Onboarding Guided Tour — Plan

**Status:** Awaiting Verse review
**Date:** 2026-05-07
**Author:** Terse

## Mechanism

Coachmark overlays anchored to real UI. As the user lands on a page, a card pops up explaining what they're looking at and points at the next nav item. Navigation drives progress — the user *clicks* their way through the app, and each click reveals the next explanation. No "Next →" buttons hijacking the flow.

## Trigger

- Auto-runs on first app launch (persisted flag in localStorage: `onboarding.completed`)
- Re-runnable from **Settings → Replay onboarding tour**

## Step order

| # | Where | Anchor | Content |
|---|-------|--------|---------|
| 0 | Welcome modal (centered, no anchor) | — | "The loop in 30 seconds" — Plan the week → plan each day → focus → shut down the day → shut down the week. *Start tour* / *Skip*. |
| 1 | **Daily Plan** | Task list area | Decide *today's* tasks. Pull from projects, smart estimates, reorder. Then: *"Click Focus to see how you work a task →"* (sidebar Focus item pulses) |
| 2 | **Focus** | Play button | One task, one timer. Opens paused — press Play. PiP follows you, auto-advance on done. *"Click Daily Shutdown next →"* |
| 3 | **Daily Shutdown** | Reflection area | Close today. Mark what got done, roll the rest forward, short reflection. Sets up tomorrow's plan. *"Click Weekly Plan →"* |
| 4 | **Weekly Plan / Plan tab** | Project rail | Plan **by project** for the upcoming week. Pick projects → drop tasks → set rough load. *what & how much*. *"Click the Schedule tab →"* |
| 5 | **Weekly Plan / Schedule tab** | Day strip | Drag tasks onto specific days. Calendar/week view. *when*. *"Click Weekly Shutdown →"* |
| 6 | **Weekly Shutdown** | Objectives section | Review the week against **objectives**. Log wins/misses, decide carry-overs. Feeds next week's Plan tab. *"Click Dashboard →"* |
| 7 | **Dashboard** | Whole page | At-a-glance: objectives, projects, time trends. Read-only — you *see* work here, you don't *do* it. *"Click Done →"* |
| 8 | Done modal | — | "You're set. Replay anytime from Settings." |

## Anchoring & visuals

- Portaled tooltip card (~280px wide) pointing at the anchor element with a small caret
- Dimmed scrim around everything except the anchor (cut-out hole, ~6px padding around target)
- Anchored sidebar item pulses softly to signal "click me next"
- The tour *follows the user's click* on the highlighted nav target — natural, not forced
- Persistent `Skip tour` link in the bottom-right of every card; `Step N of 8` in the corner

## Scaffolding (high level)

- New store slice: `onboarding: { active, step, completed }` with persistence
- New component: `<OnboardingOverlay />` at App root, conditional render
- Steps defined as a typed array (`id`, `anchorSelector`, `title`, `body`, `nextNav`)
- Anchor lookup via `data-onboarding="<id>"` attributes on relevant elements (Daily Plan task list, Focus play button, sidebar items, weekly plan tab toggle, etc.) — no fragile CSS selectors

## Out of scope (intentional)

Project Detail, Settings, recurring tasks, calendar integration, keyboard shortcuts, quick-add. Covered later in a separate "Power user" doc.

## Sequencing

1. Save this plan to `/docs/`
2. Verse review
3. New branch, build in milestones:
   - **M1:** store slice + overlay shell + welcome modal + dismissal flag (no real steps yet)
   - **M2:** anchor system + step 1 (Daily Plan) + Settings replay button
   - **M3:** all remaining steps wired
   - **M4:** polish — pulse animation, scrim cutout, copy pass
4. Stop after each milestone for Verse review.
