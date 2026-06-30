# Truncate bare pasted URLs in notes

**Date:** 2026-06-30
**Role:** Terse (plan — awaiting Verse review before any code)
**Status:** PROPOSED

## Goal

When a **bare URL is pasted/typed** into a note, display it shortened —
the full domain plus a few characters of the slug, ending in an ellipsis —
while the link still points at the *exact* original URL.

Example:
`https://apolloio.slack.com/archives/D090E9YJN0N/p1782857204949699`
→ shows as `apolloio.slack.com/archi…` (clickable → full URL).

**Do NOT shorten hyperlinked text.** If the user wrote `[Slack thread](url)`
(or pasted a rich link whose text isn't the URL), the custom label is shown
verbatim. Only bare URLs (display text == href) get truncated.

Confirmed scope: shorten **everywhere** — both in the editor while writing
*and* in the collapsed task-card / calendar previews.

## Current behavior (where it stands today)

- **Editor** (`src/components/RichTextEditor.tsx`, Tiptap): `Link.configure`
  with `autolink` + `linkOnPaste` wraps a bare URL in `<a href=X>X</a>` whose
  visible text is the **full URL**. This is the long string the user sees.
- **Preview** (`src/utils/linkify.ts` → `CalendarMetaRail.tsx`):
  `htmlToSegments` already shortens bare `<a>` (`label === url && len > 40`)
  via `shortenUrl()` → `host/firstPathSeg/...`. So previews are *partly* done,
  but the format differs from what's wanted and the editor isn't covered.

## Shared decision: the short-label format

One exported helper, reused by both editor and preview so they always match:

```ts
// linkify.ts — replaces the existing shortenUrl()
export function shortLinkLabel(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const slug = u.pathname + u.search + u.hash; // includes leading "/"
    if (slug === "" || slug === "/") return host;          // domain-only
    const SLUG_CHARS = 6;                                   // "a few"
    if (slug.length <= SLUG_CHARS + 1) return host + slug;  // already short
    return host + slug.slice(0, SLUG_CHARS) + "…";
  } catch {
    return url;
  }
}
```

- Keeps the **full host** so the destination is recognizable and the existing
  per-brand link icons (Slack/Notion/Figma/Asana) still match on host.
- `SLUG_CHARS = 6` and the `…` glyph are the two tunable knobs — flagged for
  Verse. (Nick wrote `...`; the app already uses the single `…` char in
  `htmlToSegments`, so I default to `…` for consistency — easy to switch.)

## Plan

### 1. `src/utils/linkify.ts`
- Replace `shortenUrl` with `shortLinkLabel` (exported) using the format above.
- In `htmlToSegments`, recognize the new editor pill: a
  `span[data-link-pill]` element → emit `{ type: "link", label: textContent,
  url: data-href }` (label is already short; no re-shortening).
- Keep the legacy bare-`<a>` shortening path (old notes saved before this
  change still shorten in previews), now calling `shortLinkLabel` — lower the
  `len > 40` guard since the new format is compact.

### 2. New atomic node `src/components/editor/linkPill.ts`
Mirror the existing `timePill.ts` pattern (Nick already trusts this shape):
- Inline `atom` node, `name: "linkPill"`.
- Attributes: `href` (full URL, the source of truth) and `label` (frozen short
  display string), both via `data-href` / `data-label`.
- `renderHTML` → `["span", {"data-link-pill": "", class: "note-link-pill",
  "data-href": href, ...}, label]` — label emitted as a **text child**, never
  innerHTML (same XSS-safe approach as timePill; satisfies the
  `htmlToSegments`/untrusted-HTML discipline).
- `parseHTML` → `span[data-link-pill]`.
- `renderText` → the full `href` (so copying a pill as plain text yields the
  real URL, not the truncated label).
- Creation of pills from **bare URLs only**:
  - `addInputRule`: URL + space/enter → replace with a pill (label =
    `shortLinkLabel(url)`).
  - `addPasteRules` / `handlePaste`: pasted text that is a single bare URL →
    pill.
  - Only `https?://` URLs are accepted (same guard as everywhere else).

### 3. `src/components/RichTextEditor.tsx`
- Register `LinkPill` in `extensions`.
- Turn **off** `autolink` and `linkOnPaste` on the `Link` extension so bare
  URLs are owned solely by `LinkPill` (no double-wrapping). The `Link` mark
  stays for hyperlinked text: `convertMarkdownLinks` (`[text](url)`) and
  pasted rich-HTML anchors keep their custom labels — **untouched**, per the
  requirement.
- Extend the click-to-open handler: match `closest("a, [data-link-pill]")` and
  open `href || data-href` via the Tauri opener (full URL).

### 4. `src/index.css`
- Add `.note-link-pill` to the existing `.tiptap a` rule group (color,
  underline, chain `::before` icon).
- Add `.note-link-pill[data-href*="slack.com"]` (etc.) to each existing brand
  `::before` selector list — share the SVG blocks, don't duplicate them.

### Out of scope (note, not doing now)
- **Legacy editor notes**: URLs pasted *before* this change stay as full-text
  `<a>` in the editor (previews still shorten them via the legacy path). A
  one-time load-time conversion is possible later but is non-destructive to
  skip — the href is already correct.
- **Pasted rich-HTML anchor whose text == href** becomes a `Link` mark showing
  the full URL (rare; comes from copying a bare-URL hyperlink off a webpage).
  Can be folded into the paste handler later if it bites.
- `SLUG_CHARS` count / `…` vs `...` — trivial to change post-review.

## Risk / cost
- Zero new dependencies, zero DB/migration, zero cost to run. ✅ (budget zero)
- Pure presentational + editor-node change; full URL is always preserved in
  `href`/`data-href`, so links remain exact and nothing is lost on round-trip.
- New surface = one small node file + small edits to 3 existing files.
```
