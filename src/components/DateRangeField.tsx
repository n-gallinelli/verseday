import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { localDateIso, formatMonthDay, addDaysIso, addMonthsIso } from "../utils/dates";

// A single, mode-aware date field that mirrors itself across contexts:
//  - Task details open in "single" mode with an "Add end date" escape hatch.
//  - Objectives open in "range" mode with a "Single day" escape hatch.
// Fully controlled — the parent owns persistence (and any change events).
// All date math is local-tz (localDateIso / addDaysIso / addMonthsIso) so the
// today-ring and push-back shortcuts never hit the UTC off-by-one class.

export interface DateRangeValue {
  start: string | null; // YYYY-MM-DD or null
  end: string | null; // YYYY-MM-DD or null (the deadline / range end)
}

interface DateRangeFieldProps {
  value: DateRangeValue;
  onChange: (next: DateRangeValue) => void;
  /** Mode the picker opens in when the field is empty + which copy/escape
   *  hatch to show. "single" = task, "range" = project. */
  defaultMode: "single" | "range";
  /** Empty-state CTA copy: "Set day" (task) | "Set dates" (project). */
  emptyLabel: string;
  /** Show the "push back one week / two weeks / a month" shortcuts (task). */
  quickShortcuts?: boolean;
}

// Single-letter weekday header, Sunday-start — matches the mockup.
const DOW = ["S", "M", "T", "W", "T", "F", "S"];

function toIso(year: number, month: number, day: number): string {
  // Local construction (not toISOString) — see localDateIso.
  return localDateIso(new Date(year, month, day));
}

