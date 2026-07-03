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
          // GUARD against the atom-toText mismatch. `renderText` (below) maps to
          // the pill's `spec.toText`, which Tiptap folds into the input-rule
          // match text via getTextContentFromNodes — so this URL rule can match
          // the pill's OWN href when the cursor sits after a pill. But the match
          // is measured in STRING length (href ~40 chars) while the pill is a
          // single doc position, so range.from is wrong:
          //   • pill near line start → range.from underflows NEGATIVE → the
          //     original replaceWith threw "Position out of range", and since
          //     this runs in the inputRules handleKeyDown that throw aborted
          //     ProseMirror's Enter handling (Enter/space looked dead);
          //   • enough text before the pill → range.from lands IN-BOUNDS but
          //     mid-sentence → replaceWith would silently delete ~href-length
          //     chars of the user's real text and drop in a duplicate pill.
          // Verify the matched span is the genuinely-typed URL: textBetween
          // renders any atom leaf as U+FFFC, so a contaminated match won't equal
          // match[1] and we bail — covering both cases. A real typed URL spans
          // only its own text, so it passes untouched. On bail the rule makes no
          // change and the keypress falls through to normal handling.
          if (range.from < 0 || range.to > state.doc.content.size) return;
          const typed = state.doc.textBetween(range.from, range.to, undefined, "\uFFFC");
          if (typed !== match[1]) return;
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
            const { state } = view;
            const { selection } = state;
            // Pasting a URL ONTO a text selection = hyperlink those words: keep
            // them as the label and apply the Link mark (the service icon comes
            // from the href via CSS). Only a paste with NO selection becomes a
            // shortened pill — otherwise we'd delete the user's words and drop
            // in a truncated URL (the reported bug).
            if (!selection.empty) {
              const linkMark = state.schema.marks.link;
              // No Link mark in the schema — let default paste handle it rather
              // than silently clobbering the selection with a pill.
              if (!linkMark) return false;
              const tr = state.tr.addMark(
                selection.from,
                selection.to,
                linkMark.create({ href: text })
              );
              view.dispatch(tr.scrollIntoView());
              return true;
            }
            const node = type.create({ href: text, label: shortLinkLabel(text) });
            const tr = state.tr.replaceSelectionWith(node).insertText(" ");
            view.dispatch(tr.scrollIntoView());
            return true;
          },
        },
      }),
    ];
  },
});
