interface DisclosureCaretProps {
  expanded: boolean;
  size?: number;
}

/**
 * Small rounded chevron used for collapsible sections. Color is inherited via
 * `currentColor`, so callers theme it by setting `text-*` on a wrapper.
 */
export default function DisclosureCaret({
  expanded,
  size = 10,
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
        transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
        transition: "transform 150ms ease-out",
      }}
      aria-hidden
    >
      <path d="M3.5 2.5 L6.5 5 L3.5 7.5" />
    </svg>
  );
}
