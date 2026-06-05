import { describe, it, expect } from "vitest";
import { sessionFromFocus, withSession, type FocusState } from "./appStore";

// Stage 1 of the focus single-source refactor. The non-negotiable invariant
// (docs/2026-06-04-focus-single-source-refactor-plan.md):
//   session !== null  ⟺  focus?.mode === "active"
// Every focus write in appStore funnels through withSession (which derives
// session via sessionFromFocus), so proving the helpers' ⟺ proves the invariant
// for all set sites.

const active: FocusState = {
  mode: "active",
  taskId: 7,
  timeEntryId: 42,
  previousPage: "daily",
  priorElapsedMs: 0,
  paused: false,
  workedMs: 123000,
};
const preview: FocusState = {
  mode: "preview",
  taskId: 7,
  previousPage: "daily",
  priorElapsedMs: 0,
};

describe("sessionFromFocus — the session/focus invariant", () => {
  it("active focus → a session (⟺ holds)", () => {
    const s = sessionFromFocus(active);
    expect(s).not.toBeNull();
    expect(s).toEqual({ timeEntryId: 42, taskId: 7, workedMs: 123000, paused: false });
  });

  it("preview focus → null (not focusing)", () => {
    expect(sessionFromFocus(preview)).toBeNull();
  });

  it("no focus → null", () => {
    expect(sessionFromFocus(null)).toBeNull();
  });

  it("mirrors paused", () => {
    expect(sessionFromFocus({ ...active, paused: true })?.paused).toBe(true);
  });

  it("⟺ over a representative set: session !== null exactly when mode === active", () => {
    const cases: (FocusState | null)[] = [
      active,
      { ...active, paused: true },
      preview,
      null,
    ];
    for (const f of cases) {
      expect(sessionFromFocus(f) !== null).toBe(f?.mode === "active");
    }
  });
});

describe("withSession — the single funnel every focus write uses", () => {
  it("adds a derived session matching sessionFromFocus, preserving the patch", () => {
    const patch = withSession({ focus: active, currentPage: "daily" as const });
    expect(patch.focus).toBe(active);
    expect(patch.currentPage).toBe("daily");
    expect(patch.session).toEqual(sessionFromFocus(active));
  });

  it("clears session for a preview or null focus patch", () => {
    expect(withSession({ focus: preview }).session).toBeNull();
    expect(withSession({ focus: null }).session).toBeNull();
  });
});
