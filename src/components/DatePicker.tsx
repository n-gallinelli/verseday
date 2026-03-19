import { useState, useEffect, useRef } from "react";

interface DatePickerProps {
  selectedDate: string; // YYYY-MM-DD
  onSelect: (date: string) => void;
  onClose: () => void;
}

const DAY_HEADERS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function toIso(d: Date): string {
  return d.toISOString().split("T")[0];
}

export default function DatePicker({
  selectedDate,
  onSelect,
  onClose,
}: DatePickerProps) {
  const initial = new Date(selectedDate + "T00:00:00");
  const [viewYear, setViewYear] = useState(initial.getFullYear());
  const [viewMonth, setViewMonth] = useState(initial.getMonth());
  const ref = useRef<HTMLDivElement>(null);

  const todayStr = toIso(new Date());

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

  return (
    <div
      ref={ref}
      className="absolute top-full mt-1 right-0 z-30 bg-white border border-black/[0.1] rounded-[10px] shadow-lg p-3 w-[252px] animate-scale-in"
    >
      {/* Month nav */}
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={prevMonth}
          className="w-6 h-6 rounded-md hover:bg-black/[0.05] flex items-center justify-center text-[12px] text-black/40 cursor-pointer"
        >
          ‹
        </button>
        <span className="text-[13px] font-medium text-[#2c2a35]">
          {monthLabel}
        </span>
        <button
          onClick={nextMonth}
          className="w-6 h-6 rounded-md hover:bg-black/[0.05] flex items-center justify-center text-[12px] text-black/40 cursor-pointer"
        >
          ›
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-0 mb-1">
        {DAY_HEADERS.map((d) => (
          <div
            key={d}
            className="text-center text-[10px] text-black/30 py-0.5"
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
                  ? "bg-[#7B9ED9] text-white"
                  : isToday
                    ? "bg-[#7B9ED9]/10 text-[#7B9ED9] font-medium"
                    : "text-[#2c2a35] hover:bg-black/[0.05]"
              }`}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>

      {/* Today shortcut */}
      <button
        onClick={() => {
          onSelect(todayStr);
          onClose();
        }}
        className="w-full mt-2 text-[11px] text-[#7B9ED9] cursor-pointer hover:underline text-center py-1"
      >
        Go to today
      </button>
    </div>
  );
}
