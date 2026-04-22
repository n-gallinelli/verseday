import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";

interface CalendarPickerProps {
  value: string; // YYYY-MM-DD or ""
  onChange: (date: string) => void;
  onClear?: () => void;
  placeholder?: string;
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

  const todayIso = new Date().toISOString().split("T")[0];

  // Calculate popover position relative to viewport
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const calHeight = 340;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow < calHeight
      ? rect.top - calHeight - 4
      : rect.bottom + 4;
    // Clamp left so calendar doesn't overflow right edge
    const left = Math.min(rect.left, window.innerWidth - 290);
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
    <div ref={containerRef} className="relative">
      {/* Trigger button */}
      <div className="flex items-center gap-1">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => {
            if (!open) updatePosition();
            setOpen(!open);
          }}
          className="bg-transparent border border-black/[0.08] rounded-[6px] px-[10px] py-1 text-[12px] text-black/40 font-normal cursor-pointer hover:border-black/[0.14]"
        >
          {displayLabel}
        </button>
        {value && onClear && (
          <button
            type="button"
            onClick={() => {
              onClear();
              setOpen(false);
            }}
            className="text-[11px] text-black/25 hover:text-black/50 cursor-pointer"
            title="Clear date"
          >
            ✕
          </button>
        )}
      </div>

      {/* Calendar popover — portaled to body to escape overflow/transform clipping */}
      {open && popoverPos && createPortal(
        <div
          ref={popoverRef}
          className="fixed z-[100] bg-white rounded-lg p-4 animate-scale-in"
          style={{
            boxShadow: "0 4px 16px rgba(0,0,0,0.10)",
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
              className="w-5 h-5 flex items-center justify-center rounded text-black/40 hover:text-black/70 hover:bg-black/[0.04] cursor-pointer"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M6.5 1.5L3 5l3.5 3.5" />
              </svg>
            </button>
            <span className="text-[14px] font-medium text-[#2c2a35]">
              {formatMonthYear(viewYear, viewMonth)}
            </span>
            <button
              type="button"
              onClick={nextMonth}
              className="w-5 h-5 flex items-center justify-center rounded text-black/40 hover:text-black/70 hover:bg-black/[0.04] cursor-pointer"
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
                className="text-center text-[11px] uppercase text-[#AAAAAA] py-1"
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

              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => selectDay(day)}
                  className={`w-9 h-9 rounded-full text-[13px] cursor-pointer transition-colors flex items-center justify-center ${
                    isSelected
                      ? "bg-[#6B84A3] text-white"
                      : isToday
                        ? "ring-2 ring-[#6B84A3] ring-inset text-[#6B84A3] font-medium"
                        : "text-[#2c2a35] hover:bg-[#F0F0ED]"
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
