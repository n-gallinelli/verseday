# Dark Mode Token Contract

The token contract for VerseDay's light + dark themes. **Every color in the app should resolve to one of these tokens.** Raw color literals (`#…`, `rgb(…)`, `rgba(…)`, `bg-black/[0.x]`) are forbidden in component code post-milestone 4 — only allowed inside `src/index.css` and the `@theme` block.

Light values follow the existing palette. Dark values are hand-tuned (not programmatic darken) for legibility and brand fit.

---

## 1. Surfaces

| Token              | Light        | Dark         | Usage                                                       |
| ------------------ | ------------ | ------------ | ----------------------------------------------------------- |
| `--bg-base`        | `#f5f4f0`    | `#16161a`    | App main background, primary canvas                         |
| `--bg-sidebar`     | `#efede8`    | `#1a1a1f`    | Left sidebar nav (chrome surface, slightly distinct from base) |
| `--bg-elevated`    | `#ffffff`    | `#1f1f24`    | Cards, modals, popovers, task rows                          |
| `--bg-rail`        | `#FAFAF7`    | `#1b1b20`    | Side rails (project detail right rail, task detail rail)    |
| `--bg-sunken`      | `#f0eeea`    | `#121215`    | Focus mode ambient base, deep recesses                      |
| `--bg-input`       | `rgba(0,0,0,0.03)` | `rgba(255,255,255,0.04)` | Pill inputs, time fields, segmented controls         |
| `--bg-input-hover` | `rgba(0,0,0,0.06)` | `rgba(255,255,255,0.07)` | Hover state for the above                            |
| `--bg-tag-soft`    | `rgba(0,0,0,0.04)` | `rgba(255,255,255,0.05)` | Subtle tag/chip backgrounds                          |
| `--bg-banner`      | `#2c2a35`    | `#2a2a30`    | Notification banner surface (always darker than the page; pairs with `--text-banner`) |
| `--text-banner`    | `#f5f4f0`    | `#e8e6e0`    | Text/caption color on `--bg-banner` (always light, both themes)                       |

---

## 2. Text

| Token                | Light                  | Dark                  | Usage                                            |
| -------------------- | ---------------------- | --------------------- | ------------------------------------------------ |
| `--text-primary`     | `#2c2a35`              | `#e8e6e0`             | Body, headings, task titles                      |
| `--text-secondary`   | `rgba(0,0,0,0.55)`     | `rgba(232,230,224,0.7)` | Field labels, secondary copy                   |
| `--text-muted`       | `rgba(0,0,0,0.40)`     | `rgba(232,230,224,0.5)` | Hints, hover tooltips, completed task copy     |
| `--text-faded`       | `rgba(0,0,0,0.25)`     | `rgba(232,230,224,0.35)` | Placeholders, "no data" states, ✕ buttons      |
| `--text-disabled`    | `rgba(0,0,0,0.15)`     | `rgba(232,230,224,0.18)` | Disabled controls, very subtle metadata        |
| `--text-on-accent`   | `#ffffff`              | `#0f0f12`             | Text/icons on solid accent backgrounds (play button, save button) |

---

## 3. Borders & dividers

| Token                | Light                  | Dark                       | Usage                                       |
| -------------------- | ---------------------- | -------------------------- | ------------------------------------------- |
| `--border-hairline`  | `rgba(0,0,0,0.06)`     | `rgba(255,255,255,0.07)`   | Default 0.5px hairlines                     |
| `--border-soft`      | `rgba(0,0,0,0.08)`     | `rgba(255,255,255,0.09)`   | Cards, modals, slightly more present        |
| `--border-medium`    | `rgba(0,0,0,0.12)`     | `rgba(255,255,255,0.14)`   | Hover/active border emphasis                |
| `--border-strong`    | `rgba(0,0,0,0.20)`     | `rgba(255,255,255,0.24)`   | Default checkbox border                     |
| `--divider`          | `rgba(0,0,0,0.04)`     | `rgba(255,255,255,0.06)`   | Vertical dividers, super-subtle separators  |

