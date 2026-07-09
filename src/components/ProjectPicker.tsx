import {
  useState,
  useRef,
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import { createPortal } from "react-dom";
import type { Project } from "../types";
import ProjectGlyph from "./ProjectGlyph";
import { useCustomIcons } from "../hooks/useCustomIcons";
import { useObjectiveNameTooltip } from "./useObjectiveNameTooltip";

// Imperative handle so an external control (e.g. the Daily new-task input on
// Tab) can open the picker and drop keyboard focus onto its first option. This
// is an action, not derivable state, so it stays behind a ref instead of a
// controlled-open prop — ProjectPicker keeps owning its own open state.
export interface ProjectPickerHandle {
  openAndFocusFirst: () => void;
}

interface ProjectPickerProps {
  value: string; // project id as string, or "" for —
  projects: Project[];
  onChange: (value: string) => void;
  // Fired on every KEYBOARD-driven close (select via Enter, Esc, Tab) so the
  // opener can return focus (the Daily flow: select project → focus back in the
  // input → Enter adds the task). Mouse-outside close does NOT fire it. Optional
  // — consumers that don't pass it (TaskDetailOverlay) keep the old behavior.
  onReturnFocus?: () => void;
}

const ProjectPicker = forwardRef<ProjectPickerHandle, ProjectPickerProps>(
  function ProjectPicker({ value, projects, onChange, onReturnFocus }, ref) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  // Set when opened via the imperative handle so the mount effect moves focus to
  // the first option (not on mouse-open).
  const focusFirstRef = useRef(false);

  const selected = value ? projects.find((p) => String(p.id) === value) ?? null : null;
  const { byId: iconsById } = useCustomIcons();

  // Hover tooltip — reveals the full objective name for a truncated row.
  // Shared with the Quick-Add bar via useObjectiveNameTooltip.
  const { showTip, hideTip, tooltip } = useObjectiveNameTooltip(iconsById);

  // Tooltip lives only while the popover is open (rows that unmount on
  // close won't fire onMouseLeave).
  useEffect(() => {
    if (!open) hideTip();
  }, [open, hideTip]);

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

  // Open + focus the first option. updatePosition() BEFORE setOpen(true) — the
  // portal is gated on `open && pos`, and pos is null until measured (the mouse
  // path gets it via toggle()); skipping this would render nothing on keyboard-
  // open.
  useImperativeHandle(
    ref,
    () => ({
      openAndFocusFirst() {
        updatePosition();
        focusFirstRef.current = true;
        setOpen(true);
      },
    }),
    [updatePosition],
  );

  // After the popover mounts from an imperative open, move DOM focus to the
  // first option (the "—" no-project button). Focus IS the highlight — arrow
  // keys move it between the option buttons.
  useEffect(() => {
    if (open && focusFirstRef.current) {
      focusFirstRef.current = false;
      popoverRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    }
  }, [open]);

  // Keyboard nav inside the open popover. stopPropagation on every handled key
  // so a global ↑/↓ (e.g. day navigation) can't also fire. Enter is deliberately
  // NOT handled here — it rides the focused option button's native click →
  // pick(), keeping a single selection path.
  const handlePopoverKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        const items = Array.from(
          popoverRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [],
        );
        if (!items.length) return;
        const idx = items.findIndex((el) => el === document.activeElement);
        const delta = e.key === "ArrowDown" ? 1 : -1;
        const next =
          idx < 0 ? 0 : Math.min(Math.max(idx + delta, 0), items.length - 1);
        items[next]?.focus();
      } else if (e.key === "Escape" || e.key === "Tab") {
        // Both close without selecting and return focus to the opener.
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        onReturnFocus?.();
      }
    },
    [onReturnFocus],
  );

  function toggle() {
    if (!open) updatePosition();
    setOpen(!open);
  }

  function pick(id: string) {
    onChange(id);
    setOpen(false);
    // Single selection path for mouse AND keyboard (Enter rides native click).
    // Fires focus-return so the Daily "select → Enter again to add" flow works;
    // a no-op for consumers that don't pass onReturnFocus.
    onReturnFocus?.();
  }

  return (
    <div className="relative w-full">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        className="w-full flex items-start gap-2 bg-elevated hover:bg-overlay-hover rounded-lg px-3.5 py-2.5 text-left cursor-pointer transition-colors"
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
          onKeyDown={handlePopoverKeyDown}
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
            className={`w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer transition-colors text-[13px] font-normal focus:outline-none focus:ring-2 focus:ring-inset focus:ring-accent-blue ${
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
                onMouseLeave={hideTip}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer transition-colors text-[13px] font-normal focus:outline-none focus:ring-2 focus:ring-inset focus:ring-accent-blue ${
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

      {tooltip}
    </div>
  );
});

export default ProjectPicker;
