import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { getWorkedMinutesByDate, setTaskRecurrence, parseRecurrence, serializeRecurrence } from "../db/queries";
import CalendarPicker from "./CalendarPicker";
import ProjectPicker from "./ProjectPicker";
import RichTextEditor from "./RichTextEditor";
import SimpleSelect from "./SimpleSelect";
import type { Task, Project } from "../types";

const MAX_TITLE_LENGTH = 200;
const MAX_ESTIMATE_MINUTES = 480;

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
  hideLabel = false,
}: {
  label: string;
  value: string;
  presets: { label: string; value: string }[];
  isOpen: boolean;
  onToggle: () => void;
  onChange: (value: string) => void;
  autoTrackedNote?: string;
  hideLabel?: boolean;
}) {
  const pillRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const [rawInput, setRawInput] = useState("");
  const displayValue = formatDisplayMinutes(value);
  const hasValue = displayValue !== "—";

  // Seed the custom-input field with the current value when the popover opens.
  useEffect(() => {
    if (!isOpen) return;
    if (presets.some((p) => p.value === value)) {
      setRawInput("");
      return;
    }
    const n = parseInt(value);
    if (!value || isNaN(n) || n <= 0) {
      setRawInput("");
      return;
    }
    const h = Math.floor(n / 60);
    const m = n % 60;
    if (h > 0 && m > 0) setRawInput(`${h}h ${m}m`);
    else if (h > 0) setRawInput(`${h}h`);
    else setRawInput(`${n}m`);
  }, [isOpen, value, presets]);

  useEffect(() => {
    if (!isOpen) {
      setPopoverPos(null);
      return;
    }
    function updatePosition() {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      const POPOVER_WIDTH = 240;
      const POPOVER_HEIGHT = 220;
      const flipUp = window.innerHeight - r.bottom < POPOVER_HEIGHT;
      const top = flipUp ? r.top - POPOVER_HEIGHT - 6 : r.bottom + 6;
      // Clamp left so popover doesn't overflow viewport edges
      const maxLeft = window.innerWidth - POPOVER_WIDTH - 8;
      const left = Math.max(8, Math.min(r.left, maxLeft));
      setPopoverPos({ top, left });
    }
    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [isOpen]);

  return (
    <div className="relative" ref={pillRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={onToggle}
        className={`rounded-md cursor-pointer border transition-colors ${
          hideLabel ? "flex items-center" : "flex flex-col items-start"
        } ${
          isOpen
            ? "bg-[#EEF3FB] border-[#7B9ED9]"
            : "bg-black/[0.03] border-black/[0.06] hover:border-black/[0.12]"
        }`}
        style={{ padding: hideLabel ? "5px 12px" : "4px 10px", borderWidth: "0.5px" }}
      >
        {!hideLabel && (
          <span className="text-[9px] uppercase tracking-[0.07em] text-black/25 leading-none">
            {label}
          </span>
        )}
        <span className={`text-[13px] font-medium leading-tight ${hasValue ? "text-[#2c2a35]" : "text-black/20"}`}>
          {displayValue}
        </span>
      </button>

      {isOpen && popoverPos && createPortal(
        <div
          data-time-pill
          className="fixed bg-white border border-black/[0.08] rounded-lg shadow-lg z-[60]"
          style={{
            top: popoverPos.top,
            left: popoverPos.left,
            width: 240,
            padding: 10,
            borderWidth: "0.5px",
          }}
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
            value={rawInput}
            onChange={(e) => {
              setRawInput(e.target.value);
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
        </div>,
        document.body
      )}
    </div>
  );
}

// ── Property Row (right rail) ────────────────────────────────────────────────

function PropertyRow({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div>
      <div className="uppercase [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] text-black/30 mb-1.5">
        {label}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {children}
      </div>
      {hint && <div className="text-[10px] text-black/25 mt-1.5">{hint}</div>}
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
  const [localStatus, setLocalStatus] = useState(task.status);
  const prevStatusRef = useRef(task.status);
  const justCompleted = localStatus === "done" && prevStatusRef.current !== "done";
  const [completionGlow, setCompletionGlow] = useState(false);
  useEffect(() => {
    if (localStatus === "done" && prevStatusRef.current !== "done") {
      setCompletionGlow(true);
      const t = setTimeout(() => setCompletionGlow(false), 2400);
      prevStatusRef.current = localStatus;
      return () => clearTimeout(t);
    }
    prevStatusRef.current = localStatus;
  }, [localStatus]);
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
  const [recurrenceInterval, setRecurrenceInterval] = useState<number>(parsedRecurrence?.interval ?? 1);

  const saveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Load per-day breakdown
  useEffect(() => {
    getWorkedMinutesByDate(task.id).then(setDayBreakdown).catch(() => {});
  }, [task.id]);

  // Close popover on click outside
  // Sync local status if parent refreshes the task object.
  useEffect(() => {
    setLocalStatus(task.status);
  }, [task.id, task.status]);

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
        className="relative bg-white rounded-[12px] w-[880px] max-w-[94vw] max-h-[88vh] flex flex-col overflow-hidden animate-scale-in"
        style={{ boxShadow: "0 8px 40px rgba(0,0,0,0.10), 0 2px 8px rgba(0,0,0,0.06)" }}
        onClick={(e) => { e.stopPropagation(); handleModalClick(e); }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            if (openPopover) { setOpenPopover(null); } else { handleClose(); }
          }
        }}
      >
        {completionGlow && (
          <div
            className="absolute top-0 left-0 right-0 h-[220px] pointer-events-none animate-completion-glow z-10"
            style={{
              background:
                "linear-gradient(to bottom, rgba(106,158,127,0.22) 0%, rgba(106,158,127,0.08) 55%, rgba(106,158,127,0) 100%)",
            }}
          />
        )}
        {/* Header strip — title hero */}
        <div className="flex items-center gap-3 px-8 pt-7 pb-6 border-b border-black/[0.04]">
          {onToggle && (
            <button
              onClick={() => {
                // Optimistic: flip locally so the UI updates without closing.
                setLocalStatus((prev) => (prev === "done" ? "todo" : "done"));
                onToggle(task);
              }}
              title={localStatus === "done" ? "Mark as not done" : "Mark complete"}
              className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 cursor-pointer transition-colors mt-[3px] ${
                localStatus === "done"
                  ? "bg-[#6A9E7F] border-[#6A9E7F] hover:bg-[#5a8a6e] hover:border-[#5a8a6e]"
                  : "border-black/25 hover:border-[#6A9E7F]"
              }`}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                stroke={localStatus === "done" ? "white" : "rgba(0,0,0,0.25)"}
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path
                  d="M2.5 6.2l2.5 2.3L9.5 3.7"
                  className={justCompleted ? "animate-check-draw" : ""}
                />
              </svg>
            </button>
          )}
          <textarea
            value={title}
            onChange={(e) => {
              const v = e.target.value.replace(/\n/g, "");
              setTitle(v);
              debouncedSave({ title: v });
            }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = el.scrollHeight + "px";
            }}
            ref={(el) => {
              if (el) {
                el.style.height = "auto";
                el.style.height = el.scrollHeight + "px";
              }
            }}
            rows={1}
            maxLength={MAX_TITLE_LENGTH}
            placeholder="Untitled task"
            className={`flex-1 min-w-0 text-[24px] font-medium bg-transparent border-none outline-none leading-tight placeholder-black/15 resize-none overflow-hidden transition-colors duration-150 ease-out ${
              localStatus === "done"
                ? "text-black/35 line-through"
                : "text-[#2c2a35]"
            }`}
          />
          {onStartFocus && localStatus !== "done" && (
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
            className="text-black/25 hover:text-black/50 cursor-pointer text-[16px] flex-shrink-0 w-7 h-7 flex items-center justify-center"
          >
            ✕
          </button>
        </div>

        {/* Body — split panel */}
        <div className="flex-1 flex min-h-0">
          {/* Left: Notes — work surface */}
          <div className="flex-1 min-w-0 px-8 py-7 overflow-y-auto">
            <div className="uppercase [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] text-black/30 mb-2">
              Notes
            </div>
            <RichTextEditor
              value={notes}
              onChange={(html) => {
                setNotes(html);
                debouncedSave({ notes: html });
              }}
              placeholder="Add notes..."
              className="w-full bg-white border border-black/[0.06] rounded-md px-3.5 py-3 text-[13px] text-black/65 leading-relaxed min-h-[380px] focus-within:border-[#7B9ED9]/30"
            />
          </div>

          {/* Right: Properties rail */}
          <div className="w-[320px] flex-shrink-0 border-l border-black/[0.06] bg-[#FAFAF7] px-6 py-7 overflow-y-auto space-y-6">
            <PropertyRow label="Project">
              <ProjectPicker
                value={projectId}
                projects={projects}
                onChange={(val) => {
                  setProjectId(val);
                  debouncedSave({ projectId: val });
                }}
              />
            </PropertyRow>

            <PropertyRow label="Date">
              <CalendarPicker
                value={dateScheduled}
                onChange={(date) => {
                  setDateScheduled(date);
                  debouncedSave({ dateScheduled: date });
                }}
                onClear={() => {
                  setDateScheduled("");
                  debouncedSave({ dateScheduled: "" });
                }}
              />
            </PropertyRow>

            <div>
              <div className="uppercase [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] text-black/30 mb-1.5">
                Time
              </div>
              <div className="flex items-stretch gap-1.5">
                <div data-time-pill>
                  <TimeFieldPill
                    label="Worked"
                    value={worked}
                    presets={WORKED_PRESETS}
                    isOpen={openPopover === "worked"}
                    onToggle={() => setOpenPopover(openPopover === "worked" ? null : "worked")}
                    onChange={(val) => {
                      setWorked(val);
                      if (onSetWorkedMinutes && val) {
                        const n = parseInt(val);
                        if (!isNaN(n) && n > 0) onSetWorkedMinutes(task.id, n);
                      }
                    }}
                    autoTrackedNote={autoTrackedNote}
                  />
                </div>
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
              </div>
            </div>

            {!isInstance && (
              <PropertyRow
                label="Repeat"
                hint={isTemplate ? "Template — instances created on daily plan load" : undefined}
              >
                <SimpleSelect
                  value={recurrenceFreq}
                  width="w-[140px]"
                  onChange={(freq) => {
                    setRecurrenceFreq(freq);
                    if (freq === "none") {
                      setTaskRecurrence(task.id, null).catch(() => {});
                    } else if (freq === "weekly") {
                      setTaskRecurrence(task.id, serializeRecurrence({ freq: "weekly", day: recurrenceDay, interval: recurrenceInterval })).catch(() => {});
                    } else {
                      setTaskRecurrence(task.id, serializeRecurrence({ freq: freq as "daily" | "weekdays" })).catch(() => {});
                    }
                  }}
                  options={[
                    { value: "none", label: "None" },
                    { value: "daily", label: "Daily" },
                    { value: "weekdays", label: "Weekdays" },
                    { value: "weekly", label: "Weekly" },
                  ]}
                />
                {recurrenceFreq === "weekly" && (
                  <>
                    <SimpleSelect
                      value={String(recurrenceInterval)}
                      width="w-[170px]"
                      onChange={(v) => {
                        const interval = parseInt(v);
                        setRecurrenceInterval(interval);
                        setTaskRecurrence(task.id, serializeRecurrence({ freq: "weekly", day: recurrenceDay, interval })).catch(() => {});
                      }}
                      options={[
                        { value: "1", label: "Every week" },
                        { value: "2", label: "Every other week" },
                        { value: "3", label: "Every 3 weeks" },
                        { value: "4", label: "Every 4 weeks" },
                        { value: "6", label: "Every 6 weeks" },
                      ]}
                    />
                    <SimpleSelect
                      value={String(recurrenceDay)}
                      width="w-[140px]"
                      onChange={(v) => {
                        const day = parseInt(v);
                        setRecurrenceDay(day);
                        setTaskRecurrence(task.id, serializeRecurrence({ freq: "weekly", day, interval: recurrenceInterval })).catch(() => {});
                      }}
                      options={[
                        { value: "0", label: "Sunday" },
                        { value: "1", label: "Monday" },
                        { value: "2", label: "Tuesday" },
                        { value: "3", label: "Wednesday" },
                        { value: "4", label: "Thursday" },
                        { value: "5", label: "Friday" },
                        { value: "6", label: "Saturday" },
                      ]}
                    />
                  </>
                )}
              </PropertyRow>
            )}
            {isInstance && (
              <div className="text-[10px] text-black/25">Recurring task instance</div>
            )}

            {dayBreakdown.length > 1 && (
              <PropertyRow label="Worked on">
                <div className="flex flex-wrap gap-1.5 w-full">
                  {dayBreakdown.map((d) => {
                    const maxMin = Math.max(...dayBreakdown.map((x) => x.minutes));
                    const barWidth = maxMin > 0 ? Math.max(12, Math.round((d.minutes / maxMin) * 100)) : 12;
                    return (
                      <div key={d.date} className="flex items-center gap-1.5 bg-white rounded-md px-2 py-1 border border-black/[0.04]">
                        <div
                          className="h-[3px] rounded-full bg-[#7B9ED9]"
                          style={{ width: `${barWidth}%`, minWidth: 8, maxWidth: 48 }}
                        />
                        <span className="text-[10px] text-black/35 whitespace-nowrap">
                          {new Date(d.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                        </span>
                        <span className="text-[10px] text-black/50 font-medium">{d.minutes}m</span>
                      </div>
                    );
                  })}
                </div>
              </PropertyRow>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-8 py-4 border-t border-black/[0.06]">
          <span className="text-[10px] text-black/20 flex-1">
            Auto-saved
          </span>
          {onDelete && (
            <button
              onClick={() => {
                onDelete(task.id);
                onClose();
              }}
              className="text-[#C0614A]/60 hover:text-[#C0614A] cursor-pointer p-2 rounded-md hover:bg-[#C0614A]/[0.08] transition-colors"
              title="Delete task"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 4h12M5.33 4V2.67a1.33 1.33 0 011.34-1.34h2.66a1.33 1.33 0 011.34 1.34V4M13 4v9.33a1.33 1.33 0 01-1.33 1.34H4.33A1.33 1.33 0 013 13.33V4" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
