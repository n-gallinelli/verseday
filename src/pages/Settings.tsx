import { useEffect, useState, useRef } from "react";
import { getSetting, setSetting } from "../db/queries";

const FOCUS_DEFAULTS = {
  focus_work_min: 25,
  focus_short_break_min: 5,
  focus_long_break_min: 15,
  focus_cycles_before_long: 4,
};

type FocusKey = keyof typeof FOCUS_DEFAULTS;

const STEP_SIZE: Record<FocusKey, number> = {
  focus_work_min: 5,
  focus_short_break_min: 5,
  focus_long_break_min: 5,
  focus_cycles_before_long: 1,
};

const FOCUS_FIELDS: {
  key: FocusKey;
  label: string;
  description: string;
  min: number;
  max: number;
  unit: string;
}[] = [
  { key: "focus_work_min", label: "Work duration", description: "Length of each focus session", min: 1, max: 120, unit: "min" },
  { key: "focus_short_break_min", label: "Short break", description: "Break after each work session", min: 1, max: 30, unit: "min" },
  { key: "focus_long_break_min", label: "Long break", description: "Extended break after completing a cycle", min: 1, max: 60, unit: "min" },
  { key: "focus_cycles_before_long", label: "Cycles before long break", description: "Work sessions before a long break", min: 1, max: 10, unit: "cycles" },
];

export default function Settings() {
  const [focusValues, setFocusValues] = useState<Record<FocusKey, number>>({ ...FOCUS_DEFAULTS });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    async function load() {
      const entries = await Promise.all(
        (Object.keys(FOCUS_DEFAULTS) as FocusKey[]).map(async (key) => {
          const val = await getSetting(key);
          return [key, val ? parseInt(val) : FOCUS_DEFAULTS[key]] as [FocusKey, number];
        })
      );
      setFocusValues(Object.fromEntries(entries) as Record<FocusKey, number>);
    }
    load();
  }, []);

  function handleFocusChange(key: FocusKey, value: number, min: number, max: number) {
    const clamped = Math.min(max, Math.max(min, value));
    setFocusValues((prev) => ({ ...prev, [key]: clamped }));
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSetting(key, String(clamped));
    }, 400);
  }

  function handleStep(key: FocusKey, delta: number, min: number, max: number) {
    const current = focusValues[key];
    const step = STEP_SIZE[key];
    handleFocusChange(key, current + delta * step, min, max);
  }

  async function resetFocusDefaults() {
    setFocusValues({ ...FOCUS_DEFAULTS });
    await Promise.all(
      (Object.keys(FOCUS_DEFAULTS) as FocusKey[]).map((key) =>
        setSetting(key, String(FOCUS_DEFAULTS[key]))
      )
    );
  }

  const isDefaultValues = (Object.keys(FOCUS_DEFAULTS) as FocusKey[]).every(
    (key) => focusValues[key] === FOCUS_DEFAULTS[key]
  );

  return (
    <div className="flex flex-col h-full bg-[#f5f4f0] overflow-hidden">
      <div className="px-6 py-4 flex-shrink-0" style={{ borderBottom: "0.5px solid rgba(0,0,0,0.06)" }}>
        <h2 className="text-[18px] font-medium text-[#2c2a35] font-display">Settings</h2>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[600px] mx-auto px-6 py-6 space-y-8">
          {/* Focus Timer */}
          <section className="mt-1">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="rgba(0,0,0,0.3)" strokeWidth="1.2" strokeLinecap="round">
                  <circle cx="7" cy="7" r="5.5" />
                  <path d="M7 4v3.5l2.5 1.5" />
                </svg>
                <h3 className="uppercase [font-size:var(--font-size-label)] [letter-spacing:var(--letter-spacing-label)] text-black/30" style={{ fontWeight: 500 }}>
                  Focus timer
                </h3>
              </div>
              {!isDefaultValues && (
                <button
                  onClick={resetFocusDefaults}
                  className="text-[11px] text-black/30 hover:text-black/50 cursor-pointer"
                >
                  Reset to defaults
                </button>
              )}
            </div>
            <div className="bg-white rounded-lg p-6 space-y-5" style={{ border: "0.5px solid rgba(0,0,0,0.06)" }}>
              {FOCUS_FIELDS.map((field) => (
                <div key={field.key} className="flex items-center justify-between">
                  <div>
                    <div className="text-[13px] text-[#2c2a35]">{field.label}</div>
                    <div className="text-[11px] text-black/30">{field.description}</div>
                  </div>
                  {/* Pill stepper: [ − | 25 min | + ] */}
                  <div
                    className="flex items-center bg-white rounded-lg overflow-hidden flex-shrink-0 w-[168px]"
                    style={{ border: "1px solid rgba(0,0,0,0.10)" }}
                  >
                    <button
                      onClick={() => handleStep(field.key, -1, field.min, field.max)}
                      disabled={focusValues[field.key] <= field.min}
                      className="w-8 h-8 flex items-center justify-center text-black/40 hover:text-black/80 cursor-pointer disabled:opacity-25 disabled:cursor-default text-[15px] transition-colors"
                    >
                      −
                    </button>
                    <div className="flex-1 flex items-center justify-center gap-1.5">
                      <span className="text-[15px] font-medium text-[#2c2a35] min-w-[28px] text-center tabular-nums">
                        {focusValues[field.key]}
                      </span>
                      <div className="w-px h-4 bg-black/[0.08]" />
                      <span className="text-[12px] text-black/35 w-[40px]">
                        {field.unit}
                      </span>
                    </div>
                    <button
                      onClick={() => handleStep(field.key, 1, field.min, field.max)}
                      disabled={focusValues[field.key] >= field.max}
                      className="w-8 h-8 flex items-center justify-center text-black/40 hover:text-black/80 cursor-pointer disabled:opacity-25 disabled:cursor-default text-[15px] transition-colors"
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
