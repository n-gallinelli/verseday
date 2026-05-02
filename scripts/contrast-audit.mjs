#!/usr/bin/env node
/*
 * scripts/contrast-audit.mjs — WCAG 2.1 contrast audit for the dark-mode
 * token contract.
 *
 * Usage:
 *   node scripts/contrast-audit.mjs > docs/dark-mode-m4-contrast.md
 *   npm run audit:contrast
 *
 * What it does:
 *   - Parses src/index.css to extract the :root block (light) and the
 *     @media (prefers-color-scheme: dark) :root block (dark overrides).
 *   - Resolves var(--…) chains and bakes rgba alphas left-to-right at
 *     arbitrary stack depth (e.g. text-fg-muted on bg-input-hover on
 *     bg-base — three layers, two with alpha).
 *   - Computes WCAG 2.1 relative-luminance contrast ratios for a curated
 *     set of foreground/background pairs against AA thresholds (4.5:1 for
 *     body text, 3:1 for large text and graphical UI).
 *   - Emits a markdown report to stdout.
 *
 * Structural assumptions about src/index.css:
 *   - The first occurrence of `:root {…}` is the light-mode token set.
 *   - The second occurrence of `:root {…}` (nested inside @media
 *     (prefers-color-scheme: dark)) is the dark overrides. Tokens not
 *     overridden in dark fall through to the light value.
 *   - Token values are hex (#rgb / #rrggbb / #rrggbbaa), rgba(...), or
 *     var(--other-token).
 *
 * Out of scope (must be checked manually if changed):
 *   - Inline color-mix() expressions in component code (e.g.
 *     FocusLanding's Start-button glow uses
 *     color-mix(in srgb, var(--accent-blue) 18%, transparent) — this
 *     parser does not look at JSX/TSX).
 *   - Tailwind opacity modifiers in component code that aren't represented
 *     as a defined pair below (e.g. a one-off `bg-accent-X/[0.07]` in a
 *     single component). The PAIRS list below covers the recurring
 *     patterns; one-offs are M4.4 walkthrough territory.
 *
 * When to re-run:
 *   - After any change to a --bg-*, --text-*, --accent-*, --border-*,
 *     --calendar-*, --mood-*, or --focus-* token in either :root or the
 *     dark @media block.
 *   - Before publishing changes to dark-mode-tokens.md that introduce new
 *     token-pair patterns.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cssPath = path.join(__dirname, '..', 'src', 'index.css');
const css = fs.readFileSync(cssPath, 'utf8');

// ── Parse :root blocks ────────────────────────────────────────────────────
const rootMatches = [...css.matchAll(/:root\s*\{([\s\S]*?)\n\s*\}/g)];
if (rootMatches.length < 2) {
  console.error('ERROR: expected two :root blocks (light + dark @media). Found', rootMatches.length);
  process.exit(1);
}

function parseTokens(block) {
  const tokens = {};
  const re = /--([a-zA-Z0-9-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(block)) !== null) {
    tokens[m[1]] = m[2].trim();
  }
  return tokens;
}

const lightTokens = parseTokens(rootMatches[0][1]);
const darkOverrides = parseTokens(rootMatches[1][1]);
const darkTokens = { ...lightTokens, ...darkOverrides };

// ── Color resolution ──────────────────────────────────────────────────────
function resolveColor(value, tokens, depth = 0) {
  if (depth > 16) throw new Error(`var() resolution loop on ${value}`);
  value = value.trim();

  const varMatch = value.match(/^var\(\s*--([a-zA-Z0-9-]+)\s*(?:,\s*(.+?))?\s*\)$/);
  if (varMatch) {
    const name = varMatch[1];
    if (tokens[name] !== undefined) return resolveColor(tokens[name], tokens, depth + 1);
    if (varMatch[2]) return resolveColor(varMatch[2], tokens, depth + 1);
    throw new Error(`Unknown token --${name}`);
  }

  if (value.startsWith('#')) {
    const hex = value.slice(1);
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16),
        a: 1,
      };
    }
    if (hex.length === 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: 1,
      };
    }
    if (hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: parseInt(hex.slice(6, 8), 16) / 255,
      };
    }
    throw new Error(`Bad hex: ${value}`);
  }

  const rgbMatch = value.match(/^rgba?\s*\(\s*([^)]+)\s*\)$/);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(',').map(s => s.trim());
    return {
      r: parseInt(parts[0], 10),
      g: parseInt(parts[1], 10),
      b: parseInt(parts[2], 10),
      a: parts[3] !== undefined ? parseFloat(parts[3]) : 1,
    };
  }

  throw new Error(`Cannot parse color: ${value}`);
}

// "over" alpha composite. Returns opaque color. Bottom must be opaque.
function bake(fg, bg) {
  const a = fg.a;
  return {
    r: Math.round(a * fg.r + (1 - a) * bg.r),
    g: Math.round(a * fg.g + (1 - a) * bg.g),
    b: Math.round(a * fg.b + (1 - a) * bg.b),
    a: 1,
  };
}

function bakeStack(layers) {
  if (layers.length === 0) throw new Error('bakeStack: empty stack');
  let result = layers[0];
  if (result.a !== 1) {
    throw new Error(`bakeStack: bottom layer must be opaque (a=${result.a})`);
  }
  for (let i = 1; i < layers.length; i++) {
    result = bake(layers[i], result);
  }
  return result;
}

// WCAG 2.1 relative luminance + contrast ratio
function luminance({ r, g, b }) {
  const lin = c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(c1, c2) {
  const l1 = luminance(c1);
  const l2 = luminance(c2);
  const [light, dark] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (light + 0.05) / (dark + 0.05);
}

// ── Pair specification ────────────────────────────────────────────────────
// A pair is a stack of layers, bottom-up. The topmost layer is the fg.
// Each layer is one of:
//   - string: token name (resolved with alpha=1 from token's intrinsic alpha)
//   - { token, alpha }: token name with explicit alpha override (Tailwind /[0.06] etc.)
//   - { hex: '#xxx', alpha? }: literal hex
const tok = (token, alpha) => alpha != null ? { token, alpha } : { token };
const lit = (hex, alpha) => alpha != null ? { hex, alpha } : { hex };

function resolveLayer(layer, tokens) {
  let color;
  if (typeof layer === 'string') {
    color = resolveColor(`var(--${layer})`, tokens);
  } else if (layer.token) {
    color = resolveColor(`var(--${layer.token})`, tokens);
  } else if (layer.hex) {
    color = resolveColor(layer.hex, tokens);
  } else {
    throw new Error(`Bad layer: ${JSON.stringify(layer)}`);
  }
  if (layer.alpha !== undefined && layer.alpha !== null) {
    color = { ...color, a: layer.alpha };
  }
  return color;
}

function pairContrast(stack, tokens) {
  const resolved = stack.map(l => resolveLayer(l, tokens));
  const bg = bakeStack(resolved.slice(0, -1));
  const fgComposited = bake(resolved[resolved.length - 1], bg);
  return { ratio: contrast(fgComposited, bg), fg: fgComposited, bg };
}

// ── Spot-test 3-layer alpha resolution ────────────────────────────────────
// text-faded on bg-input-hover on bg-base — three layers, two with alpha.
// This is the deliberate multi-layer test Verse asked for.
{
  const stack = ['bg-base', 'bg-input-hover', 'text-faded'];
  const { ratio: rL } = pairContrast(stack, lightTokens);
  const { ratio: rD } = pairContrast(stack, darkTokens);
  // Sanity: should produce sensible (likely failing) contrast values, not throw.
  // Light: text-faded #000@0.25 on bg-input-hover #000@0.03 on #f5f4f0
  // Dark:  text-faded fff@0.35 on bg-input-hover fff@0.07 on #16161a
  if (!Number.isFinite(rL) || !Number.isFinite(rD)) {
    console.error('ERROR: spot-test produced non-finite ratio', { rL, rD });
    process.exit(1);
  }
}

// ── Pair definitions ──────────────────────────────────────────────────────
// Each group defines { id, title, threshold, blurb, pairs[] }
// Each pair is { name, stack: [bottom...top] }

const surfaces = [
  ['bg-base',          'bg-base'],
  ['bg-elevated',      'bg-elevated'],
  ['bg-sidebar',       'bg-sidebar'],
  ['bg-rail',          'bg-rail'],
  ['bg-sunken',        'bg-sunken'],
];
const shutdownSurfaces = [
  ['shutdown-bg-cool',    'shutdown-bg-cool'],
  ['shutdown-bg-neutral', 'shutdown-bg-neutral'],
  ['shutdown-bg-warm',    'shutdown-bg-warm'],
];

function bodyTextPairs() {
  const out = [];
  const fgTokens = ['text-primary', 'text-secondary', 'text-muted', 'text-faded'];
  for (const fg of fgTokens) {
    for (const [label, surf] of [...surfaces, ...shutdownSurfaces]) {
      out.push({ name: `${fg} on ${label}`, stack: [surf, fg] });
    }
  }
  // bg-input-hover (rgba) baked over bg-base / bg-elevated — input field bg
  for (const fg of fgTokens) {
    out.push({ name: `${fg} on bg-input-hover ▸ bg-base`, stack: ['bg-base', 'bg-input-hover', fg] });
    out.push({ name: `${fg} on bg-input-hover ▸ bg-elevated`, stack: ['bg-elevated', 'bg-input-hover', fg] });
  }
  // bg-tag-soft (rgba) baked over bg-base / bg-elevated — tag pill bg
  for (const fg of ['text-secondary', 'text-muted']) {
    out.push({ name: `${fg} on bg-tag-soft ▸ bg-base`, stack: ['bg-base', 'bg-tag-soft', fg] });
    out.push({ name: `${fg} on bg-tag-soft ▸ bg-elevated`, stack: ['bg-elevated', 'bg-tag-soft', fg] });
  }
  return out;
}

function solidButtonPairs() {
  const accents = [
    'accent-blue', 'accent-blue-hover',
    'accent-green', 'accent-green-hover', 'accent-green-bright', 'accent-green-bright-hover',
    'accent-orange', 'accent-orange-hover',
    'accent-warning',
    'accent-danger',
    'accent-destructive', 'accent-destructive-hover',
  ];
  return accents.map(a => ({ name: `text-on-accent on ${a}`, stack: [a, 'text-on-accent'] }));
}

function accentTextOnSurfacePairs() {
  // Mood tokens (--mood-bad, --mood-okay) intentionally excluded — they're
  // used as bg fills (MoodSelector pill bodies), not as text. Documented in
  // dark-mode-m4-contrast-disposition.md bucket b4.
  const accents = [
    'accent-blue-soft-text', 'accent-blue',
    'accent-orange-soft-text', 'accent-orange',
    'accent-warning-soft-text', 'accent-warning',
    'accent-danger', 'accent-destructive',
    'accent-green-deep', 'accent-green-bright',
  ];
  const surfs = [['bg-base', 'bg-base'], ['bg-elevated', 'bg-elevated'], ['bg-sidebar', 'bg-sidebar']];
  const out = [];
  for (const fg of accents) {
    for (const [label, surf] of surfs) {
      out.push({ name: `${fg} on ${label}`, stack: [surf, fg] });
    }
  }
  return out;
}

function accentTextOnTintPairs() {
  // Mirrors the in-codebase patterns surfaced by grep:
  //   TaskCard ProjectDetail: text-accent-blue on bg-accent-blue/[0.06] (border /20)
  //   DurationPicker active: text-accent-blue-soft-fg on bg-accent-blue-soft (intrinsic alpha)
  //   WeeklyPlanner Today: text-accent-orange on bg-accent-orange/[0.08]
  //   WeeklyPlanner over-est: text-accent-orange on bg-accent-orange/[0.08] (same)
  //   DailyPlanner over-est: text-accent-danger on bg-accent-danger/10 (= /[0.10])
  //   ProjectDetail trash hover: text-accent-destructive on bg-accent-destructive/[0.08]
  // Parent surface = bg-base for the standard case; bg-elevated for the in-modal case.
  const out = [];
  const tints = [
    { fg: 'accent-blue',         bgTok: 'accent-blue',        a: 0.06, label: 'accent-blue/[0.06]' },
    { fg: 'accent-blue',         bgTok: 'accent-blue',        a: 0.12, label: 'accent-blue/[0.12]  (hover)' },
    { fg: 'accent-blue-soft-text', bgTokFull: 'accent-blue-soft-bg',     label: 'accent-blue-soft-bg' },
    { fg: 'accent-orange',       bgTok: 'accent-orange',      a: 0.08, label: 'accent-orange/[0.08]' },
    { fg: 'accent-orange',       bgTok: 'accent-orange',      a: 0.02, label: 'accent-orange/[0.02]  (today col)' },
    { fg: 'accent-orange',       bgTokFull: 'accent-orange-soft-bg',    label: 'accent-orange-soft-bg' },
    { fg: 'accent-danger',       bgTok: 'accent-danger',      a: 0.10, label: 'accent-danger/10' },
    { fg: 'accent-destructive',  bgTok: 'accent-destructive', a: 0.08, label: 'accent-destructive/[0.08]' },
    { fg: 'accent-green-deep',   bgTokFull: 'accent-green-soft-bg',     label: 'accent-green-soft-bg' },
  ];
  for (const t of tints) {
    for (const [parentLabel, parent] of [['bg-base', 'bg-base'], ['bg-elevated', 'bg-elevated']]) {
      const tintLayer = t.bgTokFull
        ? t.bgTokFull
        : tok(t.bgTok, t.a);
      out.push({
        name: `${t.fg} on ${t.label} ▸ ${parentLabel}`,
        stack: [parent, tintLayer, t.fg],
      });
    }
  }
  return out;
}

function bannerPairs() {
  return [{ name: 'text-banner on bg-banner', stack: ['bg-banner', 'text-banner'] }];
}

function calendarPairs() {
  return [
    // selected: text-on-accent on calendar-selected-bg
    { name: 'text-on-accent on calendar-selected-bg', stack: ['calendar-selected-bg', 'text-on-accent'] },
    // today: calendar-today-ring as text on bg-elevated (DatePicker popover surface)
    { name: 'calendar-today-ring on bg-elevated', stack: ['bg-elevated', 'calendar-today-ring'] },
    // calendar-day-hover (rgba in dark) on bg-elevated, with text-fg on top
    { name: 'text-primary on calendar-day-hover ▸ bg-elevated', stack: ['bg-elevated', 'calendar-day-hover', 'text-primary'] },
  ];
}

function borderPairs() {
  // 3:1 — graphical/UI threshold
  const out = [];
  for (const border of ['border-medium', 'border-strong']) {
    for (const [label, surf] of surfaces) {
      out.push({ name: `${border} on ${label}`, stack: [surf, border] });
    }
  }
  return out;
}

function graphicalUiPairs() {
  // 3:1 — graphical UI elements where the user perceives a shape/edge.
  return [
    // PiP progress-bar inner (accent-blue solid) vs track (overlay-hover) baked over bg-base
    { name: 'PiP inner bar (accent-blue) vs track (overlay-hover ▸ bg-base)',
      stack: ['bg-base', 'overlay-hover', 'accent-blue'] },
    // Same on bg-elevated parent (PiP window may sit on elevated surface)
    { name: 'PiP inner bar (accent-blue) vs track (overlay-hover ▸ bg-elevated)',
      stack: ['bg-elevated', 'overlay-hover', 'accent-blue'] },
    // Focus-ring: solid --accent-blue (M4.3.4 settled on solid over alpha-tinted
    // for clearer keyboard-nav affordance; even /80 alpha barely cleared 3:1).
    { name: 'accent-blue (focus-ring) on bg-base',
      stack: ['bg-base', 'accent-blue'] },
    { name: 'accent-blue (focus-ring) on bg-elevated',
      stack: ['bg-elevated', 'accent-blue'] },
    // Border at 20% / 30% (used as accent ghost outlines on tinted pills)
    { name: 'accent-blue/20 outline on bg-base',
      stack: ['bg-base', tok('accent-blue', 0.20)] },
    { name: 'accent-blue/30 outline on bg-base',
      stack: ['bg-base', tok('accent-blue', 0.30)] },
  ];
}

const GROUPS = [
  {
    id: 'body-text',
    title: '1. Body text on surface',
    threshold: 4.5,
    blurb: 'Primary text content. AA threshold 4.5:1.',
    pairs: bodyTextPairs(),
  },
  {
    id: 'solid-buttons',
    title: '2. Solid-fill button text (text-on-accent on accent bg)',
    threshold: 4.5,
    blurb: 'Filled buttons (Start, Delete, etc.). AA threshold 4.5:1. Verse-flagged risk: dark-mode --text-on-accent #0f0f12 on mid-luminance accents (--accent-orange-hover, --accent-warning).',
    pairs: solidButtonPairs(),
  },
  {
    id: 'accent-text-on-surface',
    title: '3. Accent-as-text on surface',
    threshold: 4.5,
    blurb: 'Accent colors used inline as text on plain surfaces (status messages, links, mood indicators). AA threshold 4.5:1.',
    pairs: accentTextOnSurfacePairs(),
  },
  {
    id: 'accent-text-on-tint',
    title: '4. Accent-text on accent-tint background',
    threshold: 4.5,
    blurb: 'The third-tier bake: accent text on tinted bg of the same accent over a parent surface. Highest-risk failure surface per Verse. AA threshold 4.5:1.',
    pairs: accentTextOnTintPairs(),
  },
  {
    id: 'banner',
    title: '5. Banner',
    threshold: 4.5,
    blurb: 'Inverted-contrast undo/notice bar. AA threshold 4.5:1.',
    pairs: bannerPairs(),
  },
  {
    id: 'calendar',
    title: '6. Calendar tile numerals',
    threshold: 4.5,
    blurb: 'Day-number text on selected/today tiles. AA threshold 4.5:1.',
    pairs: calendarPairs(),
  },
  {
    id: 'borders',
    title: '7. Borders / graphical edges',
    threshold: 3.0,
    blurb: 'Visible edges of cards, modals, dividers. AA graphical/UI threshold 3:1.',
    pairs: borderPairs(),
  },
  {
    id: 'graphical-ui',
    title: '8. Graphical UI shapes',
    threshold: 3.0,
    blurb: 'Non-text shapes the user must perceive: progress-bar fills, focus rings, accent outlines on tinted pills. AA graphical/UI threshold 3:1.',
    pairs: graphicalUiPairs(),
  },
];

// ── Render ────────────────────────────────────────────────────────────────
function fmt(n) { return n.toFixed(1); }
function cell(ratio, threshold) {
  return `${fmt(ratio)}:1 ${ratio >= threshold ? '✅' : '❌'}`;
}

const out = [];
out.push('# Dark Mode — M4.3 Contrast Audit');
out.push('');
out.push('Generated by `scripts/contrast-audit.mjs` against `src/index.css`. Re-run with `npm run audit:contrast` after any token change.');
out.push('');
out.push('## Methodology');
out.push('');
out.push('- WCAG 2.1 relative-luminance contrast ratio formula.');
out.push('- Translucent layers (rgba and Tailwind alpha modifiers) baked over their parent surface(s) left-to-right at arbitrary depth using standard "over" alpha composite. Spot-tested with a 3-layer case (`text-faded` ▸ `bg-input-hover` ▸ `bg-base`) before publishing.');
out.push('- AA thresholds: **4.5:1** for body text, **3:1** for large text and graphical/UI elements (borders, focus rings, progress fills).');
out.push('- The script parses **only `src/index.css`**. Inline `color-mix()` expressions in component code (e.g. FocusLanding\'s Start-button glow `color-mix(in srgb, var(--accent-blue) 18%, transparent)`) are out of parser scope; if you tweak those expressions, re-check the affected pair manually.');
out.push('');
out.push('### Disposition rubric (applied in the failures section below)');
out.push('');
out.push('- **(a) Genuine fix** — body-text fg/bg pair fails AA, used in primary content rendering, no decorative or disabled-state semantic justifying the low contrast. Schedule a fix slice.');
out.push('- **(b) Intentional-by-design** — fg has explicit decorative / disabled / illustration semantic (e.g. `--text-faded` on empty-state hint copy is "ghost hint," not primary information). Document the exemption in `dark-mode-tokens.md` with rationale; cite WCAG\'s decorative-element carveout where applicable.');
out.push('- **(c) Non-blocking edge case** — pair is theoretically derivable from the contract but no actual callsite in `src/` uses it. Note for future and move on.');
out.push('- **Architectural finding** — failure fits none of the above buckets. Flag and stop; do not shoehorn.');
out.push('');
out.push('### Carveouts (not measured)');
out.push('');
out.push('- `--text-disabled` — intentionally below contrast (disabled-state semantic).');
out.push('- Brand-mark exception files (Sidebar/QuickAdd VerseDayLogo, SunsetOverlay) — already documented as theme-stable.');
out.push('- `--chart-bar-neutral` — used as fill only, no text overlay.');
out.push('- `--focus-ambient-*` ambient bg colors — the focus-mode timer view has no body text on those bgs.');
out.push('');

for (const mode of ['light', 'dark']) {
  const tokens = mode === 'light' ? lightTokens : darkTokens;
  out.push(`## ${mode === 'light' ? 'Light mode' : 'Dark mode'}`);
  out.push('');
  for (const group of GROUPS) {
    out.push(`### ${group.title}`);
    out.push('');
    out.push(group.blurb);
    out.push('');
    out.push('| Pair | Contrast | WCAG threshold |');
    out.push('|---|---|---|');
    for (const p of group.pairs) {
      let ratio;
      try {
        ratio = pairContrast(p.stack, tokens).ratio;
      } catch (e) {
        out.push(`| \`${p.name}\` | ERROR: ${e.message} | ${fmt(group.threshold)}:1 |`);
        continue;
      }
      out.push(`| \`${p.name}\` | ${cell(ratio, group.threshold)} | ${fmt(group.threshold)}:1 |`);
    }
    out.push('');
  }
}

// ── Failures aggregation ──────────────────────────────────────────────────
out.push('## Failures (raw)');
out.push('');
out.push('All pairs that fall below the WCAG AA threshold in either mode. Disposition (which bucket per the methodology rubric, which fix slice) lives in **`docs/dark-mode-m4-contrast-disposition.md`** — hand-maintained, not regenerated.');
out.push('');
out.push('| Mode | Group | Pair | Ratio | Threshold |');
out.push('|---|---|---|---|---|');

const failures = [];
for (const mode of ['light', 'dark']) {
  const tokens = mode === 'light' ? lightTokens : darkTokens;
  for (const group of GROUPS) {
    for (const p of group.pairs) {
      try {
        const { ratio } = pairContrast(p.stack, tokens);
        if (ratio < group.threshold) {
          failures.push({ mode, group: group.title.replace(/^\d+\.\s*/, ''), name: p.name, ratio, threshold: group.threshold });
        }
      } catch {}
    }
  }
}

if (failures.length === 0) {
  out.push('| — | — | _(no failures)_ | — | — |');
} else {
  for (const f of failures) {
    out.push(`| ${f.mode} | ${f.group} | \`${f.name}\` | ${fmt(f.ratio)}:1 | ${fmt(f.threshold)}:1 |`);
  }
}
out.push('');
out.push(`_Total failures: ${failures.length} across ${new Set(failures.map(f => f.mode)).size} mode(s)._`);
out.push('');

console.log(out.join('\n'));
