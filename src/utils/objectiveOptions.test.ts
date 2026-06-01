import { describe, it, expect } from "vitest";
import { activeObjectiveOptions } from "./objectiveOptions";
import type { Project } from "../types";

function proj(id: number, completed = 0): Project {
  return {
    id,
    name: `P${id}`,
    color: "#809BC2",
    archived: 0,
    description: null,
    start_date: null,
    target_date: null,
    notes: null,
    sort_order: null,
    completed,
    priority: 0,
    created_at: "2026-01-01",
  };
}

describe("activeObjectiveOptions", () => {
  const list = [proj(1), proj(2, 1), proj(3)]; // 2 is completed

  it("excludes completed objectives", () => {
    expect(activeObjectiveOptions(list, "").map((p) => p.id)).toEqual([1, 3]);
  });

  it("keeps the current selection even if it's completed (no silent blank)", () => {
    expect(activeObjectiveOptions(list, "2").map((p) => p.id)).toEqual([1, 3, 2]);
  });

  it("does not duplicate a current selection that is already active", () => {
    expect(activeObjectiveOptions(list, "1").map((p) => p.id)).toEqual([1, 3]);
  });

  it("empty current value → active only", () => {
    expect(activeObjectiveOptions(list, "").map((p) => p.id)).toEqual([1, 3]);
  });

  it("a current value with no matching project is ignored", () => {
    expect(activeObjectiveOptions(list, "999").map((p) => p.id)).toEqual([1, 3]);
  });
});
