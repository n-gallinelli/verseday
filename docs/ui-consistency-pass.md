# UI Consistency Pass — Plan

**Branch:** `feat/ui-consistency-pass` (off `main`)
**Author:** Terse · **Status:** PLAN — awaiting Verse review (no code written yet)
**Date:** 2026-06-17

A six-part visual-consistency pass across the four day/week screens plus
Objectives. Brief describes intended end-states; this plan pins each to exact
files/lines and defines **one** reversibility mechanism so the whole pass can be
backed out in a single edit if Nick doesn't like the result.

---

## 0. Reversibility architecture (the headline requirement)

> "Build them in a way that is very easily reversible for all of them at once."

**Mechanism: atomic commits on a dedicated branch (NO feature flag).**

Per Verse: a compile-time `const` flag adds no capability over atomic commits —
"flip + rebuild" is identical to reverting the merge, while costing ~15 ternaries,
a cleanup commit, and two divergeable code paths. So:

- One atomic commit **per change** (#1–#6) plus a `setup` commit for the shared
  helpers. New values still centralized in shared helpers (date formatters in
  `dates.ts`, `PRIMARY_ACTION_CLASS`, `ADD_TASK_FIELD_CLASS`, `SHUTDOWN_BUTTON_CLASS`).
- **Revert all at once** = revert the merge commit / don't merge the branch.
- **Revert one change** = `git revert <that sha>`.

(If Nick later wants a *live*, no-rebuild A/B toggle, that's a real runtime
Setting — a separate ask, not approximated with a const.)

---

## 1. Standardize the "add task" field

**Target style (Objectives "New objective" field)** — `src/pages/Projects.tsx:781`
container: `bg-elevated rounded-[10px] px-4 py-[10px]`, `0.5px solid
var(--border-hairline)`, leading + icon, solid background.

**Change — Weekly Plan add-task input** `src/pages/weekly-plan/PlanTaskList.tsx:197`:
- Current: `border border-dashed border-line-hairline rounded-md` (dashed/grey →
  reads disabled).
- New: solid field matching Objectives — drop `border-dashed` for a solid
  hairline border, solid `bg-input`/`bg-elevated` background, same height/radius
  and placeholder styling (`placeholder:text-fg-disabled`). Keep Enter-to-save;
  keep/add the inline confirm affordance consistent with Objectives' "Create".
- Extract the shared field classes into `ADD_TASK_FIELD_CLASS` so both inputs
  reference one source.

**Also in scope (same "grey = disabled" smell):** the Schedule tab's dashed
add-row `ScheduleTab.tsx:310` — flag for the same de-greying treatment; confirm
with Verse whether it's in or out (it's a different control — an "add" affordance
row, not a text field — so I lean *out* unless Verse wants it included).

---

## 2. Match the two shutdown terminal buttons

- **Reflect** (Daily Shutdown) `src/pages/DailyShutdown.tsx:706`:
  `flex-1 py-2.5 rounded-lg border border-accent-blue/50 text-accent-blue-soft-fg
  text-[13px] font-medium … gap-1.5`, icon 14×12.
- **Complete shutdown** (Weekly Shutdown) `src/pages/WeeklyShutdown.tsx:840`:
  `w-full py-3 rounded-lg border border-accent-pink-bright/60 text-accent-pink-bright
  text-[14px] font-medium … gap-2`, icon 14×10.

**Mismatch:** padding (`py-2.5` vs `py-3`), font (`13` vs `14`), icon gap
(`1.5` vs `2`), width helper (`flex-1` vs `w-full`).

