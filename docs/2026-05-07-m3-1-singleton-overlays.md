# M3.1 — Singleton Overlays (`SummaryOverlay`, `SunsetOverlay`)

**Status:** Awaiting Verse review
**Date:** 2026-05-07
**Author:** Terse
**Branch:** `refactor/m3-canonical-tasks` (fresh from `main` post-M2 merge)
**Type:** First milestone of the M3 chunk. Smaller, scoped warm-up before M3.2's canonical `tasksById` lift.

---

## Why M3.1 first, not M3.2

Verse-suggested order. The original entity plan (rev 2, `docs/2026-05-07-task-as-entity-plan.md` §3) lists M3.1 → M3.5 in order; the singleton-overlays milestone is the smallest, most localized of the lot, and lands the same R5 seam-then-wire-up pattern M1 + M2 used. Doing it first:

- Validates that the `selectedTaskDetailId`-style pattern generalizes to other singleton-eligible surfaces without surprises.
- Establishes the `verseday:*-changed` event-bus retirement cadence for M3.2 to follow.
- Keeps the M3.2 commit history focused on the canonical-data lift, not bundled with overlay restructuring.

M3.2 (canonical `tasksById`) starts after M3.1 lands.

---

## What this milestone retires

Two overlays currently mounted per-screen, identified in the entity plan §2 singleton inventory:

| Surface | Current mount sites | Open mechanism today | Target store field |
|---|---|---|---|
| `SummaryOverlay` | `DailyPlanner.tsx:1555`, `DailyShutdown.tsx:584` | local `showSummary` `useState` in each parent | `summaryOverlay: { kind: "daily" \| "weekly", anchorDate: string } \| null` |
| `SunsetOverlay` | `DailyShutdown.tsx:582`, `WeeklyShutdown.tsx:646` | local `showSunset` `useState` | `sunsetOverlayOpen: boolean` |