---

## 4. Overlays

| Token                | Light                | Dark                  | Usage                                          |
| -------------------- | -------------------- | --------------------- | ---------------------------------------------- |
| `--overlay-scrim`    | `rgba(0,0,0,0.30)`   | `rgba(0,0,0,0.55)`    | Modal backdrop                                 |
| `--overlay-hover`    | `rgba(0,0,0,0.04)`   | `rgba(255,255,255,0.05)` | Hover wash on neutral surfaces              |
| `--overlay-pressed`  | `rgba(0,0,0,0.08)`   | `rgba(255,255,255,0.09)` | Active/pressed state                         |
| `--shadow-card`      | `0 2px 10px -2px rgba(0,0,0,0.07)` | `0 4px 14px -2px rgba(0,0,0,0.5)` | Card hover lift |
| `--shadow-modal`     | `0 8px 40px rgba(0,0,0,0.10), 0 2px 8px rgba(0,0,0,0.06)` | `0 12px 48px rgba(0,0,0,0.6), 0 4px 16px rgba(0,0,0,0.4)` | Modal box-shadow |

---

## 5. Brand accents

Hand-tuned for each theme — dark variants are slightly desaturated and warmed to read against the dark surfaces without glowing.

| Token                       | Light       | Dark        | Usage                                                   |
| --------------------------- | ----------- | ----------- | ------------------------------------------------------- |
| `--accent-blue`             | `#7B9ED9`   | `#7396cc`   | Focus blue — play buttons, primary CTAs, selected states |
| `--accent-blue-hover`       | `#6889c4`   | `#5f86bc`   | Hover for above                                         |
| `--accent-blue-soft-bg`     | `#EEF3FB`   | `rgba(115,150,204,0.16)` | Selected pickers/menus                       |
| `--accent-blue-soft-text`   | `#3D6FCC`   | `#9bb8e3`   | Text on the soft-bg                                     |
| `--accent-green`            | `#6A9E7F`   | `#6fa088`   | Completion green — checkbox fill, task-done glow        |
| `--accent-green-hover`      | `#5a8a6e`   | `#5e8c75`   |                                                         |
| `--accent-green-bright`     | `#5DCAA5`   | `#55b598`   | Active timer text, mood-positive tint, weekly shutdown primary |
| `--accent-green-bright-hover` | `#4ab893` | `#4ba089`   | Hover for `--accent-green-bright` (e.g. "Save & shutdown") |
| `--accent-green-deep`       | `#0F6E56`   | `#3aa386`   | "Done today" labels, weekly shutdown chip               |
| `--accent-green-glow`       | `rgba(106,158,127,0.22)` | `rgba(111,160,136,0.28)` | Top-of-modal completion gradient (peak)        |
| `--accent-green-soft-bg`    | `#F0F9F5`   | `rgba(111,160,136,0.14)` | Soft-tinted callout banner bg (e.g. weekly carry-forward) |
| `--accent-orange`           | `#e0873e`   | `#d68647`   | Priority high tint, weekly planner accents              |
| `--accent-orange-hover`     | `#cc7633`   | `#c47840`   |                                                         |
| `--accent-orange-soft-bg`   | `#FFF8F0`   | `rgba(214,134,71,0.10)` | High-priority task card background                |
| `--accent-orange-soft-bg-hover` | `#FFF4E8` | `rgba(214,134,71,0.14)` |                                              |
| `--accent-warning`          | `#c9923a`   | `#d6a35a`   | Rollover-day badge, advisory amber (not destructive)    |
| `--accent-danger`           | `#d95f5f`   | `#e07474`   | Overdue badges, destructive (trash) hover               |

---

## 6. Picker/calendar accents

