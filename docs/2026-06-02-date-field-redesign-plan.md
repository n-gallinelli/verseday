# Date Field Redesign — Task details + Objectives (Terse → Verse review)

**Date:** 2026-06-02
**Author:** Terse
**Status:** AWAITING VERSE REVIEW — no code written yet
**Scope:** One shared, mode-aware date field + calendar popover, consumed in two places. No DB schema change / no migration (columns already exist).

---

## 0. Goal (from Nick's mockups)

A single smart date field that mirrors itself across two contexts:

| | **Task field** | **Project field** |
|---|---|---|
| Empty CTA | "Set day" (dashed pill, calendar-plus icon) | "Set dates" (dashed pill, calendar-plus icon) |
| Picker opens in | **single-date mode** | **range mode** (pick start, then end) |
| Inline escape hatch | "Add end date" (→ range) | "Single day" (→ collapse to one) |
| Common resting state | one date — `Jun 21` | range — `Jun 2 → Jun 21` |
| Other valid resting state | range — `Jun 2 → Jun 21` | single — `Jun 21` |

**Confirmed with Nick (2026-06-02):**
- **Task range semantics:** the end of a task range = the existing **`due_date` deadline**. `date_scheduled` is the start. The task still lives on its scheduled day in the Daily Plan — **no change to scheduling, rollover, or worked-time.** The field just visualizes scheduled→due together.
- **Keep the push-back shortcuts** ("push back one week / two weeks / a month") that the current task picker has — carry them into the new single-day picker, alongside the escape hatch.

---

## 1. Data model — already sufficient, no migration

| Context | Start column | End column | Notes |
|---|---|---|---|
| Task | `tasks.date_scheduled` (TEXT, null) | `tasks.due_date` (TEXT, null, added v16) | ISO `YYYY-MM-DD` |
| Project | `projects.start_date` (TEXT, null, v5) | `projects.target_date` (TEXT, null, v2) | ISO `YYYY-MM-DD` |

Resting-state derivation (both contexts), given `{start, end}`:
- `start == null && end == null` → **Empty** (CTA).
- `start != null && end == null` → **Single** (`start`).
- `start != null && end != null && start == end` → **Single** (`start`).
- `start != null && end != null && start < end` → **Range** (`start → end`).
- Single-day storage: keep the day in the **start** column, end column `null`. (Project "single day" = `start_date` set, `target_date` null.)

No schema change. Migration-discipline doc untouched.

---

## 2. New component: `DateRangeField`

`src/components/DateRangeField.tsx` — trigger (the three resting states) + a calendar popover (portal, same pattern as `CalendarPicker`/`ProjectPicker`).

**Props**
```ts
interface DateRangeFieldProps {
  value: { start: string | null; end: string | null };
  onChange: (next: { start: string | null; end: string | null }) => void;
  defaultMode: "single" | "range";   // task: "single", project: "range"
  emptyLabel: string;                // "Set day" | "Set dates"
  quickShortcuts?: boolean;          // task: true (push-back), project: false
}
```
- `defaultMode` drives: which CTA copy, which mode the popover opens in when empty, and which escape hatch shows.
- The component is fully controlled; parent owns persistence + events.

**Trigger states (match mockups)**
- Empty: dashed-border pill, `calendar-plus` icon + `emptyLabel`, muted.
- Single: solid pill, `calendar` icon + `Jun 21`.
- Range: solid pill, `calendar` icon + `Jun 2 → Jun 21` (arrow between).

**Popover**
- Header `Month YYYY` + prev/next chevrons. Sunday-start grid `S M T W T F S` (matches current `CalendarPicker` + the mockup). Reuse `CalendarPicker`'s month-matrix + navigation + today-ring logic (lift the grid into a small internal `MonthGrid` so both can share it; avoids reinventing).
- **Single mode:** selected day = filled blue circle. Footer (divider above):
  - escape hatch **"Add end date"** (calendar-with-arrow icon) → switches popover to range mode with `start` fixed, awaiting the end click.
  - if `quickShortcuts`, the push-back row ("Push back 1 week / 2 weeks / 1 month") — preserved per Nick. Stacked under the escape hatch.
