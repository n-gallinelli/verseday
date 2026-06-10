import { describe, it, expect } from "vitest";
import { clampToFrame } from "./pipClamp";

// clampToFrame — keeps the pip's whole rect inside the monitor frame minus a
// top (menu-bar) inset. All physical px. The off-top case is the one that
// actually bit us (pip parked at y=-68, above the menu bar).
describe("clampToFrame", () => {
  // 1x display, 220x58 pip, 25px menu-bar top inset, no side/bottom margins
  // (pip is alwaysOnTop → floats over dock/edges).
  const frame = { x: 0, y: 0, width: 1512, height: 982 };
  const size = { width: 220, height: 58 };
  const margins = { top: 25, right: 0, bottom: 0, left: 0 };

  it("off the TOP (the real bug) → snaps below the menu bar", () => {
    expect(clampToFrame({ x: 20, y: -68 }, size, frame, margins)).toEqual({ x: 20, y: 25 });
  });

  it("off the LEFT → snaps to x=0", () => {
    expect(clampToFrame({ x: -120, y: 200 }, size, frame, margins)).toEqual({ x: 0, y: 200 });
  });

  it("off the RIGHT → snaps so the right edge sits at the frame edge", () => {
    // maxX = 1512 - 220 = 1292
    expect(clampToFrame({ x: 1490, y: 200 }, size, frame, margins)).toEqual({ x: 1292, y: 200 });
  });

  it("off the BOTTOM → snaps so the bottom edge sits at the frame edge", () => {
    // maxY = 982 - 58 = 924
    expect(clampToFrame({ x: 100, y: 1000 }, size, frame, margins)).toEqual({ x: 100, y: 924 });
  });

  it("fully in bounds → unchanged", () => {
    expect(clampToFrame({ x: 300, y: 300 }, size, frame, margins)).toEqual({ x: 300, y: 300 });
  });

  it("Retina (2x) physical frame + scaled margin", () => {
    // 2x physical: frame & pip & inset all doubled. Off-top by a lot.
    const r = clampToFrame(
      { x: 40, y: -136 },
      { width: 440, height: 116 },
      { x: 0, y: 0, width: 3024, height: 1964 },
      { top: 50, right: 0, bottom: 0, left: 0 },
    );
    expect(r).toEqual({ x: 40, y: 50 });
  });

  it("secondary monitor (non-zero frame origin) clamps to that monitor", () => {
    // Monitor to the right, origin x=1512. Pip dragged left of it.
    const r = clampToFrame(
      { x: 1400, y: 100 },
      size,
      { x: 1512, y: 0, width: 1512, height: 982 },
      margins,
    );
    expect(r).toEqual({ x: 1512, y: 100 });
  });

  it("window taller than the available span → pins to the top inset (no inverted range)", () => {
    const r = clampToFrame(
      { x: 10, y: 500 },
      { width: 220, height: 2000 },
      frame,
      margins,
    );
    expect(r.y).toBe(25);
  });
});
