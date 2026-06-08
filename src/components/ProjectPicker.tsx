import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import type { Project } from "../types";
import ProjectGlyph from "./ProjectGlyph";
import { useCustomIcons } from "../hooks/useCustomIcons";

interface ProjectPickerProps {
  value: string; // project id as string, or "" for —
  projects: Project[];
  onChange: (value: string) => void;
}

export default function ProjectPicker({ value, projects, onChange }: ProjectPickerProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Hover tooltip — reveals the full objective name for a truncated row.
  // Same float-above-everything pattern as the popover (fixed coords +
  // createPortal) and the same visual tokens as TaskCard's project
  // tooltip: bg-elevated, 0.5px border-soft, var(--shadow-card).
  const tipRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ project: Project; top: number; left: number } | null>(null);

  // Anchor rect of the currently hovered row, kept so the tooltip can be
  // re-measured once its real width is known (the first paint uses a
  // fallback width).
  const tipAnchorRef = useRef<DOMRect | null>(null);

  const placeTip = useCallback((project: Project, rect: DOMRect) => {
    const tipEl = tipRef.current;
    const tipWidth = tipEl?.offsetWidth ?? 280;
    const tipHeight = tipEl?.offsetHeight ?? 40;
    // Prefer to the right of the row; flip left if it would overflow.
    const gap = 8;
    let left = rect.right + gap;
    if (left + tipWidth > window.innerWidth - 8) {
      left = Math.max(8, rect.left - gap - tipWidth);
    }
    const top = Math.min(
      Math.max(rect.top + rect.height / 2 - tipHeight / 2, 8),
      window.innerHeight - tipHeight - 8
    );
    setTip({ project, top, left });
  }, []);

  const showTip = useCallback((project: Project, rowEl: HTMLElement) => {
    const rect = rowEl.getBoundingClientRect();
    tipAnchorRef.current = rect;
    placeTip(project, rect);
  }, [placeTip]);

  // Snap to the real tooltip width on the next frame, after the element
  // has mounted (first paint uses the fallback width).
  useEffect(() => {
    if (!tip || !tipAnchorRef.current) return;
    const raf = requestAnimationFrame(() => {
      if (tipAnchorRef.current) placeTip(tip.project, tipAnchorRef.current);
    });
    return () => cancelAnimationFrame(raf);
  }, [tip?.project, placeTip]);

  // Tooltip lives only while the popover is open.
  useEffect(() => {
    if (!open) setTip(null);
  }, [open]);

  const selected = value ? projects.find((p) => String(p.id) === value) ?? null : null;
  const { byId: iconsById } = useCustomIcons();

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
            <span className="mt-[3px]">
              <ProjectGlyph project={selected} iconsById={iconsById} size={14} />
            </span>
            <span className="flex-1 min-w-0 text-[13px] font-normal text-fg-secondary leading-[1.4] line-clamp-3">
              {selected.name}
            </span>
          </>
        ) : (
          <span className="flex-1 text-[13px] font-normal text-fg-muted">—</span>
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
          data-portal-popover
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
            <span className="flex-1 truncate">—</span>
          </button>
          {projects.map((p) => {
            const isSelected = String(p.id) === value;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => pick(String(p.id))}
                onMouseEnter={(e) => showTip(p, e.currentTarget)}
                onMouseLeave={() => setTip(null)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer transition-colors text-[13px] font-normal ${
                  isSelected
                    ? "bg-accent-blue-soft text-accent-blue-soft-fg"
                    : "hover:bg-overlay-hover text-fg-secondary"
                }`}
              >
                <ProjectGlyph project={p} iconsById={iconsById} size={14} />
                <span className="flex-1 truncate">{p.name}</span>
              </button>
            );
          })}
        </div>,
        document.body
      )}

      {/* Full-name tooltip for a hovered (truncated) option. Splits a
          trailing " - " qualifier onto a smaller second line, matching
          TaskCard's project tooltip. Same tokens: bg-elevated, 0.5px
          border-soft, var(--shadow-card). */}
      {tip && createPortal(
        <div
          ref={tipRef}
          className="fixed z-[70] bg-elevated rounded-lg px-3 py-2 max-w-[300px] pointer-events-none animate-scale-in"
          style={{
            top: tip.top,
            left: tip.left,
            border: "0.5px solid var(--border-soft)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          {(() => {
            const sep = tip.project.name.lastIndexOf(" - ");
            const primary = sep > 0 ? tip.project.name.slice(0, sep) : tip.project.name;
            const qualifier = sep > 0 ? tip.project.name.slice(sep + 3) : "";
            return (
              <div className="flex items-start gap-2">
                <span className="mt-[2px] shrink-0">
                  <ProjectGlyph project={tip.project} iconsById={iconsById} size={14} />
                </span>
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-fg leading-[1.3] whitespace-normal break-words">
                    {primary}
                  </div>
                  {qualifier && (
                    <div className="text-[11px] text-fg-faded leading-[1.3] mt-0.5 whitespace-normal break-words">
                      {qualifier}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </div>,
        document.body
      )}
    </div>
  );
}
