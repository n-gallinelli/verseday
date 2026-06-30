import { Node, mergeAttributes, InputRule } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { shortLinkLabel } from "../../utils/linkify";

/**
 * Atomic display pill for a BARE pasted/typed URL. The full URL is the source
 * of truth (kept in `data-href`); the visible text is a shortened label
 * (`host + a few slug chars + …`) so a long link doesn't blow out the note.
 * The link still opens the exact original URL.
 *
 * Bare URLs only — a URL the user typed/pasted on its own. Hyperlinked text
 * (`[label](url)` or a pasted rich anchor) keeps its custom label via the Link
 * mark and never becomes a pill. Mirrors the timePill atom: inline, frozen on
 * insert, label emitted as a TEXT child (never innerHTML) so a hand-edited
 * data-label can't inject markup.
 *
 * SECURITY: creation paths below only ever mint https?:// hrefs. The label is
 * cosmetic; the canonical URL lives in data-href and is re-validated at every
 * open/render site (the editor click handler and htmlToSegments) before it can
 * reach the Tauri opener.
 */

const URL_RE = /^https?:\/\/\S+$/i;

export const LinkPill = Node.create({
  name: "linkPill",
  inline: true,
  group: "inline",
  atom: true, // a single unit — backspace removes the whole pill
  selectable: true,

  addAttributes() {
    return {
      // Full target URL — the source of truth, preserved verbatim.
      href: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-href") ?? "",
        renderHTML: (attrs) => (attrs.href ? { "data-href": attrs.href } : {}),
      },
      // Frozen shortened display string.
      label: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-label") ?? el.textContent ?? "",
        renderHTML: (attrs) => ({ "data-label": attrs.label }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-link-pill]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    // Label as a TEXT child (never innerHTML), same XSS-safe shape as timePill.
    return [
      "span",
      mergeAttributes(HTMLAttributes, { "data-link-pill": "", class: "note-link-pill" }),
      node.attrs.label || node.attrs.href || "",
    ];
  },

  // Copy-as-plain-text yields the real URL, not the truncated label.
  renderText({ node }) {
    return node.attrs.href || "";
  },

  addInputRules() {
    const type = this.type;
    return [
      // A bare URL followed by a space → pill. The trailing space is preserved
      // so the user keeps typing after the pill.
      new InputRule({
        find: /(https?:\/\/\S+)\s$/i,
        handler: ({ state, range, match }) => {
          const url = match[1];
          const node = type.create({ href: url, label: shortLinkLabel(url) });
          state.tr.replaceWith(range.from, range.to, node).insertText(" ");
        },
      }),
    ];
  },

  addProseMirrorPlugins() {
    const type = this.type;
    return [
      new Plugin({
        key: new PluginKey("linkPillPaste"),
        props: {
          // Pasting a lone bare URL → pill. Anything else (rich HTML, text with
          // surrounding content) falls through to the default paste handling so
          // hyperlinked text keeps its label.
          handlePaste: (view, event) => {
            const text = event.clipboardData?.getData("text/plain")?.trim();
            if (!text || !URL_RE.test(text)) return false;
            const node = type.create({ href: text, label: shortLinkLabel(text) });
            const tr = view.state.tr.replaceSelectionWith(node).insertText(" ");
            view.dispatch(tr.scrollIntoView());
            return true;
          },
        },
      }),
    ];
  },
});
