# Dark Mode — M4.1 Audit Findings

Research-only output for milestone M4 (full audit pass). Scope: enumerate every `*.tsx` under `src/`, run a comprehensive grep for chrome residuals, and verify the native `<select>` caret behavior. Drives M4.2 fix scope.

Generated against `feat/dark-mode` at commit `fe6451e` (M3 audit-completion recovery).

---

## Part 1 — Grep residuals

Pattern run:
```
grep -rnE '#[0-9a-fA-F]{3,8}|rgb\(|rgba\(|black/\[|text-black/|bg-black/|border-black/|text-white|bg-white|var\(--color-(danger|primary|surface|text-muted|primary-light|bg|text|border|surface-hover|warning|success)' src/
```

Total matches: **203**, of which **3 are real residuals**. Everything else is theme-definition or pre-approved exception.

### ✅ OK — theme definition file (140 hits)
`src/index.css` lines 1–235. These are the canonical color sources defining the token contract — light mode at `:root` (lines 14–113), dark overrides at `@media (prefers-color-scheme: dark)` (lines 142–235), plus the legacy alias block (lines 109–122).

Notable orphan inside this block: `--color-primary-light` (was at lines 113, 235) hardcoded `#9bb5e3` / `#8aa6cc` and was consumed nowhere in component code. Pre-M1 dead. **Deleted in M4.2.**

Also present: `src/index.css:371` `.tiptap a { color: var(--color-primary); }` — consumed the legacy alias in a real CSS rule. The alias chained correctly to `--accent-blue` so it themed, but the style was inconsistent with component-code conventions. **Migrated to `var(--accent-blue)` in M4.2.**

### ➖ OK — pre-approved exceptions (~50 hits)
Cross-referenced against the **Intentional exceptions** table in `dark-mode-tokens.md`:

| File | Lines | Reason |
|---|---|---|
| `src/components/Sidebar.tsx` | 165–230 | `VerseDayLogo` SVG brand mark |
| `src/pages/QuickAdd.tsx` | 156–188 | Inline duplicate of `VerseDayLogo` |
| `src/components/SunsetOverlay.tsx` | 70–106 | Sunset gradient + white text on celebration overlay |
| `src/db/queries.ts` | 4–30 | `PRESET_COLORS` user-domain project palette |

All accounted for. No drift between the table and the grep output.

### 🟡 NEEDS WORK (3 residuals across 2 files)

**`src/components/FocusPip.tsx:89`** — outer progress-bar container
```tsx
<div className="h-[3px] w-full bg-black/[0.04]">
```
Should be `bg-overlay-hover` per the migration table. M3.6 swept this file but missed these two utility classes.

**`src/components/FocusPip.tsx:104`** — pulsing fallback bar (no-estimate state)
```tsx
<div className="h-[3px] w-full bg-black/[0.04] overflow-hidden">
```
Same fix — `bg-overlay-hover`.

**Impact**: PiP window's progress-bar track reads as a faint light wash on the dark PiP surface. Visible glitch but not catastrophic since the inner progress fill (line 92–97) correctly uses `var(--accent-blue)`.

**`src/pages/PlaceholderPage.tsx:6`** — placeholder page subtext
```tsx
<p className="text-[var(--color-text-muted)]">Coming in a future milestone</p>
```
Consumes the legacy `--color-text-muted` alias. Themes correctly via the alias chain, but inconsistent with the component-code convention of using short Tailwind utilities. Should be `text-fg-muted`.

**Impact**: None at runtime. Style-guide consistency only.

### ❓ AMBIGUOUS
None.

---

## Part 2 — Per-file `*.tsx` enumeration