| Token                       | Light       | Dark        | Usage                                       |
| --------------------------- | ----------- | ----------- | ------------------------------------------- |
| `--calendar-selected-bg`    | `#6B84A3`   | `#6e8aa9`   | Selected day pill in CalendarPicker         |
| `--calendar-today-ring`     | `#6B84A3`   | `#88a5c4`   | "Today" ring + text in CalendarPicker       |
| `--calendar-day-hover`      | `#F0F0ED`   | `rgba(255,255,255,0.06)` | Day cell hover                  |

---

## 7. Status / mood

| Token                      | Light                  | Dark                   | Usage                                  |
| -------------------------- | ---------------------- | ---------------------- | -------------------------------------- |
| `--mood-tint-shutdown`     | `#5DCAA5`              | `#55b598`              | Weekly shutdown mood selector default tint   |
| `--mood-tint-daily`        | `#7B9ED9`              | `#7396cc`              | Daily shutdown mood selector default tint    |
| `--mood-bad`               | `#C0614A`              | `#cf7864`              | Selected-state tint for "Bad" / "Rough" moods (overrides the default tint) |
| `--mood-okay`              | `#D4A843`              | `#dfb555`              | Selected-state tint for "Okay" mood (overrides the default tint) |

The mood selector uses a **tiered tint strategy**: negative moods (Bad, Rough) share `--mood-bad` so they read as a single "off" register; the neutral mood (Okay) gets its own amber via `--mood-okay`; positive moods (Good, Great) deliberately have **no dedicated token** and fall through to the page-level `tintColor` prop (`--mood-tint-shutdown` for Weekly, `--mood-tint-daily` for Daily) because the page tint already encodes the celebratory palette for that surface. If a future design wants to differentiate Bad from Rough or Good from Great, add explicit tokens then; the current 3-tier collapsing is intentional, not an oversight.

---

## 8. Focus mode (special)

The Focus screen and PiP have their own surfaces because they ride on top of an ambient gradient.

| Token                         | Light                            | Dark                              | Usage                                       |
| ----------------------------- | -------------------------------- | --------------------------------- | ------------------------------------------- |
| `--focus-ambient-cool`        | `#f0f2f5`                        | `#161921`                         | 0% stop of the 25-min ambient bg keyframe (cool blue-neutral) |
| `--focus-ambient-neutral`     | `#f5f3ee`                        | `#16161a`                         | 50% stop (neutral midpoint, also reduced-motion fallback)     |
| `--focus-ambient-warm`        | `#f5f0e6`                        | `#1c1916`                         | 100% stop (warm amber-neutral)              |
| `--focus-ring-track`          | `rgba(0,0,0,0.05)`               | `rgba(255,255,255,0.06)`          | Timer ring background stroke                |
| `--focus-ring-progress`       | `#4a9e6e`                        | `#52a981`                         | Timer ring break progress stroke            |
| `--focus-glow-base`           | `#7B9ED9`                        | `#7396cc`                         | Glow layer ring during work                 |
| `--focus-glow-break`          | `#4a9e6e`                        | `#52a981`                         | Glow layer ring during break                |
| `--focus-pip-bg`              | `#f5f4f0`                        | `#1f1f24`                         | PiP window background                       |
| `--focus-pip-border`          | `rgba(0,0,0,0.08)`               | `rgba(255,255,255,0.10)`          | PiP outer border                            |

---

## 9. Shutdown screens (special)

Daily and Weekly Shutdown share a vertical "dusk sky" gradient (`.shutdown-page` in `index.css`) that's distinct from the Focus-mode ambient. Different emotional intent — focus-ambient is a subtle 25-minute temperature drift behind work; shutdown is a saturated end-of-day sky aesthetic for reflection. The two surface palettes were audited for reuse during M3.2 and **intentionally diverged** (cool stop is ~19 hex points bluer; neutral is ~10 hex points warmer; warm is ~6-8 hex points darker). Documented here as parallel to Focus mode.