**Change:** define one shared terminal-button class (height/padding/radius/font/
icon-size/gap/full-width) and apply to both, leaving only the **color** to differ
(blue family for Reflect, pink/coral for Complete shutdown — both routed through
the primary-action treatment in #6). They become two color variants of one shape.

---

## 3. Unify the Weekly Summary metric colors

**`src/pages/WeeklyShutdown.tsx:599–611`** — "Total this week" card:
- Time figure `text-[28px] … text-accent-pink-bright` (coral) — unchanged.
- Count `text-[20px] … text-fg` (neutral) → change color to
  `text-accent-pink-bright`. **Size relationship preserved** (28 vs 20); only the
  count's color changes to coral.

---

## 4. Soften the Daily Shutdown empty state

**`src/pages/DailyShutdown.tsx:542`** (and the "Done today" label context at
`:479`): replace `No tasks completed` with **"Nothing marked done today."** Same
placement, same muted styling (`text-[12px] text-fg-disabled px-2.5`). No-judgment
tone, matching the Weekly Shutdown chart's gentle empty state.

---

## 5. One date format across all screens

Abbreviated month, **no year**. Full weekday on single-day screens; collapsed
range on week screens.

**Add to `src/utils/dates.ts`:**
```ts
formatDayHeader(iso)  // "Wednesday, Jun 17"  { weekday:"long", month:"short", day:"numeric" }
formatWeekRange(monIso) // "Jun 15 – 19"  (collapse repeated month; "Jun 29 – Jul 3" across months)
```

**Apply (header date sites):**
| Screen | File:line | Current | New |
|---|---|---|---|
| Daily Plan | `DailyPlanner.tsx:965` | "Wed, Jun 17" (short wd) | `formatDayHeader` → "Wednesday, Jun 17" |
| Daily Shutdown | `DailyShutdown.tsx:389` | "Wednesday, June 17" (long month) | `formatDayHeader` → "Wednesday, Jun 17" |
| Weekly Plan | `WeeklyPlanner.tsx:10–15` | "Jun 15 – Jun 19" (repeats month) | `formatWeekRange` → "Jun 15 – 19" |
| Weekly Shutdown | `WeeklyShutdown.tsx:42–48` | "Week of June 15, 2026" | `formatWeekRange` → "Jun 15 – 19" |

Also normalize the in-flow per-day heading `WeeklyShutdown.tsx:50` and any
secondary header date (`DailyPlanner.tsx:250`) to abbreviated month for
consistency. En-dash with surrounding spaces: `Jun 15 – 19`.

---

## 6. Establish a primary-action treatment

**Primary style — soft tinted fill** (existing pink/coral tokens; this *is* the
app's coral). Color treatment only — each site keeps its own size/shape:
```
PRIMARY_ACTION_CLASS = "bg-accent-pink-soft text-accent-pink-deep
  border border-accent-pink-bright/40 hover:border-accent-pink transition-colors"
```
Hover deepens the border (rest already carries the soft fill, so a `hover:bg`
to the same token would be a no-op — Verse caught that `-soft-hover` doesn't
exist). Gentle peach/coral fill, deeper-coral text/icon — not a saturated solid.
Secondary/tertiary stay neutral outline / ghost.

`SHUTDOWN_BUTTON_CLASS = "py-3 rounded-lg text-[14px] font-medium flex items-center
justify-center gap-2 transition-colors"` (no width — each site keeps `flex-1` or
`w-full`, both render full-width). Both shutdown terminal buttons =
`<width> + SHUTDOWN_BUTTON_CLASS + PRIMARY_ACTION_CLASS`. This is where #2 and #6
consolidate.

**Rule (Verse-refined):** one accent-colored **action** per screen. **Status
chips, selection states, focus rings, semantic icons (green=done, orange=priority),
and text/hover micro-links are EXEMPT** even when clickable.

**Per-screen PRIMARY (gets `PRIMARY_ACTION_CLASS`):**
| Screen | Primary action | File:line |
|---|---|---|
| Daily Plan | Start focusing | `DailyPlanner.tsx:1072` |
| Daily Shutdown | Reflect (step 1) + Shutdown (step 2) — both terminal | `DailyShutdown.tsx:706`, `:718` |
| Weekly Shutdown | Complete shutdown (already coral — conform to shared class) | `WeeklyShutdown.tsx:840` |
| Weekly Plan | Next project | `weekly-plan/PlanProjectPanel.tsx:224` |
| Objectives | inline "Create / New objective" confirm | `Projects.tsx:807` |

**Per-screen DEMOTIONS (accent action → neutral outline so primary stands alone):**
| Screen | Site | What it is | Action |
|---|---|---|---|
| Daily Plan | `DailyPlanner.tsx:1156` | "Add" submit in inline new-task form (blue) | → neutral outline |
| Daily Shutdown | `DailyShutdown.tsx:463` | "Copy for Claude" rundown export (blue) | → neutral outline |
| Weekly Shutdown | `WeeklyShutdown.tsx:673` | "Copy for Claude" summary export (pink) | → neutral outline |

**EXEMPT (verified — left as-is):**
- Daily Plan: `:985` & `:1032` status pills (Today / running-session — code already
  labels :1032 "Status pill, not primary CTA"), `:1198` empty-state check icon,
  `:1290` transient inline-editor submit, list hover-hint micro-text (`:1574`/`:1580`/
  `:1700`/`:1706`), focus rings (`:1233`+).
- Daily Shutdown: `:385` "Daily shutdown" label chip, `:453` rundown selection,
  `:555`/`:618` text/hover micro-links, `:601` green "Moved →" semantic, `:731`
  "Summary" (already neutral).
- Weekly Shutdown: `:291` "Plan next week" (inside the post-complete
  PlanNextWeekPrompt — separate surface), `:556` label chip, `:599` metric figure
  (intentional — see #3), `:642` nav selection, `:268`/`:781` decorative icons.
- Weekly Plan: `WeeklyPlanner.tsx:76` orange text link, `PlanProjectPanel.tsx:135`
  green status chip, "Skip project this week" text link.
- Objectives: `:330` text link, `:354` search focus ring, `:368`/`:373` filter
  selection, green/orange semantic icons (`:485`/`:594`/`:604`/`:681`/`:736`/`:514`+).

---

## Resolved with Verse

- **Objectives primary:** the inline "Create / New objective" confirm (`:807`).
  "Mark Complete" confirmed nonexistent. Field gets `ADD_TASK_FIELD_CLASS`, the
  confirm gets `PRIMARY_ACTION_CLASS`.
- **Reflect blue→coral:** YES (pink ≠ destructive here).
- **ScheduleTab dashed add-row (`:310`):** OUT — add-affordance row, not a field.
- **"Today" status pill (`:1032`):** EXEMPT (status chip, even when clickable).

---

## Build order & commits (after approval)

1. `setup`: shared helpers — `dates.ts` (`formatDayHeader`, `formatWeekRange`),
   `PRIMARY_ACTION_CLASS`, `ADD_TASK_FIELD_CLASS`, `SHUTDOWN_BUTTON_CLASS`.
2. `#1` add-task field de-grey (Weekly Plan input → match Objectives).
3. `#2`+`#6 shutdown` shared terminal button + coral primary (Reflect, Shutdown, Complete shutdown).
4. `#3` weekly metric color (count → coral).
5. `#4` empty-state copy ("Nothing marked done today.").
6. `#5` date formats (4 headers + per-day headings).
7. `#6` remaining per-screen primaries (Start focusing, Next project, Create) + 3 demotions.

No flag — atomic commits per change. `tsc --noEmit` + build after the pass.
No DB/migration/IPC changes — pure presentational. Self-validate via tsc/build +
code review; eyes-on via `tauri build --debug` (tauri dev broken on macOS 26).
```
