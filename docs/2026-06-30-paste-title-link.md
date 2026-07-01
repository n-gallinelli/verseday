# Paste "Title (URL)" → hyperlinked text

**Date:** 2026-06-30
**Role:** Terse (plan — awaiting Verse review before code)
**Status:** PROPOSED
**Follow-up to:** `2026-06-30-truncate-bare-url-notes.md` (link pills, shipped @ 547197a)

## Goal

Pasting the plain-text shape Notion's **Copy link** produces —
`Sara Suite Roadmap (https://app.notion.com/p/apolloio/Sara-Suite-Roadmap-…?source=copy_link)`
— should auto-format as **hyperlinked text**: the visible label
`Sara Suite Roadmap` links to that URL. Not a bare-URL pill, not literal
`Title (URL)` text.

This is the "hyperlinked text" case from the parent feature: a custom label +
href → a normal `Link` mark, **not** a link pill, and the label is **not**
truncated (only bare URLs get shortened).

## Current behavior

- `linkPill.ts` `handlePaste` intercepts a paste **only** when the whole
  trimmed clipboard text is a lone bare URL (`/^https?:\/\/\S+$/i`) → inserts a
  link pill.
- Tiptap `Link`'s `autolink`/`linkOnPaste` are off. Pasting `Title (URL)` as
  plain text matches nothing → lands as literal text `Sara Suite Roadmap
  (https://…)`.
- (Pasting *rich HTML* that already contains an `<a>` still works — the `Link`
  mark's HTML parsing is untouched. This plan is specifically for the
  **plain-text** `Title (URL)` shape.)

## Plan

Extend the existing paste handler in `src/components/editor/linkPill.ts`
(`addProseMirrorPlugins` → `handlePaste`) with a second branch, checked before
the lone-URL branch:

1. Read `text/plain`, trim.
2. Match `/^(.+?)\s*\((https?:\/\/[^\s)]+)\)$/` — group 1 = label, group 2 =
   URL. (Requires `https?://`; URL token excludes whitespace and `)`.)
3. On match, insert **hyperlinked text**: a text node carrying the schema's
   `link` mark (`schema.marks.link.create({ href: url })`) with the label as
   its text, then a trailing **unlinked** space (`removeStoredMark(link)` so
   continued typing / the space isn't linked). Return `true`.
4. No match → fall through to the existing lone-URL pill branch, then default
   paste.

Nothing else changes — the `Link` mark already renders as `<a>` with the
configured `rel`/`target`, and both existing security gates
(`htmlToSegments` + the editor click handler) already validate `<a>` hrefs as
http(s).

## Security

- URL is `https?://`-only by the regex; a non-http(s) scheme never matches and
  falls through to plain text — no link mark minted, nothing reaches the Tauri
  opener.
- The label is inserted as a ProseMirror **text node** (not HTML) — no markup
  injection from the pasted title.
- Reuses the http(s) contract already reviewed for the `<a>` branch (literal
  regex, not `isSafeUrl`, to stay http(s)-only).

## Decisions / edges (flagged)

- **When both `text/plain` and `text/html` are present:** we act on the
  `text/plain` match. Notion's plain-text `Title (URL)` is the reported broken
  case; a genuine rich-HTML anchor paste would already have worked, and the
  Link-mark result here is the same intent. Simple + predictable. (Alternative:
  defer to HTML when present — more logic, no user-visible win here.)
- **Match is anchored to the whole trimmed clipboard** (`^…$`). Pasting a
  paragraph that merely contains `Title (URL)` is left as plain text. Safer;
  can revisit if wanted.
- **URLs containing a literal `)`** (e.g. `..._(section)`) won't parse cleanly
  (the token stops at `)`). Rare for Notion copy-links (query string, no
  trailing paren); out of scope.

## Cost / risk

Zero deps, zero DB, $0. One added branch in an existing handler; hyperlinked
text is a plain `Link` mark already fully covered by the shipped security gates.
