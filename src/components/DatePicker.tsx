import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { localDateIso } from "../utils/dates";

interface DatePickerProps {
  selectedDate: string; // YYYY-MM-DD
  onSelect: (date: string) => void;
  onClose: () => void;
  anchorRef?: React.RefObject<HTMLElement | null>;
}

const DAY_HEADERS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function toIso(d: Date): string {
  return localDateIso(d); // #19 — local component-building; toISOString() shifts the day in the evening
}

export default function DatePicker({
  selectedDate,
  onSelect,
  onClose,
  anchorRef,
}: DatePickerProps) {
  const parsed = new Date(selectedDate + "T00:00:00");
  const initial = isNaN(parsed.getTime()) ? new Date() : parsed;
  const [viewYear, setViewYear] = useState(initial.getFullYear());
  const [viewMonth, setViewMonth] = useState(initial.getMonth());
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const todayStr = toIso(new Date());

  const updatePosition = useCallback(() => {
    const anchor = anchorRef?.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const calHeight = 340;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow < calHeight ? rect.top - calHeight - 4 : rect.bottom + 4;
    const left = Math.min(rect.left, window.innerWidth - 270);
    setPos({ top, left });
  }, [anchorRef]);

  useEffect(() => {
    updatePosition();
  }, [updatePosition]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

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

  // Build calendar grid
  const firstDay = new Date(viewYear, viewMonth, 1);
  const startDow = firstDay.getDay(); // 0=Sun
  const mondayOffset = startDow === 0 ? 6 : startDow - 1; // shift to Monday start
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  const cells: (Date | null)[] = [];
  for (let i = 0; i < mondayOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(new Date(viewYear, viewMonth, d));
  }
  // Pad to full weeks
  while (cells.length % 7 !== 0) cells.push(null);

  const monthLabel = firstDay.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  if (!pos) return null;

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[100] bg-elevated border border-line-medium rounded-[10px] shadow-lg p-3 w-[252px] animate-scale-in"
      style={{ top: pos.top, left: pos.left }}
    >
      {/* Header zone — Today shortcut, split from the calendar body by a warm hairline */}
      <button
        onClick={() => {
          onSelect(todayStr);
          onClose();
        }}
        className="w-full pb-2 mb-1.5 border-b border-line-hairline-warm text-[11px] text-accent-orange-soft-fg cursor-pointer hover:underline text-center"
      >
        Go to today
      </button>

      {/* Month nav */}
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={prevMonth}
          className="w-6 h-6 rounded-md hover:bg-overlay-hover flex items-center justify-center text-[12px] text-fg-muted cursor-pointer"
        >
          ‹
        </button>
        <span className="text-[13px] font-medium text-fg">
          {monthLabel}
        </span>
        <button
          onClick={nextMonth}
          className="w-6 h-6 rounded-md hover:bg-overlay-hover flex items-center justify-center text-[12px] text-fg-muted cursor-pointer"
        >
          ›
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-0 mb-1">
        {DAY_HEADERS.map((d) => (
          <div
            key={d}
            className="text-center text-[10px] text-fg-faded py-0.5"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-0">
        {cells.map((date, i) => {
          if (!date) {
            return <div key={`empty-${i}`} className="w-[32px] h-[32px]" />;
          }
          const iso = toIso(date);
          const isSelected = iso === selectedDate;
          const isToday = iso === todayStr;

          return (
            <button
              key={iso}
              onClick={() => {
                onSelect(iso);
                onClose();
              }}
              className={`w-[32px] h-[32px] rounded-full flex items-center justify-center text-[12px] cursor-pointer transition-colors ${
                isSelected
                  ? "bg-accent-blue text-fg-on-accent"
                  : isToday
                    ? "bg-accent-blue-soft text-accent-blue-soft-fg font-medium"
                    : "text-fg hover:bg-overlay-hover"
              }`}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </div>,
    document.body
  );
}
