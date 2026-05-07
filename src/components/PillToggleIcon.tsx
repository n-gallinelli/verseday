// Pill-shaped toggle icon used for panel collapse/expand controls.
// Shape: capsule track with a circular knob inside, a tiny chevron
// inside the knob pointing in the direction of the action.
//
// Usage convention:
// - direction="left"  — knob sits left,  chevron points left  (e.g. "click to collapse left")
// - direction="right" — knob sits right, chevron points right (e.g. "click to expand right")
//
// Coordinates are exact per design spec — pill 10x6 with rx=3 (fully
// capsule), knob r=2.2, chevron polyline mirrored around the knob
// center. viewBox 0 0 18 18 gives padding around the pill so it
// scales cleanly at any size.

interface PillToggleIconProps {
  direction: "left" | "right";
  size?: number;
}

export default function PillToggleIcon({
  direction,
  size = 22,
}: PillToggleIconProps) {
  const knobCx = direction === "left" ? 7 : 11;
  const chevronPoints =
    direction === "left"
      ? "7.6,8.2 6.4,9 7.6,9.8"
      : "10.4,8.2 11.6,9 10.4,9.8";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden
    >
      <rect
        x="4"
        y="6"
        width="10"
        height="6"
        rx="3"
        fill="#E8E4F5"
        stroke="#A89CC8"
        strokeWidth="0.5"
      />
      <circle cx={knobCx} cy="9" r="2.2" fill="#A89CC8" />
      <polyline
        points={chevronPoints}
        fill="none"
        stroke="#ffffff"
        strokeWidth="0.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
