import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { snapCenterToCursor } from "../utils/dnd";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useShallow } from "zustand/react/shallow";
import {
  selectTaskIdsByProject,
  selectProjectById,
  selectProjectsByStatus,
  useAppStore,
} from "../stores/appStore";
import {
  startTimeEntry,
  getWorkedMinutesForTask,
  PROJECT_PALETTE,
} from "../db/queries";
import ErrorBanner from "../components/ErrorBanner";
import { errorMessage } from "../utils/errors";
import CalendarPicker from "../components/CalendarPicker";
import DateRangeField from "../components/DateRangeField";
import { parseTimeFromTitle } from "../utils/format";
import { localDateIso } from "../utils/dates";
import RichTextEditor from "../components/RichTextEditor";
import ProjectIconPicker from "../components/ProjectIconPicker";
import type { Task } from "../types";

const MAX_TITLE_LENGTH = 200;
const MAX_ESTIMATE_MINUTES = 480;
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri"];

// id prefix for "This week" day-cell droppables. Kept distinct from
// sortable task ids (which are plain numbers) so handleDragEnd can
// branch cleanly between schedule-to-day and reorder-within-list.
const PD_DAY_DROP_PREFIX = "pd-day-";
// id prefix for tasks rendered inside a day cell (right-rail). They
// can't share the plain-number sortable id because the same task may
// also appear in the main task list (left), and dnd-kit requires
// unique draggable ids.
const PD_DAY_TASK_PREFIX = "pd-task-";

function getCurrentWeekdayDates(): string[] {
  const today = new Date();
  const day = today.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(today);
  monday.setDate(today.getDate() + diff);
  const dates: string[] = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    dates.push(localDateIso(d)); // #67 — local tz; toISOString() shifts the weekday columns in the evening
  }
  return dates;
}

