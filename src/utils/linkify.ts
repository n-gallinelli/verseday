// Markdown link regex — [text](url)
const MD_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

/** Shorten a URL for display: domain + first path segment */
function shortenUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const pathParts = u.pathname.split("/").filter(Boolean);
    if (pathParts.length === 0) return host;
    if (pathParts.length === 1) return `${host}/${pathParts[0]}`;
    return `${host}/${pathParts[0]}/...`;
  } catch {
    return url;
  }
}

/** Parse notes text into segments of plain text and links for rendering */
export type NoteSegment =
  | { type: "text"; content: string }
  | { type: "link"; label: string; url: string };

export function parseNotes(text: string): NoteSegment[] {
  const segments: NoteSegment[] = [];
  let lastIndex = 0;

  // Reset regex state
  MD_LINK_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = MD_LINK_RE.exec(text)) !== null) {
    // Add text before this match
    if (match.index > lastIndex) {
      segments.push({ type: "text", content: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: "link", label: match[1], url: match[2] });
    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    segments.push({ type: "text", content: text.slice(lastIndex) });
  }

  return segments;
}

// ── HTML notes parsing ──────────────────────────────────────────────────
// Notes saved by the RichTextEditor are HTML (Tiptap output). The collapsed
// preview pill in TaskCard needs to render these as the same NoteSegment[]
// shape used for plain text / markdown notes. We walk the DOM and emit text
// + link segments without ever touching innerHTML, so there's no XSS surface.

const BLOCK_TAGS = new Set(["P", "DIV", "LI", "BR", "H1", "H2", "H3", "H4", "H5", "H6"]);
const PREVIEW_MAX_CHARS = 200;

export interface HtmlToSegmentsOptions {
  /** Cap on total characters emitted. Defaults to the 200-char preview-pill
   *  budget; pass Infinity to render a full description with no truncation. */
  maxChars?: number;
  /** Prefix list items with markers ("• " for <ul>, "1. " for <ol>) so the
   *  structure is readable as plain text. Off by default (the preview pill
   *  doesn't want bullets); enabled for full descriptions. */
  listMarkers?: boolean;
}

/** Parse HTML notes into rendered segments. Inserts \n between block siblings. */
export function htmlToSegments(html: string, opts: HtmlToSegmentsOptions = {}): NoteSegment[] {
  if (!html) return [];
  const maxChars = opts.maxChars ?? PREVIEW_MAX_CHARS;
  const listMarkers = opts.listMarkers ?? false;
  // DOMParser is always available in the Tauri webview.
  const doc = new DOMParser().parseFromString(html, "text/html");
  const segments: NoteSegment[] = [];
  let charsEmitted = 0;
  let truncated = false;

  function pushText(content: string) {
    if (truncated || !content) return;
    const remaining = maxChars - charsEmitted;
    if (remaining <= 0) {
      truncated = true;
      return;
    }
    if (content.length > remaining) {
      segments.push({ type: "text", content: content.slice(0, remaining) + "…" });
      charsEmitted = maxChars;
      truncated = true;
      return;
    }
    segments.push({ type: "text", content });
    charsEmitted += content.length;
  }

  function pushLink(label: string, url: string) {
    if (truncated || !label) return;
    const remaining = maxChars - charsEmitted;
    if (remaining <= 0) {
      truncated = true;
      return;
    }
    // Long bare URLs as labels (Tiptap autolinks them) get shortened so the
    // preview pill doesn't blow out horizontally.
    const display =
      label === url && label.length > 40 ? shortenUrl(url) : label;
    if (display.length > remaining) {
      segments.push({ type: "link", label: display.slice(0, remaining) + "…", url });
      charsEmitted = maxChars;
      truncated = true;
      return;
    }
    segments.push({ type: "link", label: display, url });
    charsEmitted += display.length;
  }

  function walk(node: Node): void {
    if (truncated) return;
    if (node.nodeType === Node.TEXT_NODE) {
      pushText(node.textContent || "");
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const tag = el.tagName;

    // <a> with an http(s) href becomes a link segment; non-http hrefs fall
    // through to plain text via the children walk so we never emit a link
    // with a javascript: or data: URL.
    if (tag === "A") {
      const href = el.getAttribute("href") || "";
      if (/^https?:\/\//i.test(href)) {
        pushLink(el.textContent || "", href);
        return;
      }
    }

    // <br> is a hard line break with no children
    if (tag === "BR") {
      pushText("\n");
      return;
    }

    // Lists get readable markers when requested: each <li> is prefixed with
    // "• " (<ul>) or "1. " (<ol>, sequential) and closed with a newline.
    // Whitespace-only text nodes between items are skipped so the parser's
    // inter-tag indentation doesn't inject blank lines.
    if (listMarkers && (tag === "OL" || tag === "UL")) {
      let idx = 0;
      for (const child of Array.from(el.childNodes)) {
        if (truncated) return;
        if (child.nodeType === Node.ELEMENT_NODE && (child as Element).tagName === "LI") {
          idx += 1;
          pushText(tag === "OL" ? `${idx}. ` : "• ");
          for (const liChild of Array.from(child.childNodes)) {
            walk(liChild);
            if (truncated) return;
          }
          const lastSeg = segments[segments.length - 1];
          if (lastSeg && lastSeg.type === "text" && !lastSeg.content.endsWith("\n")) {
            pushText("\n");
          }
        } else if (!(child.nodeType === Node.TEXT_NODE && !(child.textContent || "").trim())) {
          walk(child);
        }
      }
      return;
    }

    // Walk children of any other element (block or inline) — block tags get
    // a trailing newline so multi-paragraph previews don't smash together.
    for (const child of Array.from(el.childNodes)) {
      walk(child);
      if (truncated) return;
    }
    if (BLOCK_TAGS.has(tag)) {
      // Suppress trailing newline if we'd just emit a leading-only one
      const last = segments[segments.length - 1];
      if (last && last.type === "text" && !last.content.endsWith("\n")) {
        pushText("\n");
      }
    }
  }

  walk(doc.body);

  // Drop a final stray newline so the pill isn't padded at the bottom
  const last = segments[segments.length - 1];
  if (last && last.type === "text" && last.content === "\n") {
    segments.pop();
  } else if (last && last.type === "text" && last.content.endsWith("\n")) {
    last.content = last.content.replace(/\n+$/, "");
    if (!last.content) segments.pop();
  }

  return segments;
}

/**
 * Format-agnostic notes-to-segments helper. Detects HTML vs markdown/plain
 * text and dispatches accordingly. Use this everywhere that displays
 * `task.notes`, since the same field can hold either format depending on
 * whether the note has been edited in the new RichTextEditor yet.
 */
export function notesToSegments(raw: string | null | undefined): NoteSegment[] {
  if (!raw) return [];
  if (raw.trimStart().startsWith("<")) {
    return htmlToSegments(raw);
  }
  return parseNotes(raw);
}
