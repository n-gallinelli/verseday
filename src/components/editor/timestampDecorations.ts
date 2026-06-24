import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { formatNoteTimestamp } from "../../utils/noteTimestamp";

/**
 * Renders each stamped block's creation time as an unobtrusive widget in a
 * reserved right gutter (see the `.note-ts` rules in index.css). The widget is
 * a CHILD of the block, so hover-brightening is pure CSS (`block:hover .note-ts`)
 * with no JS plumbing, and it tracks the block through reflow for free.
 *
 * Two behaviours worth noting:
 *   - We walk with descendants() and match the textblocks (paragraph/heading),
 *     so a paragraph nested inside a listItem is reached and labelled — i.e. the
 *     stamp lands per bullet, not per top-level node.
 *   - Consecutive stamped blocks whose formatted label is identical collapse to
 *     a single visible stamp (a burst typed in one minute shows the time once);
 *     a block written minutes/hours/days later breaks the run and shows its own.
 *
 * This plugin is read-only: it never dispatches, so it adds no save/onChange.
 */
export const NoteTimestampDisplay = Extension.create({
  name: "noteTimestampDisplay",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("noteTimestampDisplay"),
        props: {
          decorations(state) {
            const decos: Decoration[] = [];
            let prevLabel: string | null = null;

            state.doc.descendants((node, pos) => {
              if (node.type.name !== "paragraph" && node.type.name !== "heading") {
                return; // keep descending into lists/blockquotes
              }
              const ts = node.attrs.createdAt as number | null;
              if (ts == null) return; // legacy/unstamped → no label, prev unchanged

              const label = formatNoteTimestamp(ts);
              if (label === prevLabel) return; // collapse a run of equal stamps
              prevLabel = label;

              decos.push(
                Decoration.widget(
                  pos + 1, // just inside the block, before its inline content
                  () => {
                    const el = document.createElement("span");
                    el.className = "note-ts";
                    el.textContent = label;
                    el.contentEditable = "false";
                    el.setAttribute("aria-hidden", "true");
                    return el;
                  },
                  {
                    side: -1,
                    ignoreSelection: true,
                    // Reuse the DOM node across updates when block+label are
                    // unchanged (avoids re-creating the span every keystroke).
                    key: `note-ts:${ts}:${label}`,
                  },
                ),
              );
            });

            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});