export default function DateRangeField({
  value,
  onChange,
  defaultMode,
  emptyLabel,
  quickShortcuts = false,
}: DateRangeFieldProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  // Active mode of the OPEN popover. Derived on open from the current value
  // (Q-A: range if an end exists, else single; fall back to defaultMode only
  // when empty), then user-toggleable via the escape hatches.
  const [mode, setMode] = useState<"single" | "range">(defaultMode);

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const anchor = value.start ?? value.end ?? localDateIso(new Date());
  const anchorDate = new Date(anchor + "T00:00:00");
  const [viewYear, setViewYear] = useState(anchorDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(anchorDate.getMonth());

  const todayIso = localDateIso(new Date());

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const calHeight = 360;
    const calWidth = 300;
    const spaceBelow = window.innerHeight - rect.bottom;
    let top = spaceBelow < calHeight ? rect.top - calHeight - 4 : rect.bottom + 4;
    top = Math.max(8, Math.min(top, window.innerHeight - calHeight - 8));
    let left = Math.min(rect.left, window.innerWidth - calWidth - 8);
    left = Math.max(8, left);
    setPos({ top, left });
  }, []);

  // Open: position, sync the view to the value, and resolve the start mode.
  function openPicker() {
    updatePosition();
    const a = value.start ?? value.end ?? todayIso;
    const d = new Date(a + "T00:00:00");
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
    const resolved =
      value.start == null && value.end == null
        ? defaultMode
        : value.end != null
          ? "range"
          : "single";
    setMode(resolved);
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      const t = e.target as Node;
      if (
        containerRef.current && !containerRef.current.contains(t) &&
        popoverRef.current && !popoverRef.current.contains(t)
      ) {
        setOpen(false);
      }
    }
    function reposition() { updatePosition(); }
    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, updatePosition]);

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1); }
    else setViewMonth((m) => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1); }
    else setViewMonth((m) => m + 1);
  }

  function handleDayClick(iso: string) {
    if (mode === "single") {
      onChange({ start: iso, end: null });
      setOpen(false);
      return;
    }
    // Range mode. Re-anchor when there's no start yet, the range is already
    // complete, or the click precedes the current start; otherwise close it.
    const { start, end } = value;
    if (start == null || end != null) {
      onChange({ start: iso, end: null });
    } else if (iso < start) {
      onChange({ start: iso, end: null });
    } else {
      onChange({ start, end: iso });
    }
  }

  function addEndDate() {
    // single → range. Keep the chosen day as start; next click sets the end.
    setMode("range");
  }
  function collapseToSingle() {
    // range → single. Keep the start day, drop the end.
    onChange({ start: value.start ?? value.end, end: null });
    setMode("single");
  }

  function pushBack(kind: "week" | "twoweeks" | "month") {
    const base = value.start ?? todayIso;
    const next = kind === "month" ? addMonthsIso(base, 1) : addDaysIso(base, kind === "week" ? 7 : 14);
    // Push-back keeps any existing end as-is (deadline unaffected).
    onChange({ start: next, end: value.end });
    setOpen(false);
  }

  function clearAll(e: React.MouseEvent) {
    e.stopPropagation();
    onChange({ start: null, end: null });
    setOpen(false);
  }

  // ── Trigger ────────────────────────────────────────────────────────────
  const isEmpty = value.start == null && value.end == null;
  const isRange = value.start != null && value.end != null && value.start !== value.end;

  const calIcon = (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
      <rect x="2" y="3" width="10" height="9" rx="1.5" />
      <path d="M2 5.5h10M4.5 1.5v2M9.5 1.5v2" />
    </svg>
  );

  const trigger = isEmpty ? (
    <button
      ref={triggerRef}
      type="button"
      onClick={openPicker}
      className="flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] text-fg-muted hover:text-fg-secondary cursor-pointer transition-colors"
      style={{ border: "1px dashed var(--border-medium)" }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
        <rect x="2" y="3" width="10" height="9" rx="1.5" />
        <path d="M2 5.5h10M4.5 1.5v2M9.5 1.5v2M7 7.5v3M5.5 9h3" />
      </svg>
      {emptyLabel}
    </button>
  ) : (
    <div
      className={`group/pill inline-flex items-stretch rounded-lg transition-colors ${
        open ? "border-accent-blue" : "border-line-soft hover:border-line-medium"
      }`}
      style={{ borderWidth: "0.5px", borderStyle: "solid", background: "var(--bg-elevated)" }}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={openPicker}
        className="flex items-center gap-2 pl-3 pr-2 py-2 text-[13px] text-fg cursor-pointer"
      >
        {calIcon}
        <span>{formatMonthDay(value.start ?? value.end)}</span>
        {isRange && (
          <>
            <svg width="14" height="11" viewBox="0 0 14 11" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-fg-muted">
              <path d="M1 5.5h11M8.5 2L12 5.5 8.5 9" />
            </svg>
            <span>{formatMonthDay(value.end)}</span>
          </>
        )}
      </button>
      <button
        type="button"
        onClick={clearAll}
        className="w-7 flex items-center justify-center cursor-pointer text-fg-faded hover:text-fg-secondary text-[11px] leading-none transition-opacity opacity-0 pointer-events-none group-hover/pill:opacity-100 group-hover/pill:pointer-events-auto focus:opacity-100 focus:pointer-events-auto"
        title="Clear date"
      >
        ✕
      </button>
    </div>
  );

  // ── Grid ───────────────────────────────────────────────────────────────
  const firstDow = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const monthLabel = new Date(viewYear, viewMonth).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  return (
    <div ref={containerRef} className="relative inline-block">
      {trigger}

      {open && pos && createPortal(
        <div
          ref={popoverRef}
          data-portal-popover
          className="fixed z-[100] bg-elevated rounded-xl p-4 animate-scale-in"
          style={{
            boxShadow: "var(--shadow-card)",
            border: "0.5px solid var(--border-soft)",
            width: 300,
            top: pos.top,
            left: pos.left,
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <span className="text-[15px] font-semibold text-fg">{monthLabel}</span>
            <div className="flex items-center gap-1">
              <button type="button" onClick={prevMonth} className="w-6 h-6 flex items-center justify-center rounded text-fg-muted hover:text-fg hover:bg-overlay-hover cursor-pointer">
                <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M6.5 1.5L3 5l3.5 3.5" /></svg>
              </button>
              <button type="button" onClick={nextMonth} className="w-6 h-6 flex items-center justify-center rounded text-fg-muted hover:text-fg hover:bg-overlay-hover cursor-pointer">
                <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3.5 1.5L7 5l-3.5 3.5" /></svg>
              </button>
            </div>
          </div>

          {/* Weekday row */}
          <div className="grid grid-cols-7 mb-1">
            {DOW.map((d, i) => (
              <div key={i} className="text-center text-[12px] text-fg-muted py-1">{d}</div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7">
            {cells.map((day, i) => {
              if (day === null) return <div key={`e-${i}`} className="h-9" />;
              const iso = toIso(viewYear, viewMonth, day);
              const { start, end } = value;
              const isStart = start != null && iso === start;
              const isEnd = end != null && iso === end;
              const isEndpoint = isStart || isEnd;
              const inBetween = start != null && end != null && iso > start && iso < end;
              const isToday = iso === todayIso;

              // Range band: light-blue fill on cells from start..end. Endpoints
              // round their outer corner; the filled circle sits on top.
              let bandClass = "";
              if (start != null && end != null && iso >= start && iso <= end) {
                bandClass = "bg-accent-blue-soft";
                if (isStart && !isEnd) bandClass += " rounded-l-full";
                if (isEnd && !isStart) bandClass += " rounded-r-full";
                if (isStart && isEnd) bandClass += " rounded-full";
              }

              return (
                <div key={day} className={`h-9 flex items-center justify-center ${bandClass}`}>
                  <button
                    type="button"
                    onClick={() => handleDayClick(iso)}
                    className={`w-9 h-9 rounded-full text-[13px] cursor-pointer flex items-center justify-center transition-colors ${
                      isEndpoint
                        ? "text-fg-on-accent font-medium"
                        : inBetween
                          ? "text-fg"
                          : isToday
                            ? "font-medium"
                            : "text-fg hover:bg-overlay-hover"
                    }`}
                    style={
                      isEndpoint
                        ? { backgroundColor: "var(--calendar-selected-bg)" }
                        : isToday && !inBetween
                          ? { boxShadow: "inset 0 0 0 2px var(--calendar-today-ring)", color: "var(--calendar-today-ring)" }
                          : undefined
                    }
                  >
                    {day}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Footer: escape hatch (+ summary / push-back) */}
          <div className="mt-3 pt-3 border-t border-line-hairline">
            {mode === "single" ? (
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={addEndDate}
                  className="flex items-center gap-2 text-[13px] text-accent-blue-soft-fg font-medium px-1 py-1.5 rounded-md hover:bg-overlay-hover cursor-pointer transition-colors"
                >
                  <svg width="14" height="12" viewBox="0 0 14 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                    <path d="M1 1v10M4 6h8M9 3l3 3-3 3" />
                  </svg>
                  Add end date
                </button>
                {quickShortcuts && (
                  <>
                    <button type="button" onClick={() => pushBack("week")} className="text-[12px] text-fg-secondary hover:text-fg hover:bg-overlay-hover rounded-md px-1 py-1.5 text-left cursor-pointer transition-colors">Push back one week</button>
                    <button type="button" onClick={() => pushBack("twoweeks")} className="text-[12px] text-fg-secondary hover:text-fg hover:bg-overlay-hover rounded-md px-1 py-1.5 text-left cursor-pointer transition-colors">Push back two weeks</button>
                    <button type="button" onClick={() => pushBack("month")} className="text-[12px] text-fg-secondary hover:text-fg hover:bg-overlay-hover rounded-md px-1 py-1.5 text-left cursor-pointer transition-colors">Push back a month</button>
                  </>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-fg-muted">
                  {value.start
                    ? value.end
                      ? `${formatMonthDay(value.start)} → ${formatMonthDay(value.end)}`
                      : "Pick end date"
                    : "Pick start date"}
                </span>
                <button
                  type="button"
                  onClick={collapseToSingle}
                  className="flex items-center gap-1.5 text-[13px] text-accent-blue-soft-fg font-medium px-1 py-1 rounded-md hover:bg-overlay-hover cursor-pointer transition-colors"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                    <rect x="2" y="3" width="10" height="9" rx="1.5" /><path d="M2 5.5h10M4.5 1.5v2M9.5 1.5v2" />
                  </svg>
                  Single day
                </button>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
