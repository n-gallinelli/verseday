import { describe, it, expect } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { EditorState } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { BlockTimestamp, blocksToStamp, stampDecision, coerceTimestamp } from "./blockTimestamp";

// Model-only (no DOM) — ProseMirror's document model and the change-range
// helpers run without a view, so the stamping DECISION is fully testable in the
// existing node vitest env. (The DOM-bound gutter rendering is covered by eyes-on.)
const schema = getSchema([StarterKit, BlockTimestamp]);

function p(text: string, createdAt: number | null = null): PMNode {
  return schema.node("paragraph", { createdAt }, text ? schema.text(text) : undefined);
}
function doc(...blocks: PMNode[]): PMNode {
  return schema.node("doc", null, blocks);
}
function stateOf(d: PMNode): EditorState {
  return EditorState.create({ schema, doc: d });
}

/** Apply a builder to a fresh state and return {oldDoc, newDoc, txns}. */
function dispatch(start: PMNode, build: (s: EditorState) => EditorState["tr"]) {
  const state = stateOf(start);
  const tr = build(state);
  const next = state.apply(tr);
  return { oldDoc: state.doc, newDoc: next.doc, txns: [tr] };
}

/** Positions whose node carries a non-null createdAt, for assertions. */
function stampedTexts(d: PMNode): string[] {
  const out: string[] = [];
  d.descendants((node) => {
    if (node.attrs.createdAt != null) out.push(node.textContent);
  });
  return out;
}

describe("BlockTimestamp — stamping decision", () => {
  // THE M1 GATE. A programmatic load (whole-doc replace, like setContent) of a
  // legacy blob must stamp NOTHING. stampDecision -> [] means the extension
  // appends NO transaction; since the only path that fires onChange on load is
  // that appended stamp dispatch, [] proves "onChange did NOT fire" AND "the
  // loaded doc keeps zero data-created" in one assertion.
  it("load guard: setContent-shaped replace of a legacy blob stamps nothing", () => {
    const legacy = doc(p("old line A"), p("old line B")); // no data-created
    const { oldDoc, newDoc, txns } = dispatch(doc(p("")), (s) =>
      s.tr.replaceWith(0, s.doc.content.size, legacy.content),
    );

    // Guarded (this is what a load is): zero stamps.
    expect(stampDecision(oldDoc, newDoc, txns, /* isProgrammaticLoad */ true)).toEqual([]);
    // And the loaded doc itself carries no createdAt anywhere.
    expect(stampedTexts(newDoc)).toEqual([]);
  });

  it("load guard is load-bearing: the SAME replace would stamp every block if unguarded", () => {
    const legacy = doc(p("old line A"), p("old line B"));
    const { oldDoc, newDoc, txns } = dispatch(doc(p("")), (s) =>
      s.tr.replaceWith(0, s.doc.content.size, legacy.content),
    );
    // Without the guard, a load looks like "two brand-new blocks" → corruption.
    // This is exactly why isProgrammaticLoad exists.
    expect(stampDecision(oldDoc, newDoc, txns, false)).toHaveLength(2);
  });

  it("stamps a newly inserted block, not the pre-existing stamped one", () => {
    const T = 1_700_000_000_000;
    const { oldDoc, newDoc, txns } = dispatch(doc(p("A", T)), (s) =>
      // Enter-then-type: a new paragraph appears after the first.
      s.tr.insert(s.doc.content.size, p("B")),
    );
    const positions = blocksToStamp(oldDoc, newDoc, txns);
    expect(positions).toHaveLength(1);
    expect(newDoc.nodeAt(positions[0])?.textContent).toBe("B");
  });

  it("editing one bullet never stamps an untouched legacy sibling", () => {
    // Both blocks are legacy (no stamp). User types into B only.
    const { oldDoc, newDoc, txns } = dispatch(doc(p("A"), p("B")), (s) => {
      // position inside the second paragraph's text
      const bInner = s.doc.child(0).nodeSize + 1;
      return s.tr.insertText("x", bInner);
    });
    const positions = blocksToStamp(oldDoc, newDoc, txns);
    const texts = positions.map((pos) => newDoc.nodeAt(pos)?.textContent);
    expect(texts).not.toContain("A"); // untouched sibling stays unstamped
    expect(texts).toContain("xB"); // the edited (legacy) block adopts a time
  });

  it("editing an already-stamped block does not restamp it", () => {
    const T = 1_700_000_000_000;
    const { oldDoc, newDoc, txns } = dispatch(doc(p("A", T)), (s) =>
      s.tr.insertText("!", s.doc.content.size - 1),
    );
    expect(blocksToStamp(oldDoc, newDoc, txns)).toEqual([]);
  });
});

describe("coerceTimestamp — data-created parse guard", () => {
  it("accepts a clean epoch ms", () => {
    expect(coerceTimestamp("1700000000000")).toBe(1700000000000);
  });
  it("rejects non-numeric / empty / negative / absurd so the formatter never sees garbage", () => {
    expect(coerceTimestamp(null)).toBeNull();
    expect(coerceTimestamp("")).toBeNull();
    expect(coerceTimestamp("not-a-number")).toBeNull();
    expect(coerceTimestamp("-5")).toBeNull();
    expect(coerceTimestamp("99999999999999999")).toBeNull(); // past ~year 2100 bound
    expect(coerceTimestamp("123.4")).toBeNull(); // non-integer
  });
});
