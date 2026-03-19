export default function CheckIcon({ size = 8 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 8 8"
      fill="none"
      stroke="white"
      strokeWidth="1.2"
      strokeLinecap="round"
    >
      <path d="M1.5 4l2 2 3-3" />
    </svg>
  );
}
