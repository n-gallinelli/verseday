// Lightweight project-change broadcast (#3 lightweight option A).
//
// "Objective" is the UI label for a Project; there is no separate entity. Each
// screen holds its own `useState<Project[]>` loaded via getProjects(), so a
// project mutation used to leave the other copies stale until remount. The base
// mutation functions in queries.ts emit `verseday:project-changed` after their
// DB write; every live project-copy holder re-fetches on it.
//
// Mirrors the existing `verseday:task-status-changed` precedent (queries.ts).
// The full `projectsById` canonical store lift (option B) remains the deferred
// M5 follow-up. Cross-WEBVIEW sync (QuickAdd) is out of scope — a DOM event
// can't cross Tauri windows; see the changelog's known-limitation note.

export const PROJECT_CHANGED_EVENT = "verseday:project-changed";

/** Fire after a successful project create/edit/archive/complete/delete/reorder.
 *  Window-guarded so the query layer stays node-testable (no-op off-DOM). */
export function emitProjectChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PROJECT_CHANGED_EVENT));
}

/** Subscribe a re-fetch handler; returns an unsubscribe for effect cleanup so
 *  every listener stays balanced. Handlers must only READ (re-fetch) — never
 *  mutate/emit — so the bus can't feed back on itself. */
export function onProjectChanged(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(PROJECT_CHANGED_EVENT, handler);
  return () => window.removeEventListener(PROJECT_CHANGED_EVENT, handler);
}
