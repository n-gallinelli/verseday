import { useEffect, useState, useRef } from "react";
import { getSetting, setSetting, deleteSetting } from "../db/queries";

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
  const [apiKeyStatus, setApiKeyStatus] = useState<"loading" | "configured" | "not-configured">("loading");
  const [keyInput, setKeyInput] = useState("");
  const [keySaved, setKeySaved] = useState(false);
  const [removeArmed, setRemoveArmed] = useState(false);
  const removeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

      const apiKey = await getSetting("anthropic_api_key");
      setApiKeyStatus(apiKey ? "configured" : "not-configured");
    }
    load();
  }, []);

  useEffect(() => {
    return () => {
      if (removeTimerRef.current) clearTimeout(removeTimerRef.current);
    };
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

  async function handleSaveApiKey() {
    const trimmed = keyInput.trim();
    if (!trimmed) return;
    await setSetting("anthropic_api_key", trimmed);
    setApiKeyStatus("configured");
    setKeyInput("");
    setKeySaved(true);
    setTimeout(() => setKeySaved(false), 2000);
  }

  function handleRemoveClick() {
    if (removeArmed) {
      if (removeTimerRef.current) clearTimeout(removeTimerRef.current);
      deleteSetting("anthropic_api_key");
      setApiKeyStatus("not-configured");
      setRemoveArmed(false);
    } else {
      setRemoveArmed(true);
      removeTimerRef.current = setTimeout(() => setRemoveArmed(false), 2000);
    }
  }

  const hasKeyInput = keyInput.trim().length > 0;

  return (
    <div className="flex flex-col h-full bg-[#f5f4f0] overflow-hidden">
      <div className="px-6 py-4 flex-shrink-0" style={{ borderBottom: "0.5px solid rgba(0,0,0,0.06)" }}>
        <h2 className="text-[18px] font-medium text-[#2c2a35]">Settings</h2>
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

          {/* API Key */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="rgba(0,0,0,0.3)" strokeWidth="1.2" strokeLinecap="round">
                <path d="M8 1.5l4.5 4.5-7 7H1v-4.5z" />
                <path d="M6.5 3L11 7.5" />
              </svg>
              <h3 className="uppercase [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] text-black/30">
                Anthropic API key
              </h3>
            </div>
            <div className="bg-white rounded-lg p-6 space-y-3 group/apicard" style={{ border: "0.5px solid rgba(0,0,0,0.06)" }}>
              <div className="text-[12px] text-black/40">
                Used for generating daily and weekly summaries.
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`text-[12px] px-2 py-0.5 rounded-full ${
                    apiKeyStatus === "configured"
                      ? "bg-[#E1F5EE] text-[#0F6E56]"
                      : "bg-black/[0.04] text-black/30"
                  }`}
                >
                  {apiKeyStatus === "loading"
                    ? "Loading..."
                    : apiKeyStatus === "configured"
                      ? "Configured"
                      : "Not configured"}
                </span>
              </div>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSaveApiKey(); }}
                  placeholder="sk-ant-..."
                  className="flex-1 px-3 py-2 text-[13px] border border-black/[0.08] rounded-lg focus:outline-none focus:border-[#7B9ED9]/40"
                />
                <button
                  onClick={handleSaveApiKey}
                  disabled={!hasKeyInput}
                  className={`px-4 py-2 text-[13px] rounded-lg transition-colors ${
                    hasKeyInput
                      ? "bg-[#7B9ED9] text-white cursor-pointer hover:bg-[#6889c4] opacity-100"
                      : "bg-[#7B9ED9] text-white opacity-40 cursor-not-allowed"
                  }`}
                >
                  {keySaved ? "Saved!" : "Save"}
                </button>
              </div>
              {apiKeyStatus === "configured" && (
                <button
                  onClick={handleRemoveClick}
                  className="text-[11px] invisible group-hover/apicard:visible cursor-pointer transition-colors"
                  style={{ color: removeArmed ? "rgba(220,50,50,0.9)" : "rgba(220,50,50,0.7)" }}
                >
                  {removeArmed ? "Confirm remove?" : "Remove key"}
                </button>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
