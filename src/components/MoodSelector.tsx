interface MoodSelectorProps {
  value: string | null;
  onChange: (value: string | null) => void;
  tintColor?: string;
  /** Face icon size in px. Default 28. Pass smaller for the daily
   *  shutdown's quieter mood row. */
  size?: number;
}

const MOODS: { key: string; label: string }[] = [
  { key: "Bad", label: "Bad" },
  { key: "Rough", label: "Rough" },
  { key: "Okay", label: "Okay" },
  { key: "Good", label: "Good" },
  { key: "Great", label: "Great" },
];

function MoodIcon({ mood, selected, tint, size = 28 }: { mood: string; selected: boolean; tint: string; size?: number }) {
  const stroke = selected ? tint : "var(--text-faded)";
  const fill = selected ? `color-mix(in srgb, ${tint} 8%, transparent)` : "none";
  const sw = 1.6;

  const common = { width: size, height: size, viewBox: "0 0 28 28", fill: "none" };

  switch (mood) {
    case "Bad":
      return (
        <svg {...common}>
          <circle cx="14" cy="14" r="11" stroke={stroke} strokeWidth={sw} fill={fill} />
          {/* Sad eyes */}
          <circle cx="10" cy="11.5" r="1.2" fill={stroke} />
          <circle cx="18" cy="11.5" r="1.2" fill={stroke} />
          {/* Frown */}
          <path d="M9.5 19.5c1.5-2.5 7.5-2.5 9 0" stroke={stroke} strokeWidth={sw} strokeLinecap="round" fill="none" />
        </svg>
      );
    case "Rough":
      return (
        <svg {...common}>
          <circle cx="14" cy="14" r="11" stroke={stroke} strokeWidth={sw} fill={fill} />
          <circle cx="10" cy="12" r="1.2" fill={stroke} />
          <circle cx="18" cy="12" r="1.2" fill={stroke} />
          {/* Slight frown */}
          <path d="M10 18.5c1.2-1.5 6.8-1.5 8 0" stroke={stroke} strokeWidth={sw} strokeLinecap="round" fill="none" />
        </svg>
      );
    case "Okay":
      return (
        <svg {...common}>
          <circle cx="14" cy="14" r="11" stroke={stroke} strokeWidth={sw} fill={fill} />
          <circle cx="10" cy="12" r="1.2" fill={stroke} />
          <circle cx="18" cy="12" r="1.2" fill={stroke} />
          {/* Flat mouth */}
          <line x1="10" y1="18" x2="18" y2="18" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
        </svg>
      );
    case "Good":
      return (
        <svg {...common}>
          <circle cx="14" cy="14" r="11" stroke={stroke} strokeWidth={sw} fill={fill} />
          <circle cx="10" cy="12" r="1.2" fill={stroke} />
          <circle cx="18" cy="12" r="1.2" fill={stroke} />
          {/* Slight smile */}
          <path d="M10 17c1.2 1.5 6.8 1.5 8 0" stroke={stroke} strokeWidth={sw} strokeLinecap="round" fill="none" />
        </svg>
      );
    case "Great":
      return (
        <svg {...common}>
          <circle cx="14" cy="14" r="11" stroke={stroke} strokeWidth={sw} fill={fill} />
          <circle cx="10" cy="11.5" r="1.2" fill={stroke} />
          <circle cx="18" cy="11.5" r="1.2" fill={stroke} />
          {/* Big smile */}
          <path d="M9 16.5c1.5 3 8.5 3 10 0" stroke={stroke} strokeWidth={sw} strokeLinecap="round" fill="none" />
        </svg>
      );
    default:
      return null;
  }
}

const MOOD_COLORS: Record<string, string> = {
  Bad: "var(--mood-bad)",
  Rough: "var(--mood-bad)",
  Okay: "var(--mood-okay)",
};

export default function MoodSelector({ value, onChange, tintColor = "var(--accent-blue)", size = 28 }: MoodSelectorProps) {
  return (
    <div className="flex gap-1">
      {MOODS.map((m) => {
        const selected = value === m.key;
        const color = selected && MOOD_COLORS[m.key] ? MOOD_COLORS[m.key] : tintColor;
        return (
          <button
            key={m.key}
            onClick={() => onChange(selected ? null : m.key)}
            className={`flex-1 flex flex-col items-center gap-1 py-2 rounded-[7px] cursor-pointer transition-colors border-[1.5px] bg-transparent ${
              selected ? "" : "border-line-hairline hover:border-line-strong"
            }`}
            style={
              selected
                ? { borderColor: color }
                : undefined
            }
          >
            <MoodIcon mood={m.key} selected={selected} tint={selected ? color : tintColor} size={size} />
            <span
              className="text-[9px]"
              style={{ color: selected ? color : "var(--text-faded)" }}
            >
              {m.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
