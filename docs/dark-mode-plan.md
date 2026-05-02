# Dark Mode Plan

## Goal

Add system-following dark mode (`prefers-color-scheme`) without a manual toggle. Toggle is deferred to v2.

## Why CSS variables, not Tailwind `dark:`

The app uses ~200+ hardcoded colors as Tailwind arbitrary values (`text-[#2c2a35]`, `bg-[#f5f4f0]`, `border-black/[0.06]`). Adding `dark:` variants everywhere would mean editing nearly every component. Defining semantic tokens once and consuming them via `var(--…)` is the same edit volume but a single audit surface and one place to iterate the palette.

## Tailwind plumbing — decided

**Tailwind v4** (`^4.2.2`) is in use. We extend the theme via `@theme inline` in `src/index.css`, registering semantic color tokens that resolve to CSS variables. Tailwind utility names use shorter prefixes than the underlying CSS variables (e.g. `text-fg` instead of `text-text-primary`) to avoid awkward doubling:

```css
@theme inline {
  --color-base: var(--bg-base);
  --color-elevated: var(--bg-elevated);
  --color-fg: var(--text-primary);
  --color-fg-muted: var(--text-muted);
  --color-line-soft: var(--border-soft);
  /* …etc */
}

:root {
  --bg-base: #f5f4f0;
  --bg-elevated: #ffffff;
  --text-primary: #2c2a35;
  /* …etc */
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg-base: #16161a;
    --bg-elevated: #1f1f24;
    --text-primary: #e8e6e0;
    /* …etc */
  }
}
```

Components then use Tailwind's standard utilities: `bg-base`, `text-fg`, `text-fg-muted`, `border-line-soft`, `bg-accent-blue`. JIT-compatible, no parallel system, and the dark palette swaps in via media query. The full registration list and migration cheat sheet live in `/docs/dark-mode-tokens.md`.

## D3 chart strategy — decided

Tokens won't propagate through `.attr()` calls. Strategy: **hybrid**.
- Use `currentColor` in SVG attributes where the element naturally inherits text color (axis labels, tick marks).
- Use `getComputedStyle(document.documentElement).getPropertyValue('--…')` for explicit accents (bar fills, line strokes).
- Subscribe to `matchMedia('(prefers-color-scheme: dark)').addEventListener('change', …)` and re-render the chart on theme flip.

Applied at the Dashboard chart only — other surfaces don't render via D3.

## SVG strokes in JSX

Many components write `stroke="#7B9ED9"` or `fill="white"` directly on `<svg>` / `<path>`. Tailwind classes don't reliably style SVG attributes, so each must be hand-converted to `stroke="currentColor"` (where it inherits) or `stroke="var(--accent-blue)"` (explicit token). This will be a per-file sweep.

## Designed dark accents

Dark accents are **hand-tuned**, not programmatic `darken()`. The completion green and focus blue look loud on dark backgrounds at full saturation; we'll pick desaturated, slightly cooler variants. Same for focus ambient gradient stops and the green completion glow on the task modal.

## Milestones

Each ends with **"Ready for Verse review."**

### Milestone 1 — theme infrastructure
1. Write `/docs/dark-mode-tokens.md` (the contract).
2. Add semantic tokens to `:root` and the `@media (prefers-color-scheme: dark)` block in `src/index.css`.
3. Register them in `@theme inline` so Tailwind utilities resolve.
4. Verify the existing app still looks identical in light mode (no color drift while we shim infrastructure).

### Milestone 2 — core surfaces
- Sidebar + main shell
- Daily Plan + right-rail
- Weekly Plan calendar + project rail
- Focus Mode (timer ring strokes, ambient gradient, glow layer)
- Modal stack: TaskDetailOverlay, ProjectDetail, SummaryOverlay, CalendarPicker, ProjectPicker, SimpleSelect, TimeFieldPill popover

