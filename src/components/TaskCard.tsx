import { memo, useState, useEffect, useRef } from "react";
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
import type { Task, Project, Link } from "../types";

interface TaskCardProps {
  task: Task;
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
  // Switches the start-focus button into a stop button on the focused row.
  // Click invokes onStop instead of onStart. onStop is only wired by
  // DailyPlanner's inline focus flow.
  isFocused?: boolean;
  onStop?: (task: Task) => void;
}

function TrashButton({ onDelete }: { onDelete: () => void }) {
  // One click → onDelete fires (which sets confirmDeleteId in the parent
  // and renders the inline Delete/Cancel confirmation row). No more "armed"
  // intermediate state — it was a redundant gate on top of the inline
  // confirmation, which is the actual destructive prompt.
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onDelete();
      }}
      // Solid bg so the icon stays readable when overlaid on the title.
      // Picks up the elevated surface tone instead of the destructive
      // soft-tint so it doesn't read as "armed" — destructive intent only
      // surfaces on hover (text and bg shift to accent-destructive).
      // Visibility is controlled by the parent layer's opacity, so this
      // class only handles colors.
      className="w-6 h-6 rounded-full flex items-center justify-center cursor-pointer transition-colors duration-150 text-fg-faded bg-elevated border border-line-soft hover:text-accent-destructive hover:bg-accent-destructive/15 hover:border-accent-destructive/30"
      title="Delete"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 4h12" />
        <path d="M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1" />
        <path d="M13 4v9a1 1 0 01-1 1H4a1 1 0 01-1-1V4" />
        <line x1="6.5" y1="7" x2="6.5" y2="11" />
        <line x1="9.5" y1="7" x2="9.5" y2="11" />
      </svg>
    </button>
  );
}

