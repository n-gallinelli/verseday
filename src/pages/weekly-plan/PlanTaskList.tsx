import { useState, useRef, useEffect } from "react";
import { useDraggable } from "@dnd-kit/core";
import type { Task } from "../../types";

// id format used by the Plan tab's DndContext to identify a draggable
// task. Kept in this file so the matching parsing logic in PlanTab can
// reference the same constant.
export const PLAN_TASK_DRAG_PREFIX = "plan-task-";

interface Props {
  tasks: Task[];
  onCreate: (title: string) => Promise<void>;
  onUpdateTitle: (id: number, title: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onOpenTaskDetail: (task: Task) => void;
}

// Lightweight line-by-line task list for week-level project intent.
// Each row is a real Task (project_id set, date_scheduled = null);
// they flow into the rest of the app's unscheduled views, per the
// approved plan.
export default function PlanTaskList({
  tasks,
  onCreate,
  onUpdateTitle,
  onDelete,
  onOpenTaskDetail,
}: Props) {
  return (
    <div className="space-y-1">
      {tasks.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          onUpdateTitle={onUpdateTitle}
          onDelete={onDelete}
          onOpenTaskDetail={onOpenTaskDetail}
        />
      ))}
      <NewTaskRow onCreate={onCreate} />
    </div>
  );
}

function TaskRow({
  task,
  onUpdateTitle,
  onDelete,
  onOpenTaskDetail,
}: {
  task: Task;
  onUpdateTitle: (id: number, title: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onOpenTaskDetail: (task: Task) => void;
}) {
  const [draft, setDraft] = useState(task.title);
  const [savedAt, setSavedAt] = useState(task.title);
  // Click the title → open the full task detail (matches the rest of the app).
  // The hover pencil flips the row into inline-rename mode so quick week-
  // planning edits are still one keystroke away.
  const [editing, setEditing] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  // Whole row is the drag handle — gives the user a generous target and
  // matches the ScheduleTab DraggableTaskRow pattern. The rename input, pencil,
  // and delete button stop pointer-event propagation so clicking them never
  // starts a drag; the TITLE intentionally does NOT, so it stays draggable.
  // PointerSensor's 5px activation distance is what disambiguates: a plain
  // click on the title opens the detail overlay, a >5px drag reschedules.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${PLAN_TASK_DRAG_PREFIX}${task.id}`,
    data: { taskId: task.id, taskTitle: task.title },
  });

  function save(value: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const trimmed = value.trim();
      if (!trimmed) {
        // Empty title → delete the row instead of saving an empty task.
        await onDelete(task.id);
        return;
      }
      if (trimmed === savedAt.trim()) return;
      await onUpdateTitle(task.id, trimmed);
      setSavedAt(trimmed);
    }, 400);
  }

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`group/row flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-overlay-hover cursor-grab active:cursor-grabbing touch-none ${isDragging ? "opacity-30" : ""}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-fg-faded flex-shrink-0" />
      {editing ? (
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            setDraft(e.target.value);
            save(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Escape") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
          onBlur={() => {
            // Flush any pending debounce immediately so the last edit isn't lost.
            if (debounceRef.current) {
              clearTimeout(debounceRef.current);
              debounceRef.current = null;
              save(draft);
            }
            setEditing(false);
          }}
          className="flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-disabled cursor-text"
          placeholder="(empty — will delete)"
        />
      ) : (
        <button
          type="button"
          // No stopPropagation: the title stays part of the row's drag handle
          // (move >5px → drag to a day), while a plain click (<5px, the
          // PointerSensor threshold) falls through to open the detail overlay.
          onClick={() => onOpenTaskDetail(task)}
          title="Open task details"
          className="flex-1 min-w-0 text-left truncate bg-transparent text-[13px] text-fg cursor-grab active:cursor-grabbing"
        >
          {task.title}
        </button>
      )}
      {!editing && (
        <button
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          // Re-seed from the live task.title (not the once-initialized draft):
          // the title can have changed via the detail overlay since mount.
          onClick={() => {
            setDraft(task.title);
            setSavedAt(task.title);
            setEditing(true);
          }}
          title="Rename"
          className="opacity-0 group-hover/row:opacity-100 w-5 h-5 rounded flex items-center justify-center text-fg-faded hover:text-fg-secondary hover:bg-overlay-hover cursor-pointer transition-opacity flex-shrink-0"
        >
          <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9.5 1.5l3 3L5 12l-3.5.5L2 9z" />
          </svg>
        </button>
      )}
      <button
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => onDelete(task.id)}
        title="Delete task"
        className="opacity-0 group-hover/row:opacity-100 w-5 h-5 rounded flex items-center justify-center text-fg-faded hover:text-fg-secondary hover:bg-overlay-hover cursor-pointer transition-opacity flex-shrink-0"
      >
        <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
          <path d="M3 3l8 8M11 3l-8 8" />
        </svg>
      </button>
    </div>
  );
}

function NewTaskRow({ onCreate }: { onCreate: (title: string) => Promise<void> }) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function commit() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    await onCreate(trimmed);
    setDraft("");
    inputRef.current?.focus();
  }

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 border border-dashed border-line-hairline rounded-md">
      <span className="w-1.5 h-1.5 rounded-full bg-fg-disabled flex-shrink-0" />
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        onBlur={commit}
        placeholder="Add task… (Enter to save)"
        className="flex-1 bg-transparent text-[13px] text-fg-secondary outline-none placeholder:text-fg-disabled"
      />
    </div>
  );
}
