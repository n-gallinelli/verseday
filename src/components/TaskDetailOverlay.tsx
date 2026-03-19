import { useState, useRef, useEffect, useCallback } from "react";
import { getWorkedMinutesByDate, setTaskRecurrence, parseRecurrence, serializeRecurrence } from "../db/queries";
import type { Task, Project } from "../types";

const MAX_TITLE_LENGTH = 200;
const MAX_ESTIMATE_MINUTES = 480;
const MAX_NOTES_LENGTH = 5000;

const ESTIMATE_PRESETS = [
  { label: "0m", value: "0" },
  { label: "15m", value: "15" },
  { label: "30m", value: "30" },
  { label: "45m", value: "45" },
  { label: "1h", value: "60" },
  { label: "2h", value: "120" },
  { label: "3h", value: "180" },
];

const WORKED_PRESETS = [
  { label: "15m", value: "15" },
  { label: "30m", value: "30" },
  { label: "45m", value: "45" },
  { label: "1h", value: "60" },
  { label: "1h 30m", value: "90" },
  { label: "2h", value: "120" },
];

interface TaskDetailOverlayProps {
  task: Task;
  projects: Project[];
  onClose: () => void;
  onSave: (updates: {
    id: number;
    title: string;
    projectId: number | null;
    estimatedMinutes: number | null;
    priority: string;
    notes: string | null;
    dateScheduled: string | null;
  }) => void;
  onToggle?: (task: Task) => void;
  onDelete?: (taskId: number) => void;
  onStartFocus?: (task: Task) => void;
  workedMinutes?: number;
  onSetWorkedMinutes?: (taskId: number, minutes: number) => void;
  autoTrackedMinutes?: number;
}

