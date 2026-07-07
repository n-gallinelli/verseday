# Break prompt — unify copy & styling across PiP + full focus screen

**Author:** Terse (from Nick's brief) · **Date:** 2026-07-07 · **Status:** QUEUED — plan only, NO code. Presentational (no bytes/schema). Needs Verse plan approval before build.

## Goal
The break prompt shows the same three choices on both the **PiP widget** and the **full focus screen**. Today the copy + button hierarchy diverge. Unify them: identical labels, identical hierarchy, warm-accent primary.

## Canonical actions (both surfaces, this order)
1. **Rest now** — primary. Keep the coffee-cup icon.
2. **In 5 min** — secondary.
3. **Skip it** — tertiary (quietest).

Same words on both surfaces; only the *layout* condenses on PiP.

## Button treatment (both surfaces)
- **Primary — "Rest now":** warm **sunset accent fill**, NOT green. Rationale: green is reserved for *completed* states in VerseDay; starting a break is an **action**, not a completion. Coffee-cup icon stays on the primary. Token: `--accent-orange` family (same warm accent as the attachments v2 pass — see `attachments-v2-plan.md`), never green, never `--accent-blue`.
- **Secondary — "In 5 min":** outlined or soft-filled in **warm neutral**, clearly lower weight than primary (`--accent-orange-soft-bg` / warm hairline, or a neutral outline).
- **Tertiary — "Skip it":** quietest — **plain muted text, no border**, lowest visual weight of the three.

## Per-surface layout
- **Full focus screen:** three **separate buttons**, as today (just restyled to the hierarchy above).
- **Compact PiP:** primary stays the **filled pill**; render **"In 5 min · Skip it"** as a smaller **secondary line beneath** it — same words, condensed to fit the smaller surface. (Two tap targets on that line, middot separator.)

## Implementation hooks (confirm exact files at build time)
- Full focus-screen break prompt: `src/components/FocusMode.tsx` (break-phase prompt UI).
- PiP break prompt: the focus-pip webview break-prompt component (see `project_break_end_and_meeting_followups`, `project_pip_break_prompt_polish_tabled`).
- Shared risk: the two surfaces have historically **drifted** (copy + styling). Consider a tiny shared constants module for the three labels + order so they can't diverge again (mirrors the shared-focus-control lesson). Do NOT over-abstract the layout — PiP vs focus differ structurally.
- Related history to respect: the "Rest now" PiP CTA had a low-contrast white-on-green issue (`project_rest_now_contrast_followup`) — the warm-accent fill here should be checked for AA contrast on its label.

## Open items for Verse (plan gate)
- Confirm the warm-accent-primary / green-reserved-for-completed rule is applied ONLY here + the attachments surface, not leaked globally (same scope-discipline flag as attachments v2). Blue remains the global interactive primary elsewhere.
- Shared-label constants module: yes/no.
- No DB/schema change — presentational only. Confirm.
- Contrast check on the warm primary's label (AA).

## Notes
- Purely presentational; no migration, no store change.
- Palette + scope rules align with the attachments v2 pass — build the two together or back-to-back to keep the warm-accent treatment consistent.
