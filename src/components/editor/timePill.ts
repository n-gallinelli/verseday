import { Node, mergeAttributes, InputRule } from "@tiptap/core";
import { formatNoteTimestamp } from "../../utils/noteTimestamp";
import { logicalDayIso } from "../../utils/dates";

/**
 * Explicit, user-typed timestamp pills. Triggered by `@` or `#` followed by:
 *   now      → current time + date  ("4:58 PM · Jun 24")
 *   today    → today's date         ("Jun 24")
 *   tomorrow → tomorrow's date      ("Jun 25")
 * The pill is an inline atom — it's part of the note content (persisted in the
 * notes HTML), captured at insertion time, and frozen thereafter. Nothing
 * appears unless the user types a trigger.
 */

const MAX_TS = 4102444800000; // ~year 2100 — reject absurd/garbage data-ts
type PillKind = "now" | "today" | "tomorrow";

function coerceTs(raw: string | null): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n < MAX_TS ? n : null;
}

function coerceKind(raw: string | null): PillKind {
  return raw === "today" || raw === "tomorrow" ? raw : "now";
}

/** Short "Jun 25" label for the logical day of `ms`, shifted by `offsetDays`. */
function dateLabel(ms: number, offsetDays: number): string {
  const d = new Date(logicalDayIso(new Date(ms)) + "T00:00:00");
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function labelFor(kind: PillKind, ms: number): string {
  if (kind === "now") return formatNoteTimestamp(ms);
  return dateLabel(ms, kind === "tomorrow" ? 1 : 0);
}

export const TimePill = Node.create({
  name: "timePill",
  inline: true,
  group: "inline",
  atom: true, // a single unit — backspace removes the whole pill
  selectable: true,

  addAttributes() {
    return {
      // The frozen display string. Stored so the pill never re-renders to a
      // different value later, and so it survives copy/paste as plain text.
      label: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-label") ?? el.textContent ?? "",
        renderHTML: (attrs) => ({ "data-label": attrs.label }),
      },
      // The captured instant (epoch ms), integer-coerced on parse.
      ts: {
        default: null,
        parseHTML: (el) => coerceTs(el.getAttribute("data-ts")),
        renderHTML: (attrs) => (attrs.ts ? { "data-ts": String(attrs.ts) } : {}),
      },
      kind: {
        default: "now",
        parseHTML: (el) => coerceKind(el.getAttribute("data-kind")),
        renderHTML: (attrs) => ({ "data-kind": attrs.kind }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-time-pill]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    // The label is emitted as a TEXT child (never innerHTML), so a hand-edited
    // data-label can't inject markup; atoms ignore it on re-parse anyway.
    return [
      "span",
      mergeAttributes(HTMLAttributes, { "data-time-pill": "", class: "note-time-pill" }),
      node.attrs.label || "",
    ];
  },

  renderText({ node }) {
    return node.attrs.label || "";
  },

  addInputRules() {
    const type = this.type;
    return [
      new InputRule({
        find: /[@#](now|today|tomorrow)$/,
        handler: ({ state, range, match }) => {
          const kind = match[1] as PillKind;
          const ms = Date.now();
          const node = type.create({ label: labelFor(kind, ms), ts: ms, kind });
          state.tr.replaceWith(range.from, range.to, node).insertText(" ");
        },
      }),
    ];
  },
});
