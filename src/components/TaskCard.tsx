import { memo, useCallback, useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  updateTaskNotes,
  getLinksForEntity,
  createLink,
  deleteLink,
  isSafeUrl,
} from "../db/queries";
import RichTextEditor from "./RichTextEditor";
import CalendarChip from "./CalendarChip";
import { formatHoursMinutes } from "../utils/format";
import { selectTaskById, useAppStore } from "../stores/appStore";
import type { Task, Project, Link } from "../types";

interface TaskCardProps {
  // M3.2.b.4 — TaskCard subscribes to its own task data via the
  // canonical store. Parent passes the id; the row pulls. This
  // inverts the responsibility for "row's data changed" from the
  // memo comparator (which still gates parent-driven re-renders)
  // to the internal store hook.
  taskId: number;
  project: Project | undefined;
  onToggle: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (id: number) => void;
  onToggleNotes: (id: number) => void;
  onStart?: (task: Task) => void;
  onOpenDetail?: (task: Task) => void;
  expandedNotes: boolean;
  showProject?: boolean;
  workedMinutes?: number;
  // Parent-managed flag: true on the render right after the user checked the
  // task off, used to play the arrival animation. Lifted into the parent
  // because the row remounts when it crosses incomplete→completed groups.
  justArrived?: boolean;
  // Parent-managed flag: true on the render right after createTask returns,
  // used to play the entrance animation on a freshly added row.
  justAdded?: boolean;
  // Live elapsed milliseconds for the active focus session — only set on
  // the focused task's row, undefined elsewhere. When defined, the time
  // pill shows seconds-precision live time ("Xm Ys") instead of the
  // static "Xm / Ym" format, with an accent tint to signal "this is the
  // active row." Ticks at 1Hz via useFocusTick. See DailyPlanner's
  // handleStartFocus.
  liveElapsedMs?: number;
  // Switches the start-focus button into a pause/resume button on the
  // focused row. M2.3 — clicks toggle pause via the store action
  // (togglePauseFocus), so the row icon mirrors PiP / Focus screen.
  // The legacy onStop prop was retired — full-stop is now only
  // available from PiP and Focus screen, per the rev 3 design.
  isFocused?: boolean;
  // True only when the row is the focused row AND the session is paused.
  // Drives icon swap (Pause ↔ Play), tooltip flip, and pill color
  // muting so a paused row is visually quiet.
  isPaused?: boolean;
  // Click handler for the project bar — opens the project's detail page.
  // Wired by DailyPlanner via the store's openProject action.
  onOpenProject?: (projectId: number) => void;
}