| Token                         | Light       | Dark        | Usage                                       |
| ----------------------------- | ----------- | ----------- | ------------------------------------------- |
| `--shutdown-bg-cool`          | `#dde8f0`   | `#181c24`   | 0% stop of `.shutdown-page` gradient (top, cool blue dusk → deep midnight blue) |
| `--shutdown-bg-neutral`       | `#e8e4dc`   | `#181614`   | 40% stop (neutral midpoint, warmth begins)  |
| `--shutdown-bg-warm`          | `#ede8e0`   | `#1c1814`   | 100% stop (warm earth tone at the bottom)   |

---

## Tailwind registration

A subset of these tokens are exposed to Tailwind v4 in `src/index.css` via `@theme inline`. Tailwind utility names are deliberately shorter than the underlying var name (e.g. `text-fg` rather than `text-text-primary`) to avoid the awkward `text-text-…` doubling.

```css
@theme inline {
  /* Surfaces */
  --color-base: var(--bg-base);
  --color-sidebar: var(--bg-sidebar);
  --color-elevated: var(--bg-elevated);
  --color-rail: var(--bg-rail);
  --color-sunken: var(--bg-sunken);
  --color-input: var(--bg-input);
  --color-input-hover: var(--bg-input-hover);
  --color-tag-soft: var(--bg-tag-soft);

  /* Text */
  --color-fg: var(--text-primary);
  --color-fg-secondary: var(--text-secondary);
  --color-fg-muted: var(--text-muted);
  --color-fg-faded: var(--text-faded);
  --color-fg-disabled: var(--text-disabled);
  --color-fg-on-accent: var(--text-on-accent);

  /* Borders & dividers */
  --color-line-hairline: var(--border-hairline);
  --color-line-soft: var(--border-soft);
  --color-line-medium: var(--border-medium);
  --color-line-strong: var(--border-strong);
  --color-divider: var(--divider);

  /* Overlays */
  --color-overlay-scrim: var(--overlay-scrim);
  --color-overlay-hover: var(--overlay-hover);
  --color-overlay-pressed: var(--overlay-pressed);

  /* Accents */
  --color-accent-blue: var(--accent-blue);
  --color-accent-blue-hover: var(--accent-blue-hover);
  --color-accent-blue-soft: var(--accent-blue-soft-bg);
  --color-accent-blue-soft-fg: var(--accent-blue-soft-text);

  --color-accent-green: var(--accent-green);
  --color-accent-green-hover: var(--accent-green-hover);
  --color-accent-green-bright: var(--accent-green-bright);
  --color-accent-green-bright-hover: var(--accent-green-bright-hover);
  --color-accent-green-deep: var(--accent-green-deep);
  --color-accent-green-soft: var(--accent-green-soft-bg);

  --color-accent-orange: var(--accent-orange);
  --color-accent-orange-hover: var(--accent-orange-hover);
  --color-accent-orange-soft: var(--accent-orange-soft-bg);
  --color-accent-orange-soft-hover: var(--accent-orange-soft-bg-hover);

  --color-accent-warning: var(--accent-warning);

  --color-accent-danger: var(--accent-danger);
}
```

Components then write standard Tailwind utilities — e.g. `bg-elevated`, `text-fg`, `text-fg-muted`, `border-line-soft`, `bg-accent-blue`.

### Tokens NOT exposed as Tailwind utilities

The following tokens are intentionally consumed directly via `var(--…)` (in CSS rules, inline `style={{ }}` props, or SVG attributes) — **they are not registered in `@theme inline`** because they don't fit the standard `bg-*` / `text-*` / `border-*` utility shape:

| Token group     | Tokens                                                                                              | Pattern                                                                |
| --------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Shadows         | `--shadow-card`, `--shadow-modal`                                                                    | `style={{ boxShadow: "var(--shadow-modal)" }}`                          |
| Calendar        | `--calendar-selected-bg`, `--calendar-today-ring`, `--calendar-day-hover`                            | `style={{ backgroundColor: "var(--calendar-selected-bg)" }}` or in CSS |
| Mood tints      | `--mood-tint-shutdown`, `--mood-tint-daily`, `--mood-bad`, `--mood-okay`                              | `tintColor="var(--mood-tint-shutdown)"` prop; `MOOD_COLORS` map in `MoodSelector.tsx` uses `var(--mood-bad)` / `var(--mood-okay)` strings consumed via inline style |
| Focus mode      | `--focus-ambient-cool/neutral/warm`, `--focus-ring-track`, `--focus-ring-progress`, `--focus-glow-base/break`, `--focus-pip-bg`, `--focus-pip-border` | CSS rules in `index.css` or SVG `stroke="var(--…)"` / `style={{}}`     |
| Shutdown        | `--shutdown-bg-cool/neutral/warm`                                                                    | `.shutdown-page` linear-gradient stops in `index.css` only             |
| Banner          | `--bg-banner` (registered via `--color-banner` → `bg-banner` utility), `--text-banner`               | `bg-banner` Tailwind utility for the surface; inline `style={{ color: "var(--text-banner)" }}` for text. See "Banner pattern" section below |
| Scrollbar       | `--scrollbar-thumb`, `--scrollbar-thumb-hover`                                                       | CSS rules in `index.css` only                                          |
| Accent glow     | `--accent-green-glow`                                                                                | Inline `style={{ background: "linear-gradient(..., var(--accent-green-glow), ...)" }}` (used in TaskDetailOverlay completion gradient) |

If you need one of these in a place that would normally be a Tailwind utility, switch to inline `style={{ }}`. Don't add them to `@theme` ad-hoc — the contract is that `@theme` only contains tokens that map cleanly to a `bg-*` / `text-*` / `border-*` / overlay utility.

### Important: `shadow-*` Tailwind classes do NOT pick up our shadow tokens

Tailwind's built-in `shadow-md`, `shadow-lg`, etc. resolve to Tailwind's defaults — **not** to `--shadow-card` / `--shadow-modal`. M2 must convert shadow callsites to either:

```jsx
style={{ boxShadow: "var(--shadow-modal)" }}
```

or — if a Tailwind utility is preferred — register a custom shadow in `@theme inline` (e.g. `--shadow-card: var(--shadow-card);`) so it becomes a `shadow-card` class. Decide per case during the M2 sweep; don't leave bare `shadow-md` calls sitting on token-converted surfaces.

---

## Migration patterns (cheat sheet)

These are the Tailwind utilities that resolve through `@theme inline`. The prefix shape is shorter than the underlying var (`text-fg`, not `text-text-primary`) — see the registration block above.

| Was                                | Becomes                            |
| ---------------------------------- | ---------------------------------- |
| `bg-white`                         | `bg-elevated`                      |
| `bg-[#f5f4f0]`                     | `bg-base`                          |
| `bg-[#FAFAF7]`                     | `bg-rail`                          |
| `bg-[#f0eeea]`                     | `bg-sunken`                        |
| `text-[#2c2a35]`                   | `text-fg`                          |
| `text-black/55`                    | `text-fg-secondary`                |
| `text-black/40`                    | `text-fg-muted`                    |
| `text-black/25`                    | `text-fg-faded`                    |
| `text-black/15`                    | `text-fg-disabled`                 |
| `border-black/[0.06]`              | `border-line-hairline`             |
| `border-black/[0.08]`              | `border-line-soft`                 |
| `border-black/[0.12]`              | `border-line-medium`               |
| `border-black/20`                  | `border-line-strong`               |
| `bg-black/[0.04]` (hover wash)     | `bg-overlay-hover`                 |
| `bg-black/[0.08]` (pressed)        | `bg-overlay-pressed`               |
| `bg-black/[0.03]` (input fill)     | `bg-input`                         |
| `bg-black/[0.06]` (input hover)    | `bg-input-hover`                   |
| `bg-[#7B9ED9]`                     | `bg-accent-blue`                   |
| `hover:bg-[#6889c4]`               | `hover:bg-accent-blue-hover`       |
| `bg-[#EEF3FB]`                     | `bg-accent-blue-soft`              |
| `text-[#3D6FCC]`                   | `text-accent-blue-soft-fg`         |
| `bg-[#6A9E7F]`                     | `bg-accent-green`                  |
| `bg-[#5DCAA5]` / `text-[#5DCAA5]`  | `bg-accent-green-bright` / `text-…`|
| `hover:bg-[#4ab893]`               | `hover:bg-accent-green-bright-hover`|
| `text-[#0F6E56]`                   | `text-accent-green-deep`           |
| `bg-[#e0873e]` / `text-…`          | `bg-accent-orange` / `text-…`      |
| `bg-[#FFF8F0]`                     | `bg-accent-orange-soft`            |
| `hover:bg-[#FFF4E8]`               | `hover:bg-accent-orange-soft-hover`|
| `bg-[#F0F9F5]`                     | `bg-accent-green-soft`             |
| `text-[#c9923a]` / `bg-…`          | `text-accent-warning` / `bg-…`     |
| `text-[#d95f5f]` / `bg-…`          | `text-accent-danger` / `bg-…`      |
| `text-white` (on solid accent)     | `text-fg-on-accent`                |
| `bg-black/30` (modal scrim)        | `bg-overlay-scrim`                 |