function TaskCardImpl({
  task,
  project,
  onToggle,
  onEdit,
  onDelete,
  onToggleNotes,
  onStart,
  onOpenDetail,
  expandedNotes,
  showProject = true,
  workedMinutes,
  justArrived = false,
  justAdded = false,
  liveElapsedMs,
  isFocused = false,
  onStop,
}: TaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const [notes, setNotes] = useState(task.notes ?? "");
  const [links, setLinks] = useState<Link[]>([]);
  const [newUrl, setNewUrl] = useState("");

  // Track status transition for one-shot done animation
  const prevStatusRef = useRef(task.status);
  const justCompleted = task.status === "done" && prevStatusRef.current !== "done";
  useEffect(() => { prevStatusRef.current = task.status; }, [task.status]);

  // Sync notes when task changes
  useEffect(() => {
    setNotes(task.notes ?? "");
  }, [task.notes]);

  // Load links when expanded
  useEffect(() => {
    if (expandedNotes) {
      getLinksForEntity("task", task.id)
        .then(setLinks)
        .catch(() => {});
    }
  }, [expandedNotes, task.id]);

  async function saveNotes(valueToSave: string = notes) {
    const trimmed = valueToSave.trim() || null;
    if (trimmed === task.notes) return;
    try {
      await updateTaskNotes(task.id, trimmed);
    } catch {
      // silent
    }
  }

  async function handleAddLink(e: React.FormEvent) {
    e.preventDefault();
    const url = newUrl.trim();
    if (!url) return;
    try {
      await createLink("task", task.id, url, null);
      setNewUrl("");
      const updated = await getLinksForEntity("task", task.id);
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
  const hasContent = task.notes || expandedNotes;

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
        // min-h-[2lh] reserves the height of two body-text line-heights so
        // 1-line and 2-line task titles render rows of the same height —
        // the title can wrap to 2 lines without the row growing taller
        // than its 1-line neighbors. Anything past 2 lines clips via
        // line-clamp-2 below.
        className="flex items-center gap-3 min-h-[2lh]"
      >
        {/* Checkbox */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle(task);
          }}
          title={task.status === "done" ? "Mark as not done" : "Mark complete"}
          className={`w-[22px] h-[22px] rounded-full border-2 flex items-center justify-center shrink-0 cursor-pointer transition-colors ${
            task.status === "done"
              ? `bg-accent-green border-accent-green hover:bg-accent-green-hover hover:border-accent-green-hover${justCompleted ? " animate-task-done" : ""}`
              : "border-line-strong hover:border-accent-green"
          }`}
        >
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
          {task.title}
        </span>

        {/* Right area — fixed-width slot at the row's right edge that
            holds either the time pill (idle) or the action buttons
            (hover). Both layers are absolute and right-anchored, so the
            slot's width never changes between states. Title's flex-1
            sees a constant width and never reflows on hover.

            Slot width:
              non-focused: 72px (max(static pill ~60px, play+trash 56px))
              focused:     96px (live pill 64 + gap 8 + stop 24)
            Width changes only when starting/stopping focus — a one-time
            reflow tied to a deliberate user action, not hover. */}
        <div
          className={`relative shrink-0 h-6 ${
            isFocused ? "w-[96px]" : "w-[72px]"
          }`}
        >
          {isFocused ? (
            <>
              {/* Idle layer (focused): live pill, right-anchored 32px in
                  to leave room for the always-visible stop button. */}
              <div
                className="absolute inset-0 flex items-center justify-end pr-[32px] transition-opacity duration-150 opacity-100 group-hover/row:opacity-0 pointer-events-none"
              >
                {(() => {
                  const totalSec = Math.max(0, Math.floor((liveElapsedMs ?? 0) / 1000));
                  const m = Math.floor(totalSec / 60);
                  const s = totalSec % 60;
                  const text = m > 0 ? `${m}m ${s}s` : `${s}s`;
                  const est = task.estimated_minutes ?? 0;
                  const overBudget = est > 0 && m > est;
                  return (
                    <span
                      className={`inline-flex items-center justify-center min-w-[64px] px-2 py-[2px] rounded-full bg-accent-blue-soft text-[11px] tabular-nums ${
                        overBudget ? "text-accent-danger" : "text-accent-blue-soft-fg"
                      } font-medium`}
                    >
                      {text}
                    </span>
                  );
                })()}
              </div>

              {/* Hover layer (focused): trash to the left of stop. */}
              <div className="absolute inset-0 flex items-center justify-end pr-[32px] transition-opacity duration-150 opacity-0 group-hover/row:opacity-100 pointer-events-none group-hover/row:pointer-events-auto">
                <TrashButton onDelete={() => onDelete(task.id)} />
              </div>

              {/* Stop button — always visible at the right edge. */}
              {onStop && (
                <div className="absolute right-0 inset-y-0 flex items-center">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onStop(task);
                    }}
                    className="w-6 h-6 shrink-0 rounded-full bg-accent-blue text-fg-on-accent hover:bg-[color-mix(in_srgb,var(--accent-blue),black_30%)] cursor-pointer flex items-center justify-center transition-colors duration-150"
                    title="Stop focus"
                  >
                    <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
                      <rect width="8" height="8" rx="1" />
                    </svg>
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              {/* Idle layer (non-focused): static "Xm / Ym" pill. */}
              <div className="absolute inset-0 flex items-center justify-end transition-opacity duration-150 opacity-100 group-hover/row:opacity-0 pointer-events-none">
                {(() => {
                  const worked = workedMinutes ?? 0;
                  const est = task.estimated_minutes ?? 0;
                  const hasAny = worked > 0 || est > 0;
                  if (!hasAny) return null;
                  const overBudget = est > 0 && worked > est;
                  return (
                    <span className="inline-flex items-center gap-0.5 px-2 py-[2px] rounded-full bg-overlay-hover text-[11px] tabular-nums">
                      <span className={overBudget ? "text-accent-danger font-medium" : "text-fg-faded"}>
                        {worked > 0 ? `${worked}m` : "0m"}
                      </span>
                      <span className="text-fg-disabled">/</span>
                      <span className="text-fg-faded">
                        {est > 0 ? `${est}m` : "—"}
                      </span>
                    </span>
                  );
                })()}
              </div>

              {/* Hover layer (non-focused): trash + play, right-aligned.
                  flex with justify-end + JSX trash-then-play means play
                  ends up at the right edge, trash to its left. */}
              <div className="absolute inset-0 flex items-center justify-end gap-2 transition-opacity duration-150 opacity-0 group-hover/row:opacity-100 pointer-events-none group-hover/row:pointer-events-auto">
                <TrashButton onDelete={() => onDelete(task.id)} />
                {onStart && task.status !== "done" && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onStart(task);
                    }}
                    className="w-6 h-6 shrink-0 rounded-full bg-accent-blue text-fg-on-accent hover:bg-[color-mix(in_srgb,var(--accent-blue),black_30%)] cursor-pointer flex items-center justify-center transition-colors duration-150"
                    title="Start focus"
                  >
                    <svg width="8" height="10" viewBox="0 0 8 10" fill="currentColor" className="ml-[1px]">
                      <path d="M0 0v10l8-5z" />
                    </svg>
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Project marker — colored bar pinned to the right edge. Hover
          expands the bar slightly AND fades the project name in just
          to the left of it, both in the same color so they read as
          one unit (no floating pill, no separate visual treatment).
          The wrapper is wider than the bar to give the hover target
          some forgiveness without enlarging the visible bar itself. */}
      {showProject && project && (
        <div className="absolute right-0 top-0 bottom-0 w-[28px] group/proj">
          {/* Bar — grows from 5px → 7px wide on hover. Same vertical
              extent as before (top-1.5 bottom-1.5). */}
          <div
            className="absolute right-0 top-1.5 bottom-1.5 w-[5px] rounded-l-full transition-[width] duration-150 group-hover/proj:w-[7px]"
            style={{ backgroundColor: project.color }}
          />
          {/* Project name — fades in to the left of the bar, same
              color as the bar so it reads as the bar's label. No bg,
              no border, no separate pill chrome. Right-anchored at
              ~10px so the text's right edge sits just past the
              expanded bar's left edge. max-w + truncate keeps long
              names from blowing out the slot. */}
          <span
            className="absolute top-1/2 -translate-y-1/2 right-[10px] text-[10px] font-medium leading-none max-w-[120px] truncate opacity-0 group-hover/proj:opacity-100 transition-opacity duration-150 pointer-events-none"
            style={{ color: project.color }}
          >
            {project.name}
          </span>
        </div>
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
                    <span className="text-fg-faded">🔗</span>
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
 * Function props (onToggle/onEdit/onDelete/onToggleNotes/onStart/onStop/
 * onOpenDetail) are intentionally NOT compared — DailyPlanner passes
 * inline arrow functions on every render, so reference comparison would
 * always invalidate the memo. The callbacks are safe to ignore because
 * they all read state via setState callback form or useAppStore.getState()
 * — no captured-stale-state hazards. (Approach 2 from the #8 plan.)
 *
 * The expensive case this guards against is the 1Hz tick in useFocusTick:
 * when DailyPlanner re-renders every second, every TaskCard re-evaluates.
 * With this comparator, only the focused row (whose liveWorkedMinutes
 * changes per tick) re-renders; every other card returns true from this
 * comparator and bails out.
 */
function taskCardPropsEqual(prev: TaskCardProps, next: TaskCardProps): boolean {
  // Custom comparator. Function props (onToggle/onEdit/onDelete/...) are
  // intentionally NOT compared — DailyPlanner passes inline arrow
  // functions on every render, so reference comparison would always
  // invalidate the memo. Callbacks are safe to ignore because they read
  // state via setState callback form or useAppStore.getState() — no
  // captured-stale-state hazards. The expensive case this guards is the
  // 1Hz tick from useFocusTick: only the focused row's liveElapsedMs
  // changes per tick; every other card's data props are referentially
  // equal across renders and the comparator returns true → memo skip.
  if (prev.liveElapsedMs !== next.liveElapsedMs) return false;
  if (prev.isFocused !== next.isFocused) return false;
  if (prev.task !== next.task) return false;
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
