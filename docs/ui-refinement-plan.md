# VerseDay UI Refinement Plan

**Author:** Terse
**Date:** 2026-04-22
**Status:** Rev 2 — Addressing Verse blockers 1-4 + non-blocking concerns

---

## Audit Summary

Four skill lenses were applied to the full VerseDay UI (Sidebar, FocusMode, FocusLanding, DailyPlanner, DailyShutdown, WeeklyPlanner, WeeklyShutdown, Dashboard, Projects, ProjectDetail, Settings, QuickAdd, WrapUpReminder, TaskCard, FocusPip).

---

## Findings by Skill

### 1. Impeccable (Production Quality + Distinctiveness)

| # | Issue | Severity | Location |
|---|-------|----------|----------|
| I1 | **Active nav item uses border-r-2 accent stripe** — a top AI-slop tell per impeccable absolute bans (side-stripe > 1px) | High | `Sidebar.tsx:132` |
| I2 | **Project cards use 4px left color bar** — same ban violation; feels like a generic dashboard | High | `Projects.tsx` project card rows |
| I3 | **Single font family (Figtree Variable)** — no display/body pairing; the app looks like every other SaaS tool | Medium | `index.css:35` |
| I4 | **Colors defined in hex/HSL, not OKLCH** — palette adjustments aren't perceptually uniform; light tints risk looking garish | Low | `index.css:3-16` CSS custom properties |
| I5 | **Neutrals aren't tinted toward brand hue** — bg `#f5f4f0` and surface `#ffffff` are warm-beige but not tinted toward the blue `#7B9ED9` brand; feels disconnected | Medium | `index.css` vars |
| I6 | **All buttons use same rounded-xl pill shape** — no hierarchy between primary, secondary, ghost; everything blends together | Medium | Focus prompt buttons, Settings, etc. |

### 2. Layout (Spatial Rhythm + Hierarchy)

| # | Issue | Severity | Location |
|---|-------|----------|----------|
| L1 | **Uniform gap-3 / px-6 everywhere** — no spatial rhythm; heading groups and section breaks feel the same weight | Medium | DailyShutdown, WeeklyShutdown, Dashboard |
| L2 | **Two-column shutdown pages have rigid 180px right column** — doesn't breathe on wider screens; no container queries | Low | DailyShutdown, WeeklyShutdown |
| L3 | **Dashboard summary cards are same-sized card grid** (big number + small label, repeated) — generic metric layout pattern | Medium | `Dashboard.tsx` summary cards section |
| L4 | **TaskCard is dense but flat** — every row has identical visual weight; no differentiation between today's priority and the 8th task | Medium | `TaskCard.tsx` |
| L5 | **FocusLanding hero is vertically centered but feels empty** — large centered whitespace with tiny content; could use more intentional negative space composition | Low | `FocusLanding.tsx` |
| L6 | **Settings page is a plain vertical stack** — no grouping, no visual sections; feels like a form dump | Low | `Settings.tsx` |

### 3. Delight (Joy + Memorable Moments)

| # | Issue | Severity | Location |
|---|-------|----------|----------|
| D1 | **No staggered entry on page transitions** — only `animate-fade-in` on the `<main>` wrapper; individual sections don't orchestrate | Medium | `App.tsx:241` |
| D2 | **Empty states are likely bare text** — no teaching moments or personality in zero-data states | Medium | DailyPlanner, Projects, Dashboard |
| D3 | **Task completion has no celebratory moment** — checking a task "done" just toggles state; no micro-interaction or feedback | Medium | `TaskCard.tsx` checkbox |
| D4 | **Pomodoro complete chime exists but the prompt card appears instantly** — no entrance animation; feels jarring after sustained focus | Low | `FocusMode.tsx:482` prompt card |
| D5 | **WrapUpReminder is functional but visually plain** — a daily ritual moment deserves more warmth than a standard toast | Low | `WrapUpReminder.tsx` |
| D6 | **QuickAdd overlay has no entrance/exit animation** — appears and disappears abruptly | Low | `QuickAdd.tsx` |

### 4. Quieter (Reduce Overstimulation)

