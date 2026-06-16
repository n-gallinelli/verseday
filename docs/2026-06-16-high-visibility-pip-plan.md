# High-visibility focus timer (larger + calm breathing glow)

**Date:** 2026-06-16
**Author:** Terse
**Status:** PENDING Verse review — no code written yet
**Branch:** `feat/quickadd-tab-tooltip-refocus` (ships TOGETHER with the QuickAdd work
in one PR — Nick's call)

## Goal

A more noticeable Focus PiP so that when Nick is getting distracted, a larger,
gently glowing mini-timer in his peripheral vision reminds him to stay on task.
Opt-in via a **Settings toggle** (default off). Feel = **calm breathing**: a slow
~2.5s pulse, brand accent, peripheral presence — a focus aid, not an alarm.

## Constraints discovered (shape the design)

- PiP size is the shared constant `PIP_SIZE = {220×58}` in
  `src/components/pipEvents.ts`, consumed in **two** places — window creation
  (`FocusMode.tsx`) and content self-pinning (`FocusPip.tsx`). Window is
  `resizable:false`, transparent, always-on-top.
- The card fills the whole window (`h-screen`), so **a glow has nowhere to render**
  — a halo would be clipped at the window edge. High-vis mode therefore needs a
  **larger window with the card inset**, so the halo lives in transparent padding.
- Settings persist to the SQLite `settings` table via `setSetting`/`getSetting`
  (+ typed helpers in `focusSettings.ts`); the "pip complete behavior" setting is
  the end-to-end pattern to copy. **No DDL / no migration needed** — reuses the
  existing key/value table.
- Settings reach the PiP webview by riding along in the `PipState` broadcast
  (`PIP_STATE_EVENT`); same-window propagation (Settings → FocusMode) is a
  `window.dispatchEvent(CustomEvent(...))`.

## Locked design decisions

- **Boolean setting, default OFF.** Existing usage unchanged unless toggled.
- **Calm breathing glow:** opacity pulse 0.55↔1 over ~2.5s ease-in-out.
- **Glow color tracks phase:** brand green during work, the break color during breaks.
- **~1.3× larger,** content scaled **uniformly** (transform: scale) so all three
  phase layouts — running/paused, break countdown, completion takeover — magnify
  together and the break-prompt height math stays valid in scaled units.
- **Cheap animation:** animate a glow layer's **opacity** only, never `box-shadow`
  blur radius (battery on an always-on-top window).
- **Respect `prefers-reduced-motion`:** static mid-intensity glow, no pulse.

## Implementation plan

### 1. Setting persistence — `src/utils/focusSettings.ts`
- `KEY_PIP_HIGH_VIS = "pip.high_visibility"`.
- `getPipHighVisibility(): Promise<boolean>` and `setPipHighVisibility(v): Promise<void>`
  over the existing `getSetting`/`setSetting`. No schema change.

### 2. Settings UI — `src/pages/Settings.tsx`
- New row in the mini-timer group (near the `pipCompleteBehavior` row ~L289): a
  toggle switch "High-visibility focus timer" + subcopy ("Larger mini timer with a
  gentle glow, so it's easier to notice and stay on task"). Reuse the existing
  toggle/segmented style.
- Load on mount; `handlePipHighVisChange` persists + dispatches
  `PIP_HIGH_VIS_CHANGED_EVENT` for the same-window FocusMode mount.

### 3. Shared constants/types — `src/components/pipEvents.ts`
- `PIP_SIZE_LARGE` ≈ scaled card (220×58 × 1.3 → ~286×75) **plus halo padding**
  (~14px each side) → roughly **314×103**. Exact dims finalized in impl with the
  hard constraint that the **break-prompt (tallest phase)** isn't clipped.
- Add `highVisibility: boolean` to the `PipState` interface.
- Add `PIP_HIGH_VIS_CHANGED_EVENT = "verseday:pip-high-vis-changed"`.

### 4. Window owner — `src/components/FocusMode.tsx`
- Read `getPipHighVisibility()` into a ref on mount; update live on
  `PIP_HIGH_VIS_CHANGED_EVENT`.
- Create the PiP window at `highVis ? PIP_SIZE_LARGE : PIP_SIZE`.
- Include `highVisibility` in every `PipState` broadcast.
- **Live toggle:** when the setting flips while a PiP is open,
  `pipRef.current.setSize(new LogicalSize(...))` + re-broadcast state, then re-run
  the off-screen clamp so the resized window can't hang off the monitor.
  (Fallback if setSize proves glitchy: close + recreate the window.)

### 5. PiP content — `src/components/FocusPip.tsx`
- Read `highVisibility` from `PipState`.
- Pin window size from the flag (the on-mount `setSize` chooses LARGE when set);
  add an effect to re-pin when the flag changes live.
- Render, when high-vis:
  - Inset the card to leave transparent halo room; keep `data-tauri-drag-region`
    covering the card.
  - Wrap the existing per-phase render in a base-sized inner element scaled
    `transform: scale(1.3)` (uniform) so layouts magnify without re-tuning.
  - A glow layer behind the card (absolutely-positioned, card-shaped, blurred
    accent shadow) with the breathing animation; color by phase via CSS vars.
- Normal mode is unchanged (current 220×58, no glow).

### 6. CSS — `src/index.css`
- `@keyframes pipGlowBreathe` (opacity 0.55→1→0.55, 2.5s ease-in-out infinite) +
  `.animate-pip-glow`.
- `@media (prefers-reduced-motion: reduce)` → animation none, fixed opacity.
- Glow color from existing accent-green / break-phase vars.

## Risk / review focus
- **Two size sources** (FocusMode create + FocusPip pin) both branch on the flag via
  the shared constants — must not drift (same discipline as today's PIP_SIZE).
- **Off-screen clamp after a live resize** — re-run `clampToFrame` so the enlarged
  window stays on the visible frame.
- **Break-prompt clipping** — uniform scale preserves the 58px-floor ratio; verify
  the break prompt's button row isn't clipped at the large size.
- **Glow needs transparent margin** — window stays transparent, card inset, drag
  region still covers the card.
- **Battery** — opacity-only animation, not box-shadow blur.
- **Reduced motion** honored.
- **No DB / no DDL / no migration** (reuses `settings` table). **Zero cost.**
- **Default off** — no change to existing PiP behavior unless toggled.

## Verification plan
- `tsc` + `eslint` + `vite build` clean.
- Manual: toggle on → PiP grows + breathes; toggle off → reverts live; work=green vs
  break=break-color; drag + off-screen clamp still correct at the larger size;
  `prefers-reduced-motion` shows a static glow.