// ─── Color picker — click-to-toggle popover ─────────────────────────────────
// Replaces the previous group-hover popover, which closed the moment
// the cursor left the dot's bounding box (the gap to the popover broke
// the hover chain).
function ColorPicker({
  value,
  onChange,
  takenColors = [],
}: {
  value: string;
  onChange: (color: string) => void;
  // Colors claimed by other active projects — shown but disabled, so the
  // user can't pick a color the DB guard would reject on save.
  takenColors?: string[];
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative flex-shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Change color"
        className="w-[14px] h-[14px] rounded-full cursor-pointer ring-2 ring-transparent hover:ring-overlay-pressed transition-all"
        style={{ backgroundColor: value }}
      />
      {open && (
        <div
          className="absolute top-full left-0 mt-1 z-20 bg-elevated border border-line-soft rounded-lg p-2.5 grid grid-cols-4 gap-2.5 w-max"
          style={{ boxShadow: "var(--shadow-card)" }}
        >
          {PROJECT_PALETTE.map((c) => {
            const taken = c !== value && takenColors.includes(c);
            return (
              <button
                key={c}
                type="button"
                disabled={taken}
                title={taken ? "Used by another active project" : undefined}
                onClick={() => {
                  if (taken) return;
                  onChange(c);
                  setOpen(false);
                }}
                className={`w-5 h-5 rounded-full border ${
                  taken ? "cursor-not-allowed opacity-30" : "cursor-pointer"
                }`}
                style={{
                  backgroundColor: c,
                  borderColor:
                    value === c ? "var(--text-primary)" : "transparent",
                  // Always-on inset ring so pale swatches stay visible.
                  boxShadow: "inset 0 0 0 1px var(--swatch-ring)",
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Labeled pill — shared chrome with CalendarPicker + TimeFieldPill ──────
// Wraps a raw input/select so it visually matches the canonical
// label-inside pill (uppercase label on top, value below). Two tones:
//   "default" — bg-input, matches CalendarPicker (used for date).
//   "time"    — bg-tag-soft, slightly lighter so the time pair reads
//               as a related-but-distinct group from the date pill.
// Children render on a transparent background so this wrapper supplies
// all chrome.
function LabeledInputPill({
  label,
  tone = "default",
  children,
}: {
  label: string;
  tone?: "default" | "time";
  children: React.ReactNode;
}) {
  const bgClass = tone === "time" ? "bg-tag-soft" : "bg-input";
  return (
    <label
      className={`${bgClass} border-line-hairline hover:border-line-medium focus-within:border-accent-blue rounded-md flex flex-col items-start cursor-text transition-colors w-[100px] flex-shrink-0`}
      style={{
        borderWidth: "0.5px",
        borderStyle: "solid",
        padding: "4px 10px 4px 10px",
        gap: "3px",
      }}
    >
      <span className="text-[9px] uppercase tracking-[0.07em] text-fg-faded leading-none">
        {label}
      </span>
      {children}
    </label>
  );
}

// ─── Sortable task row ──────────────────────────────────────────────────────

function formatMinutes(n: number): string {
  if (n < 60) return `${n}m`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function parseTimeInput(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  const hMatch = trimmed.match(/(\d+)\s*h/i);
  const mMatch = trimmed.match(/(\d+)\s*m/i);
  let total = 0;
  if (hMatch) total += parseInt(hMatch[1]) * 60;
  if (mMatch) total += parseInt(mMatch[1]);
  if (total === 0) {
    const num = parseInt(trimmed);
    if (!isNaN(num) && num > 0) total = num;
  }
  return total;
}

function SortableTaskRow({
  task,
  workedMinutes,
  onToggle,
  onOpenDetail,
  onDelete,
  onStart,
  onSetDate,
  onSetEstimate,
  onSetWorked,
}: {
  task: Task;
  workedMinutes: number;
  onToggle: (task: Task) => void;
  onOpenDetail: (task: Task) => void;
  onDelete: (id: number) => void;
  onStart: (task: Task) => void;
  onSetDate: (id: number, date: string) => void;
  onSetEstimate: (id: number, minutes: number | null) => void;
  onSetWorked: (id: number, minutes: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id });

  const [workedInput, setWorkedInput] = useState(
    workedMinutes > 0 ? formatMinutes(workedMinutes) : ""
  );

  useEffect(() => {
    setWorkedInput(workedMinutes > 0 ? formatMinutes(workedMinutes) : "");
  }, [workedMinutes]);

  // Estimated is now a free text input (was a presets-only <select>) so a
  // custom amount can be typed directly.
  const [estimateInput, setEstimateInput] = useState(
    task.estimated_minutes ? formatMinutes(task.estimated_minutes) : ""
  );
  useEffect(() => {
    setEstimateInput(task.estimated_minutes ? formatMinutes(task.estimated_minutes) : "");
  }, [task.estimated_minutes]);

  const prevStatusRef = useRef(task.status);
  const justCompleted = task.status === "done" && prevStatusRef.current !== "done";
  useEffect(() => { prevStatusRef.current = task.status; }, [task.status]);

  // Parse "1h 30m" / "90m" / a bare "90" (treated as minutes) → total minutes.
  function parseTimeFlexible(input: string): number {
    // parseTimeInput already handles the bare-integer case; the old extra
    // fallback here was redundant.
    return parseTimeInput(input);
  }

  function commitWorked() {
    const total = parseTimeFlexible(workedInput);
    if (total === workedMinutes) {
      // Normalize the display in case user typed garbage
      setWorkedInput(workedMinutes > 0 ? formatMinutes(workedMinutes) : "");
      return;
    }
    onSetWorked(task.id, total);
  }

  function commitEstimate() {
    const total = parseTimeFlexible(estimateInput);
    if (total === (task.estimated_minutes ?? 0)) {
      setEstimateInput(task.estimated_minutes ? formatMinutes(task.estimated_minutes) : "");
      return;
    }
    onSetEstimate(task.id, total > 0 ? total : null);
  }

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="flex flex-row items-start gap-3 p-4 bg-elevated border border-line-soft rounded-lg mb-4 hover:border-line-medium group cursor-grab active:cursor-grabbing"
    >
      {/* Checkbox */}
      <button
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => onToggle(task)}
        title={task.status === "done" ? "Mark as not done" : "Mark complete"}
        className={`w-[18px] h-[18px] rounded-full border-2 flex-shrink-0 cursor-pointer flex items-center justify-center mt-[1px] transition-colors ${
          task.status === "done"
            ? "bg-accent-green border-accent-green hover:bg-accent-green-hover hover:border-accent-green-hover"
            : "border-line-strong hover:border-accent-green"
        }`}
      >
        <svg
          width="9"
          height="9"
          viewBox="0 0 12 12"
          fill="none"
          stroke={task.status === "done" ? "var(--text-on-accent)" : "var(--text-faded)"}
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path
            d="M2.5 6.2l2.5 2.3L9.5 3.7"
            className={justCompleted ? "animate-check-draw" : ""}
          />
        </svg>
      </button>

      {/* Content wrapper — flex:1, min-width:0 prevents text overflow */}
      <div className="flex-1 min-w-0">
        {/* Title row — actions sit here (right-aligned via ml-auto) so
            they always live at the title's vertical level, never
            overlapping the metadata pills row below. */}
        <div className="flex items-start gap-3">
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onOpenDetail(task)}
            className={`text-[13px] font-normal text-left cursor-pointer hover:underline flex-1 min-w-0 leading-[1.5] line-clamp-2 ${
              task.status === "done"
                ? "text-fg-faded line-through"
                : "text-fg"
            }`}
          >
            {task.title}
          </button>

          {/* Actions — visible on row hover. Anchored to title row, not
              spanning full row height. */}
          <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
            {task.status !== "done" && (
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onStart(task)}
                className="flex items-center gap-1.5 rounded-md border border-accent-blue/50 text-accent-blue-soft-fg px-2.5 py-1 text-[11px] font-medium cursor-pointer hover:border-accent-blue hover:bg-accent-blue-soft transition-colors"
                title="Start focus"
              >
                <svg width="7" height="9" viewBox="0 0 8 10" fill="currentColor">
                  <path d="M0 0v10l8-5z" />
                </svg>
                Start
              </button>
            )}
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onDelete(task.id)}
              title="Delete task"
              className="text-fg-faded p-1 rounded-[5px] cursor-pointer hover:text-accent-destructive hover:bg-accent-destructive/[0.08] transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 4h12M5.33 4V2.67a1.33 1.33 0 011.34-1.34h2.66a1.33 1.33 0 011.34 1.34V4M13 4v9.33a1.33 1.33 0 01-1.33 1.34H4.33A1.33 1.33 0 013 13.33V4" />
              </svg>
            </button>
          </div>
        </div>

        {/* Metadata row — date | (worked + estimated). All three pills
            share the canonical chrome but are visually grouped: date
            stands alone, worked+estimated cluster as a pair (they're
            naturally a pair), with a wider gap separating the two
            categories. */}
        <div className="flex items-center gap-3 mt-2">
          <div
            className="w-[110px] flex-shrink-0"
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <CalendarPicker
              label="Date"
              value={task.date_scheduled ?? ""}
              onChange={(date) => onSetDate(task.id, date)}
              onClear={() => onSetDate(task.id, "")}
              placeholder="No date"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <LabeledInputPill label="Worked" tone="time">
              <input
                type="text"
                value={workedInput}
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onChange={(e) => setWorkedInput(e.target.value)}
                onBlur={commitWorked}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.currentTarget.blur();
                  } else if (e.key === "Escape") {
                    setWorkedInput(workedMinutes > 0 ? formatMinutes(workedMinutes) : "");
                    e.currentTarget.blur();
                  }
                }}
                onFocus={(e) => e.currentTarget.select()}
                placeholder="—"
                title={`Worked ${formatMinutes(workedMinutes)}`}
                className="bg-transparent border-none outline-none text-[12px] font-medium leading-[1.2] tabular-nums text-fg placeholder:text-fg-disabled w-full cursor-text"
              />
            </LabeledInputPill>

            <LabeledInputPill label="Estimated" tone="time">
              <input
                type="text"
                value={estimateInput}
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onChange={(e) => setEstimateInput(e.target.value)}
                onBlur={commitEstimate}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.currentTarget.blur();
                  } else if (e.key === "Escape") {
                    setEstimateInput(task.estimated_minutes ? formatMinutes(task.estimated_minutes) : "");
                    e.currentTarget.blur();
                  }
                }}
                onFocus={(e) => e.currentTarget.select()}
                placeholder="—"
                title="Estimated time (type e.g. 20 or 1h 30m)"
                className="bg-transparent border-none outline-none text-[12px] font-medium leading-[1.2] tabular-nums text-fg placeholder:text-fg-disabled w-full cursor-text"
              />
            </LabeledInputPill>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Project switcher panel ─────────────────────────────────────────────────
// ─── Main component ─────────────────────────────────────────────────────────

export default function ProjectDetail() {
  const { selectedProjectId, startFocus, goBack, setPage } = useAppStore();
  const openTaskDetail = useAppStore((s) => s.openTaskDetail);
  // M3.2.b.2 — task list now flows through the canonical store. The
  // selector returns ID list for the project; resolution against
  // tasksById happens in a memo below. Per-row TaskCard subscription
  // lands in M3.2.b.4 — until then the parent re-renders on any task
  // mutation but with no DB roundtrip.
  const projectTaskIds = useAppStore((s) =>
    selectedProjectId !== null ? selectTaskIdsByProject(s, selectedProjectId) : null,
  );
  const tasksById = useAppStore((s) => s.tasksById);
  const loadTasksForProject = useAppStore((s) => s.loadTasksForProject);
  const updateTaskAction = useAppStore((s) => s.updateTask);
  const deleteTaskAction = useAppStore((s) => s.deleteTaskAction);
  const setTaskStatusAction = useAppStore((s) => s.setTaskStatus);
  const setTaskWorkedMinutesAction = useAppStore((s) => s.setTaskWorkedMinutesAction);
  const setTaskDateScheduledAction = useAppStore((s) => s.setTaskDateScheduled);
  const setTaskSortOrdersAction = useAppStore((s) => s.setTaskSortOrders);
  const createTaskAction = useAppStore((s) => s.createTaskAction);
  // P3 — the viewed project comes from the canonical store (single-value
  // selector, no useShallow needed).
  const project = useAppStore((s) => selectProjectById(s, selectedProjectId)) ?? null;
  // P3 — project mutations route through reconciling store actions.
  const updateProjectAction = useAppStore((s) => s.updateProjectAction);
  const completeProjectAction = useAppStore((s) => s.completeProjectAction);
  const setProjectPriorityAction = useAppStore((s) => s.setProjectPriorityAction);
  const setProjectIconAction = useAppStore((s) => s.setProjectIconAction);
  const archiveProjectAction = useAppStore((s) => s.archiveProjectAction);
  const deleteProjectAction = useAppStore((s) => s.deleteProjectAction);
  // Colors used by *other* active projects — drives the disabled swatches.
  // Derived from the canonical active set (was a fetched+setState pair).
  const activeProjects = useAppStore(
    useShallow((s) => selectProjectsByStatus(s, "active")),
  );
  const takenColors = useMemo(
    () =>
      activeProjects
        .filter((p) => p.id !== selectedProjectId)
        .map((p) => p.color),
    [activeProjects, selectedProjectId],
  );
  // P2 — committed worked-minutes from the canonical store (was a private
  // workedMap). Committed-only here on purpose: the project badge is a
  // history value, and subscribing to the live focus tick would re-render
  // ProjectDetail every second. A live session reconciles into the index on
  // stop (stopFocusedSessionForTask) / next load.
  const workedByTaskId = useAppStore((s) => s.workedByTaskId);
  const loadWorkedMinutesAction = useAppStore((s) => s.loadWorkedMinutes);
  const [error, setError] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(true);

  // Inline project fields (auto-saved)
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editStartDate, setEditStartDate] = useState("");
  const [editTargetDate, setEditTargetDate] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const projectSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  // P3 — seed the (debounce-saved) edit fields exactly ONCE per project.
  // The form is auto-saved, so re-seeding on every canonical-store project
  // change (e.g. our own committed save reconciling back in) would clobber
  // an in-progress edit. The ref gates seeding to the first time we see a
  // given project id.
  const initedForId = useRef<number | null>(null);
  useEffect(() => {
    if (!project || project.id !== selectedProjectId) return;
    if (initedForId.current === project.id) return; // already seeded for this project
    initedForId.current = project.id;
    setEditName(project.name);
    setEditColor(project.color);
    setEditDescription(project.description ?? "");
    setEditStartDate(project.start_date ?? "");
    setEditTargetDate(project.target_date ?? "");
    setEditNotes(project.notes ? project.notes : project.description ? project.description : "");
  }, [project, selectedProjectId]);

  // Task creation
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskEstimate, setNewTaskEstimate] = useState("");
  const [newTaskHighPriority, setNewTaskHighPriority] = useState(false);
  const [newTaskDate, setNewTaskDate] = useState("");

  // Quick-add modal — opened by clicking a day column in the "This week" grid;
  // pre-fills date_scheduled to the clicked day.
  const [quickAddDate, setQuickAddDate] = useState<string | null>(null);

  // Task detail overlay

  // Title shown in the floating drag chip — set on drag start, cleared
  // on drag end. Drives the DragOverlay so the user has live visual
  // feedback (chip following the cursor) instead of only seeing the
  // result on mouseup.
  const [activeDragTitle, setActiveDragTitle] = useState<string | null>(null);

  // UI state
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  // pendingDelete snapshots a task during the 5-second deletion-undo
  // window so undoDelete can restore it without a refetch. Same
  // single-component undo-state shape as DailyPlanner's
  // recentlyPulled and ScheduleTab's activeDragTask.
  const [pendingDelete, setPendingDelete] = useState<{
    // eslint-disable-next-line no-restricted-syntax -- single-component pending-delete undo state, see comment above
    task: Task;
    timeoutId: ReturnType<typeof setTimeout>;
  } | null>(null);

  const [confirmDeleteProject, setConfirmDeleteProject] = useState(false);


  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // M3.2.b.2 — derive the project's tasks from the canonical map.
  // Memoized so the array ref is stable across renders that don't
  // change inputs. Includes done tasks; the `visibleTasks` memo
  // below filters by showDone for the rendered list. Stats also
  // honor a pendingDelete filter so the 5-second optimistic hide
  // matches what the user sees in the list.
  const tasks = useMemo(() => {
    if (projectTaskIds === null) return [] as Task[];
    const out: Task[] = [];
    const hiddenId = pendingDelete?.task.id ?? -1;
    for (const id of projectTaskIds) {
      if (id === hiddenId) continue;
      const t = tasksById.get(id);
      if (t) out.push(t);
    }
    // Default order for uncompleted tasks: UNDATED first (a newly-added task
    // has no date, so it surfaces at the top), then dated tasks by soonest —
    // due date, falling back to the scheduled date. Done tasks sink to the
    // bottom. sort_order breaks ties (so among undated, the most-recently-added
    // — smallest sort_order via prepend-on-create — leads, and a manual drag
    // still orders same-date tasks).
    const effectiveDate = (t: Task): string | null => t.due_date ?? t.date_scheduled;
    out.sort((a, b) => {
      const aDone = a.status === "done" ? 1 : 0;
      const bDone = b.status === "done" ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;
      if (aDone === 0) {
        const ad = effectiveDate(a);
        const bd = effectiveDate(b);
        if (!ad && bd) return -1; // undated first
        if (ad && !bd) return 1;
        if (ad && bd && ad !== bd) return ad < bd ? -1 : 1;
      }
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    });
    return out;
  }, [projectTaskIds, tasksById, pendingDelete]);

  // List-render slice — applies the showDone toggle. The drag-reorder
  // handler uses this same slice so reorder operates on what the
  // user actually sees.
  const visibleTasks = useMemo(
    () => (showDone ? tasks : tasks.filter((t) => t.status !== "done")),
    [tasks, showDone],
  );

  // Refresh task list only — safe to call during edits. Goes through
  // the store's load action (writes to canonical map + indices). The
  // worked-minutes refresh stays here because it's M3.3 territory.
  const refreshTasks = useCallback(async () => {
    if (selectedProjectId === null) return;
    try {
      await loadTasksForProject(selectedProjectId);
      setError(null);
      const ids =
        useAppStore.getState().taskIdsByProject.get(selectedProjectId) ?? [];
      await loadWorkedMinutesAction(ids);
    } catch (e) {
      setError(errorMessage(e, "Failed to load tasks"));
    }
  }, [selectedProjectId, loadTasksForProject, loadWorkedMinutesAction]);

  // Full load — resets edit fields (only on mount / project switch).
  // #14 — `isStale` lets the caller abort state writes if the component
  // unmounted or switched projects mid-read (fast project switching), so a slow
  // load can't flash stale data or warn. Effect-driven callers pass it via the
  // cancelled-ref pattern; event-handler callers (mounted) omit it.
  const loadData = useCallback(async (isStale?: () => boolean) => {
    if (selectedProjectId === null) return;
    try {
      // P3 — the project itself + taken colors now come from the canonical
      // store (selectProjectById / selectProjectsByStatus); edit-field
      // seeding moved to the one-time init effect above. loadData only
      // loads the task list + worked-minutes index.
      await loadTasksForProject(selectedProjectId);
      if (isStale?.()) return;
      const ids =
        useAppStore.getState().taskIdsByProject.get(selectedProjectId) ?? [];
      await loadWorkedMinutesAction(ids);
      if (isStale?.()) return;
      setError(null);
    } catch (e) {
      setError(errorMessage(e, "Failed to load project"));
    }
  }, [selectedProjectId, loadTasksForProject, loadWorkedMinutesAction]);

  useEffect(() => {
    // Finalize any pending delete when switching projects
    if (pendingDelete) {
      clearTimeout(pendingDelete.timeoutId);
      deleteTaskAction(pendingDelete.task.id).catch(() => {});
      setPendingDelete(null);
    }
    // #14 — cancelled-ref: a project switch or unmount mid-load marks this run
    // stale so loadData skips its state writes.
    let cancelled = false;
    loadData(() => cancelled);
    setConfirmDeleteId(null);
    return () => {
      cancelled = true;
    };
  }, [loadData]);

  // M3.2.b.5.b — verseday:task-updated/-deleted listener retired.
  // Task-data reactivity flows through selectTaskIdsByProject +
  // tasksById subscriptions. workedMap aggregates are M3.3 territory
  // and accept stale-until-mount in this window.

  // ── Project auto-save (debounced) ─────────────────────────────────────

  function debouncedSaveProject(
    name: string,
    color: string,
    description: string,
    startDate: string,
    targetDate: string,
    notes: string
  ) {
    if (projectSaveRef.current) clearTimeout(projectSaveRef.current);
    projectSaveRef.current = setTimeout(async () => {
      if (!project) return;
      const trimmedName = name.trim();
      if (!trimmedName) return;
      try {
        await updateProjectAction({
          id: project.id,
          name: trimmedName,
          color,
          description: description.trim() || null,
          startDate: startDate || null,
          targetDate: targetDate || null,
          notes: notes.trim() || null,
        });
      } catch (e) {
        setError(errorMessage(e, "Failed to save project"));
      }
    }, 600);
  }

  useEffect(() => {
    return () => {
      if (projectSaveRef.current) clearTimeout(projectSaveRef.current);
    };
  }, []);

  // Auto-grow project title textarea whenever the name (or its derived
  // font size) changes — covers async loads and project switches.
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [editName]);

  // Flush pending saves immediately (for modal close)
  function flushProjectSave() {
    if (projectSaveRef.current && project) {
      clearTimeout(projectSaveRef.current);
      projectSaveRef.current = null;
      const trimmedName = editName.trim();
      if (trimmedName) {
        updateProjectAction({
          id: project.id,
          name: trimmedName,
          color: editColor,
          description: editDescription.trim() || null,
          startDate: editStartDate || null,
          targetDate: editTargetDate || null,
          notes: editNotes.trim() || null,
        }).catch(() => {});
      }
    }
  }

  function handleClose() {
    flushProjectSave();
    goBack();
  }

  // The modal is dismissed by clicking outside (handled in App.tsx) — that
  // path doesn't go through handleClose, so any debounced project edit
  // would be lost on unmount. Flush on teardown via a ref to the latest
  // closure so we always read the current edit state.
  const flushRef = useRef(flushProjectSave);
  flushRef.current = flushProjectSave;
  useEffect(() => {
    return () => {
      flushRef.current();
    };
  }, []);

  // Esc closes the modal. If the user is mid-edit in any input/textarea,
  // first Esc blurs that field; a second Esc then closes — same pattern
  // as the daily shutdown.
  const closeRef = useRef(handleClose);
  closeRef.current = handleClose;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      const el = document.activeElement;
      const isInput =
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          (el as HTMLElement).isContentEditable);
      if (isInput) {
        (el as HTMLElement).blur();
        return;
      }
      e.preventDefault();
      closeRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function handleDeleteProject() {
    if (!selectedProjectId) return;
    try {
      await deleteProjectAction(selectedProjectId);
      goBack();
    } catch (e) {
      setError(errorMessage(e, "Failed to delete project"));
      setConfirmDeleteProject(false);
    }
  }

  async function handleArchive() {
    if (!selectedProjectId) return;
    try {
      await archiveProjectAction(selectedProjectId, true);
      goBack();
    } catch (e) {
      setError(errorMessage(e, "Failed to archive objective"));
    }
  }

  function updateField(
    field: "name" | "color" | "description" | "startDate" | "targetDate" | "notes",
    value: string
  ) {
    const next = {
      name: editName,
      color: editColor,
      description: editDescription,
      startDate: editStartDate,
      targetDate: editTargetDate,
      notes: editNotes,
      [field]: value,
    };
    if (field === "name") setEditName(value);
    else if (field === "color") setEditColor(value);
    else if (field === "description") setEditDescription(value);
    else if (field === "startDate") setEditStartDate(value);
    else if (field === "targetDate") setEditTargetDate(value);
    else if (field === "notes") setEditNotes(value);

    debouncedSaveProject(
      next.name,
      next.color,
      next.description,
      next.startDate,
      next.targetDate,
      next.notes
    );
  }

  // Atomic start+target write. updateField reads sibling fields from the
  // current closure, so calling it twice in a row (start then target) would
  // race on stale state and one debounced save would clobber the other. The
  // date range is always set as a pair, in a single debounced write.
  function updateDates(start: string, target: string) {
    setEditStartDate(start);
    setEditTargetDate(target);
    debouncedSaveProject(editName, editColor, editDescription, start, target, editNotes);
  }

  // ── Project completion ───────────────────────────────────────────────

  async function handleCompleteToggle() {
    if (!project) return;
    try {
      // Action reconciles into the canonical store; the selector re-renders us.
      await completeProjectAction(project.id, !project.completed);
    } catch (e) {
      setError(errorMessage(e, "Failed to update project"));
    }
  }

  async function handlePriorityToggle() {
    if (!project) return;
    try {
      await setProjectPriorityAction(project.id, !project.priority);
    } catch (e) {
      setError(errorMessage(e, "Failed to update priority"));
    }
  }

  async function handleSetIcon(icon: string | null, customIconId: number | null) {
    if (!project) return;
    try {
      await setProjectIconAction(project.id, icon, customIconId);
    } catch (e) {
      setError(errorMessage(e, "Failed to set icon"));
    }
  }

  // ── Task CRUD ─────────────────────────────────────────────────────────

  async function handleAddTask(e: React.FormEvent) {
    e.preventDefault();
    let title = newTaskTitle.trim();
    if (!title) return;
    if (title.length > MAX_TITLE_LENGTH) {
      setError(`Title must be ${MAX_TITLE_LENGTH} characters or less`);
      return;
    }
    let est: number | null = null;
    if (newTaskEstimate) {
      est = parseInt(newTaskEstimate);
      if (isNaN(est) || est < 1 || est > MAX_ESTIMATE_MINUTES) {
        setError(`Estimate must be 1–${MAX_ESTIMATE_MINUTES} minutes`);
        return;
      }
    }
    // Smart time parsing from title if no manual estimate
    if (est == null) {
      const parsed = parseTimeFromTitle(title);
      if (parsed.minutes != null) {
        title = parsed.cleanTitle;
        est = parsed.minutes;
      }
    }
    try {
      await createTaskAction({
        title,
        projectId: selectedProjectId,
        dateScheduled: newTaskDate || null,
        estimatedMinutes: est,
        priority: newTaskHighPriority ? "high" : "medium",
      });
      setNewTaskTitle("");
      setNewTaskEstimate("");
      setNewTaskHighPriority(false);
      setNewTaskDate("");
      setError(null);
      refreshTasks();
    } catch (e) {
      setError(errorMessage(e, "Failed to add task"));
    }
  }

  async function handleQuickAddForDate(date: string, rawTitle: string) {
    let title = rawTitle.trim();
    if (!title) return;
    if (title.length > MAX_TITLE_LENGTH) {
      setError(`Title must be ${MAX_TITLE_LENGTH} characters or less`);
      return;
    }
    let est: number | null = null;
    const parsed = parseTimeFromTitle(title);
    if (parsed.minutes != null) {
      title = parsed.cleanTitle;
      est = parsed.minutes;
    }
    try {
      await createTaskAction({
        title,
        projectId: selectedProjectId,
        dateScheduled: date,
        estimatedMinutes: est,
        priority: "medium",
      });
      setQuickAddDate(null);
      setError(null);
      refreshTasks();
    } catch (e) {
      setError(errorMessage(e, "Failed to add task"));
    }
  }

  async function toggleTask(task: Task) {
    try {
      await setTaskStatusAction(task.id, task.status === "done" ? "todo" : "done");
      refreshTasks();
    } catch (e) {
      setError(errorMessage(e, "Failed to update task"));
    }
  }

  async function handleStartFocus(task: Task) {
    // Clicking Focus on the already-focused task is a no-op.
    if (useAppStore.getState().focus?.taskId === task.id) return;
    try {
      // #8 — commit any in-flight session (instead of refusing to start) so the
      // outgoing session's worked time is saved before focus is overwritten.
      await useAppStore.getState().endActiveFocusSession();
      const priorMinutes = await getWorkedMinutesForTask(task.id);
      const priorMs = priorMinutes * 60 * 1000;
      const entryId = await startTimeEntry(task.id, "tracked");
      startFocus(task, entryId, "project_detail", priorMs);
      // Project detail's play button keeps the immersive flow — the
      // explicit "stay inline" UX is Daily Plan's only.
      setPage("focus");
    } catch (e) {
      setError(errorMessage(e, "Failed to start timer"));
    }
  }

  function handleDeleteTask(id: number) {
    // Remove from UI immediately, defer actual delete for undo window
    const taskToDelete = tasks.find((t) => t.id === id);
    if (!taskToDelete) return;

    // Cancel any existing pending delete — finalize via the store action.
    if (pendingDelete) {
      clearTimeout(pendingDelete.timeoutId);
      deleteTaskAction(pendingDelete.task.id).catch(() => {});
    }

    setConfirmDeleteId(null);
    // Optimistic hide — the `tasks` memo above filters out
    // pendingDelete.task.id, so the row vanishes from the list
    // without a direct setTasks call.
    const timeoutId = setTimeout(async () => {
      try {
        await deleteTaskAction(id);
      } catch (e) {
        setError(errorMessage(e, "Failed to delete task"));
      }
      setPendingDelete(null);
    }, 5000);

    setPendingDelete({ task: taskToDelete, timeoutId });
  }

  async function undoDelete() {
    if (!pendingDelete) return;
    clearTimeout(pendingDelete.timeoutId);
    setPendingDelete(null);
    // Re-insert the task by reloading
    refreshTasks();
  }

  function handleDragStart(event: DragStartEvent) {
    const activeId = String(event.active.id);
    const taskId = activeId.startsWith(PD_DAY_TASK_PREFIX)
      ? Number(activeId.slice(PD_DAY_TASK_PREFIX.length))
      : Number(activeId);
    if (Number.isNaN(taskId)) return;
    const task = tasks.find((t) => t.id === taskId);
    setActiveDragTitle(task?.title ?? null);
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveDragTitle(null);
    const { active, over } = event;
    if (!over) return;

    // Drop onto a "This week" day cell → schedule the task to that day.
    // Source can be the main sortable list (active.id is plain task
    // number) or a day-cell chip (active.id is "pd-task-{n}").
    const overId = String(over.id);
    const activeId = String(active.id);
    if (overId.startsWith(PD_DAY_DROP_PREFIX)) {
      const dateIso = overId.slice(PD_DAY_DROP_PREFIX.length);
      const taskId = activeId.startsWith(PD_DAY_TASK_PREFIX)
        ? Number(activeId.slice(PD_DAY_TASK_PREFIX.length))
        : Number(activeId);
      if (Number.isNaN(taskId)) return;
      try {
        await setTaskDateScheduledAction(taskId, dateIso);
        refreshTasks();
      } catch (e) {
        setError(errorMessage(e, "Failed to schedule task"));
      }
      return;
    }

    // Day-cell chips can't reorder the main task list — bail before
    // the sortable lookup below (their ids aren't in `tasks`).
    if (activeId.startsWith(PD_DAY_TASK_PREFIX)) return;

    // Otherwise: sortable reorder within the rendered (visible) list.
    if (active.id === over.id) return;
    const oldIndex = visibleTasks.findIndex((t) => t.id === active.id);
    const newIndex = visibleTasks.findIndex((t) => t.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    // M3.2.b.5.b — store action handles SQL batch + canonical map
    // sort_order patches + index slice replacement atomically. The
    // bucket parameter is the project bucket (not date) since this
    // is the project-task list reorder. Note: visibleTasks excludes
    // done tasks if showDone=false, but the bucket replacement
    // expects the COMPLETE ordered ID list. To preserve done tasks'
    // relative order, we reorder the visible portion in-place
    // within the full bucket and pass that.
    const reorderedVisible = arrayMove(visibleTasks, oldIndex, newIndex);
    const visibleIdSet = new Set(visibleTasks.map((t) => t.id));
    const reorderedVisibleIter = reorderedVisible[Symbol.iterator]();
    const orderedIds: number[] = [];
    for (const t of tasks) {
      if (visibleIdSet.has(t.id)) {
        const next = reorderedVisibleIter.next();
        if (!next.done) orderedIds.push(next.value.id);
      } else {
        orderedIds.push(t.id);
      }
    }
    try {
      await setTaskSortOrdersAction(
        { kind: "project", projectId: selectedProjectId! },
        orderedIds,
      );
    } catch (e) {
      setError(errorMessage(e, "Failed to reorder"));
      refreshTasks();
    }
  }

  // ── Render ────────────────────────────────────────────────────────────

  if (!project) {
    return (
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 flex items-center justify-center text-fg-faded text-[14px]">
          Loading...
        </div>
      </div>
    );
  }

  const weekDates = getCurrentWeekdayDates();

  return (
    <div className="relative flex flex-1 overflow-hidden flex-col h-full max-w-[1400px] mx-auto w-full">
        <ErrorBanner error={error} onDismiss={() => setError(null)} />

        {/* Undo delete banner — absolute overlay so it doesn't push the
            modal's content down (which was clipping the bottom day
            strip). Slides in from the top, auto-dismisses with the
            existing pendingDelete timeout. */}
        {pendingDelete && (
          <div
            className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-4 px-4 py-2 rounded-full text-[12px] max-w-[520px] min-w-[320px] animate-slide-up"
            style={{
              background: "var(--bg-banner)",
              color: "var(--text-banner)",
              boxShadow: "var(--shadow-card)",
            }}
          >
            <span className="flex-1 truncate">
              Deleted &ldquo;{pendingDelete.task.title}&rdquo;
            </span>
            <button
              onClick={undoDelete}
              className="font-semibold cursor-pointer transition-opacity flex-shrink-0 underline underline-offset-[3px] hover:opacity-80"
              style={{ color: "var(--text-banner)" }}
            >
              Undo
            </button>
          </div>
        )}

        {/* Header strip — hero title row */}
        <div className="px-8 pt-7 pb-5 border-b border-divider flex-shrink-0">
          <div className="flex items-center gap-3">
            {/* Color picker — click-to-toggle so the popover survives
                the cursor's trip across the gap from the dot. Closes
                on outside click or color selection. */}
            <ColorPicker
              value={editColor}
              takenColors={takenColors}
              onChange={(c) => updateField("color", c)}
            />

            {/* Objective icon — emoji or custom uploaded image (#25) */}
            <ProjectIconPicker
              project={project}
              onPick={(icon, customIconId) => handleSetIcon(icon, customIconId)}
            />

            {/* Editable name — 22px hero; shrinks for longer titles */}
            <textarea
              ref={titleRef}
              value={editName}
              onChange={(e) => updateField("name", e.target.value.replace(/\n/g, ""))}
              maxLength={MAX_TITLE_LENGTH}
              rows={1}
              className="flex-1 min-w-0 font-medium text-fg bg-transparent border-none outline-none resize-none leading-tight overflow-hidden focus:bg-elevated focus:border focus:border-accent-blue focus:rounded-md focus:px-2 focus:-mx-2"
              style={{
                fontSize:
                  editName.length <= 40
                    ? 22
                    : editName.length <= 80
                      ? 18
                      : 16,
              }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = el.scrollHeight + "px";
              }}
            />

            <button
              onClick={handlePriorityToggle}
              title={project.priority ? "Remove priority" : "Mark high priority (sorts to top of Objectives)"}
              className={`flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-md cursor-pointer transition-colors ${
                project.priority
                  ? "text-accent-orange hover:bg-overlay-hover"
                  : "text-fg-faded hover:text-fg-secondary hover:bg-overlay-hover"
              }`}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill={project.priority ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
                <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 18.9 6.1 21.5l1.2-6.5L2.5 9.4l6.6-.9z" />
              </svg>
            </button>
            <button
              onClick={handleCompleteToggle}
              className={`text-[12px] font-medium cursor-pointer px-2.5 py-1 rounded-md border flex-shrink-0 transition-colors ${
                project.completed
                  ? "border-accent-green/50 text-accent-green-deep hover:border-accent-green hover:bg-accent-green-soft"
                  : "border-accent-blue/50 text-accent-blue-soft-fg hover:border-accent-blue hover:bg-accent-blue-soft"
              }`}
            >
              {project.completed ? "✓ Completed" : "Mark Complete"}
            </button>
            <button
              onClick={handleArchive}
              title="Archive objective"
              className="text-fg-faded hover:text-fg-secondary hover:bg-overlay-hover cursor-pointer flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-md transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="12" height="3" rx="0.5" />
                <path d="M3 6v7a1 1 0 001 1h8a1 1 0 001-1V6" />
                <path d="M6.5 9h3" />
              </svg>
            </button>
            <button
              onClick={() => setConfirmDeleteProject(true)}
              title="Delete objective"
              className="text-fg-faded hover:text-accent-destructive hover:bg-accent-destructive/[0.08] cursor-pointer flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-md transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 4h12M5.33 4V2.67a1.33 1.33 0 011.34-1.34h2.66a1.33 1.33 0 011.34 1.34V4M13 4v9.33a1.33 1.33 0 01-1.33 1.34H4.33A1.33 1.33 0 013 13.33V4" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body — split panel. DndContext wraps both halves so tasks
            can be dragged from the list (left) onto "This week" day
            cells (right). */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
        <div className="flex flex-1 min-h-0">
          {/* Main: Tasks (work surface) */}
          <div className="flex-[1.2] min-w-0 flex flex-col overflow-hidden">
            {/* Task input row — slim, right under the header. */}
            <form
              onSubmit={handleAddTask}
              className="flex items-center gap-2 mx-8 mt-5 mb-3 px-3 py-1.5 border border-line-soft rounded-md bg-elevated flex-shrink-0"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 14 14"
                fill="none"
                stroke="var(--text-disabled)"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <line x1="7" y1="3" x2="7" y2="11" />
                <line x1="3" y1="7" x2="11" y2="7" />
              </svg>
              <input
                type="text"
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                maxLength={MAX_TITLE_LENGTH}
                placeholder="Add a task to this objective..."
                className="flex-1 bg-transparent border-none outline-none text-[13px] text-fg placeholder:text-fg-faded"
              />
              <button
                type="submit"
                className="border border-accent-blue/50 text-accent-blue-soft-fg rounded-md px-3 py-0.5 text-[12px] font-medium cursor-pointer hover:border-accent-blue hover:bg-accent-blue-soft transition-colors"
              >
                Add
              </button>
            </form>

            {/* Task list header */}
            <div className="flex items-center justify-between px-8 pb-2 flex-shrink-0">
              <span className="uppercase text-fg-faded [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)]">
                Tasks
              </span>
              <button
                onClick={() => setShowDone(!showDone)}
                className={`flex items-center gap-1.5 text-[11px] cursor-pointer px-2 py-1 rounded-full border bg-elevated hover:bg-overlay-hover ${
                  showDone
                    ? "text-accent-blue-soft-fg border-accent-blue/20"
                    : "text-fg-faded border-line-soft"
                }`}
              >
                {showDone ? "Hide completed" : "Show completed"}
              </button>
            </div>

            {/* Task list — scrollable region */}
            <div className="overflow-y-auto px-8 pb-5 flex-1 min-h-0">
            <SortableContext
              items={visibleTasks.map((t) => t.id)}
              strategy={verticalListSortingStrategy}
            >
              {visibleTasks.length === 0 ? (
                <p className="text-center text-fg-faded py-8 text-[13px]">
                  No tasks yet. Add one above.
                </p>
              ) : (
                visibleTasks.map((task) => {
                  // Render the row + an overlay for the delete-confirm
                  // prompt. Overlaying instead of replacing keeps the
                  // row's height locked so confirming/cancelling
                  // doesn't jump the rest of the list around.
                  const isConfirming = confirmDeleteId === task.id;
                  return (
                    <div key={task.id} className="relative">
                      <SortableTaskRow
                      task={task}
                      workedMinutes={workedByTaskId.get(task.id) ?? 0}
                      onToggle={toggleTask}
                      onOpenDetail={(t) => openTaskDetail(t.id)}
                      onDelete={(id) => setConfirmDeleteId(id)}
                      onStart={handleStartFocus}
                      onSetDate={(id, date) => {
                        setTaskDateScheduledAction(id, date || null)
                          .then(() => refreshTasks())
                          .catch((e) => setError(errorMessage(e, "Failed to set date")));
                      }}
                      onSetEstimate={(id, minutes) => {
                        const t = tasks.find((x) => x.id === id);
                        if (!t) return;
                        updateTaskAction({
                          id,
                          title: t.title,
                          projectId: t.project_id,
                          estimatedMinutes: minutes,
                          priority: t.priority,
                          notes: t.notes,
                          dateScheduled: t.date_scheduled,
                        })
                          .then(() => refreshTasks())
                          .catch((e) => setError(errorMessage(e, "Failed to set estimate")));
                      }}
                      onSetWorked={(id, minutes) => {
                        setTaskWorkedMinutesAction(id, minutes)
                          .then(() => refreshTasks())
                          .catch((e) => setError(errorMessage(e, "Failed to set worked time")));
                      }}
                    />
                      {isConfirming && (
                        <div
                          className="absolute inset-0 z-10 px-3 rounded-lg bg-elevated border border-line-soft flex items-center gap-3"
                        >
                          <span className="flex-1 text-[12px]">
                            <span className="text-accent-destructive">
                              Delete &ldquo;{task.title}&rdquo;?
                            </span>{" "}
                            <span className="text-accent-warning-soft-fg">
                              Time entries will also be deleted.
                            </span>
                          </span>
                          <button
                            onClick={() => handleDeleteTask(task.id)}
                            className="border border-accent-destructive/50 text-accent-destructive rounded-md px-3 py-1 text-[11px] font-medium cursor-pointer hover:border-accent-destructive hover:bg-accent-destructive/[0.08] transition-colors"
                          >
                            Delete
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="text-fg-faded text-[11px] cursor-pointer hover:text-fg-secondary"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </SortableContext>
        </div>
          </div>

          {/* Right rail: dates + notes + this-week. Flex column so the
              week grid at the bottom can grow into available vertical
              space instead of leaving an empty band beneath it. */}
          <div className="flex-1 min-w-[200px] border-l border-line-hairline bg-rail p-8 overflow-y-auto flex flex-col gap-8">
            <div>
              <div className="uppercase [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] text-fg-faded mb-1.5">
                Dates
              </div>
              <DateRangeField
                defaultMode="range"
                emptyLabel="Set dates"
                value={{ start: editStartDate || null, end: editTargetDate || null }}
                onChange={(v) => updateDates(v.start ?? "", v.end ?? "")}
              />
            </div>

            <div>
              <div className="uppercase [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] text-fg-faded mb-2">
                Notes
              </div>
              {/* Borderless work-surface style — matches TaskDetailOverlay's
                  notes treatment so the eye lands on the writing, not the
                  chrome. */}
              <RichTextEditor
                value={editNotes}
                onChange={(html) => updateField("notes", html)}
                placeholder="Add notes..."
                className="w-full bg-elevated rounded-md px-1 py-1 text-[13px] text-fg-secondary leading-relaxed min-h-[120px]"
              />
            </div>

            {/* This week — emphasized as the operational heart of the
                rail. Real heading typography (not a tiny uppercase
                label) and a hairline divider above to set it apart
                from the dates / notes blocks. flex-1 + min-h-0 lets
                the section grow into the rail's remaining vertical
                space; the grid inherits and the day cells stretch
                vertically (grid items default to align-items: stretch). */}
            <div className="pt-5 border-t border-line-hairline flex-1 min-h-0 flex flex-col">
              <h3 className="text-[15px] font-medium text-fg mb-3 font-display">
                This week
              </h3>
              <div className="grid grid-cols-5 gap-2 flex-1 min-h-0">
                {weekDates.map((date, i) => (
                  <PdDayCell
                    key={date}
                    date={date}
                    dayName={DAY_NAMES[i]}
                    dayTasks={tasks.filter((t) => t.date_scheduled === date)}
                    accentColor={editColor}
                    onQuickAdd={() => setQuickAddDate(date)}
                    onOpenTask={(t) => openTaskDetail(t.id)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Floating chip that follows the cursor while dragging — same
            pattern used in PlanTab. Drop animation disabled so it
            disappears cleanly on release rather than easing back to
            the source. */}
        <DragOverlay dropAnimation={null} modifiers={[snapCenterToCursor]}>
          {activeDragTitle && (
            <div
              className="px-3 py-1.5 rounded-md bg-elevated border border-accent-blue/40 text-[12px] text-fg max-w-[280px] truncate"
              style={{ boxShadow: "var(--shadow-card)" }}
            >
              {activeDragTitle}
            </div>
          )}
        </DragOverlay>
        </DndContext>

        {/* Footer */}
        <div className="flex items-center gap-2 px-8 py-3.5 border-t border-line-hairline flex-shrink-0">
          <span className="text-[10px] text-fg-disabled flex-1">
            Auto-saved
          </span>
          {confirmDeleteProject && (
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-accent-destructive">
                Delete objective &amp; all tasks?
              </span>
              <button
                onClick={handleDeleteProject}
                className="border border-accent-destructive/50 text-accent-destructive text-[11px] font-medium rounded-md px-2.5 py-1 cursor-pointer hover:border-accent-destructive hover:bg-accent-destructive/[0.08] transition-colors"
              >
                Delete
              </button>
              <button
                onClick={() => setConfirmDeleteProject(false)}
                className="text-[11px] text-fg-secondary hover:text-fg cursor-pointer px-1.5"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

      {/* TaskDetailOverlay is mounted as a singleton at App.tsx
          (M1 — see TaskDetailOverlayHost). After M3.2.b.5.b, host
          mutations route through store actions — task-list rows
          re-render via canonical-map subscriptions automatically. */}

      {/* Quick-add modal — pops up when a "This week" day cell is clicked */}
      {quickAddDate && (
        <DayQuickAddModal
          date={quickAddDate}
          onClose={() => setQuickAddDate(null)}
          onSubmit={(title) => handleQuickAddForDate(quickAddDate, title)}
        />
      )}
    </div>
  );
}

// Droppable day cell in the right-rail "This week" grid. Same visual
// treatment as before; extracted so we can hook useDroppable cleanly.
// On hover during a drag, accents the cell's border so the user knows
// it's a valid drop target.
function PdDayCell({
  date,
  dayName,
  dayTasks,
  accentColor,
  onQuickAdd,
  onOpenTask,
}: {
  date: string;
  dayName: string;
  dayTasks: Task[];
  accentColor: string;
  onQuickAdd: () => void;
  onOpenTask: (task: Task) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `${PD_DAY_DROP_PREFIX}${date}`,
  });
  const hasTasks = dayTasks.length > 0;

  return (
    <div
      ref={setNodeRef}
      onClick={onQuickAdd}
      title={`Add task for ${dayName}`}
      className={`min-w-0 cursor-pointer rounded-lg p-2 min-h-[88px] flex flex-col transition-colors border ${
        isOver
          ? "bg-accent-blue-soft border-accent-blue/40"
          : hasTasks
            ? "bg-elevated border-line-hairline hover:border-line-medium"
            : "bg-transparent border-line-hairline border-dashed hover:bg-overlay-hover hover:border-line-medium"
      }`}
    >
      <div
        className="text-[11px] font-medium uppercase tracking-[0.06em] text-center pb-1.5 mb-1.5 border-b transition-colors"
        style={{
          color: hasTasks ? accentColor : "var(--text-muted)",
          borderColor: hasTasks
            ? `color-mix(in srgb, ${accentColor} 25%, transparent)`
            : "var(--border-soft)",
        }}
      >
        {dayName}
      </div>
      {dayTasks.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-[10px] text-fg-disabled">—</div>
      ) : (
        <div className="space-y-1 flex-1">
          {dayTasks.map((task) => (
            <PdDayTaskChip
              key={task.id}
              task={task}
              onOpenTask={onOpenTask}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Draggable task chip inside a day cell. Uses a prefixed id so it
// doesn't collide with the main task list's plain-number sortable ids
// (the same task can appear in both views). Click opens detail; drag
// (after PointerSensor's 5px activation distance) lets the user move
// the task to another day's drop target.
function PdDayTaskChip({
  task,
  onOpenTask,
}: {
  task: Task;
  onOpenTask: (task: Task) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${PD_DAY_TASK_PREFIX}${task.id}`,
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        e.stopPropagation();
        onOpenTask(task);
      }}
      title={task.title}
      className={`block w-full text-left text-[11px] hover:text-fg cursor-grab active:cursor-grabbing truncate leading-snug touch-none ${
        task.status === "done"
          ? "text-fg-faded line-through"
          : "text-fg-secondary"
      } ${isDragging ? "opacity-30" : ""}`}
    >
      {task.title}
    </div>
  );
}

function DayQuickAddModal({
  date,
  onClose,
  onSubmit,
}: {
  date: string;
  onClose: () => void;
  onSubmit: (title: string) => void;
}) {
  const [title, setTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const d = new Date(date + "T00:00:00");
  const heading = d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-base rounded-xl w-full max-w-[420px] overflow-hidden"
        style={{
          boxShadow: "var(--shadow-overlay)",
          border: "1px solid var(--border-soft)",
        }}
      >
        <div className="px-5 pt-4 pb-3 border-b border-line-soft">
          <div className="text-[11px] uppercase tracking-[0.06em] text-fg-faded mb-0.5">
            Add task for
          </div>
          <h2 className="text-[15px] font-medium text-fg">{heading}</h2>
        </div>
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3">
          <input
            ref={inputRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs to get done?"
            maxLength={MAX_TITLE_LENGTH}
            className="w-full bg-elevated border border-line-hairline rounded-md px-3 py-2 text-[13px] text-fg placeholder:text-fg-disabled outline-none focus:border-accent-blue"
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="text-[12px] text-fg-secondary hover:text-fg cursor-pointer px-2 py-1"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim()}
              className="text-[12px] font-medium border border-accent-blue/50 text-accent-blue-soft-fg hover:border-accent-blue hover:bg-accent-blue-soft disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer rounded-md px-3 py-1.5 transition-colors"
            >
              Add task
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