### SVG attributes

SVG `stroke=` / `fill=` don't reliably accept Tailwind classes, so use `var(--…)` directly — or `currentColor` when the SVG inherits from its parent's text color:

```jsx
// before
<path stroke="#7B9ED9" />

// after — explicit token
<path stroke="var(--accent-blue)" />

// or — inherit from parent text color
<svg stroke="currentColor" className="text-accent-blue"><path /></svg>
```

### Inline-style tokens (not Tailwind)

For tokens not registered in `@theme inline` (shadows, focus, calendar, mood, scrollbar — see the table above), use inline `style={{ }}` or CSS rules:

```jsx
// shadow
<div style={{ boxShadow: "var(--shadow-modal)" }}>…</div>

// focus ambient gradient on a CSS class — see `.focus-ambient-bg` in index.css
```

### Box-shadow gotcha

Tailwind's `shadow-md`, `shadow-lg`, etc. resolve to **Tailwind defaults**, not `--shadow-card` / `--shadow-modal`. Convert these explicitly during M2 — see the "Important" callout in the registration section above.

### Banner pattern

When a banner needs to **stand out as a transient notification** — drag-drop undo, bulk-action confirmation, etc. — use the dedicated `--bg-banner` + `--text-banner` token pair. Both adapt to the theme: the banner surface is always darker than the surrounding page, the text is always lighter than the surface.

```jsx
<div className="bg-banner" style={{ color: "var(--text-banner)" }}>…</div>
```

| Theme | `--bg-banner` | `--text-banner` | Effect |
| ----- | ------------- | --------------- | ------ |
| Light | `#2c2a35`     | `#f5f4f0`       | Strongly dark surface against the warm-beige page; high-attention notification |
| Dark  | `#2a2a30`     | `#e8e6e0`       | Slightly lifted dark surface against the deeper page bg; reads as native dark-mode chrome, still distinct from `bg-elevated` and `bg-base` |

Earlier iterations tried an "inverted-contrast" trick (`bg-fg` + `text-base`) that auto-flipped the banner colors via the existing fg/bg primary tokens. It was clever but produced a near-white banner in dark mode, which clashed with the rest of the dark UI. The dedicated pair above stays in the dark-mode register while still standing out.

> **⚠️ Don't use the `text-banner` Tailwind utility.** Tailwind v4 auto-derives **both** `bg-banner` and `text-banner` from any `--color-*` registration. Our `--color-banner: var(--bg-banner)` line in `@theme inline` therefore generates a `text-banner` class — but it resolves to `--bg-banner` (the dark surface color), **not** to `--text-banner` (the cream text color). Anyone who writes `<span className="text-banner">` expecting the cream text gets charcoal text instead, silently. For banner text, **always** use inline `style={{ color: "var(--text-banner)" }}` as shown in the example above. (`--text-banner` itself is intentionally not registered in `@theme inline` because the Tailwind class name it would produce — `text-text-banner` — clashes with our shorter-prefix convention; even if it were registered cleanly, the `text-banner` collision above would still need this warning.)
>
> A future cleanup would rename the Tailwind utility for the banner surface (e.g. `bg-banner-surface`) so the collision is impossible. Out of scope for the current contract — too invasive to retrofit.

