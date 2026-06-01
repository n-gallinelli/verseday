interface LinkIconProps {
  size?: number;
  className?: string;
}

/**
 * Small rounded link/chain glyph for attached links. Replaces a raw 🔗 emoji
 * that the webview wasn't rendering. Color is inherited via `currentColor`, so
 * callers theme it by setting `text-*` on the element (matches DisclosureCaret
 * / CalendarChip). Two interlocking links drawn on a 24-grid, scaled down — the
 * ~1px effective stroke at 12px keeps it consistent with the app's fine icons.
 */
export default function LinkIcon({ size = 12, className = "" }: LinkIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}
