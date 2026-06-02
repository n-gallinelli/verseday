// Custom-icon library broadcast. Fires when the custom_icons library changes
// (a new upload; P2: a delete) so every surface that resolves a custom_icon_id
// re-fetches the library instead of holding a stale copy.
//
// P5 — promoted from an in-window DOM CustomEvent to a Tauri event so it
// crosses webviews: QuickAdd lives in a separate Tauri window and uses
// useCustomIcons/ProjectGlyph, so a DOM event never reached it and its icon
// library went stale. A Tauri emit reaches every webview (incl. the emitter);
// every consumer is a read-only refetch that never re-emits, so there's no
// echo loop. (project-changed is NOT bridged — QuickAdd reads projects fresh
// from the shared DB on focus; see the Phase 5 design.)

import { emit, listen } from "@tauri-apps/api/event";

export const ICONS_CHANGED_EVENT = "verseday:icons-changed";

export function emitIconsChanged(): void {
  // Fire-and-forget — reaches all webviews. Swallow errors (e.g. a non-Tauri
  // context like tests) so a broadcast failure never breaks the mutation.
  void emit(ICONS_CHANGED_EVENT).catch(() => {});
}

export function onIconsChanged(handler: () => void): () => void {
  // Tauri's listen() is async (Promise<UnlistenFn>), but callers expect a
  // SYNCHRONOUS cleanup (useCustomIcons' effect returns this directly). Bridge
  // it: stash the unlisten when it resolves, and handle unmount-before-resolve
  // via a cancelled flag so no listener leaks.
  let un: (() => void) | null = null;
  let cancelled = false;
  listen(ICONS_CHANGED_EVENT, () => handler())
    .then((u) => {
      if (cancelled) u();
      else un = u;
    })
    .catch(() => {});
  return () => {
    cancelled = true;
    un?.();
  };
}
