// Geometry for keeping the focus pip on-screen. Pure + side-effect-free so
// the clamp math is unit-tested directly (FocusPip wires it to onMoved →
// settle → setPosition). ALL values are PHYSICAL pixels — the caller reads
// onMoved/outerPosition (PhysicalPosition) and the monitor's physical size,
// and never mixes in logical units.

export interface Pt {
  x: number;
  y: number;
}
export interface Size {
  width: number;
  height: number;
}
/** A monitor's physical bounds: top-left origin (`x`/`y`) + size. */
export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** Per-edge insets (physical px). The pip is alwaysOnTop, so it floats over
 *  the dock/side edges and stays grabbable there — only the menu bar (top)
 *  is a true occluder, so in practice only `top` is non-zero. */
export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Clamp a window's top-left position so the WHOLE window stays inside
 * `frame` minus `margins`. If the window is larger than the available span
 * on an axis (e.g. taller than the frame), it pins to the min edge rather
 * than producing an inverted range. Returns the (possibly unchanged)
 * position; the caller decides whether the delta is worth a setPosition.
 */
export function clampToFrame(pos: Pt, size: Size, frame: Frame, margins: Margins): Pt {
  const minX = frame.x + margins.left;
  const maxX = frame.x + frame.width - size.width - margins.right;
  const minY = frame.y + margins.top;
  const maxY = frame.y + frame.height - size.height - margins.bottom;
  return {
    x: clamp(pos.x, minX, Math.max(minX, maxX)),
    y: clamp(pos.y, minY, Math.max(minY, maxY)),
  };
}
