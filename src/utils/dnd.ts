import type { Modifier } from "@dnd-kit/core";

/**
 * Snap the DragOverlay chip's center to the cursor so it follows the
 * mouse exactly, regardless of where on the source row the user
 * grabbed. Without this, dnd-kit anchors the chip to the source's
 * top-left + grab offset, which puts the chip noticeably off-cursor
 * for wide rows.
 */
export const snapCenterToCursor: Modifier = ({
  activatorEvent,
  draggingNodeRect,
  transform,
}) => {
  if (
    draggingNodeRect &&
    activatorEvent &&
    "clientX" in activatorEvent &&
    "clientY" in activatorEvent
  ) {
    const e = activatorEvent as PointerEvent;
    const offsetX = e.clientX - draggingNodeRect.left;
    const offsetY = e.clientY - draggingNodeRect.top;
    return {
      ...transform,
      x: transform.x + offsetX - draggingNodeRect.width / 2,
      y: transform.y + offsetY - draggingNodeRect.height / 2,
    };
  }
  return transform;
};
