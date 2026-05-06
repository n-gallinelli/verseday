# Daily Shutdown — alignment & breathing room polish

Branch: `polish/shutdown-alignment-spacing`
File: `src/pages/DailyShutdown.tsx`

## Problems
1. Right edge of task rows jittered between rows depending on whether project name / time were rendered (both were conditional, so columns slid).
2. Rows were ~36px tall — visually cramped.
3. Header label "DAILY SHUTDOWN" rendered all-caps, felt aggressive.
4. Breadcrumb (Review → Reflect) too small and faint to read.
5. Star icons hugged the row's left edge.
6. Section gap between "Done today" / "Didn't get to" was tight; last row pressed against the Reflect footer.

## Decisions
- **Fixed-width right slots.** Project-name slot is always rendered at `w-[120px]`, time slot at `w-[44px]` (Done) / `w-[68px]` (Didn't, also hosts hover Move). Empty cells render an empty string so columns lock regardless of data.
- **Hover Move shares the time slot** in "Didn't get to" via absolute overlay — no extra column reserved, no shift.
- **Row padding `py-[6px]` → `py-3`** lifts row height to ~44–48px. `gap-2.5 → gap-3` adds general breathing room.
- **Star/priority indicator gets `ml-0.5`** so the leading icon isn't flush against the card edge.
- **Header**: drop `uppercase`, push padding `py-4 → py-5`, label-to-date `mb-1 → mb-2`.
- **Breadcrumb**: bump `text-[11px] → text-[12px]`, lift base color from `text-fg-faded` to `text-fg-secondary` (active step `text-fg`), keep arrow at `text-fg-faded` so it reads as separator not content.
- **Body container**: `space-y-6 → space-y-8`, `py-5 → pt-5 pb-8` so last row breathes from the footer.

## Out of scope / left as-is
- Dot vertical centering — `items-center` on the row already centers correctly; the taller row makes any perceived offset disappear. Will revisit only if it still looks off after preview.

## Verification
- `tsc --noEmit` clean.
- Visual verification pending in `npm run tauri dev`.