function formatDisplayMinutes(value: string): string {
  const n = parseInt(value);
  if (!value || isNaN(n) || n <= 0) return "—";
  const h = Math.floor(n / 60);
  const m = n % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${n}m`;
}

function parseTimeInput(raw: string): number {
  const hMatch = raw.match(/(\d+)\s*h/i);
  const mMatch = raw.match(/(\d+)\s*m/i);
  let total = 0;
  if (hMatch) total += parseInt(hMatch[1]) * 60;
  if (mMatch) total += parseInt(mMatch[1]);
  return total;
}

// ── Time Field Pill + Popover ────────────────────────────────────────────────

function TimeFieldPill({
  label,
  value,
  presets,
  isOpen,
  onToggle,
  onChange,
  autoTrackedNote,
}: {
  label: string;
  value: string;
  presets: { label: string; value: string }[];
  isOpen: boolean;
  onToggle: () => void;
  onChange: (value: string) => void;
  autoTrackedNote?: string;
}) {
  const pillRef = useRef<HTMLDivElement>(null);
  const displayValue = formatDisplayMinutes(value);
  const hasValue = displayValue !== "—";

  return (
    <div className="relative" ref={pillRef}>
      <button
        type="button"
        onClick={onToggle}
        className={`flex flex-col items-start rounded-md cursor-pointer border transition-colors ${
          isOpen
            ? "bg-[#EEF3FB] border-[#7B9ED9]"
            : "bg-black/[0.03] border-black/[0.06] hover:border-black/[0.12]"
        }`}
        style={{ padding: "4px 10px", borderWidth: "0.5px" }}
      >
        <span className="text-[9px] uppercase tracking-[0.07em] text-black/25 leading-none">
          {label}
        </span>
        <span className={`text-[13px] font-medium leading-tight ${hasValue ? "text-[#2c2a35]" : "text-black/20"}`}>
          {displayValue}
        </span>
      </button>

      {isOpen && (
        <div
          className="absolute left-0 bg-white border border-black/[0.08] rounded-lg shadow-lg z-30"
          style={{ top: "calc(100% + 6px)", width: 240, padding: 10, borderWidth: "0.5px" }}
        >
          <div className="text-[10px] uppercase text-black/25 tracking-[0.05em] mb-2">
            {label === "Estimated" ? "Estimated time" : "Time worked"}
          </div>
          <div className="flex flex-wrap gap-1 mb-2">
            {presets.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => onChange(value === p.value ? "" : p.value)}
                className={`px-2.5 py-1 rounded-md text-[12px] cursor-pointer transition-colors border ${
                  value === p.value
                    ? "bg-[#EEF3FB] border-[#7B9ED9] text-[#3D6FCC]"
                    : "bg-black/[0.03] border-black/[0.06] text-black/40 hover:bg-black/[0.06]"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <input
            type="text"
            value={presets.some((p) => p.value === value) ? "" : (() => {
              const n = parseInt(value);
              if (!value || isNaN(n) || n <= 0) return "";
              const h = Math.floor(n / 60);
              const m = n % 60;
              if (h > 0 && m > 0) return `${h}h ${m}m`;
              if (h > 0) return `${h}h`;
              return `${n}m`;
            })()}
            onChange={(e) => {
              const total = parseTimeInput(e.target.value);
              if (total > 0 && total <= MAX_ESTIMATE_MINUTES) {
                onChange(total.toString());
              } else if (e.target.value === "") {
                onChange("");
              }
            }}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              if (!raw) return;
              let total = parseTimeInput(raw);
              if (total === 0) total = parseInt(raw);
              if (!isNaN(total) && total > 0 && total <= MAX_ESTIMATE_MINUTES) {
                onChange(total.toString());
              }
            }}
            placeholder="custom (e.g. 1h 30m)"
            className="w-full bg-black/[0.03] border border-black/[0.06] rounded-md px-2.5 py-1.5 text-[12px] text-black/50 placeholder-black/20 outline-none focus:border-[#7B9ED9]/40"
          />
          {autoTrackedNote && (
            <div className="text-[10px] text-black/25 mt-1.5">
              {autoTrackedNote}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Overlay ─────────────────────────────────────────────────────────────

export default function TaskDetailOverlay({
  task,
  projects,
  onClose,
  onSave,
  onToggle,
  onDelete,
  onStartFocus,
  workedMinutes = 0,
  onSetWorkedMinutes,
  autoTrackedMinutes,
}: TaskDetailOverlayProps) {
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? "");
  const [estimate, setEstimate] = useState(task.estimated_minutes?.toString() ?? "");
  const [projectId, setProjectId] = useState(task.project_id?.toString() ?? "");
  const [priority, setPriority] = useState(task.priority);
  const [dateScheduled, setDateScheduled] = useState(task.date_scheduled ?? "");
  const [worked, setWorked] = useState(workedMinutes > 0 ? workedMinutes.toString() : "");
  const [dayBreakdown, setDayBreakdown] = useState<{ date: string; minutes: number }[]>([]);
  const [openPopover, setOpenPopover] = useState<"estimate" | "worked" | null>(null);

  // Recurrence
  const parsedRecurrence = parseRecurrence(task.recurrence ?? null);
  const isTemplate = task.recurrence != null && task.recurrence_source_id == null;
  const isInstance = task.recurrence_source_id != null;
  const [recurrenceFreq, setRecurrenceFreq] = useState<string>(parsedRecurrence?.freq ?? "none");
  const [recurrenceDay, setRecurrenceDay] = useState<number>(parsedRecurrence?.day ?? 1);

  const saveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Load per-day breakdown
  useEffect(() => {
    getWorkedMinutesByDate(task.id).then(setDayBreakdown).catch(() => {});
  }, [task.id]);

  // Close popover on click outside
  const handleModalClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (openPopover && !target.closest("[data-time-pill]")) {
      setOpenPopover(null);
    }
  }, [openPopover]);

  function buildUpdate(overrides: Record<string, string> = {}) {
    const t = overrides.title ?? title;
    const p = overrides.projectId ?? projectId;
    const e = overrides.estimate ?? estimate;
    const pr = overrides.priority ?? priority;
    const n = overrides.notes ?? notes;
    const ds = overrides.dateScheduled ?? dateScheduled;

    const trimmedTitle = t.trim();
    if (!trimmedTitle) return null;

    let est: number | null = null;
    if (e) {
      est = parseInt(e);
      if (isNaN(est) || est < 1 || est > MAX_ESTIMATE_MINUTES) est = null;
    }

    return {
      id: task.id,
      title: trimmedTitle,
      projectId: p ? parseInt(p) : null,
      estimatedMinutes: est,
      priority: pr,
      notes: n.trim() || null,
      dateScheduled: ds || null,
    };
  }

  function debouncedSave(overrides: Record<string, string> = {}) {
    if (saveRef.current) clearTimeout(saveRef.current);
    saveRef.current = setTimeout(() => {
      const update = buildUpdate(overrides);
      if (update) onSave(update);
    }, 600);
  }

  function flushSave() {
    if (saveRef.current) {
      clearTimeout(saveRef.current);
      saveRef.current = null;
    }
    const update = buildUpdate();
    if (update) onSave(update);
  }

  useEffect(() => {
    return () => {
      if (saveRef.current) clearTimeout(saveRef.current);
    };
  }, []);

  function handleClose() {
    flushSave();
    onClose();
  }

  const autoTrackedNote = autoTrackedMinutes && autoTrackedMinutes > 0
    ? `+ ${formatDisplayMinutes(autoTrackedMinutes.toString())} tracked automatically`
    : undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={handleClose}
    >
      <div className="absolute inset-0 bg-black/30" />
      <div
        ref={modalRef}
        className="relative bg-white rounded-xl shadow-xl w-[540px] max-h-[85vh] overflow-y-auto animate-scale-in"
        onClick={(e) => { e.stopPropagation(); handleModalClick(e); }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            if (openPopover) { setOpenPopover(null); } else { handleClose(); }
          }
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-6 pt-6 pb-3">
          {onToggle && (
            <button
              onClick={() => {
                onToggle(task);
                onClose();
              }}
              className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 cursor-pointer ${
                task.status === "done"
                  ? "bg-[#4a9e6e] border-[#4a9e6e]"
                  : "border-black/20"
              }`}
            >
              {task.status === "done" && (
                <span className="text-white text-xs">✓</span>
              )}
            </button>
          )}
          <input
            type="text"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              debouncedSave({ title: e.target.value });
            }}
            maxLength={MAX_TITLE_LENGTH}
            className="flex-1 text-[16px] font-medium text-[#2c2a35] bg-transparent border-none outline-none"
          />
          {onStartFocus && task.status !== "done" && (
            <button
              onClick={() => {
                flushSave();
                onStartFocus(task);
                onClose();
              }}
              className="w-8 h-8 rounded-full bg-[#7B9ED9] text-white hover:bg-[#6889c4] cursor-pointer flex items-center justify-center flex-shrink-0"
              title="Start focus"
            >
              <svg width="8" height="10" viewBox="0 0 8 10" fill="white" className="ml-[1px]">
                <path d="M0 0v10l8-5z" />
              </svg>
            </button>
          )}
          <button
            onClick={handleClose}
            className="text-black/25 hover:text-black/50 cursor-pointer text-[16px] flex-shrink-0"
          >
            ✕
          </button>
        </div>

        {/* Meta row */}
        <div className="flex items-center flex-wrap gap-2 px-6 pb-4">
          <select
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              debouncedSave({ projectId: e.target.value });
            }}
            className="bg-black/[0.04] border border-black/[0.08] rounded-md px-2 py-1 text-[12px] text-black/50 outline-none cursor-pointer"
          >
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="relative flex items-center gap-1">
            <button
              type="button"
              onClick={(e) => {
                const input = (e.currentTarget.nextElementSibling as HTMLInputElement);
                input?.showPicker?.();
                input?.focus();
              }}
              className="bg-black/[0.04] border border-black/[0.08] rounded-md px-2 py-1 text-[12px] text-black/50 cursor-pointer hover:border-black/[0.14]"
            >
              {dateScheduled
                ? new Date(dateScheduled + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })
                : "—"}
            </button>
            <input
              type="date"
              value={dateScheduled}
              onChange={(e) => {
                setDateScheduled(e.target.value);
                debouncedSave({ dateScheduled: e.target.value });
              }}
              className="absolute opacity-0 w-0 h-0 pointer-events-none"
              tabIndex={-1}
            />
            {dateScheduled && (
              <button
                type="button"
                onClick={() => {
                  setDateScheduled("");
                  debouncedSave({ dateScheduled: "" });
                }}
                className="text-[11px] text-black/25 hover:text-black/50 cursor-pointer"
                title="Clear date"
              >
                ✕
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              const next = priority === "high" ? "medium" : "high";
              setPriority(next);
              debouncedSave({ priority: next });
            }}
            className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] cursor-pointer border ${
              priority === "high"
                ? "bg-[#d95f5f]/10 border-[#d95f5f]/25 text-[#d95f5f]"
                : "bg-black/[0.04] border-black/[0.08] text-black/45"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                priority === "high" ? "bg-[#d95f5f]" : "bg-black/20"
              }`}
            />
            High
          </button>

          {/* Divider */}
          <div className="w-px h-5 bg-black/[0.08]" />

          {/* Time pills */}
          <div data-time-pill>
            <TimeFieldPill
              label="Estimated"
              value={estimate}
              presets={ESTIMATE_PRESETS}
              isOpen={openPopover === "estimate"}
              onToggle={() => setOpenPopover(openPopover === "estimate" ? null : "estimate")}
              onChange={(val) => {
                setEstimate(val);
                debouncedSave({ estimate: val });
              }}
            />
          </div>
          {onSetWorkedMinutes && (
            <div data-time-pill>
              <TimeFieldPill
                label="Worked"
                value={worked}
                presets={WORKED_PRESETS}
                isOpen={openPopover === "worked"}
                onToggle={() => setOpenPopover(openPopover === "worked" ? null : "worked")}
                onChange={(val) => {
                  setWorked(val);
                  if (val) {
                    const n = parseInt(val);
                    if (!isNaN(n) && n > 0) onSetWorkedMinutes(task.id, n);
                  }
                }}
                autoTrackedNote={autoTrackedNote}
              />
            </div>
          )}
        </div>

        {/* Recurrence control */}
        {!isInstance && (
          <div className="px-6 pb-3">
            <label className="text-[10px] uppercase tracking-[0.08em] text-black/25 mb-1.5 block">
              Repeat
            </label>
            <div className="flex items-center gap-2">
              <select
                value={recurrenceFreq}
                onChange={(e) => {
                  const freq = e.target.value;
                  setRecurrenceFreq(freq);
                  if (freq === "none") {
                    setTaskRecurrence(task.id, null).catch(() => {});
                  } else if (freq === "weekly") {
                    setTaskRecurrence(task.id, serializeRecurrence({ freq: "weekly", day: recurrenceDay })).catch(() => {});
                  } else {
                    setTaskRecurrence(task.id, serializeRecurrence({ freq: freq as "daily" | "weekdays" })).catch(() => {});
                  }
                }}
                className="bg-black/[0.04] border border-black/[0.08] rounded-md px-2 py-1 text-[12px] text-black/50 outline-none cursor-pointer"
              >
                <option value="none">None</option>
                <option value="daily">Daily</option>
                <option value="weekdays">Weekdays</option>
                <option value="weekly">Weekly</option>
              </select>
              {recurrenceFreq === "weekly" && (
                <select
                  value={recurrenceDay}
                  onChange={(e) => {
                    const day = parseInt(e.target.value);
                    setRecurrenceDay(day);
                    setTaskRecurrence(task.id, serializeRecurrence({ freq: "weekly", day })).catch(() => {});
                  }}
                  className="bg-black/[0.04] border border-black/[0.08] rounded-md px-2 py-1 text-[12px] text-black/50 outline-none cursor-pointer"
                >
                  <option value={0}>Sunday</option>
                  <option value={1}>Monday</option>
                  <option value={2}>Tuesday</option>
                  <option value={3}>Wednesday</option>
                  <option value={4}>Thursday</option>
                  <option value={5}>Friday</option>
                  <option value={6}>Saturday</option>
                </select>
              )}
              {isTemplate && (
                <span className="text-[10px] text-black/25">Template — instances created on daily plan load</span>
              )}
            </div>
          </div>
        )}
        {isInstance && (
          <div className="px-6 pb-3">
            <span className="text-[10px] text-black/25">Recurring task instance</span>
          </div>
        )}

        {/* Per-day breakdown */}
        {dayBreakdown.length > 1 && (
          <div className="px-6 pb-3">
            <label className="text-[10px] uppercase tracking-[0.08em] text-black/25 mb-1 block">
              Worked on
            </label>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5">
              {dayBreakdown.map((d) => (
                <span key={d.date} className="text-[11px] text-black/35">
                  {new Date(d.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                  {" "}
                  <span className="text-black/50">{d.minutes}m</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
        <div className="px-6 pb-5">
          <label className="text-[10px] uppercase tracking-widest text-black/30 mb-1.5 block">
            Notes
          </label>
          <textarea
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              debouncedSave({ notes: e.target.value });
            }}
            maxLength={MAX_NOTES_LENGTH}
            placeholder="Add notes..."
            rows={5}
            className="w-full bg-[#f5f4f0] border border-black/[0.06] rounded-md px-3 py-2.5 text-[13px] text-black/55 placeholder-black/20 resize-none leading-relaxed outline-none focus:border-[#7B9ED9]/30"
          />
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-6 py-3 border-t border-black/[0.06]">
          <span className="text-[10px] text-black/20 flex-1">
            Auto-saved
          </span>
          {onDelete && (
            <button
              onClick={() => {
                onDelete(task.id);
                onClose();
              }}
              className="text-[11px] text-[#d95f5f]/50 hover:text-[#d95f5f] cursor-pointer"
            >
              Delete task
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
