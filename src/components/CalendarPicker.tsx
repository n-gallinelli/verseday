import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { localDateIso } from "../utils/dates";

interface CalendarPickerProps {
  value: string; // YYYY-MM-DD or ""
  onChange: (date: string) => void;
  onClear?: () => void;
  placeholder?: string;
  // When provided, renders as a label-inside pill (uppercase label on top,
  // value below) so date pickers can sit alongside time pills as a
  // visually consistent set. When omitted, falls back to the legacy
  // single-line pill (no label).
  label?: string;
}

const DAY_NAMES = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

function formatMonthYear(year: number, month: number): string {
  return new Date(year, month).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function toIso(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export default function CalendarPicker({
  value,
  onChange,
  onClear,
  placeholder = "No date",
  label,
}: CalendarPickerProps) {
  const [open, setOpen] = useState(false);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Calendar state: default to selected date's month or today
  const initDate = value ? new Date(value + "T00:00:00") : new Date();
  const [viewYear, setViewYear] = useState(initDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(initDate.getMonth());

  const todayIso = localDateIso(new Date()); // #19 — local tz; toISOString() picks the wrong "today" in the evening

  // Calculate popover position relative to viewport. Clamps on both
  // axes so the calendar (and especially its bottom-stack of "push
  // back" quick actions) never overflows off-screen — previously the
  // bottom rows could be clipped when the trigger sat low and there
  // wasn't quite enough space above to flip the picker.
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const calHeight = 340;
    const calWidth = 290;
    const spaceBelow = window.innerHeight - rect.bottom;
    let top = spaceBelow < calHeight
      ? rect.top - calHeight - 4
      : rect.bottom + 4;
    // Clamp vertically: keep at least 8px from both viewport edges.
    top = Math.max(8, Math.min(top, window.innerHeight - calHeight - 8));
    // Clamp horizontally too.
    let left = Math.min(rect.left, window.innerWidth - calWidth - 8);
    left = Math.max(8, left);
    setPopoverPos({ top, left });
  }, []);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (
        containerRef.current && !containerRef.current.contains(target) &&
        popoverRef.current && !popoverRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  // Sync view when value changes externally
  useEffect(() => {
    if (value) {
      const d = new Date(value + "T00:00:00");
      setViewYear(d.getFullYear());
      setViewMonth(d.getMonth());
    }
  }, [value]);

  function prevMonth() {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(viewYear - 1);
    } else {
      setViewMonth(viewMonth - 1);
    }
  }

  function nextMonth() {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(viewYear + 1);
    } else {
      setViewMonth(viewMonth + 1);
    }
  }

  function selectDay(day: number) {
    onChange(toIso(viewYear, viewMonth, day));
    setOpen(false);
  }

  function pushBackDays(days: number) {
    const baseIso = value || todayIso;
    const d = new Date(baseIso + "T00:00:00");
    d.setDate(d.getDate() + days);
    onChange(localDateIso(d)); // #19 — local tz
    setOpen(false);
  }

  function pushBackMonth() {
    const baseIso = value || todayIso;
    const d = new Date(baseIso + "T00:00:00");
    d.setMonth(d.getMonth() + 1);
    onChange(localDateIso(d)); // #19 — local tz
    setOpen(false);
  }

  // Build calendar grid
  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDay = getFirstDayOfWeek(viewYear, viewMonth);
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  // Display label
  const displayLabel = value
    ? new Date(value + "T00:00:00").toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
    : placeholder;

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Pill: outer styled container holds the trigger (left) and a
          × clear affordance (right). The × wrapper reserves space
          when onClear is wired so width is constant; the × itself
          fades in only on pill hover (or when focused via keyboard)
          so the default state stays clean. Pill matches
          TimeFieldPill's label-inside style for visual consistency
          across DATES / TIME sections in the task detail overlay. */}
      <div
        className={`group/pill flex items-stretch w-full rounded-md transition-colors ${
          open
            ? "bg-input border-accent-blue"
            : "bg-input border-line-hairline hover:border-line-medium"
        }`}
        style={{ borderWidth: "0.5px", borderStyle: "solid" }}
      >
        <button
          ref={triggerRef}
          type="button"
          onClick={() => {
            if (!open) updatePosition();
            setOpen(!open);
          }}
          className={`flex-1 min-w-0 cursor-pointer text-left ${
            label ? "flex flex-col items-start gap-[3px]" : "flex items-center"
          }`}
          style={{
            padding: label ? "4px 4px 4px 10px" : "4px 4px 4px 12px",
          }}
        >
          {label && (
            <span className="text-[9px] uppercase tracking-[0.07em] text-fg-faded leading-none">
              {label}
            </span>
          )}
          <span
            className={`text-[12px] font-medium leading-[1.2] truncate ${
              value ? "text-fg" : "text-fg-disabled"
            }`}
          >
            {displayLabel}
          </span>
        </button>
        {onClear && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClear();
              setOpen(false);
            }}
            className={`w-7 flex items-center justify-center cursor-pointer text-fg-faded hover:text-fg-secondary text-[11px] leading-none transition-opacity ${
              value
                ? "opacity-0 pointer-events-none group-hover/pill:opacity-100 group-hover/pill:pointer-events-auto focus:opacity-100 focus:pointer-events-auto"
                : "opacity-0 pointer-events-none"
            }`}
            title="Clear date"
            aria-hidden={!value}
            tabIndex={value ? 0 : -1}
          >
            ✕
          </button>
        )}
      </div>

      {/* Calendar popover — portaled to body to escape overflow/transform clipping */}
      {open && popoverPos && createPortal(
        <div
          ref={popoverRef}
          className="fixed z-[100] bg-elevated rounded-lg p-4 animate-scale-in"
          style={{
            boxShadow: "var(--shadow-card)",
            border: "0.5px solid var(--border-soft)",
            minWidth: 280,
            top: popoverPos.top,
            left: popoverPos.left,
          }}
        >
          {/* Month/year header */}
          <div className="flex items-center justify-between mb-3">
            <button
              type="button"
              onClick={prevMonth}
              className="w-5 h-5 flex items-center justify-center rounded text-fg-muted hover:text-fg hover:bg-overlay-hover cursor-pointer"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M6.5 1.5L3 5l3.5 3.5" />
              </svg>
            </button>
            <span className="text-[14px] font-medium text-fg">
              {formatMonthYear(viewYear, viewMonth)}
            </span>
            <button
              type="button"
              onClick={nextMonth}
              className="w-5 h-5 flex items-center justify-center rounded text-fg-muted hover:text-fg hover:bg-overlay-hover cursor-pointer"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M3.5 1.5L7 5l-3.5 3.5" />
              </svg>
            </button>
          </div>

          {/* Day-of-week row */}
          <div className="grid grid-cols-7 mb-2">
            {DAY_NAMES.map((d) => (
              <div
                key={d}
                className="text-center text-[11px] uppercase text-fg-muted py-1"
              >
                {d}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7">
            {cells.map((day, i) => {
              if (day === null) {
                return <div key={`empty-${i}`} className="w-9 h-9" />;
              }

              const iso = toIso(viewYear, viewMonth, day);
              const isToday = iso === todayIso;
              const isSelected = iso === value;

              const baseCell = "w-9 h-9 rounded-full text-[13px] cursor-pointer transition-colors flex items-center justify-center";
              if (isSelected) {
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => selectDay(day)}
                    className={`${baseCell} text-fg-on-accent`}
                    style={{ backgroundColor: "var(--calendar-selected-bg)" }}
                  >
                    {day}
                  </button>
                );
              }
              if (isToday) {
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => selectDay(day)}
                    className={`${baseCell} font-medium`}
                    style={{
                      boxShadow: "inset 0 0 0 2px var(--calendar-today-ring)",
                      color: "var(--calendar-today-ring)",
                    }}
                  >
                    {day}
                  </button>
                );
              }
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => selectDay(day)}
                  className={`${baseCell} text-fg`}
                  style={{ backgroundColor: "transparent" }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--calendar-day-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                >
                  {day}
                </button>
              );
            })}
          </div>

          {/* Push-back quick actions */}
          <div className="mt-3 pt-3 border-t border-line-hairline flex flex-col gap-1">
            <button
              type="button"
              onClick={() => pushBackDays(7)}
              className="text-[12px] text-fg-secondary hover:text-fg hover:bg-overlay-hover rounded-md px-2 py-1.5 text-left cursor-pointer transition-colors"
            >
              Push back one week
            </button>
            <button
              type="button"
              onClick={() => pushBackDays(14)}
              className="text-[12px] text-fg-secondary hover:text-fg hover:bg-overlay-hover rounded-md px-2 py-1.5 text-left cursor-pointer transition-colors"
            >
              Push back two weeks
            </button>
            <button
              type="button"
              onClick={pushBackMonth}
              className="text-[12px] text-fg-secondary hover:text-fg hover:bg-overlay-hover rounded-md px-2 py-1.5 text-left cursor-pointer transition-colors"
            >
              Push back a month
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
