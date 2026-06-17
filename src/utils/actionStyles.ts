// Shared button/field style constants for the 2026-06-17 UI consistency pass.
// Centralizing the new treatments here keeps every screen referencing one
// source, so a revert is a single-file change (plus the per-screen commits).

/**
 * Primary-action treatment — a soft tinted fill, color only (each call site
 * keeps its own size/shape). The DEFAULT primary uses the app's blue accent:
 * inviting and consistent with the app identity. Rest carries the fill, so
 * hover deepens the border. The single accent ACTION per screen.
 *
 * Hue follows the screen's accent: blue everywhere EXCEPT Weekly Shutdown,
 * which is pink-themed — use PRIMARY_ACTION_CLASS_PINK there only.
 */
export const PRIMARY_ACTION_CLASS =
  "bg-accent-blue-soft text-accent-blue-soft-fg border border-accent-blue/40 hover:border-accent-blue transition-colors";

/** Pink variant of the primary fill — Weekly Shutdown ONLY (its themed color). */
export const PRIMARY_ACTION_CLASS_PINK =
  "bg-accent-pink-soft text-accent-pink-deep border border-accent-pink-bright/40 hover:border-accent-pink transition-colors";

/**
 * Neutral demotion — for accent-colored actions that competed with the screen's
 * primary. Outline + muted text, fills faintly on hover.
 */
export const NEUTRAL_ACTION_CLASS =
  "border border-line-soft text-fg-secondary hover:bg-overlay-hover transition-colors";

/**
 * Shared shape for the two shutdown terminal buttons (Reflect / Shutdown /
 * Complete shutdown). No width — each site keeps `flex-1` or `w-full`, both of
 * which render full-width. Combine with PRIMARY_ACTION_CLASS for the coral fill.
 */
export const SHUTDOWN_BUTTON_CLASS =
  "py-3 rounded-lg text-[14px] font-medium cursor-pointer flex items-center justify-center gap-2 transition-colors";

/**
 * Standard add-task / inline-create text field — solid (never dashed/grey,
 * which reads as disabled). Matches the Objectives "New objective" field so all
 * add-task inputs read identically. Combine with a width/`flex-1` per site.
 */
export const ADD_TASK_FIELD_CLASS =
  "flex items-center gap-2.5 bg-elevated rounded-[10px] px-3 py-2 border-[0.5px] border-line-soft";
