import { Extension, getChangedRanges, combineTransactionSteps, findChildrenInRange } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";

/**
 * Per-block note timestamps.
 *
 * Notes are stored as a single Tiptap HTML blob (one `tasks.notes` TEXT
 * column). To give each bullet/line a creation time WITHOUT a schema change,
 * we stamp the block node it lives on with `createdAt` (epoch ms), serialized
 * as a `data-created` attribute inside that same blob. Display is handled
 * separately (see ./timestampDecorations).
 *
 * Stamping rules (mirrors Tiptap's official @tiptap/extension-unique-id, which
 * solves the identical "attribute only on NEWLY-created nodes" problem):
 *   - Only blocks inside a transaction's CHANGED ranges are considered, so an
 *     edit to one bullet never touches untouched siblings.
 *   - A block is stamped only if it has no prior `createdAt`. Editing an
 *     already-stamped block never restamps it.
 *   - Programmatic content loads (setContent on mount-sync / cross-surface
 *     broadcast) are suppressed via `isProgrammaticLoad` so legacy blobs are
 *     never back-stamped with "now" — and, critically, the stamping transaction
 *     (a SEPARATE dispatch that DOES fire onChange even when setContent used
 *     emitUpdate:false) never runs, so a load never persists fake timestamps.
 *   - Stamping transactions set addToHistory:false (not undo steps).
 */

// Blocks we treat as a stampable "line". listItem is intentionally NOT here:
// its visible line is the paragraph nested inside it, which IS a textblock we
// stamp — so descending normally lands the stamp on the right node.
const STAMPABLE = new Set(["paragraph", "heading"]);

// Sanity bounds for a parsed data-created: positive and before ~year 2100.
// Anything else (non-numeric, negative, absurd) is treated as "no stamp" so a
// pasted/hand-edited attribute can never feed garbage into the formatter.
const MAX_TS = 4102444800000;

export function coerceTimestamp(raw: string | null): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n < MAX_TS ? n : null;
}

/**
 * Pure core (DOM-free, model-only) — given the docs before/after a dispatch and
 * the transactions that produced it, return the positions of blocks that should
 * receive a creation timestamp. Exported for the M1 proof test.
 *
 * Returns [] when there is nothing to stamp. The caller is responsible for the
 * isProgrammaticLoad guard; this function assumes stamping is allowed.
 */
export function blocksToStamp(
  oldDoc: PMNode,
  newDoc: PMNode,
  transactions: readonly Transaction[],
): number[] {
  if (!transactions.some((tr) => tr.docChanged)) return [];

  const transform = combineTransactionSteps(oldDoc, [...transactions]);
  const changes = getChangedRanges(transform);

  const positions: number[] = [];
  for (const { newRange } of changes) {
    const blocks = findChildrenInRange(newDoc, newRange, (node) =>
      STAMPABLE.has(node.type.name),
    );
    for (const { node, pos } of blocks) {
      if (node.attrs.createdAt == null) positions.push(pos);
    }
  }
  return positions;
}

/**
 * Full stamping decision including the load guard — the exact logic the
 * extension runs. When `isProgrammaticLoad` is true this returns [] no matter
 * what the transaction did, which is what keeps a setContent (whole-doc
 * replace) from stamping legacy blocks AND from appending a stamp transaction
 * that would fire onChange. Exported so the M1 proof test exercises the real
 * decision path rather than a copy of it.
 */
export function stampDecision(
  oldDoc: PMNode,
  newDoc: PMNode,
  transactions: readonly Transaction[],
  isProgrammaticLoad: boolean,
): number[] {
  if (isProgrammaticLoad) return [];
  return blocksToStamp(oldDoc, newDoc, transactions);
}

export interface BlockTimestampOptions {
  /** Shared flag — set true around every programmatic setContent. */
  isProgrammaticLoad: { current: boolean };
  /** Injectable clock for tests; defaults to Date.now. */
  now: () => number;
}

export const BlockTimestamp = Extension.create<BlockTimestampOptions>({
  name: "blockTimestamp",

  addOptions() {
    return {
      isProgrammaticLoad: { current: false },
      now: () => Date.now(),
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          createdAt: {
            default: null,
            parseHTML: (el) => coerceTimestamp(el.getAttribute("data-created")),
            renderHTML: (attrs) =>
              attrs.createdAt ? { "data-created": String(attrs.createdAt) } : {},
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    // Stamping lives on a ProseMirror plugin's appendTransaction (Tiptap's
    // Extension config has no such hook). Close over options for the guard/clock.
    const options = this.options;
    return [
      new Plugin({
        key: new PluginKey("blockTimestamp"),
        appendTransaction(transactions, oldState, newState) {
          const positions = stampDecision(
            oldState.doc,
            newState.doc,
            transactions,
            options.isProgrammaticLoad.current,
          );
          if (positions.length === 0) return null;

          const now = options.now();
          const tr = newState.tr;
          for (const pos of positions) tr.setNodeAttribute(pos, "createdAt", now);
          tr.setMeta("addToHistory", false);
          return tr;
        },
      }),
    ];
  },
});
