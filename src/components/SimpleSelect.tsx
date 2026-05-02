import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";

interface Option {
  value: string;
  label: string;
}

interface SimpleSelectProps {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  placeholder?: string;
  width?: string; // e.g. "w-full" or "w-[120px]"
}

export default function SimpleSelect({
  value,
  options,
  onChange,
  placeholder,
  width = "w-full",
}: SimpleSelectProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value) ?? null;

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 6, left: r.left, width: r.width });
  }, []);

  useEffect(() => {
    if (!open) return;
    function handleDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (
        triggerRef.current?.contains(t) ||
        popoverRef.current?.contains(t)
      ) return;
      setOpen(false);
    }
    function reposition() { updatePosition(); }
    document.addEventListener("mousedown", handleDocClick);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("mousedown", handleDocClick);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, updatePosition]);

  function toggle() {
    if (!open) updatePosition();
    setOpen(!open);
  }

  function pick(v: string) {
    onChange(v);
    setOpen(false);
  }

  return (
    <div className={`relative ${width}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        className="w-full flex items-center gap-2 bg-elevated hover:bg-overlay-hover rounded-lg px-3 py-2 text-left cursor-pointer transition-colors"
        style={{ border: "0.5px solid var(--border-medium)" }}
      >
        <span
          className={`flex-1 truncate text-[13px] font-normal ${
            selected ? "text-fg-secondary" : "text-fg-muted"
          }`}
        >
          {selected ? selected.label : placeholder ?? ""}
        </span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-fg-muted flex-shrink-0"
        >
          <path d="M2 4l3 3 3-3" />
        </svg>
      </button>

      {open && pos && createPortal(
        <div
          ref={popoverRef}
          className="fixed z-[60] bg-elevated rounded-lg max-h-[320px] overflow-y-auto animate-scale-in"
          style={{
            top: pos.top,
            left: pos.left,
            width: pos.width,
            border: "0.5px solid var(--border-soft)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          {options.map((o) => {
            const isSelected = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => pick(o.value)}
                className={`w-full flex items-center px-3 py-2 text-left cursor-pointer transition-colors text-[13px] font-normal ${
                  isSelected
                    ? "bg-accent-blue-soft text-accent-blue-soft-fg"
                    : "hover:bg-overlay-hover text-fg-secondary"
                }`}
              >
                <span className="flex-1 truncate">{o.label}</span>
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}