- **Range mode:** start & end filled blue, in-between days a light-blue band (image 7 #4). Interaction = pick start → pick end. Footer: left shows `Jun 2 → Jun 21` summary; right shows escape hatch **"Single day"** → collapse to `{start, end:null}`.
- Range selection rules: first click sets `start`, clears `end`. Second click ≥ start sets `end`. Second click < start → treat as new `start` (re-anchor), await end again. This is the conventional range UX and avoids invalid `end < start`.

**Clearing** (open detail — see §6 Q-B): current pickers expose an `onClear` (×). The mockups don't show a clear control. Proposed: a subtle "Clear" text link in the popover footer (both modes) that emits `{start:null,end:null}`. Flag for Verse — alternative is click-selected-day-again-to-deselect.

---

## 3. Consumer changes

### 3a. Task details — `src/components/TaskDetailOverlay.tsx` (the "Dates" block, ~lines 830–859)
Replace the two side-by-side `CalendarPicker`s ("Scheduled"/"Due") with one:
```tsx
<DateRangeField
  defaultMode="single"
  emptyLabel="Set day"
  quickShortcuts
  value={{ start: dateScheduled || null, end: dueDate || null }}
  onChange={(v) => {
    setDateScheduled(v.start ?? "");
    setDueDate(v.end ?? "");
    debouncedSave({ dateScheduled: v.start ?? "", dueDate: v.end ?? "" });
  }}
/>
```
- Keeps the existing `debouncedSave`/`updateTask` plumbing and local state.
- **Collision-safety note (must-fix):** changing a recurring instance's `date_scheduled` must go through the recurrence-collision-safe path (the `updateTaskDateScheduled` guard added on `fix/recurring-pull-collision`). Confirm `debouncedSave`→`updateTask` either routes through that guard or that we call `updateTaskDateScheduled` for the scheduled date specifically. Detail to settle in impl; flagged so we don't reintroduce the flash bug from the task detail.

### 3b. Objectives — `src/pages/ProjectDetail.tsx` (Start/End block, ~lines 1516–1535)
Replace the two `CalendarPicker`s with one:
```tsx
<DateRangeField
  defaultMode="range"
  emptyLabel="Set dates"
  value={{ start: editStartDate || null, end: editTargetDate || null }}
  onChange={(v) => {
    setEditStartDate(v.start ?? "");
    setEditTargetDate(v.end ?? "");
    updateField("startDate", v.start ?? "");   // and targetDate
    updateField("targetDate", v.end ?? "");
  }}
/>
```
- Persists via the existing `updateProject(...)` debounce, which **already emits `verseday:project-changed`** — keep that so Dashboard/objective dropdowns refresh.

### 3c. Helper
Add `formatMonthDay(iso) => "Jun 21"` to `src/utils/dates.ts` (lift the existing inline `toLocaleDateString("en-US",{month:"short",day:"numeric"})` pattern) and reuse in the trigger.

### 3d. Cleanup
`CalendarPicker` is currently used only by these two spots (per the survey). After migration it may be unused — verify with a repo-wide search and, if so, delete it (and confirm `DatePicker`, used for Daily-Plan date nav, is untouched). If any other consumer exists, leave `CalendarPicker` in place.

---

## 4. Security / architecture notes (for Verse)

- **No DB schema change, no migration, no new dependency, no network, zero cost.** Pure UI over existing columns + existing save functions.
- **Events preserved:** project saves keep emitting `verseday:project-changed` (via `updateProject`); task saves flow through the store/`updateTask` as today.
- **No scheduling-semantics change:** per Nick's answer, task end = deadline only; Daily Plan placement/rollover untouched. This plan deliberately does NOT make tasks multi-day.
- **Recurrence-collision regression risk** is the one real correctness watch-item (§3a) — the new field must not bypass the collision-safe scheduled-date write.
- **Reused portal/click-outside pattern** matches `ProjectPicker`; the new popover will carry `data-portal-popover` so it composes with the Daily-Plan add-row guard if ever embedded there (defensive, low cost).

## 5. Test plan

- `tsc` + `eslint` clean on touched/new files; validate live via the running `tauri dev` (HMR) — **no `/Applications` reinstall** unless Nick asks.
- Task field: empty→"Set day"; pick a day→single pill `Jun 21`; "Add end date"→range; range pill `Jun 2 → Jun 21`; push-back shortcuts still work; recurring task scheduled-date change does NOT flash/revert.
- Project field: empty→"Set dates"; opens in range mode; pick start then end→`Jun 2 → Jun 21`; "Single day"→collapses to `Jun 21`; Dashboard/objective dropdowns reflect the change (project-changed event).
- Validation: `end < start` impossible via the re-anchor rule; clearing returns to empty CTA.

## 6. Open questions for Verse

- **Q-A (mode persistence):** when a task field is empty, the picker opens in single mode (correct). But once a task has a *range*, should reopening show the calendar already in range mode? Proposed: yes — derive the open-mode from current value first, falling back to `defaultMode` when empty. Confirm.
- **Q-B (clear affordance):** add a subtle "Clear" link in the popover footer (proposed) vs. click-selected-day-to-deselect vs. keep an `×` on the trigger. Pick one.
- **Q-C (`CalendarPicker` removal):** OK to delete it if the survey confirms no other consumers?

## 7. Rollout
Per project rules: one branch (`feat/date-range-field` proposed), all changes one pass, single final review, **no push to main**, no production reinstall unless Nick asks. Awaiting **APPROVED / REJECTED** with reasons.
