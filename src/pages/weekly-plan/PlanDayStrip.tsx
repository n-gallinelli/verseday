import { useState, useEffect, useRef } from "react";
import { useDroppable, useDraggable } from "@dnd-kit/core";
import type { Task } from "../../types";
import { PLAN_TASK_DRAG_PREFIX } from "./PlanTaskList";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri"];

// id format the parent DndContext uses to identify a day drop target.
export const PLAN_DAY_DROP_PREFIX = "plan-day-";
const DEFAULT_MINUTES = 30;
const STEP_MINUTES = 5;
const MAX_MINUTES = 1440;

function formatHM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

// Parse user input. Accepts "H:MM" (e.g. "1:30") or plain minutes ("90").
// Returns null if the input doesn't match either form, so the caller can
// decide whether to ignore the keystroke or fall back to the prior value.
function parseHM(input: string): number | null {
  const trimmed = input.trim();
  const colonMatch = trimmed.match(/^(\d{1,2}):([0-5]\d)$/);
  if (colonMatch) {
    return parseInt(colonMatch[1], 10) * 60 + parseInt(colonMatch[2], 10);
  }
  const minutesMatch = trimmed.match(/^\d+$/);
  if (minutesMatch) {
    return parseInt(trimmed, 10);
  }
  return null;
}

function clampMinutes(m: number): number {
  return Math.max(0, Math.min(MAX_MINUTES, m));
}

interface Props {
  weekDates: string[];                    // 5 ISO strings (Mon..Fri)
  commitments: Map<number, number>;        // dayOffset → minutes
  projectColor: string;
  /** Tasks scheduled to each day this week, keyed by ISO date. Shown
   *  as small chips under their day's button. */
  tasksByDate: Map<string, Task[]>;
  onSet: (dayOffset: number, minutes: number) => void;
  onClear: (dayOffset: number) => void;
  /** Allow parent (PlanTab) to forward bare 1–5 shortcuts here. */
  toggleSignal?: { dayOffset: number; nonce: number } | null;
}

