import { useState, useEffect, useRef } from "react";

const QUICK_PRESETS = [
  { label: "0m", value: 0 },
  { label: "15m", value: 15 },
  { label: "30m", value: 30 },
  { label: "45m", value: 45 },
  { label: "1h", value: 60 },
  { label: "90m", value: 90 },
];

const EXPANDED_PRESETS = [
  { label: "10m", value: 10 },
  { label: "20m", value: 20 },
  { label: "25m", value: 25 },
  { label: "35m", value: 35 },
  { label: "40m", value: 40 },
  { label: "50m", value: 50 },
  { label: "2h", value: 120 },
  { label: "3h", value: 180 },
  { label: "4h", value: 240 },
];

interface DurationPickerProps {
  value: number | null; // minutes
  onChange: (minutes: number | null) => void;
}

function formatDuration(minutes: number | null): string {
  if (minutes == null || minutes <= 0) return "Time";
  if (minutes < 60) return `${minutes}m`;
  const h = minutes / 60;
  return `${h % 1 === 0 ? h : h.toFixed(1)}h`;
}

export default function DurationPicker({
  value,
  onChange,
}: DurationPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [customInput, setCustomInput] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  function handleCustomSubmit() {
    const trimmed = customInput.trim();
    if (!trimmed) return;
    const num = parseInt(trimmed);
    if (!isNaN(num) && num > 0 && num <= 480) {
      onChange(num);
      setCustomInput("");
      setIsOpen(false);
    }
  }

  function handlePreset(minutes: number) {
    onChange(minutes);
    setCustomInput("");
    setIsOpen(false);
  }

  function handleQuickPreset(minutes: number) {
    if (value === minutes) {
      onChange(null);
    } else {
      onChange(minutes);
    }
  }

  function handleClear() {
    onChange(null);
    setCustomInput("");
    setIsOpen(false);
  }

  return (
    <div className="flex items-center gap-1" ref={ref}>
      {/* Quick preset pills — always visible */}
      {QUICK_PRESETS.map((p) => (
        <button
          key={p.value}
          type="button"
          onClick={() => handleQuickPreset(p.value)}
          className={`px-1.5 py-0.5 rounded text-[10px] cursor-pointer transition-colors ${
            value === p.value
              ? "bg-accent-blue text-fg-on-accent"
              : "bg-overlay-hover text-fg-secondary hover:bg-overlay-pressed"
          }`}
        >
          {p.label}
        </button>
      ))}

      {/* Expanded picker trigger */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={`flex items-center gap-1 border rounded-md px-1.5 py-0.5 text-[10px] cursor-pointer transition-colors ${
            value && !QUICK_PRESETS.some((p) => p.value === value)
              ? "bg-accent-blue-soft border-accent-blue/30 text-accent-blue-soft-fg"
              : "bg-overlay-hover border-line-soft text-fg-secondary hover:bg-overlay-pressed"
          }`}
        >
          <svg
            width="9"
            height="9"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          >
            <circle cx="5" cy="5" r="4" />
            <path d="M5 3v2l1.5 1" />
          </svg>
          {value && !QUICK_PRESETS.some((p) => p.value === value)
            ? formatDuration(value)
            : "..."}
        </button>

        {isOpen && (
          <div className="absolute top-full mt-1 right-0 z-30 bg-elevated border border-line-medium rounded-[10px] shadow-lg p-2 w-[180px] animate-scale-in">
            {/* Custom input */}
            <div className="flex gap-1 mb-1.5">
              <input
                ref={inputRef}
                type="text"
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleCustomSubmit();
                  }
                }}
                placeholder="Minutes..."
                className="flex-1 min-w-0 bg-overlay-hover border border-line-soft rounded-md px-2 py-1 text-[11px] text-fg placeholder-fg-faded outline-none focus:border-accent-blue/40"
              />
              <button
                type="button"
                onClick={handleCustomSubmit}
                className="text-[10px] text-accent-blue-soft-fg px-1.5 py-1 rounded-md border border-accent-blue/30 bg-accent-blue-soft cursor-pointer hover:bg-accent-blue/15"
              >
                Set
              </button>
            </div>

            {/* Extended presets */}
            <div className="flex flex-wrap gap-1">
              {EXPANDED_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => handlePreset(p.value)}
                  className={`px-2 py-1 rounded-md text-[11px] cursor-pointer transition-colors ${
                    value === p.value
                      ? "bg-accent-blue text-fg-on-accent"
                      : "bg-overlay-hover text-fg-secondary hover:bg-overlay-pressed"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Clear */}
            {value != null && (
              <button
                type="button"
                onClick={handleClear}
                className="w-full mt-1.5 text-[10px] text-fg-secondary cursor-pointer hover:text-fg text-center py-0.5"
              >
                Clear
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
