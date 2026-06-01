import { useEffect, useState, useRef } from "react";
import {
  getSetting,
  setSetting,
  DEFAULT_TASK_ESTIMATE_FALLBACK_MIN,
} from "../db/queries";
import CalendarSettings from "../components/settings/CalendarSettings";
import RepeatingTasksSettings from "../components/settings/RepeatingTasksSettings";
import {
  getBreakContinuity,
  setBreakContinuity as persistBreakContinuity,
  type BreakContinuity,
} from "../utils/focusSettings";

const FOCUS_DEFAULTS = {
  focus_work_min: 25,
  focus_short_break_min: 5,
  focus_long_break_min: 15,
  focus_cycles_before_long: 4,
};

// Task-defaults section. Single field today, but room to grow (priority
// default, default project, etc.) without restructuring.
const TASK_DEFAULT_KEY = "default_task_estimate_min";
const TASK_DEFAULT_MIN = 5;
const TASK_DEFAULT_MAX = 240;
const TASK_DEFAULT_STEP = 5;

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
  const [taskEstimate, setTaskEstimate] = useState<number>(
    DEFAULT_TASK_ESTIMATE_FALLBACK_MIN
  );
  const [breakContinuity, setBreakContinuity] = useState<BreakContinuity>("reset");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const taskDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    async function load() {
      const entries = await Promise.all(
        (Object.keys(FOCUS_DEFAULTS) as FocusKey[]).map(async (key) => {
          const val = await getSetting(key);
          return [key, val ? parseInt(val) : FOCUS_DEFAULTS[key]] as [FocusKey, number];
        })
      );
      setFocusValues(Object.fromEntries(entries) as Record<FocusKey, number>);

      const taskRaw = await getSetting(TASK_DEFAULT_KEY);
      const parsed = taskRaw ? parseInt(taskRaw, 10) : NaN;
      setTaskEstimate(
        Number.isFinite(parsed) && parsed > 0
          ? parsed
          : DEFAULT_TASK_ESTIMATE_FALLBACK_MIN
      );

      setBreakContinuity(await getBreakContinuity());
    }
    load();
  }, []);

  function handleBreakContinuityChange(mode: BreakContinuity) {
    setBreakContinuity(mode);
    persistBreakContinuity(mode);
  }

  function handleTaskEstimateChange(value: number) {
    const clamped = Math.min(
      TASK_DEFAULT_MAX,
      Math.max(TASK_DEFAULT_MIN, value)
    );
    setTaskEstimate(clamped);
    if (taskDebounceRef.current) clearTimeout(taskDebounceRef.current);
    taskDebounceRef.current = setTimeout(() => {
      setSetting(TASK_DEFAULT_KEY, String(clamped));
    }, 400);
  }

  function handleTaskEstimateStep(delta: number) {
    handleTaskEstimateChange(taskEstimate + delta * TASK_DEFAULT_STEP);
  }

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
    <div className="flex flex-col h-full bg-base overflow-hidden">
      <div className="px-6 py-4 flex-shrink-0" style={{ borderBottom: "0.5px solid var(--border-hairline)" }}>
        <h2 className="text-[18px] font-medium text-fg font-display">Settings</h2>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[600px] mx-auto px-6 py-6 space-y-8">
          {/* Focus Timer */}
          <section className="mt-1">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--text-faded)" strokeWidth="1.2" strokeLinecap="round">
                  <circle cx="7" cy="7" r="5.5" />
                  <path d="M7 4v3.5l2.5 1.5" />
                </svg>
                <h3 className="uppercase [font-size:var(--font-size-label)] [letter-spacing:var(--letter-spacing-label)] text-fg-faded" style={{ fontWeight: 500 }}>
                  Focus timer
                </h3>
              </div>
              {!isDefaultValues && (
                <button
                  onClick={resetFocusDefaults}
                  className="text-[11px] text-fg-faded hover:text-fg-secondary cursor-pointer"
                >
                  Reset to defaults
                </button>
              )}
            </div>
            <div className="bg-elevated rounded-lg p-6 space-y-5" style={{ border: "0.5px solid var(--border-hairline)" }}>
              {FOCUS_FIELDS.map((field) => (
                <div key={field.key} className="flex items-center justify-between">
                  <div>
                    <div className="text-[13px] text-fg">{field.label}</div>
                    <div className="text-[11px] text-fg-faded">{field.description}</div>
                  </div>
                  {/* Pill stepper: [ − | 25 min | + ] */}
                  <div
                    className="flex items-center bg-elevated rounded-lg overflow-hidden flex-shrink-0 w-[168px]"
                    style={{ border: "1px solid var(--border-medium)" }}
                  >
                    <button
                      onClick={() => handleStep(field.key, -1, field.min, field.max)}
                      disabled={focusValues[field.key] <= field.min}
                      className="w-8 h-8 flex items-center justify-center text-fg-muted hover:text-fg cursor-pointer disabled:opacity-25 disabled:cursor-default text-[15px] transition-colors"
                    >
                      −
                    </button>
                    <div className="flex-1 flex items-center justify-center gap-1.5">
                      <span className="text-[15px] font-medium text-fg min-w-[28px] text-center tabular-nums">
                        {focusValues[field.key]}
                      </span>
                      <div className="w-px h-4 bg-line-soft" />
                      <span className="text-[12px] text-fg-faded w-[40px]">
                        {field.unit}
                      </span>
                    </div>
                    <button
                      onClick={() => handleStep(field.key, 1, field.min, field.max)}
                      disabled={focusValues[field.key] >= field.max}
                      className="w-8 h-8 flex items-center justify-center text-fg-muted hover:text-fg cursor-pointer disabled:opacity-25 disabled:cursor-default text-[15px] transition-colors"
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}

              {/* Break continuity across tasks */}
              <div className="flex items-center justify-between pt-1">
                <div>
                  <div className="text-[13px] text-fg">Break timer across tasks</div>
                  <div className="text-[11px] text-fg-faded">
                    {breakContinuity === "continue"
                      ? "Keeps counting across tasks; resets after 2 min idle/paused"
                      : "Resets the break timer each time you switch tasks"}
                  </div>
                </div>
                <div
                  className="flex items-center bg-elevated rounded-lg overflow-hidden flex-shrink-0 w-[168px]"
                  style={{ border: "1px solid var(--border-medium)" }}
                >
                  {(["reset", "continue"] as BreakContinuity[]).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => handleBreakContinuityChange(mode)}
                      className={`flex-1 h-8 flex items-center justify-center text-[12px] cursor-pointer transition-colors ${
                        breakContinuity === mode
                          ? "bg-accent-blue-soft text-accent-blue-soft-fg font-medium"
                          : "text-fg-muted hover:text-fg"
                      }`}
                    >
                      {mode === "reset" ? "Each task" : "Continue"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Task defaults */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--text-faded)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2.5 3.5h9M2.5 7h9M2.5 10.5h6" />
                </svg>
                <h3 className="uppercase [font-size:var(--font-size-label)] [letter-spacing:var(--letter-spacing-label)] text-fg-faded" style={{ fontWeight: 500 }}>
                  Task defaults
                </h3>
              </div>
            </div>
            <div className="bg-elevated rounded-lg p-6 space-y-5" style={{ border: "0.5px solid var(--border-hairline)" }}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[13px] text-fg">Default time estimate</div>
                  <div className="text-[11px] text-fg-faded">
                    Used when a new task is created without an explicit estimate
                  </div>
                </div>
                <div
                  className="flex items-center bg-elevated rounded-lg overflow-hidden flex-shrink-0 w-[168px]"
                  style={{ border: "1px solid var(--border-medium)" }}
                >
                  <button
                    onClick={() => handleTaskEstimateStep(-1)}
                    disabled={taskEstimate <= TASK_DEFAULT_MIN}
                    className="w-8 h-8 flex items-center justify-center text-fg-muted hover:text-fg cursor-pointer disabled:opacity-25 disabled:cursor-default text-[15px] transition-colors"
                  >
                    −
                  </button>
                  <div className="flex-1 flex items-center justify-center gap-1.5">
                    <span className="text-[15px] font-medium text-fg min-w-[28px] text-center tabular-nums">
                      {taskEstimate}
                    </span>
                    <div className="w-px h-4 bg-line-soft" />
                    <span className="text-[12px] text-fg-faded w-[40px]">min</span>
                  </div>
                  <button
                    onClick={() => handleTaskEstimateStep(1)}
                    disabled={taskEstimate >= TASK_DEFAULT_MAX}
                    className="w-8 h-8 flex items-center justify-center text-fg-muted hover:text-fg cursor-pointer disabled:opacity-25 disabled:cursor-default text-[15px] transition-colors"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          </section>

          <CalendarSettings />

          {/* Repeating tasks — see/edit every recurring task in one place */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--text-faded)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 7a5 5 0 0 1 8.5-3.5L12 5M12 7a5 5 0 0 1-8.5 3.5L2 9" />
                <path d="M12 2v3H9M2 12V9h3" />
              </svg>
              <h3 className="uppercase [font-size:var(--font-size-label)] [letter-spacing:var(--letter-spacing-label)] text-fg-faded" style={{ fontWeight: 500 }}>
                Repeating tasks
              </h3>
            </div>
            <RepeatingTasksSettings />
          </section>

        </div>
      </div>
    </div>
  );
}
