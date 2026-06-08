import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import type { Project } from "../types";
import ProjectGlyph from "./ProjectGlyph";

// Styled hover tooltip that reveals the full objective name for a
// truncated dropdown row. Shared by the Objective dropdown in
// TaskDetailOverlay (via ProjectPicker) and the global Quick-Add bar, so
// the two surfaces stay identical. Floats above everything via a portal
// to document.body (each Tauri webview has its own body, so the Quick-Add
// window portals into its own document — correct in both). Visual tokens
// mirror TaskCard's project tooltip: bg-elevated, 0.5px border-soft,
// var(--shadow-card).
//
// Usage: wire `showTip`/`hideTip` to each row's onMouseEnter/onMouseLeave,
// render `tooltip` once anywhere in the tree, and call `hideTip()` when the
// dropdown closes (rows that unmount on close won't fire onMouseLeave).
export function useObjectiveNameTooltip(iconsById: Map<number, string>) {
  const tipRef = useRef<HTMLDivElement>(null);
  // Live anchor element of the hovered row, kept (not a snapshotted rect)
  // so reposition reads a fresh getBoundingClientRect — dropdown lists are
  // internally scrollable, so the row can move under the tooltip.
  const tipAnchorRef = useRef<HTMLElement | null>(null);
  // eslint-disable-next-line no-restricted-syntax -- transient UI state, not a project cache: holds the row the user is hovering (an already-canonical Project handed in by the caller) plus its tooltip coords. Nothing here is a source of truth to read from the store.
  const [tip, setTip] = useState<{ project: Project; top: number; left: number } | null>(null);

  const placeTip = useCallback((project: Project, rowEl: HTMLElement) => {
    const rect = rowEl.getBoundingClientRect();
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
      window.innerHeight - tipHeight - 8,
    );
    setTip({ project, top, left });
  }, []);

  const showTip = useCallback(
    (project: Project, rowEl: HTMLElement) => {
      tipAnchorRef.current = rowEl;
      placeTip(project, rowEl);
    },
    [placeTip],
  );

  const hideTip = useCallback(() => setTip(null), []);

  // Snap to the real tooltip width on the next frame (first paint uses the
  // fallback width), and reposition on scroll/resize so the tooltip tracks
  // its row when the inner list scrolls. Capture-phase scroll listener
  // catches the dropdown's own scroller.
  useEffect(() => {
    if (!tip) return;
    function reposition() {
      if (tipAnchorRef.current) placeTip(tip!.project, tipAnchorRef.current);
    }
    const raf = requestAnimationFrame(reposition);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [tip?.project, placeTip]);

  const tooltip = tip
    ? createPortal(
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
            // Split a trailing " - " qualifier onto a smaller second line,
            // matching TaskCard's project tooltip.
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
        document.body,
      )
    : null;

  return { showTip, hideTip, tooltip };
}
