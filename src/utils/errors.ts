/**
 * Extract a human-readable message from an unknown caught error.
 *
 * Why this exists: Tauri's SQL plugin (and most invoke handlers) reject
 * with plain strings, not `Error` instances. Code that does
 * `e instanceof Error ? e.message : fallback` always lands on the
 * fallback for those rejections, which means the actual SQL/IO error
 * gets silently replaced with a generic string. Three rounds of
 * "Failed to load data" with no console signal in this session alone
 * traced back to that one pattern. See
 * docs/2026-05-04-recurring-instance-skip-on-delete.md (failure mode 4
 * + the P0 follow-up note) for the full history.
 *
 * Order of preference:
 *   1. The string itself, if `e` is a string (Tauri-style rejection).
 *   2. `e.message`, if `e` is an Error instance.
 *   3. The provided fallback, if no useful message can be extracted.
 *   4. `String(e)` as a last resort — truthy non-string-non-Error.
 *
 * The fallback is still meaningful: empty/null/undefined errors fall
 * through to it, and short non-string non-Error throws (e.g., a number
 * or boolean) are caught by the truthy check.
 */
export function errorMessage(e: unknown, fallback: string): string {
  if (typeof e === "string" && e.length > 0) return e;
  if (e instanceof Error && e.message.length > 0) return e.message;
  if (e == null) return fallback;
  // Truthy non-string non-Error: render via String() rather than dropping
  // it entirely. Rare in this codebase but better to surface than swallow.
  const s = String(e);
  return s && s !== "[object Object]" ? s : fallback;
}