function TaskCardImpl({
  taskId,
  project,
  onToggle,
  onOpenDetail,
  expandedNotes,
  showProject = true,
  workedMinutes,
  justArrived = false,
  justAdded = false,
  liveElapsedMs,
  isFocused = false,
  isPaused = false,
  onOpenProject,
}: TaskCardProps) {
  // M3.2.b.4 — internal subscription. Returns the same Task ref
  // across renders unless this row's entry was rewritten in the
  // canonical map; selector + Zustand referential-equality
  // short-circuit means non-changing rows skip re-renders without
  // help from the memo comparator below.
  const task = useAppStore((s) => selectTaskById(s, taskId));
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: taskId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // M3.2.b.4 — task may be transiently undefined in the legacy
  // SQL-direct path window; useState initializer uses ?. and the
  // sync useEffect below catches the late arrival.
  const [notes, setNotes] = useState(task?.notes ?? "");
  const [links, setLinks] = useState<Link[]>([]);
  const [newUrl, setNewUrl] = useState("");

  // Project tooltip — portaled to document.body so it can float above the
  // row without affecting layout, and so it escapes the row's hover/click
  // groups. Same positioning pattern as DatePicker / ProjectPicker /
  // CalendarPicker: anchor ref + computed fixed coords + scroll/resize
  // listeners + createPortal. Opens instantly on hover, closes on leave.
  const projAnchorRef = useRef<HTMLDivElement>(null);
  const projTooltipRef = useRef<HTMLDivElement>(null);
  const [projTooltip, setProjTooltip] = useState<{ top: number; left: number } | null>(null);

  const measureProjTooltip = useCallback(() => {
    const anchor = projAnchorRef.current;
    if (!anchor) return null;
    const rect = anchor.getBoundingClientRect();
    // Tooltip width/height: read after first render via ref. Until
    // measured, fall back to sensible defaults; the recompute on the
    // next frame snaps to real values.
    const tooltipEl = projTooltipRef.current;
    const tooltipWidth = tooltipEl?.offsetWidth ?? 240;
    const tooltipHeight = tooltipEl?.offsetHeight ?? 48;
    // Position tooltip to the LEFT of the bar, vertically centered on
    // the bar's center. Tooltip's right edge sits at the wrapper's left
    // edge (no gap) so the tooltip extends leftward across and FULLY
    // covers the play/pause button area (which sits in the action slot
    // just left of the bar). Caret bridges the small visual space to
    // the bar itself.
    const barCenterY = rect.top + rect.height / 2;
    const naiveTop = barCenterY - tooltipHeight / 2;
    const naiveLeft = rect.left - tooltipWidth;
    // Clamp inside the viewport with 8px margins.
    const clampedTop = Math.min(
      Math.max(naiveTop, 8),
      window.innerHeight - tooltipHeight - 8
    );
    const clampedLeft = Math.max(naiveLeft, 8);
    return {
      top: clampedTop,
      left: clampedLeft,
    };
  }, []);

  function handleProjEnter() {
    // Open instantly on hover per user request — no delay.
    const next = measureProjTooltip();
    if (next) setProjTooltip(next);
  }

  function handleProjLeave() {
    setProjTooltip(null);
  }

  // Reposition on scroll/resize while the tooltip is open. Capture-phase
  // scroll listener catches nested scrollers (the daily-plan task list
  // scrolls inside its own region). Cleanup tears down on close.
  useEffect(() => {
    if (!projTooltip) return;
    function reposition() {
      const next = measureProjTooltip();
      if (next) setProjTooltip(next);
    }
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    // Re-measure on the next frame too, after the tooltip element has
    // mounted and its width is real (not the 200px fallback).
    const raf = requestAnimationFrame(reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      cancelAnimationFrame(raf);
    };
  }, [projTooltip !== null, measureProjTooltip]);


  // Track status transition for one-shot done animation. Uses ?. so
  // a transiently-undefined task doesn't crash the ref initializer.
  const prevStatusRef = useRef(task?.status);
  const justCompleted = task?.status === "done" && prevStatusRef.current !== "done";
  useEffect(() => { prevStatusRef.current = task?.status; }, [task?.status]);

  // Sync notes when task changes
  useEffect(() => {
    setNotes(task?.notes ?? "");
  }, [task?.notes]);

  // Load links when expanded. Dep is `taskId` (primitive prop, stable
  // across renders) rather than `task.id` so a re-render that changes
  // the Task ref but not the id doesn't re-trigger the fetch.
  useEffect(() => {
    if (expandedNotes) {
      getLinksForEntity("task", taskId)
        .then(setLinks)
        .catch(() => {});
    }
  }, [expandedNotes, taskId]);


  // M3.2.b.4 — defensive null guard. Under current architecture
  // (M3.2.a's atomic withTaskRemoved/withTaskInserted patches +
  // loadTasksFor* atomic sets), the parent's id list and tasksById
  // are kept consistent within a single state transition, so this
  // path is theoretical. Kept as a one-line guard against any future
  // legacy SQL-direct slip that adds an id to a secondary index
  // without writing tasksById.
  if (!task) return null;

  async function saveNotes(valueToSave: string = notes) {
    const trimmed = valueToSave.trim() || null;
    // task! — function declaration is hoisted so TS doesn't carry
    // narrowing from the early-return above into this body.
    if (trimmed === task!.notes) return;
    try {
      await updateTaskNotes(taskId, trimmed);
    } catch {
      // silent
    }
  }

  async function handleAddLink(e: React.FormEvent) {
    e.preventDefault();
    const url = newUrl.trim();
    if (!url) return;
    try {
      await createLink("task", taskId, url, null);
      setNewUrl("");
      const updated = await getLinksForEntity("task", taskId);
      setLinks(updated);
    } catch {
      // silent
    }
  }

  async function handleDeleteLink(linkId: number) {
    try {
      await deleteLink(linkId);
      setLinks((prev) => prev.filter((l) => l.id !== linkId));
    } catch {
      // silent
    }
  }

  const isHigh = task.priority === "high" || task.priority === "urgent";

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-task-row-id={task.id}
      {...attributes}
      {...listeners}
      onClick={() => onOpenDetail?.(task)}
      // Inner buttons (checkbox, play, trash) all stopPropagation, so this
      // outer click handler only fires for clicks on the row's empty space
      // — verified in TaskCard.tsx during the polish batch.
      className={`relative px-4 py-4 rounded-lg border transition-colors duration-150 ease-out group/row touch-none cursor-pointer ${
        isDragging ? "cursor-grabbing" : ""
      } ${
        task.status === "done"
          ? "bg-[var(--accent-green-muted-bg)] border-accent-green/15 hover:bg-[var(--accent-green-muted-bg)]"
          : isHigh
            ? "bg-accent-orange-soft border-accent-orange/15 hover:bg-accent-orange-soft-hover"
            : "bg-elevated/60 border-line-soft hover:bg-overlay-hover"
      }${justArrived ? " animate-task-arrived" : ""}${justAdded ? " animate-task-added" : ""}`}
    >
      <div
        // h-[2lh] LOCKS the inner flex's height so content swaps (e.g.
        // idle ↔ active right-column layout) can't grow it. min-h alone
        // wasn't enough — switching to fixed height. Title is line-clamp
        // -2'd to 2 lines max (= exactly 2lh), so it fits without
        // clipping, and the active state's absolute stack overflows
        // into the row's py-4 padding instead of pushing the row.
        className="flex items-center gap-3 h-[2lh]"
      >
        {/* Checkbox */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle(task);
          }}
          title={task.status === "done" ? "Mark as not done" : "Mark complete"}
          className={`relative w-[22px] h-[22px] rounded-full border-2 flex items-center justify-center shrink-0 cursor-pointer transition-colors ${
            task.status === "done"
              ? `bg-accent-green border-accent-green hover:bg-accent-green-hover hover:border-accent-green-hover${justCompleted ? " animate-task-done" : ""}`
              : "border-line-strong hover:border-accent-green"
          }`}
        >
          {/* One-shot positive burst on completion — a green ring that pops
              outward from the checkbox. pointer-events-none + absolute so it
              never affects layout or the click target. */}
          {justCompleted && (
            <span
              aria-hidden
              className="absolute inset-0 rounded-full pointer-events-none animate-task-done-burst"
              style={{ border: "2px solid var(--accent-green)" }}
            />
          )}
          <svg
            width="11"
            height="11"
            viewBox="0 0 12 12"
            fill="none"
            stroke={task.status === "done" ? "var(--text-on-accent)" : "var(--text-faded)"}
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path
              d="M3 6.5l2.2 2.2L9 3.3"
              className={justCompleted ? "animate-check-draw" : ""}
            />
          </svg>
        </button>

        {/* Title — row click opens detail. line-clamp-2 lets long titles
            wrap to a second line; the row's min-h-[2lh] pre-reserves
            space so 1-line cards aren't shorter than 2-line cards.
            Beyond 2 lines, the title cuts off with an ellipsis. flex-1
            absorbs whatever space the right-area reserves; that width
            is constant across hover states so the title never reflows
            on hover. */}
        <span
          className={`flex-1 min-w-0 line-clamp-2 break-words text-fg [font-size:var(--font-size-body)] [font-weight:var(--font-weight-body)] ${
            task.status === "done" ? "line-through !text-fg-faded" : ""
          }`}
        >
          {task.external_source === "calendar" && <CalendarChip className="mr-1.5 align-[-1px]" />}
          {task.title}
        </span>

        {/* Right area — FIXED-width column (104px) regardless of state.
            Title's flex-1 sees the same reservation in idle and active,
            so the title text never reflows when a timer starts/stops or
            on hover. Two layouts inside:

              idle (no timer): single centered element, cross-fade
                between time pill (default) and play button (hover).
                Same 1:1 footprint, same vertical center.

              active (timer running): vertical stack, both elements
                always visible — live pill on top, pause button below.
                The stack itself is the visual signal that this row is
                running, so no hover is needed to expose the controls. */}
        {/* Right area — fixed-width slot (132px) so the title's flex-1
            sees the same reservation idle vs. focused. Idle: a single
            centered pill (with worked/est, or invisible if neither).
            Focused: pill on the left + pause button on the right —
            daily plan exposes pause but not start (start lives on the
            focus screen and the detail overlay's Start button). The
            slot width is constant, so neither hover nor the focus
            transition reflows the title. */}
        <div className="relative shrink-0 w-[132px] self-stretch">
          <div className="absolute inset-0 flex items-center justify-center gap-1.5">
            {(() => {
              const liveSec = Math.max(0, Math.floor((liveElapsedMs ?? 0) / 1000));
              const liveM = Math.floor(liveSec / 60);
              const liveS = liveSec % 60;
              // Always include seconds so the counter visibly ticks
              // — daily-plan rows are where the user watches a session
              // accrue. Past the first minute we still use the shared
              // Xh Ym formatter for the hours/minutes prefix so a
              // 112-minute counter reads "1h 52m 16s", not "112m 16s".
              const liveText =
                liveM > 0 ? `${formatHoursMinutes(liveM)} ${liveS}s` : `${liveS}s`;
              const est = task.estimated_minutes ?? 0;
              const worked = workedMinutes ?? 0;
              const idleHasContent = worked > 0 || est > 0;
              // Visibility:
              //   focused: visible always (live counter showing)
              //   idle + has time: visible
              //   idle + no time: invisible (slot still reserves space
              //     so row geometry is identical regardless)
              const visClass =
                isFocused || idleHasContent ? "" : "invisible";
              // Paused: drop the accent-blue tint to a generic overlay
              // tint so the pill doesn't read as "live" against the
              // surrounding page. Running and idle keep their existing
              // treatments.
              const bgClass = isFocused
                ? isPaused
                  ? "bg-overlay-hover"
                  : "bg-accent-blue-soft"
                : "bg-overlay-hover";
              // Uniform pill width across all rows (focused or not). The
              // focused row used to drop min-w to fit an inline pause button
              // beside it, but that button was removed, so the pill keeps the
              // same min-width everywhere.
              const widthClass = "min-w-[100px]";
              return (
                <span
                  className={`inline-flex items-center justify-center gap-0.5 h-[20px] ${widthClass} px-2 rounded-full text-[11px] tabular-nums whitespace-nowrap ${
                    isFocused ? "font-medium" : ""
                  } ${bgClass} ${visClass}`}
                >
                  {isFocused ? (
                    // Paused: mute the live pill colors to text-fg-faded so
                    // the row visually quiets down (matches the PiP's
                    // paused state at FocusPip.tsx:387). Running: keep the
                    // accent-blue treatment that signals "this row is the
                    // live one."
                    isPaused ? (
                      <>
                        <span className="text-fg-faded">{liveText}</span>
                        <span className="text-fg-disabled">/</span>
                        <span className="text-fg-faded">
                          {est > 0 ? formatHoursMinutes(est) : "—"}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="text-accent-blue-soft-fg">
                          {liveText}
                        </span>
                        <span className="text-accent-blue-soft-fg/40">/</span>
                        <span className="text-accent-blue-soft-fg/80">
                          {est > 0 ? formatHoursMinutes(est) : "—"}
                        </span>
                      </>
                    )
                  ) : (
                    <>
                      <span className="text-fg-faded">
                        {worked > 0 ? formatHoursMinutes(worked) : "0m"}
                      </span>
                      <span className="text-fg-disabled">/</span>
                      <span className="text-fg-faded">
                        {est > 0 ? formatHoursMinutes(est) : "—"}
                      </span>
                    </>
                  )}
                </span>
              );
            })()}
            {/* No inline play/pause on the daily-view row — focus is started
                from the top-right control, the Focus screen, or the task
                detail's Start button. */}
          </div>
        </div>
      </div>

      {/* Project marker — colored bar pinned to the right edge. Hovering
          opens a portaled tooltip above the bar with the full project
          name; bar itself grows 5→7px on hover as the affordance signal.
          The 14px wrapper sits within the card's px-4 right padding, so
          the hover zone never overlaps the action buttons (play/trash)
          which live in the content area starting at right-16. */}
      {showProject && project && (
        <div
          ref={projAnchorRef}
          className={`absolute right-0 top-0 bottom-0 w-[14px] ${
            onOpenProject ? "cursor-pointer" : ""
          }`}
          onMouseEnter={handleProjEnter}
          onMouseLeave={handleProjLeave}
          onClick={(e) => {
            if (onOpenProject) {
              e.stopPropagation();
              onOpenProject(project.id);
            }
          }}
        >
          <div
            className="absolute right-0 top-1.5 bottom-1.5 rounded-l-full transition-[width] duration-150"
            style={{
              backgroundColor: project.color,
              width: projTooltip ? 7 : 5,
            }}
          />
        </div>
      )}

      {/* Project tooltip — portaled to document.body so it floats next
          to the bar without affecting layout. Positioned LEFT of the bar
          and vertically centered on it (emerges from the bar's row, not
          from above). Two-tier text: project name (medium, primary) on
          top, optional qualifier (secondary, smaller) below. Caret points
          right at the bar. Same styling tokens as DatePicker /
          ProjectPicker: bg-elevated, 0.5px border-soft,
          var(--shadow-card). */}
      {showProject && project && projTooltip && createPortal(
        <div
          ref={projTooltipRef}
          className="fixed z-[60] bg-elevated rounded-lg px-3 py-2 max-w-[260px] pointer-events-none"
          style={{
            top: projTooltip.top,
            left: projTooltip.left,
            border: "0.5px solid var(--border-soft)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          {(() => {
            // Split on the last " - " (space-dash-space) to separate
            // primary name from a trailing qualifier (e.g.
            // "Increased Homepage Above-the-Fold Testing - Q1 FY27 INIT"
            // → primary = "Increased Homepage Above-the-Fold Testing",
            //   qualifier = "Q1 FY27 INIT"). If no delimiter, just
            // render the whole name as the primary line.
            const sep = project.name.lastIndexOf(" - ");
            const primary = sep > 0 ? project.name.slice(0, sep) : project.name;
            const qualifier = sep > 0 ? project.name.slice(sep + 3) : "";
            return (
              <div className="flex items-start gap-2">
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0 mt-[6px]"
                  style={{ backgroundColor: project.color }}
                />
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

      {/* Expanded area: notes + links */}
      {expandedNotes && (
        <div
          className="mt-2 space-y-2"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {/* Editable notes */}
          <RichTextEditor
            value={notes}
            onChange={(html) => {
              setNotes(html);
              saveNotes(html);
            }}
            placeholder="Add notes..."
            className="w-full p-2.5 rounded-md bg-base border border-line-hairline text-[12px] text-fg-secondary min-h-[60px] leading-relaxed focus-within:border-accent-blue"
          />

          {/* Links */}
          <div>
            {links.length > 0 && (
              <div className="space-y-1 mb-1.5">
                {links.map((link) => (
                  <div
                    key={link.id}
                    className="flex items-center gap-2 text-[11px]"
                  >
                    {isSafeUrl(link.url) ? (
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent-blue-soft-fg hover:underline truncate flex-1"
                      >
                        {link.label || link.url}
                      </a>
                    ) : (
                      <span className="text-fg-secondary truncate flex-1">
                        {link.label || link.url}
                      </span>
                    )}
                    <button
                      onClick={() => handleDeleteLink(link.id)}
                      className="text-fg-faded hover:text-accent-destructive cursor-pointer text-[10px]"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            <form onSubmit={handleAddLink} className="flex gap-1.5">
              <input
                type="url"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="Add a URL..."
                className="flex-1 bg-base border border-line-hairline rounded-md px-2 py-1 text-[11px] text-fg placeholder:text-fg-disabled outline-none focus:border-accent-blue"
              />
              <button
                type="submit"
                className="text-[10px] text-accent-blue-soft-fg px-2 py-1 rounded-md border border-accent-blue/20 bg-accent-blue/[0.06] cursor-pointer hover:bg-accent-blue/[0.12]"
              >
                Add
              </button>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

/**
 * Custom React.memo comparator. Returns `true` to skip re-render.
 *
 * M3.2.b.4 architectural inversion: the comparator is no longer
 * responsible for "this row's data changed." TaskCard's internal
 * `useAppStore((s) => selectTaskById(s, taskId))` subscription is.
 * The comparator's only job now is to gate parent-driven re-renders
 * that don't affect this row. A render that mutates this row's task
 * data triggers a re-render via the store hook regardless of what
 * the comparator returns.
 *
 * Function props (onToggle/onEdit/onDelete/onToggleNotes/onStart/
 * onOpenDetail) are intentionally NOT compared — DailyPlanner passes
 * inline arrow functions on every render, so reference comparison
 * would always invalidate the memo. Callbacks are safe to ignore
 * because they read state via setState callback form or
 * useAppStore.getState() — no captured-stale-state hazards.
 *
 * The expensive case this still guards against is the 1Hz tick from
 * useFocusTick: when DailyPlanner re-renders every second, every
 * TaskCard re-evaluates. The comparator's primitive checks all pass
 * for non-focused rows; only the focused row's liveElapsedMs differs,
 * so only it re-renders.
 */
function taskCardPropsEqual(prev: TaskCardProps, next: TaskCardProps): boolean {
  if (prev.liveElapsedMs !== next.liveElapsedMs) return false;
  if (prev.isFocused !== next.isFocused) return false;
  if (prev.isPaused !== next.isPaused) return false;
  // M3.2.b.4 — primitive id check replaces the prior `task` ref check.
  // A different taskId means we're rendering a different row entirely
  // (parent reordered or the row was replaced) and the row needs to
  // re-render to re-subscribe.
  if (prev.taskId !== next.taskId) return false;
  if (prev.project !== next.project) return false;
  if (prev.expandedNotes !== next.expandedNotes) return false;
  if (prev.showProject !== next.showProject) return false;
  if (prev.workedMinutes !== next.workedMinutes) return false;
  if (prev.justArrived !== next.justArrived) return false;
  if (prev.justAdded !== next.justAdded) return false;
  return true;
}

const TaskCard = memo(TaskCardImpl, taskCardPropsEqual);
export default TaskCard;
