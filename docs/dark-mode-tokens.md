# Dark Mode Token Contract

The token contract for VerseDay's light + dark themes. **Every color in the app should resolve to one of these tokens.** Raw color literals (`#…`, `rgb(…)`, `rgba(…)`, `bg-black/[0.x]`) are forbidden in component code post-milestone 4 — only allowed inside `src/index.css` and the `@theme` block.

Light values follow the existing palette. Dark values are hand-tuned (not programmatic darken) for legibility and brand fit.

---

## 1. Surfaces

| Token              | Light        | Dark         | Usage                                                       |
| ------------------ | ------------ | ------------ | ----------------------------------------------------------- |
| `--bg-base`        | `#f5f4f0`    | `#16161a`    | App background (main shell, sidebar)                        |
| `--bg-elevated`    | `#ffffff`    | `#1f1f24`    | Cards, modals, popovers, task rows                          |
| `--bg-rail`        | `#FAFAF7`    | `#1b1b20`    | Side rails (project detail right rail, task detail rail)    |
| `--bg-sunken`      | `#f0eeea`    | `#121215`    | Focus mode ambient base, deep recesses                      |
| `--bg-input`       | `rgba(0,0,0,0.03)` | `rgba(255,255,255,0.04)` | Pill inputs, time fields, segmented controls         |
| `--bg-input-hover` | `rgba(0,0,0,0.06)` | `rgba(255,255,255,0.07)` | Hover state for the above                            |
| `--bg-tag-soft`    | `rgba(0,0,0,0.04)` | `rgba(255,255,255,0.05)` | Subtle tag/chip backgrounds                          |

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
| `--accent-green-bright`     | `#5DCAA5`   | `#55b598`   | Active timer text, mood-positive tint                   |
| `--accent-green-deep`       | `#0F6E56`   | `#3aa386`   | "Done today" labels, weekly shutdown chip               |
| `--accent-green-glow`       | `rgba(106,158,127,0.22)` | `rgba(111,160,136,0.28)` | Top-of-modal completion gradient (peak)        |
| `--accent-orange`           | `#e0873e`   | `#d68647`   | Priority high tint, weekly planner accents              |
| `--accent-orange-hover`     | `#cc7633`   | `#c47840`   |                                                         |
| `--accent-orange-soft-bg`   | `#FFF8F0`   | `rgba(214,134,71,0.10)` | High-priority task card background                |
| `--accent-orange-soft-bg-hover` | `#FFF4E8` | `rgba(214,134,71,0.14)` |                                              |
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
| `--mood-tint-shutdown`     | `#5DCAA5`              | `#55b598`              | Weekly shutdown mood selector          |
| `--mood-tint-daily`        | `#7B9ED9`              | `#7396cc`              | Daily shutdown mood selector           |

---

## 8. Focus mode (special)

The Focus screen and PiP have their own surfaces because they ride on top of an ambient gradient.

| Token                         | Light                            | Dark                              | Usage                                       |
| ----------------------------- | -------------------------------- | --------------------------------- | ------------------------------------------- |
| `--focus-ambient-from`        | `#f0eeea`                        | `#1a1c22`                         | Top of focus ambient gradient               |
| `--focus-ambient-to`          | `#e8e4dc`                        | `#0f1014`                         | Bottom of focus ambient gradient            |
| `--focus-ring-track`          | `rgba(0,0,0,0.05)`               | `rgba(255,255,255,0.06)`          | Timer ring background stroke                |
| `--focus-ring-progress`       | `#4a9e6e`                        | `#52a981`                         | Timer ring break progress stroke            |
| `--focus-glow-base`           | `#7B9ED9`                        | `#7396cc`                         | Glow layer ring during work                 |
| `--focus-glow-break`          | `#4a9e6e`                        | `#52a981`                         | Glow layer ring during break                |
| `--focus-pip-bg`              | `#f5f4f0`                        | `#1f1f24`                         | PiP window background                       |
| `--focus-pip-border`          | `rgba(0,0,0,0.08)`               | `rgba(255,255,255,0.10)`          | PiP outer border                            |

---

## Tailwind registration

A subset of these tokens are exposed to Tailwind v4 in `src/index.css` via `@theme inline`. Tailwind utility names are deliberately shorter than the underlying var name (e.g. `text-fg` rather than `text-text-primary`) to avoid the awkward `text-text-…` doubling.

```css
@theme inline {
  /* Surfaces */
  --color-base: var(--bg-base);
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
  --color-accent-green-deep: var(--accent-green-deep);

  --color-accent-orange: var(--accent-orange);
  --color-accent-orange-hover: var(--accent-orange-hover);
  --color-accent-orange-soft: var(--accent-orange-soft-bg);
  --color-accent-orange-soft-hover: var(--accent-orange-soft-bg-hover);

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
| Mood tints      | `--mood-tint-shutdown`, `--mood-tint-daily`                                                          | `tintColor="var(--mood-tint-shutdown)"` prop / inline style             |
| Focus mode      | `--focus-ambient-from/to`, `--focus-ring-track`, `--focus-ring-progress`, `--focus-glow-base/break`, `--focus-pip-bg`, `--focus-pip-border` | CSS rules in `index.css` or SVG `stroke="var(--…)"` / `style={{}}`     |
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
| `text-[#0F6E56]`                   | `text-accent-green-deep`           |
| `bg-[#e0873e]` / `text-…`          | `bg-accent-orange` / `text-…`      |
| `bg-[#FFF8F0]`                     | `bg-accent-orange-soft`            |
| `hover:bg-[#FFF4E8]`               | `hover:bg-accent-orange-soft-hover`|
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