| Element type                                  | Pattern                              |
| --------------------------------------------- | ------------------------------------ |
| Banner outer surface                          | `className="bg-banner"` + `style={{ color: "var(--text-banner)" }}` |
| Action / link inside the banner               | A theme-stable accent (e.g. `text-accent-orange`, `text-accent-green-bright`) — readable against `--bg-banner` in both themes |
| Hover state on banner action                  | Pull toward `--text-banner`: `onMouseEnter={(e) => e.currentTarget.style.color = "var(--text-banner)"}` |

#### Action color in banners — pick the page's accent register

The banner surface is theme-fixed (`--bg-banner` / `--text-banner`), but the action link inside it picks up the page's primary accent so the per-page identity survives the shared notification chrome. Three banners are live as of M3.3, each tinted by its page:

| Page                  | Page accent leaning | Action-link class            |
| --------------------- | ------------------- | ---------------------------- |
| Weekly Planner (M2.4) | orange              | `text-accent-orange`         |
| Weekly Shutdown (M3.2) | green              | `text-accent-green-bright`   |
| Projects list (M3.3)  | blue                | `text-accent-blue`           |

Hover handler in all three swaps the link's color to `var(--text-banner)` (cream against the dark banner surface) so the link "absorbs" into the banner text register on hover. New banners follow the same recipe: pick the host page's primary accent for the action; hover flips to `var(--text-banner)`. Don't introduce a "neutral" or `text-fg-muted` action — it would break the per-page identity convention.

Example: `WeeklyPlanner.tsx:696` (undo banner after a drag-drop date move).

### Modal background rule

Modals don't all use the same outer surface. The right token depends on what the modal renders inside:

- **Single-content modal** (no internal `bg-elevated` cards) → outer uses **`bg-elevated`**.  
  Examples: `TaskDetailOverlay`, `SummaryOverlay`, `CalendarPicker` popover, `TimeFieldPill` popover, `ProjectPicker` / `SimpleSelect` dropdowns.
- **Container modal** (renders `bg-elevated` cards/sub-surfaces inside, with the modal's bg showing in the gaps) → outer uses **`bg-base`**.  
  Example: `ProjectDetail` (1080px container, internal task cards at `bg-elevated`, right rail at `bg-rail`).

Why: in dark mode, `bg-elevated` (`#1f1f24`) and a card on `bg-elevated` have **zero contrast** — the cards visually merge with the modal background. The `bg-base` outer keeps card surfaces ~9 hex points lighter, so cards still read as cards. In light mode the values are close so either choice looks fine, but the rule is set by the dark-mode constraint.

---

## Intentional exceptions (don't tokenize)

Some color literals are deliberately **not** tokens because they're decorative brand illustration that should look identical in light and dark mode. These are pre-approved exclusions for the M4 audit grep:

| File                                  | Lines     | What                                                                                  |
| ------------------------------------- | --------- | ------------------------------------------------------------------------------------- |
| `src/components/Sidebar.tsx`          | 165–230   | `VerseDayLogo` SVG — sunrise/ocean gradient stops + four sunset ring segments. Brand mark, fixed regardless of theme. |
| `src/components/SunsetOverlay.tsx`    | 70–106    | Post-shutdown celebration overlay — peach → pink → indigo sunset gradient + white text and translucent-white "Done" button. The sunset is a literal sunset illustration; "white" on the dark gradient reads identically in both themes. |

If a new decorative illustration is added in the future and should not theme, append a row here in the same commit. Otherwise the M4 grep will flag it.