**Known global-CSS breaks to convert during M2 (carried over from M1, by file:line):**
- ⏳ `src/index.css:272` — native `<select>` caret SVG hardcodes `stroke='%23999'`. Three callsites still use native `<select>` (DailyPlanner inline-edit, WeeklyPlanner quick-add, ProjectDetail edit form). Deferred to M3/M4 — `color-scheme: light dark` on `:root` makes the OS render the form chrome itself, so the custom caret is mostly redundant; revisit during the audit.
- ⏳ `src/index.css:.shutdown-page` background gradient (raw hex stops `#dde8f0`, `#e8e4dc`, `#ede8e0`). Deferred to M3 (when shutdown screens get themed).
- ✅ `@keyframes focusAmbientBg` + reduced-motion fallback. Resolved in **M2.5**: tokens `--focus-ambient-cool` / `--focus-ambient-neutral` / `--focus-ambient-warm` defined with hand-tuned dark variants; keyframe and reduced-motion `background-color` both reference them. The previously-defined-but-unused `--focus-ambient-from/to` tokens were renamed to reflect actual consumption.
- ✅ `[data-palette="new"]` palette-preview block. Deleted in **M2.5** per its own disposable comment. The `!important` hex-literal selectors no longer matched anything once Daily Plan was tokenized in M2.3a/b.

### Milestone 3 — secondary surfaces
- Daily/Weekly Shutdown
- Settings
- Dashboard (incl. D3 chart re-theming via the strategy above)
- Projects list
- FocusPip (Tauri webview — verify color-scheme propagates on macOS)

### Milestone 4 — audit
1. **Automated grep**: `grep -rE '#[0-9a-fA-F]{3,8}|rgb\(|rgba\(' src/` — every hit must be intentional (e.g. dark-mode-only color in CSS) or a token.
2. **Contrast check**: every token pair (text-on-bg) hits WCAG AA — 4.5:1 for body, 3:1 for large/UI. Use a tool, not eyeballs.
3. **Focus ring visibility**: confirm focus-visible rings render against dark surfaces (current rings often assume light bg).
4. **Visual sweep**: every page in dark mode, every interactive state (hover/focus/active/disabled).
5. **PiP test on macOS**: launch a focus session in dark mode, confirm the PiP webview matches.

## Out of scope (track as follow-ups)

- Manual override toggle in Settings (v2).
- Per-component animation tuning if hover glows/shadows look wrong on dark — file separately during M4 audit.

---

## Verse review (durable)

**Verdict: APPROVED with conditions.**

### Conditions before milestone 1
1. Document the token contract first → `/docs/dark-mode-tokens.md`.
2. Include opacity tokens (`--border-hairline`, `--overlay-soft`, etc.) — don't leave alpha-on-neutral patterns implicit.
3. Decide Tailwind plumbing explicitly — chosen: extend theme via `@theme inline` referencing CSS vars (Tailwind v4 native).

### Conditions for milestones 2/3
4. D3 chart strategy — chosen: hybrid (`currentColor` + `getComputedStyle` + `matchMedia` change listener).
5. SVG strokes/fills in JSX — convert every hardcoded color to `currentColor` or `var(--…)`.
6. Hand-tuned dark accents, not programmatic darken.

### Conditions for milestone 4
7. Automated checks: grep for raw color literals, WCAG contrast on token pairs, focus-ring visibility on dark.

### Verify, don't assume
8. PiP color-scheme propagation on macOS — test in milestone 3 before claiming it works.

### Out of scope (Verse-confirmed)
- Settings override toggle → defer to v2.
- Animation glow/shadow re-tuning → file separately if needed during M4.

### Security
- No credentials, no API surface, no data-flow changes. Clean.

---

## Milestone 1 — review record

**First pass: REJECTED.** Blocker: naming drift between docs (`text-text-primary`, `border-border-soft`) and the actual Tailwind registrations in `src/index.css` (`text-fg`, `border-line-soft`). Both docs and the example code in this file have been updated to match the implementation's shorter form.

**Remediation in this revision:**
1. `dark-mode-tokens.md` — Tailwind registration block now mirrors `src/index.css` exactly; migration cheat sheet uses `text-fg`, `text-fg-muted`, `border-line-soft`, etc.
2. `dark-mode-tokens.md` — added a "Tokens NOT exposed as Tailwind utilities" section enumerating shadow / calendar / mood / focus / scrollbar tokens with the inline-style pattern; called out the `shadow-md` Tailwind-default trap.
3. `dark-mode-plan.md` (this file) — updated the Tailwind plumbing example to use `text-fg` etc.; added the known-break tracker for M2 (the four file:line references in `index.css` flagged by Verse).
4. Confirmed the `[data-palette="new"]` block at `src/index.css:499–516` is disposable; will be deleted during/before M2 per its own comment, not propagated.
