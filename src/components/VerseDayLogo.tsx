interface VerseDayLogoProps {
  size?: number;
}

export default function VerseDayLogo({ size = 32 }: VerseDayLogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <defs>
        <linearGradient id="verseday-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#E8D4F0" />
          <stop offset="35%" stopColor="#F8D0DC" />
          <stop offset="70%" stopColor="#FBC9A4" />
          <stop offset="100%" stopColor="#FCE5A8" />
        </linearGradient>
        <linearGradient id="verseday-ocean" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#A8CFE5" />
          <stop offset="100%" stopColor="#CFE5F0" />
        </linearGradient>
        <radialGradient id="verseday-sunglow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FFD9A0" stopOpacity={0.9} />
          <stop offset="60%" stopColor="#FFD9A0" stopOpacity={0.35} />
          <stop offset="100%" stopColor="#FFD9A0" stopOpacity={0} />
        </radialGradient>
        <clipPath id="verseday-clip">
          <circle cx="10" cy="10" r="5.8" />
        </clipPath>
      </defs>

      <g clipPath="url(#verseday-clip)">
        <rect x="4" y="4" width="12" height="7.7" fill="url(#verseday-sky)" />
        <circle cx="10" cy="11.05" r="3.9" fill="url(#verseday-sunglow)" />
        <circle cx="10" cy="11.05" r="1.1" fill="#FFD9A0" />
        <rect x="4" y="11.7" width="12" height="4.3" fill="url(#verseday-ocean)" />
        <rect x="4" y="11.66" width="12" height="0.06" fill="#FFFFFF" fillOpacity={0.45} />
      </g>

      <path
        d="M 4.15,4.54 A 8,8 0 0 1 15.85,4.54"
        stroke="#E89BB1"
        strokeWidth="1.92"
        strokeLinecap="round"
      />
      <path
        d="M 15.46,4.15 A 8,8 0 0 1 15.46,15.85"
        stroke="#F4B58E"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M 15.85,15.46 A 8,8 0 0 1 4.15,15.46"
        stroke="#A8CFE5"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M 4.54,15.85 A 8,8 0 0 1 4.54,4.15"
        stroke="#C9B5E0"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
