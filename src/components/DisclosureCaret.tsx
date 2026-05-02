interface DisclosureCaretProps {
  expanded: boolean;
  size?: number;
  /**
   * Degrees to rotate the chevron when expanded. 90 (default) makes it point
   * down — use for sections that open downward. -90 points it up — use for
   * panels that open upward (e.g. the sidebar shortcuts).
   */
  rotateExpanded?: number;
  className?: string;
}

/**
 * Small rounded chevron used for collapsible sections. Color is inherited via
 * `currentColor`, so callers theme it by setting `text-*` on a wrapper.
 */
export default function DisclosureCaret({
  expanded,
  size = 10,
  rotateExpanded = 90,
  className = "",
}: DisclosureCaretProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        transform: expanded ? `rotate(${rotateExpanded}deg)` : "rotate(0deg)",
        transition: "transform 150ms ease-out",
      }}
      className={className}
      aria-hidden
    >
      <path d="M3.5 2.5 L6.5 5 L3.5 7.5" />
    </svg>
  );
}