export default function PlanDayStrip({
  weekDates,
  commitments,
  projectColor,
  tasksByDate,
  onSet,
  onClear,
  toggleSignal,
}: Props) {
  // Tracks which day, if any, is showing an inline "clear?" confirm.
  // Click an active day with non-default minutes → confirm; click the
  // same day again → clear; click the inline "cancel" → confirm
  // dismisses. (Clicking another day or waiting does NOT auto-dismiss
  // — confirm sticks until explicitly resolved.)
  const [confirmingClear, setConfirmingClear] = useState<number | null>(null);

  // Forwarded keyboard signal from PlanTab — we use a nonce so repeated
  // presses of the same key still re-fire.
  const lastSignalNonceRef = useRef<number | null>(null);
  useEffect(() => {
    if (!toggleSignal) return;
    if (toggleSignal.nonce === lastSignalNonceRef.current) return;
    lastSignalNonceRef.current = toggleSignal.nonce;
    handleToggle(toggleSignal.dayOffset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toggleSignal]);

  function handleToggle(dayOffset: number) {
    const has = commitments.has(dayOffset);
    if (!has) {
      onSet(dayOffset, DEFAULT_MINUTES);
      setConfirmingClear(null);
    } else {
      // Active day clicked. If this is the second click in confirm
      // state, clear; otherwise enter confirm state. (If the existing
      // value is still the default and we haven't confirmed, clear
      // immediately — typing 0:30 then immediately undoing shouldn't
      // demand a confirm.)
      const currentMinutes = commitments.get(dayOffset);
      if (confirmingClear === dayOffset || currentMinutes === DEFAULT_MINUTES) {
        onClear(dayOffset);
        setConfirmingClear(null);
      } else {
        setConfirmingClear(dayOffset);
      }
    }
  }

  return (
    <div className="flex gap-3 items-start">
      {weekDates.map((date, idx) => {
        const minutes = commitments.get(idx) ?? null;
        const active = minutes != null;
        const confirming = confirmingClear === idx;
        const dayTasks = tasksByDate.get(date) ?? [];
        return (
          <DayButton
            key={date}
            label={DAY_NAMES[idx]}
            date={date}
            minutes={minutes}
            active={active}
            confirming={confirming}
            projectColor={projectColor}
            tasks={dayTasks}
            onToggle={() => handleToggle(idx)}
            onChangeMinutes={(m) => {
              const clamped = clampMinutes(m);
              // Stepping (or typing) to 0 clears the day. Keeping a
              // 0-minute "active" day would let it count toward the
              // ≥1-day Done gate while contributing no commitment —
              // a degenerate state we don't want to support.
              if (clamped <= 0) {
                onClear(idx);
              } else {
                onSet(idx, clamped);
              }
            }}
            onCancelConfirm={() => setConfirmingClear(null)}
          />
        );
      })}
    </div>
  );
}

function DayButton({
  label,
  date,
  minutes,
  active,
  confirming,
  projectColor,
  tasks,
  onToggle,
  onChangeMinutes,
  onCancelConfirm,
}: {
  label: string;
  date: string;
  minutes: number | null;
  active: boolean;
  confirming: boolean;
  projectColor: string;
  tasks: Task[];
  onToggle: () => void;
  onChangeMinutes: (m: number) => void;
  onCancelConfirm: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Drop target for tasks dragged from PlanTaskList. The wrapper div
  // (not the inner button) is the droppable so a hovered drag is
  // detected anywhere over the column, not just the button.
  const { isOver, setNodeRef: setDropRef } = useDroppable({
    id: `${PLAN_DAY_DROP_PREFIX}${date}`,
    data: { date },
  });

  // Local mm/dd label, e.g. "May 13"
  const dayLabel = new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  function startEdit() {
    if (!active || minutes == null) return;
    setDraft(formatHM(minutes));
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function commitDraft() {
    const parsed = parseHM(draft);
    if (parsed != null) {
      onChangeMinutes(parsed);
    }
    setEditing(false);
  }

  return (
    <div
      ref={setDropRef}
      className={`flex flex-col items-center gap-1.5 flex-1 rounded-lg transition-colors ${isOver ? "ring-2 ring-accent-blue ring-offset-2 ring-offset-base" : ""}`}
    >
      <button
        type="button"
        onClick={onToggle}
        className={`w-full flex flex-col items-center px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
          active
            ? "border-transparent text-fg"
            : "border-line-soft text-fg-secondary hover:border-line-strong hover:bg-overlay-hover"
        }`}
        style={
          active
            ? {
                backgroundColor: `color-mix(in srgb, ${projectColor} 14%, transparent)`,
                borderColor: `color-mix(in srgb, ${projectColor} 40%, transparent)`,
              }
            : undefined
        }
      >
        <span className="text-[12px] font-medium">{label}</span>
        <span className="text-[10px] text-fg-faded mt-0.5">{dayLabel}</span>
      </button>

      {/* Min-time slot — fixed-height so the strip doesn't reflow when a
          day activates. Renders the input row when active, the "min"
          legend when not. */}
      <div className="h-[28px] w-full flex items-center justify-center">
        {active &&
          (editing ? (
            <input
              ref={inputRef}
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitDraft}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitDraft();
                if (e.key === "Escape") setEditing(false);
              }}
              placeholder="H:MM"
              className="w-full text-center text-[12px] tabular-nums bg-base border border-accent-blue rounded-md px-1 py-0.5 outline-none"
            />
          ) : (
            <div className="flex items-center gap-1 tabular-nums">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onChangeMinutes((minutes ?? 0) - STEP_MINUTES);
                }}
                title="Decrease 5 min"
                className="w-5 h-5 rounded text-fg-faded hover:text-fg-secondary hover:bg-overlay-hover cursor-pointer text-[14px] leading-none"
              >
                −
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  startEdit();
                }}
                title="Edit minimum minutes"
                className="text-[12px] text-fg cursor-text px-1 hover:bg-overlay-hover rounded"
              >
                {minutes != null ? formatHM(minutes) : "0:00"}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onChangeMinutes((minutes ?? 0) + STEP_MINUTES);
                }}
                title="Increase 5 min"
                className="w-5 h-5 rounded text-fg-faded hover:text-fg-secondary hover:bg-overlay-hover cursor-pointer text-[14px] leading-none"
              >
                +
              </button>
            </div>
          ))}
      </div>

      {/* Confirm prompt — sits below the time input. Only visible when
          the user clicked an active button with non-default minutes. */}
      {confirming && (
        <div className="text-[10px] text-fg-faded mt-0.5 flex items-center gap-1.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCancelConfirm();
            }}
            className="hover:text-fg-secondary cursor-pointer"
          >
            cancel
          </button>
          <span>· click again to clear</span>
        </div>
      )}

      {/* Scheduled-task chips — sit just below the minutes input.
          Sized generously since at most ~3 per day per project; title
          allowed to wrap to 2 lines so the user can actually read it
          rather than ellipsizing every long task. Chip color is tinted
          with the project color for continuity with the active
          day-button background. Each chip is draggable so the user
          can move tasks between days; the parent's drag handler
          transfers the commitment minutes accordingly. */}
      {tasks.length > 0 && (
        <div className="w-full mt-2 flex flex-col gap-1.5">
          {tasks.map((task) => (
            <ScheduledTaskChip
              key={task.id}
              task={task}
              projectColor={projectColor}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ScheduledTaskChip({
  task,
  projectColor,
}: {
  task: Task;
  projectColor: string;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${PLAN_TASK_DRAG_PREFIX}${task.id}`,
    data: { taskId: task.id, taskTitle: task.title },
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      title={task.title}
      className={`w-full text-left flex items-start gap-2 px-2.5 py-2 rounded-md border cursor-grab active:cursor-grabbing touch-none ${isDragging ? "opacity-30" : ""}`}
      style={{
        backgroundColor: `color-mix(in srgb, ${projectColor} 10%, var(--bg-elevated))`,
        borderColor: `color-mix(in srgb, ${projectColor} 30%, transparent)`,
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-[5px]"
        style={{ backgroundColor: projectColor }}
      />
      <div className="flex-1 min-w-0">
        <div
          className={`text-[12px] leading-snug line-clamp-2 break-words ${
            task.status === "done"
              ? "text-fg-faded line-through"
              : "text-fg-secondary"
          }`}
        >
          {task.title}
        </div>
        {task.estimated_minutes != null && task.estimated_minutes > 0 && (
          <div className="text-[10px] text-fg-faded tabular-nums mt-0.5">
            {task.estimated_minutes}m
          </div>
        )}
      </div>
    </div>
  );
}
