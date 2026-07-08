# Objective-detail Date / Worked / Estimated — warm-surface pass

**Branch:** `feat/objective-detail-warm-pills`
**Date:** 2026-07-08
**Status:** Verse plan APPROVED (3 binding conditions, all met below). On-scope
under the owed `--fg-warm-*` warm-surface follow-up.

## Intent

The per-task metadata trio on the objective (project) detail screen
(`SortableTaskRow`, `ProjectDetail.tsx`) rendered Date, Worked, and Estimated
as three identical pills on a flat, cool-leaning gray fill. Design direction:

- **Date** is a reference fact, not tracked data — quiet it so it stops
  competing with the time numbers.
- **Worked + Estimated** are a matched pair (both durations) — keep them
  siblings (same size/shape) but let Worked, the number that's true right now,
  carry marginally more weight than Estimated, the plan/reference number. Two
  depths of one warm tone, not two colors.
- **Lighten overall** by shifting the fills off pure/cool gray to a
  warm-tinted neutral (per the "no pure gray" rule).

## Changes

1. **New fill tokens** (`src/index.css`) — two depths of one warm tone, derived
   from `--accent-orange` via `color-mix` so they track the accent across
   light/dark automatically (same construction as `--fg-warm-muted/faded`; no
   dark override):
   - `--bg-tag-warm: color-mix(in srgb, var(--accent-orange) 6%, transparent)` — **Worked** (deeper)
   - `--bg-tag-warm-faint: color-mix(in srgb, var(--accent-orange) 3.5%, transparent)` — **Estimated** (quieter)
   - `@theme` aliases `--color-tag-warm` / `--color-tag-warm-faint`.

2. **`LabeledInputPill`** (local to `ProjectDetail.tsx`) — `tone="time"` split
   into `tone="worked"` (`bg-tag-warm`) and `tone="estimated"`
   (`bg-tag-warm-faint`). Warm-toned pills also carry a warm caption
   (`text-fg-warm-faded` instead of `text-fg-faded`) so the whole chip reads as
   one family. Sizes/shape unchanged — still siblings.

3. **`CalendarPicker`** — new opt-in `variant="quiet"` (default `"pill"`). Quiet
   drops the fill, border, and the uppercase "DATE" caption; renders a small
   calendar glyph + a lightened value (`text-fg-secondary`, a notch below the
   `text-fg` time numbers) with a `hover:bg-input` affordance. Applied at the
   ProjectDetail Date call site only.

No DDL, no new deps, no runtime/logic change — purely presentational.
`npx tsc --noEmit` clean.

## Verse conditions — disposition

1. **Derive the tints, don't hardcode** — done; both fills are `color-mix` off
   `--accent-orange`, defined once, auto-tracking light/dark.
2. **Accessible name + focus ring on the quiet trigger** — done; the trigger
   gets `aria-label={label}` ("Date") since the visible caption is dropped, plus
   a `focus-visible:ring-2 ring-accent-blue` outline.
3. **Fix the rationale** — corrected: `CalendarPicker` currently has exactly
   **one** caller (`ProjectDetail.tsx`, the Date pill); the two other repo hits
   are comments, not usages. The `variant="pill"` default is therefore about
   keeping that single caller's other invocation paths stable, not "byte-
   identical shared callers." `variant` and `label` are orthogonal: quiet uses
   `label` only for the aria name, never for a visible caption — verified the
   quiet + label combination renders as intended (glyph + value, no caption).

## Follow-on — task-detail TIME pills (same branch)

Nick asked to carry the warm treatment to the Estimated / Time-spent pills on
the **task detail overlay** too. `TimeFieldPill` (`TaskDetailOverlay.tsx`) now
derives a warm resting fill from its `label` (same keying the component already
uses for the `label === "Estimated"` branch):

- `Worked` / `Time spent` → `bg-tag-warm` (deeper)
- `Estimated` → `bg-tag-warm-faint` (quieter)
- any other label → `bg-input` (unchanged)

Visible captions on the warm pills use `text-fg-warm-faded`. The **open** state
is untouched — it keeps `bg-accent-blue-soft` / `border-accent-blue` as the
active-editing signal; only the resting fill warms. Reuses the same tokens
(no new tokens, no logic change). `tsc` clean.

## Refinement — tighten Date ↔ time-pair spacing (objective detail)

The quiet Date sits in a compact glyph+text pill, but its wrapper still held
the old filled-pill's fixed `w-[110px]`, leaving dead space so the Worked/
Estimated pair floated far from it. Fixes:

- ProjectDetail metadata row: Date wrapper `w-[110px]` → `flex-shrink-0`
  (hug content); group gap `gap-3` → `gap-2`.
- Quiet `CalendarPicker` now sizes to content: root `w-fit`, pill `inline-flex`
  (was `flex w-full`), trigger drops `flex-1`. Reserved clear-✕ trimmed
  `w-7` → `w-5` in quiet (also tidies the orphaned-✕ Verse flagged).

Non-quiet (pill) variant untouched — still `w-full` / `flex-1` / `w-7`.

## Also in this branch (unrelated one-liner)

`DatePicker.tsx` popover header "Go to today" → "Jump to today" to match the
DailyPlanner "Jump to..." trigger wording.
