// Custom-icon library broadcast. Fires when the custom_icons library changes
// (a new upload; P2: a delete) so every surface that resolves a
// custom_icon_id re-fetches the library instead of holding a stale copy.
// NOTE: this in-window DOM bus is itself slated for promotion to a Tauri
// cross-webview event in Phase 5 (the project-changed DOM bus it used to
// mirror was retired in Phase 3 — project changes now flow through the
// canonical projectsById store). A project's icon *assignment* change goes
// through setProjectIconAction → projectsById.

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
