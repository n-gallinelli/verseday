// Custom-icon library broadcast. Fires when the custom_icons library changes
// (a new upload; P2: a delete) so every surface that resolves a
// custom_icon_id re-fetches the library instead of holding a stale copy.
// Mirrors utils/projectEvents. (A project's icon *assignment* change rides the
// existing verseday:project-changed event, since it's a project edit.)

export const ICONS_CHANGED_EVENT = "verseday:icons-changed";

export function emitIconsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ICONS_CHANGED_EVENT));
}

export function onIconsChanged(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(ICONS_CHANGED_EVENT, handler);
  return () => window.removeEventListener(ICONS_CHANGED_EVENT, handler);
}