| File | Status | Notes |
|---|---|---|
| `src/App.tsx` | ✅ swept | M2.1 |
| `src/main.tsx` | ✅ swept | Entry point — no chrome |
| `src/components/Button.tsx` | ✅ swept | M2.2 |
| `src/components/CalendarPicker.tsx` | ✅ swept | M2.2 |
| `src/components/DatePicker.tsx` | ✅ swept | M3 recovery (fe6451e) |
| `src/components/DurationPicker.tsx` | ✅ swept | M3 recovery (fe6451e) |
| `src/components/ErrorBanner.tsx` | ✅ swept | M3 recovery (fe6451e) |
| `src/components/ErrorBoundary.tsx` | ✅ swept | M3 recovery (fe6451e) |
| `src/components/FocusPip.tsx` | 🟡 | M3.6 sweep missed `bg-black/[0.04]` × 2 (lines 89, 104) |
| `src/components/MoodSelector.tsx` | ✅ swept | M3.2 |
| `src/components/NewProjectPanel.tsx` | ✅ swept | M3 recovery (fe6451e) |
| `src/components/ProjectPicker.tsx` | ✅ swept | M2.2 |
| `src/components/RichTextEditor.tsx` | ✅ swept | M3 recovery (fe6451e) |
| `src/components/Sidebar.tsx` | ➖ exception | VerseDayLogo + rest swept M2.1 |
| `src/components/SimpleSelect.tsx` | ✅ swept | M2.2 |
| `src/components/SummaryOverlay.tsx` | ✅ swept | M2.2 |
| `src/components/SunsetOverlay.tsx` | ➖ exception | Sunset gradient + white text |
| `src/components/TaskCard.tsx` | ✅ swept | M2.3b |
| `src/components/TaskDetailOverlay.tsx` | ✅ swept | M2.2 |
| `src/components/WrapUpReminder.tsx` | ✅ swept | M3 recovery (fe6451e) |
| `src/pages/DailyPlanner.tsx` | ✅ swept | M2.3a/b — native `<select>` line 657, see Part 3 |
| `src/pages/DailyShutdown.tsx` | ✅ swept | M3.2 |
| `src/pages/Dashboard.tsx` | ✅ swept | M3.5 |
| `src/pages/FocusLanding.tsx` | ✅ swept | M3 recovery (fe6451e) |
| `src/pages/FocusMode.tsx` | ✅ swept | M2.5 |
| `src/pages/PlaceholderPage.tsx` | 🟡 | 1 × legacy `var(--color-text-muted)` (line 6) |
| `src/pages/ProjectDetail.tsx` | ✅ swept | M3.4 — native `<select>` line 247, see Part 3 |
| `src/pages/Projects.tsx` | ✅ swept | M3.3 |
| `src/pages/QuickAdd.tsx` | ➖ exception | VerseDayLogo + rest swept M3.6 |
| `src/pages/Settings.tsx` | ✅ swept | M3.1 |
| `src/pages/WeeklyPlanner.tsx` | ✅ swept | M2.4 — native `<select>` line 410, see Part 3 |
| `src/pages/WeeklyShutdown.tsx` | ✅ swept | M3.2 |

**Counts**: 32 `*.tsx` files. 27 ✅ swept, 3 ➖ exception, 2 🟡 needs work.

---

## Part 3 — Native `<select>` caret check

### CSS rule (src/index.css:321–329)
```css
select {
  -webkit-appearance: none;
  -moz-appearance: none;
  appearance: none;
  background-image: url("data:image/svg+xml,...stroke='%23999'...");
  background-repeat: no-repeat;
  background-position: right 8px center;
  padding-right: 22px;
}
```

### Status: ❌ broken on dark mode

`-webkit-appearance: none` forces the custom SVG caret to be the only chevron drawn — macOS WKWebView does **not** fall back to native chrome. The `color-scheme: light dark` on `:root` only affects elements that have NOT had appearance suppressed.

The hardcoded `stroke='%23999'` is medium gray. On dark form backgrounds (`rgba(255,255,255,0.07)` to `#1f1f24`) it reads as poorly-contrasted noise rather than a clear chevron.

### Callsites (3)

1. **`src/pages/ProjectDetail.tsx:247`** — task estimate dropdown on `bg-input-hover`
2. **`src/pages/DailyPlanner.tsx:657`** — inline-edit project selector on transparent bg
3. **`src/pages/WeeklyPlanner.tsx:410`** — quick-add project selector on transparent bg

All three render the same too-faint chevron on dark mode.

### Fix options for M4.2

- **A**: Replace the inline data-URI with two SVGs — one default, one dark — via `@media (prefers-color-scheme: dark)` override on the `select` rule. Cleanest for our token model.
- **B**: Drop `-webkit-appearance: none` and let the OS draw native chrome. Loses the consistent right-padded chevron but auto-themes. Cosmetic regression on light mode.
- **C**: Use a CSS mask + currentColor approach. More complex, but the chevron color follows the consuming element's `color`.

Recommend A — predictable, no regression, parallels how we handled scrollbar tokens.

---

## Part 4 — Git context

Branch `feat/dark-mode`, 17 commits ahead of `main`:

```
fe6451e  M3 audit-completion (recovery): close gaps in M3 sweep
f081141  dark mode M3.6: FocusPip + QuickAdd (Tauri webviews)
8faa694  dark mode M3.5: Dashboard + --chart-bar-neutral + delete dead ProjectCard
755ff21  dark mode M3.4: ProjectDetail + --accent-destructive register
116246f  dark mode M3.3: Projects list
96b5de2  dark mode M3.2: Daily + Weekly Shutdown + 6 new tokens
1234474  dark mode M3.1: Settings
d118d0c  dark mode fix: replace inverted-contrast banner with --bg-banner token pair
f973691  dark mode fix: undo banner text invisible in dark mode (Tailwind collision)
4c8f398  dark mode docs: M2 close-out fixes from Verse review
c1dbb48  dark mode M2.5: Focus Mode + tokenize keyframe + delete palette-preview
b4764a9  dark mode M2.4: Weekly Plan + --accent-green-soft-bg token
9c4ed69  dark mode M2.3b: Daily Plan main column + TaskCard
5f72044  dark mode M2.3a: Daily Plan right rail + --accent-warning token
d73e4e5  dark mode M2.2: modal stack + shared Button + modal-bg rule
9cc21f5  dark mode M2.1: sidebar + main shell
af012fd  dark mode M1: theme tokens + token contract docs
```
