import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import type { Project } from "../types";

interface ProjectPickerProps {
  value: string; // project id as string, or "" for No project
  projects: Project[];
  onChange: (value: string) => void;
}

export default function ProjectPicker({ value, projects, onChange }: ProjectPickerProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const selected = value ? projects.find((p) => String(p.id) === value) ?? null : null;

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

  function pick(id: string) {
    onChange(id);
    setOpen(false);
  }

  return (
    <div className="relative w-full">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        className="w-full flex items-start gap-2 bg-elevated hover:bg-overlay-hover rounded-lg px-3 py-2 text-left cursor-pointer transition-colors"
        style={{ border: "0.5px solid var(--border-medium)" }}
      >
        {selected ? (
          <>
            <span
              className="w-2 h-2 rounded-full flex-shrink-0 mt-[6px]"
              style={{ backgroundColor: selected.color }}
            />
            <span className="flex-1 min-w-0 text-[13px] font-normal text-fg-secondary leading-[1.4] line-clamp-3">
              {selected.name}
            </span>
          </>
        ) : (
          <span className="flex-1 text-[13px] font-normal text-fg-muted">No project</span>
        )}
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-fg-muted flex-shrink-0 mt-[6px]"
        >
          <path d="M2 4l3 3 3-3" />
        </svg>
      </button>

      {open && pos && createPortal(
        <div
          ref={popoverRef}
          className="fixed z-[60] bg-elevated rounded-lg max-h-[440px] overflow-y-auto animate-scale-in"
          style={{
            top: pos.top,
            left: pos.left,
            width: pos.width,
            border: "0.5px solid var(--border-soft)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <button
            type="button"
            onClick={() => pick("")}
            className={`w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer transition-colors text-[13px] font-normal ${
              value === ""
                ? "bg-accent-blue-soft text-accent-blue-soft-fg"
                : "hover:bg-overlay-hover text-fg-secondary"
            }`}
          >
            <span className="flex-1 truncate">No project</span>
          </button>
          {projects.map((p) => {
            const isSelected = String(p.id) === value;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => pick(String(p.id))}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer transition-colors text-[13px] font-normal ${
                  isSelected
                    ? "bg-accent-blue-soft text-accent-blue-soft-fg"
                    : "hover:bg-overlay-hover text-fg-secondary"
                }`}
              >
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: p.color }}
                />
                <span className="flex-1 truncate">{p.name}</span>
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}