| # | Issue | Severity | Location |
|---|-------|----------|----------|
| Q1 | **Focus glow pulse is always-on and prominent** — after 25+ minutes of staring at the timer, the pulsing glow layer becomes fatiguing | Medium | `FocusMode.tsx` glow layer + `index.css:175` |
| Q2 | **Timer ring pulse (scale 1.04) runs continuously** — subtle but adds visual noise during deep work | Low | `index.css:115-124` |
| Q3 | **Sidebar shortcut list is visually dense when open** — 11 items at 9-10px font packed tightly | Low | `Sidebar.tsx:278` shortcuts panel |
| Q4 | **Dashboard bar chart uses saturated orange (#e0873e) for worked bars** — high chroma draws too much attention relative to its informational weight | Low | `Dashboard.tsx` bar chart |

---

## Global Rules

### Motion accessibility (Verse blocker #3)
**Every new animation added in any phase** must be gated behind `@media (prefers-reduced-motion: reduce)`. This applies to D1, D3, D4, and any future motion work. The existing `index.css` already follows this pattern for `timer-circle-ring` — all new animations will match.

### Review cadence (Verse blocker #4)
Terse will STOP after each phase and say **"Ready for Verse review."** No phase begins until the prior phase is approved. Phases are:
- Phase 1 complete → Verse review
- Phase 2 complete → Verse review
- Phase 3 complete → Verse review
- Phase 4 complete → Verse review

### Per-phase exit criteria
Each phase must pass a **manual smoke test in a Tauri build** (`cargo tauri dev`), not just Vite dev server. Terse will confirm this before requesting review.

---

## Proposed Changes (Prioritized)

### Phase 1 — High Impact, Low Risk

1. **Fix sidebar active indicator** (I1): Replace `border-r-2` with a subtle background tint using the brand blue at low opacity. The active state should feel like a warm glow, not a stripe.

2. **Fix project color indicator** (I2): Replace the 4px left bar with a small color dot inline with the project name (similar to how FocusMode already shows project context).

3. **Add a display font pairing** (I3, Verse blocker #1 resolved):
   - **Font:** [Bricolage Grotesque](https://fonts.google.com/specimen/Bricolage+Grotesque) (variable, wght 200-800)
   - **License:** SIL Open Font License — free, permissive, no restrictions
   - **Delivery:** Self-hosted via `@fontsource-variable/bricolage-grotesque` npm package (same pattern as existing Figtree). Bundled in the app binary — no CDN, no runtime fetch, works offline.
   - **Why this font:** Bricolage Grotesque has optical sizing and quirky organic shapes — it reads as warm and handcrafted, not corporate. It contrasts well with Figtree's clean geometry. It's not in the impeccable skill's reflex-reject list.
   - **Usage:** Page headings only (FocusMode task title, page headers, Dashboard hero number). Figtree stays for all body/UI text.

4. **Create a Button component + differentiate hierarchy** (I6, Verse blocker #2 resolved):
   - Create `src/components/Button.tsx` with a `variant` prop: `"primary" | "secondary" | "ghost"`
   - Primary: filled brand blue bg, white text
   - Secondary: subtle `bg-black/[0.05]`, dark text
   - Ghost: text-only, no background, hover underline or subtle bg
   - Also accepts `size="sm" | "md"` for compact vs standard contexts
   - All existing inline button styles will be migrated to use this component within Phase 1 scope. No more scattered className button definitions.

### Phase 2 — Spatial Rhythm

5. **Introduce varied spacing** (L1): Use larger gaps above section headings and tighter gaps between related items. Create visual "breathing room" that communicates hierarchy.

6. **Rethink Dashboard summary cards** (L3, Verse non-blocking resolved): The existing `SummaryCard` component accepts generic `label/value/subtext` props and sits in a `flex gap-3` row — data bindings are NOT coupled to grid structure. Safe to restructure layout without touching data flow. Change: promote the primary metric (today's worked time) to a larger standalone display, move secondary stats (tasks done, streak) inline below it.

7. **Add visual weight to high/urgent tasks in TaskCard** (L4, Verse non-blocking resolved): TaskCard already checks `task.priority === "high" || task.priority === "urgent"` (TaskCard.tsx:148) and has an `isHigh` flag. Currently unused for visual differentiation. Change: give `isHigh` tasks a subtle warm-tinted background. This is tied to the existing `priority` field, NOT positional — no ambiguity about "first task."

### Phase 3 — Delight Moments

8. **Staggered page entry** (D1): Apply the existing `animate-stagger` classes to major content sections on page load — header, then content blocks, then footer actions. Uses existing CSS. Gated behind `prefers-reduced-motion`.

9. **Task completion micro-interaction** (D3): Add a brief scale + fade animation when a task is checked done. CSS-only, no library needed. Gated behind `prefers-reduced-motion`.

10. **Break prompt entrance** (D4): Animate the pomodoro prompt card in with `animate-scale-in` (already defined in CSS). One className addition. Gated behind `prefers-reduced-motion`.

11. **Empty state personality** (D2): Design 2-3 minimal empty states with short, warm copy that teaches the interface ("Plan your day by adding tasks above").

### Phase 4 — Quieter Refinements

12. **Fade out focus glow over time** (Q1, Verse non-blocking resolved): Implementation uses a **CSS-only approach** — a `@keyframes glowFadeOut` animation with `animation-delay: 300s` (5 min) and `animation-fill-mode: forwards` that transitions opacity to 0.05 over 60s. No React timer, no re-renders, no state. When the user pauses, the glow layer already has `.paused` which freezes `animation-play-state` — the fade animation will also freeze via the same mechanism. On resume, both animations continue from where they left off. Respects `prefers-reduced-motion`.

13. **Reduce timer pulse amplitude** (Q2): Change scale from `1.04` to `1.02` and slow the cycle from 4s to 6s.

14. **Soften Dashboard bar chart** (Q4): Reduce orange chroma; use a muted warm tone that still distinguishes worked from planned but doesn't shout.

### Deferred (Low Priority)

- OKLCH color migration (I4) — beneficial but large diff, can do later
- Neutral brand-tinting (I5) — subtle improvement, batch with OKLCH migration
- Settings page grouping (L6) — functional as-is
- Container queries for shutdown columns (L2) — nice-to-have
- QuickAdd entrance animation (D6) — Tauri window show/hide may not support CSS transitions cleanly

---

## Constraints

- **Zero budget** — no paid fonts, no external services. Bricolage Grotesque is OFL-licensed and self-hosted.
- **Tauri 2 desktop app** — no server-side rendering concerns; but Tauri webview has WebKit quirks (noted in existing code comments). All fonts bundled, no CDN.
- **Existing tech:** React + Tailwind CSS + Tiptap
- **All changes are CSS/component-level** — no database or backend changes

---

## Estimated Scope

- Phase 1: ~2-3 hours (4 changes) → Verse review gate
- Phase 2: ~2 hours (3 changes) → Verse review gate
- Phase 3: ~1.5 hours (4 changes, mostly CSS) → Verse review gate
- Phase 4: ~1 hour (3 changes) → Verse review gate
- **Total: ~7-8 hours across all phases**

---

Ready for Verse re-review.