Both render-once-but-visible-from-multiple-screens. Both currently get duplicated mount logic + per-screen `useState`. Lifting to App-shell singletons removes the duplication and makes the open/close action a store-level concern (consistent with M1's `selectedTaskDetailId` pattern).

---

## What this milestone does **not** touch

- `tasksByIdCache` (still in place; M3.2 retires it)
- Canonical `tasksById` map (M3.2 introduces it)
- `verseday:task-updated` / `verseday:task-deleted` event-bus listeners in each parent screen (M3.2 retires them when the cache lift is canonical)
- Any of the other (B)-class candidates from the audit (`tasks` per screen, `workedMinutesByTask`, etc.) — those land in M3.3 onward
- The `editingTaskId` candidate (M3.4)
- Lint guardrail (M4)
- `closeOrphanedTimeEntries` ordering vs `restoreFocus` (M3.5 cleanup item, tracked)
- Dead `handleStopFocus` in DailyPlanner (M3.5 cleanup, tracked)

Strict scope: two overlays, four mount sites, two store actions per overlay (open + close), two singleton hosts at App shell.

---

## Design

### Store changes (`src/stores/appStore.ts`)

```ts
interface AppState {
  // ... existing fields ...

  /** Open the singleton SummaryOverlay. `null` = closed. M3.1. */
  summaryOverlay:
    | { kind: "daily"; anchorDate: string }
    | { kind: "weekly"; anchorDate: string } // (DailyPlanner currently only opens "daily"; DailyShutdown opens "daily" too — kind is reserved for M3.2 if WeeklyShutdown ever wires it up)
    | null;
  openSummaryOverlay: (kind: "daily" | "weekly", anchorDate: string) => void;
  closeSummaryOverlay: () => void;

  /** Open the singleton SunsetOverlay. M3.1. Animation overlay
   *  triggered on shutdown completion; auto-dismisses on click. */
  sunsetOverlayOpen: boolean;
  openSunsetOverlay: () => void;
  closeSunsetOverlay: () => void;
}
```

**Persistence:** neither field persists — both are transient UI state that should reset on app restart (same rationale as `selectedTaskDetailId`).

### New host components

Mirror M1's `TaskDetailOverlayHost` pattern: a thin wrapper that subscribes to the open-state field and passes the right props to the existing overlay component.

```tsx
// src/components/SummaryOverlayHost.tsx
export default function SummaryOverlayHost() {
  const summaryOverlay = useAppStore((s) => s.summaryOverlay);
  const closeSummaryOverlay = useAppStore((s) => s.closeSummaryOverlay);
  if (!summaryOverlay) return null;
  return (
    <SummaryOverlay
      type={summaryOverlay.kind}
      anchorDate={summaryOverlay.anchorDate}
      onClose={closeSummaryOverlay}
    />
  );
}

// src/components/SunsetOverlayHost.tsx
export default function SunsetOverlayHost() {
  const sunsetOverlayOpen = useAppStore((s) => s.sunsetOverlayOpen);
  const closeSunsetOverlay = useAppStore((s) => s.closeSunsetOverlay);
  if (!sunsetOverlayOpen) return null;
  return <SunsetOverlay onDismiss={closeSunsetOverlay} />;
}
```

### Mount at App shell

`src/App.tsx`:
```tsx
<TaskDetailOverlayHost />        {/* existing */}
<SummaryOverlayHost />           {/* new */}
<SunsetOverlayHost />            {/* new */}
```

### Per-screen retirement

Each parent drops its `useState`, replaces JSX render with the store action call, drops the import.

| File | Drops | Replaces with |
|---|---|---|
| `src/pages/DailyPlanner.tsx` | `[showSummary, setShowSummary]` useState; `<SummaryOverlay ... />` JSX; `import SummaryOverlay` | `useAppStore((s) => s.openSummaryOverlay)` for the trigger; remove the JSX entirely |
| `src/pages/DailyShutdown.tsx` | `[showSummary, setShowSummary]` useState; `[showSunset, setShowSunset]` useState; both JSX blocks; both imports | `openSummaryOverlay("daily", selectedDate)` and `openSunsetOverlay()` at the trigger sites |
| `src/pages/WeeklyShutdown.tsx` | `[showSunset, setShowSunset]` useState; `<SunsetOverlay ... />` JSX; `import SunsetOverlay` | `openSunsetOverlay()` at the trigger site |

---

## Sub-milestones (R5 seam-then-wire-up cadence)

### M3.1.a — additive seam (one commit)

- Add the four store fields + four actions in `appStore.ts`.
- Create `SummaryOverlayHost.tsx` and `SunsetOverlayHost.tsx`.
- Mount both hosts at `App.tsx` alongside `TaskDetailOverlayHost`.
- **Don't touch the per-screen mounts.** Hosts stay inert because nothing calls the open actions yet.
- Verify: typecheck clean, build clean, app boots normally, both overlays still work via the existing per-screen `useState` paths.
- **Stop. Verse review.**

### M3.1.b — wire-up (one commit)

- Each parent: replace local `useState` + JSX with store action calls.
- Per-screen imports of the overlay components removed.
- Hosts now actually render when actions fire.
- Verify all the existing trigger flows: "Summarize plan" / "Summarize day" buttons, sunset animation on shutdown completion.
- **Stop. Verse review.**

---

## Risks & concerns

- **`SummaryOverlay`'s `type` prop type vs. the new store kind.** Currently the overlay takes `type: "daily" | "weekly"`. Match exactly. WeeklyShutdown doesn't currently render `SummaryOverlay`, only `SunsetOverlay` — the `kind: "weekly"` slot is reserved for future wiring without forcing the type to widen later.
- **Animation continuity.** `SunsetOverlay` runs an entrance animation on mount. Lifting to a singleton means it mounts/unmounts at the App shell. Should still animate correctly because `sunsetOverlayOpen` toggling false→true creates a fresh mount of the overlay's inner content. Verify in M3.1.b.
- **Re-render scope.** Trivial — only the host re-renders when the open-state field changes. Existing parent screens stop re-rendering on `showSummary`/`showSunset` toggles entirely. Net win.
- **No DB or schema change. No migration.** Pure React state restructure.
- **No security surface, no IPC, no budget impact.**

---

## Test plan

After M3.1.b:

1. **DailyPlanner "Summarize plan"** — click the summarize button. Overlay opens, displays the day's summary. Close it. Re-open. Verify behaves identically to pre-M3.1.
2. **DailyShutdown "Summarize day"** — same flow on the shutdown screen.
3. **DailyShutdown completion → sunset animation** — complete a daily shutdown. Sunset overlay appears with animation. Click to dismiss. Verify dismiss closes it cleanly.
4. **WeeklyShutdown completion → sunset animation** — same flow on weekly shutdown.
5. **No leak across screens** — open Summary on Daily Plan, navigate to Daily Shutdown without closing it. The overlay should still render (it's at App shell now). Closing it via Esc or backdrop click clears `summaryOverlay` in the store, dismissing it from wherever you are. Acceptable behavior shift; flag if user dislikes.
6. **Concurrent overlays** — open Summary; if Sunset triggers via shutdown completion, both should be able to render. Layer order: Sunset on top (full-screen animation). Verify z-index doesn't break.

---

## Out of scope (carry-forward to subsequent M3.x)

- Canonical `tasksById` lift → M3.2
- Task-time aggregates (`workedMinutesByTask`) → M3.3
- Cross-screen UX state (`editingTaskId`, `dailyPlanByDate`, etc.) → M3.4
- M3.5 cleanup (dead `handleStopFocus`, `restoreFocus`/`closeOrphanedTimeEntries` ordering, `tasksByIdCache` retirement, `verseday:task-*` events)
- ESLint custom rule (M4)

---

## Constraints

- Branch: `refactor/m3-canonical-tasks`. Never main.
- No schema change, no migration. `/docs/migration-discipline.md` compliant by absence.
- No security surface, no new IPC, no new persisted secrets.
- Budget: zero.
- M1 + M2 invariants preserved: `TaskDetailOverlay` singleton, `FocusState.taskId` canonical, pause-symmetry across all surfaces, worked-seconds counter as source of truth.
