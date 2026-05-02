interface MoodSelectorProps {
  value: string | null;
  onChange: (value: string | null) => void;
  tintColor?: string;
}

const MOODS: { key: string; label: string }[] = [
  { key: "Bad", label: "Bad" },
  { key: "Rough", label: "Rough" },
  { key: "Okay", label: "Okay" },
  { key: "Good", label: "Good" },
  { key: "Great", label: "Great" },
];

function MoodIcon({ mood, selected, tint }: { mood: string; selected: boolean; tint: string }) {
  const size = 28;
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

export default function MoodSelector({ value, onChange, tintColor = "var(--accent-blue)" }: MoodSelectorProps) {
  return (
    <div className="flex gap-1">
      {MOODS.map((m) => {
        const selected = value === m.key;
        const color = selected && MOOD_COLORS[m.key] ? MOOD_COLORS[m.key] : tintColor;
        return (
          <button
            key={m.key}
            onClick={() => onChange(selected ? null : m.key)}
            className="flex-1 flex flex-col items-center gap-1 py-2 rounded-[7px] cursor-pointer transition-colors"
            style={{
              border: `1.5px solid ${selected ? color : "var(--border-hairline)"}`,
              backgroundColor: selected ? `color-mix(in srgb, ${color} 3%, transparent)` : "var(--bg-elevated)",
            }}
          >
            <MoodIcon mood={m.key} selected={selected} tint={selected ? color : tintColor} />
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
