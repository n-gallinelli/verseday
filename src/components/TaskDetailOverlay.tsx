import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { activeObjectiveOptions } from "../utils/objectiveOptions";
import { useFocusTick } from "../hooks/useFocusTick";
import { createPortal } from "react-dom";
import { getWorkedMinutesByDate, parseRecurrence, serializeRecurrence } from "../db/queries";
import { parseTimeFromTitle, formatHoursMinutes } from "../utils/format";
import { useAppStore } from "../stores/appStore";
import DateRangeField from "./DateRangeField";
import CalendarMetaRail from "./CalendarMetaRail";
import ProjectPicker from "./ProjectPicker";
import RichTextEditor from "./RichTextEditor";
import SimpleSelect from "./SimpleSelect";
import type { Task, Project } from "../types";

const MAX_ESTIMATE_MINUTES = 480;

// Experiment: render the Time section like the daily plan's task-row
// time pill (compact "Xm / Ym" with a slash between, no in-pill labels)
// instead of the labeled side-by-side pills used in the rest of this
// overlay. Flip to `true` to try it — the alternate layout is kept
// behind this flag for easy toggling.
const USE_DAILY_PLAN_TIME_STYLE = false;

const ESTIMATE_PRESETS = [
  { label: "0m", value: "0" },
  { label: "15m", value: "15" },
  { label: "30m", value: "30" },
  { label: "45m", value: "45" },
  { label: "1h", value: "60" },
  { label: "2h", value: "120" },
  { label: "3h", value: "180" },
];

const WORKED_PRESETS = [
  { label: "5m", value: "5" },
  { label: "10m", value: "10" },
  { label: "15m", value: "15" },
  { label: "30m", value: "30" },
  { label: "1h", value: "60" },
  { label: "1h 30m", value: "90" },
];

interface TaskDetailOverlayProps {
  task: Task;
  projects: Project[];
  onClose: () => void;
  onSave: (updates: {
    id: number;
    title: string;
    projectId: number | null;
    estimatedMinutes: number | null;
    priority: string;
    notes: string | null;
    dateScheduled: string | null;
    dueDate: string | null;
  }) => void;
  onToggle?: (task: Task) => void;
  onDelete?: (taskId: number) => void;
  onStartFocus?: (task: Task) => void;
  workedMinutes?: number;
  onSetWorkedMinutes?: (taskId: number, minutes: number) => void;
  autoTrackedMinutes?: number;
  autoFocusTitle?: boolean;
}

function formatDisplayMinutes(value: string): string {
  const n = parseInt(value);
  if (!value || isNaN(n) || n <= 0) return "—";
  const h = Math.floor(n / 60);
  const m = n % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${n}m`;
}

function parseTimeInput(raw: string): number {
  const hMatch = raw.match(/(\d+)\s*h/i);
  const mMatch = raw.match(/(\d+)\s*m/i);
  let total = 0;
  if (hMatch) total += parseInt(hMatch[1]) * 60;
  if (mMatch) total += parseInt(mMatch[1]);
  return total;
}

// ── Time Field Pill + Popover ────────────────────────────────────────────────

function TimeFieldPill({
  label,
  value,
  presets,
  isOpen,
  onToggle,
  onChange,
  onReset,
  autoTrackedNote,
  hideLabel = false,
}: {
  label: string;
  value: string;
  presets: { label: string; value: string }[];
  isOpen: boolean;
  onToggle: () => void;
  onChange: (value: string) => void;
  // Optional reset action — when provided AND a value is set, the
  // popover renders a small "Reset" button below the input that
  // clears the field. Used for the "Worked" pill to wipe time
  // entries; not used for "Estimated" (no destructive op there).
  onReset?: () => void;
  autoTrackedNote?: string;
  hideLabel?: boolean;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const [rawInput, setRawInput] = useState("");
  const displayValue = formatDisplayMinutes(value);
  const hasValue = displayValue !== "—";

  // Parse a raw field string and commit it via onChange. Tries the
  // structured parser first (e.g. "1h 45m" → 105); if that returns 0
  // (no h/m suffix), falls back to a bare minute count so "10" commits
  // as 10m. No-ops on empty/invalid/out-of-range input.
  const commitRaw = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    let total = parseTimeInput(trimmed);
    if (total === 0) total = parseInt(trimmed, 10);
    if (!isNaN(total) && total > 0 && total <= MAX_ESTIMATE_MINUTES) {
      onChange(total.toString());
    }
  };

  // Seed the custom-input field from the current value ONLY when the popover
  // opens. Previously this also depended on `value`, so every keystroke (which
  // updates `value` via onChange) re-seeded `rawInput` and re-appended the "m"
  // suffix mid-typing — typing "20" became "2" → "2m" → "2m0". Seeding once on
  // open leaves the field fully under the user's control while typing.
  useEffect(() => {
    if (!isOpen) return;
    if (presets.some((p) => p.value === value)) {
      setRawInput("");
      return;
    }
    const n = parseInt(value);
    if (!value || isNaN(n) || n <= 0) {
      setRawInput("");
      return;
    }
    const h = Math.floor(n / 60);
    const m = n % 60;
    if (h > 0 && m > 0) setRawInput(`${h}h ${m}m`);
    else if (h > 0) setRawInput(`${h}h`);
    else setRawInput(`${n}m`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setPopoverPos(null);
      return;
    }
    function updatePosition() {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      const POPOVER_WIDTH = 240;
      const POPOVER_HEIGHT = 220;
      const flipUp = window.innerHeight - r.bottom < POPOVER_HEIGHT;
      const top = flipUp ? r.top - POPOVER_HEIGHT - 6 : r.bottom + 6;
      // Clamp left so popover doesn't overflow viewport edges
      const maxLeft = window.innerWidth - POPOVER_WIDTH - 8;
      const left = Math.max(8, Math.min(r.left, maxLeft));
      setPopoverPos({ top, left });
    }
    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [isOpen]);

  return (
    <div className="relative">
      {/* Pill: trigger + × clear affordance share one styled container —
          mirrors CalendarPicker's pill so the DATES and TIME rows read
          as a consistent set. × space is reserved when onReset is
          wired; the × itself fades in only on pill hover (or keyboard
          focus) so the default state stays clean. */}
      <div
        className={`group/pill flex items-stretch w-full rounded-md transition-colors ${
          isOpen
            ? "bg-accent-blue-soft border-accent-blue"
            : "bg-input border-line-hairline hover:border-line-medium"
        }`}
        style={{ borderWidth: "0.5px", borderStyle: "solid" }}
      >
        <button
          ref={triggerRef}
          type="button"
          onClick={onToggle}
          className={`flex-1 min-w-0 cursor-pointer text-left ${
            hideLabel ? "flex items-center" : "flex flex-col items-start gap-[3px]"
          }`}
          style={{ padding: hideLabel ? "10px 4px 10px 12px" : "4px 4px 4px 10px" }}
        >
          {!hideLabel && (
            <span className="text-[9px] uppercase tracking-[0.07em] text-fg-faded leading-none">
              {label}
            </span>
          )}
          <span className={`text-[12px] font-medium leading-[1.2] truncate ${hasValue ? "text-fg" : "text-fg-disabled"}`}>
            {displayValue}
          </span>
        </button>
        {onReset && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onReset();
            }}
            className={`w-7 flex items-center justify-center cursor-pointer text-fg-faded hover:text-fg-secondary text-[11px] leading-none transition-opacity ${
              hasValue
                ? "opacity-0 pointer-events-none group-hover/pill:opacity-100 group-hover/pill:pointer-events-auto focus:opacity-100 focus:pointer-events-auto"
                : "opacity-0 pointer-events-none"
            }`}
            title={`Clear ${label.toLowerCase()}`}
            aria-hidden={!hasValue}
            tabIndex={hasValue ? 0 : -1}
          >
            ✕
          </button>
        )}
      </div>

      {isOpen && popoverPos && createPortal(
        <div
          data-time-pill
          className="fixed bg-elevated rounded-lg z-[60]"
          style={{
            top: popoverPos.top,
            left: popoverPos.left,
            width: 240,
            padding: 10,
            border: "0.5px solid var(--border-soft)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <div className="text-[10px] uppercase text-fg-faded tracking-[0.05em] mb-2">
            {label === "Estimated" ? "Estimated time" : "Time worked"}
          </div>
          <div className="flex flex-wrap gap-1 mb-2">
            {presets.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => onChange(value === p.value ? "" : p.value)}
                className={`px-2.5 py-1 rounded-md text-[12px] cursor-pointer transition-colors border ${
                  value === p.value
                    ? "bg-accent-blue-soft border-accent-blue text-accent-blue-soft-fg"
                    : "bg-input border-line-hairline text-fg-muted hover:bg-input-hover"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <input
            // Focus the field the instant the popover opens so the user can
            // start typing immediately (or click a preset / the field) without
            // a second click. The input remounts on every open (conditional
            // render), so autoFocus re-fires each time the popover appears.
            autoFocus
            type="text"
            value={rawInput}
            onChange={(e) => {
              setRawInput(e.target.value);
              const raw = e.target.value;
              if (raw === "") {
                onChange("");
                return;
              }
              commitRaw(raw);
            }}
            onBlur={(e) => commitRaw(e.target.value)}
            onKeyDown={(e) => {
              // Enter commits the typed minutes and closes the popover.
              // Stop propagation so the parent modal's key handler doesn't
              // also act on it. Escape just closes without committing.
              if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                commitRaw(e.currentTarget.value);
                onToggle();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                onToggle();
              }
            }}
            placeholder="e.g. 10 or 1h 30m"
            className="w-full bg-input border border-line-hairline rounded-md px-2.5 py-1.5 text-[12px] text-fg-secondary placeholder:text-fg-disabled outline-none focus:border-accent-blue"
          />
          {autoTrackedNote && (
            <div className="text-[10px] text-fg-faded mt-1.5">
              {autoTrackedNote}
            </div>
          )}
          {onReset && hasValue && (
            <button
              type="button"
              onClick={onReset}
              className="block mx-auto mt-2 text-[11px] text-fg-faded hover:text-accent-destructive cursor-pointer transition-colors hover:underline"
            >
              Reset
            </button>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

// ── Property Row (right rail) ────────────────────────────────────────────────

function PropertyRow({
  label,
  children,
  hint,
  labelAction,
}: {
  label: string;
  children: React.ReactNode;
  hint?: React.ReactNode;
  // Optional control rendered on the right side of the label row (e.g. an
  // "Open objective" link). Kept on the label line so it doesn't disturb
  // the control below.
  labelAction?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="uppercase [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] text-fg-faded">
          {label}
        </div>
        {labelAction}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {children}
      </div>
      {hint && <div className="text-[10px] text-fg-faded mt-1.5">{hint}</div>}
    </div>
  );
}

// ── Main Overlay ─────────────────────────────────────────────────────────────

export default function TaskDetailOverlay({
  task,
  projects,
  onClose,
  onSave,
  onToggle,
  onDelete,
  onStartFocus,
  workedMinutes = 0,
  onSetWorkedMinutes,
  autoTrackedMinutes,
  autoFocusTitle = false,
}: TaskDetailOverlayProps) {
  // Cross-screen sync: when this overlay edits the task that's currently
  // focused, mirror the change into the cache so FocusMode (and any other
  // surface reading via selectFocusedTask) sees the new values
  // immediately. M2.2 — `updateFocusTask` is now a thin primeTasks
  // wrapper; signature unchanged for callers.
  const { session, focusView, updateFocusTask, setFocusPriorElapsedMs, setTaskRecurrenceAction, openProject, togglePauseFocus } = useAppStore();
  const strikethroughCompleted = useAppStore((s) => s.strikethroughCompleted);
  const isFocusedTask = (session?.taskId ?? focusView?.taskId) === task.id;
  // The ACTIVE running session for THIS task (null if this task isn't the live
  // session). Drives the header control: when this task is being focused the
  // button must reflect that (Pause / Resume) — never "Start" — so the overlay
  // agrees with the focus screen, pip, and the "Focusing…" header pill.
  const liveSession = session && session.taskId === task.id ? session : null;
  // Live elapsed for the active session (null if none). Used to auto-populate
  // a calendar meeting's "time spent" while it's the running focus task — the
  // value ticks live but stays editable.
  const liveFocusMs = useFocusTick();
  const liveTimeSpentValue =
    isFocusedTask && liveFocusMs !== null
      ? String(Math.round(liveFocusMs / 60000))
      : null;

  const [title, setTitle] = useState(task.title);
  const titleRef = useRef<HTMLTextAreaElement | null>(null);

  // Size + (optionally) focus the title once when the overlay opens. Done
  // via effect so we only steal focus once — a ref callback runs on every
  // render and would yank focus back if the user clicked away.
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
    if (autoFocusTitle) {
      el.focus();
      el.select();
    }
    // intentionally only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [localStatus, setLocalStatus] = useState(task.status);
  const prevStatusRef = useRef(task.status);
  const justCompleted = localStatus === "done" && prevStatusRef.current !== "done";
  const [completionGlow, setCompletionGlow] = useState(false);
  useEffect(() => {
    if (localStatus === "done" && prevStatusRef.current !== "done") {
      setCompletionGlow(true);
      const t = setTimeout(() => setCompletionGlow(false), 2400);
      prevStatusRef.current = localStatus;
      return () => clearTimeout(t);
    }
    prevStatusRef.current = localStatus;
  }, [localStatus]);
  const [notes, setNotes] = useState(task.notes ?? "");
  const [estimate, setEstimate] = useState(task.estimated_minutes?.toString() ?? "");
  const [projectId, setProjectId] = useState(task.project_id?.toString() ?? "");
  // The Objective dropdown offers active objectives only — completed ones are
  // not assignable. The task's current objective is kept even if completed so
  // an existing assignment still shows. See utils/objectiveOptions.
  const objectiveOptions = useMemo(
    () => activeObjectiveOptions(projects, projectId),
    [projects, projectId],
  );
  const [priority] = useState(task.priority);
  const [dateScheduled, setDateScheduled] = useState(task.date_scheduled ?? "");
  const [dueDate, setDueDate] = useState(task.due_date ?? "");
  const [worked, setWorked] = useState(workedMinutes > 0 ? workedMinutes.toString() : "");
  const [dayBreakdown, setDayBreakdown] = useState<{ date: string; minutes: number }[]>([]);
  const [openPopover, setOpenPopover] = useState<"estimate" | "worked" | null>(null);
  // Inline delete confirm — keeps the user inside the overlay so they can
  // see what they're deleting until the moment of confirmation.
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Recurrence
  const parsedRecurrence = parseRecurrence(task.recurrence ?? null);
  const isInstance = task.recurrence_source_id != null;
  const [recurrenceFreq, setRecurrenceFreq] = useState<string>(parsedRecurrence?.freq ?? "none");
  const [recurrenceDay, setRecurrenceDay] = useState<number>(parsedRecurrence?.day ?? 1);
  const [recurrenceInterval, setRecurrenceInterval] = useState<number>(parsedRecurrence?.interval ?? 1);

  const saveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedFlashRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // After completing a task from the overlay we let the check-draw + glow
  // play, then auto-dismiss back to the daily screen. Tracked so it's
  // cleared on unmount and never fires after the user re-opens/un-checks.
  const autoCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Footer label state — reflects what's actually happening with saves
  // instead of a perpetual "Auto-saved" lie. 'pending' while a debounced
  // save is queued, 'saved' for ~1.5s after a save fires, 'idle' at
  // steady state.
  const [saveState, setSaveState] = useState<"idle" | "pending" | "saved">("idle");

  // Load per-day breakdown
  useEffect(() => {
    getWorkedMinutesByDate(task.id).then(setDayBreakdown).catch(() => {});
  }, [task.id]);

  // Sync local `worked` draft to the workedMinutes prop. The host
  // (TaskDetailOverlayHost) fetches workedMinutes asynchronously after
  // the overlay mounts, so the initial render sees workedMinutes=0
  // and the useState initializer above seeds `worked=""`. Without this
  // sync, the field stays at "" even after the fetch lands.
  // Pre-S.5 this was masked because the wall-clock query returned
  // non-zero for in-progress sessions, so workedMinutes was rarely 0
  // at mount; under the worked-seconds model, a freshly-stopped task
  // legitimately reports its real worked time only after the async
  // fetch completes.
  useEffect(() => {
    setWorked(workedMinutes > 0 ? workedMinutes.toString() : "");
  }, [workedMinutes]);

  // Close popover on click outside
  // Sync local status if parent refreshes the task object.
  useEffect(() => {
    setLocalStatus(task.status);
  }, [task.id, task.status]);

  // Listen for notes changes coming from FocusMode (or any other
  // surface editing this same task) — keeps the detail overlay's
  // notes in lockstep with focus when both are open at once.
  useEffect(() => {
    function onNotesChanged(e: Event) {
      const ce = e as CustomEvent<{ taskId: number; html: string }>;
      if (ce.detail.taskId !== task.id) return;
      if (ce.detail.html === notes) return;
      setNotes(ce.detail.html);
    }
    window.addEventListener("verseday:task-notes-changed", onNotesChanged);
    return () =>
      window.removeEventListener("verseday:task-notes-changed", onNotesChanged);
  }, [task.id, notes]);

  const handleModalClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (openPopover && !target.closest("[data-time-pill]")) {
      setOpenPopover(null);
    }
  }, [openPopover]);

  function buildUpdate(overrides: Record<string, string> = {}) {
    const t = overrides.title ?? title;
    const p = overrides.projectId ?? projectId;
    const e = overrides.estimate ?? estimate;
    const pr = overrides.priority ?? priority;
    const n = overrides.notes ?? notes;
    const ds = overrides.dateScheduled ?? dateScheduled;
    const dd = overrides.dueDate ?? dueDate;

    const trimmedTitle = t.trim();
    if (!trimmedTitle) return null;

    let est: number | null = null;
    if (e) {
      est = parseInt(e);
      if (isNaN(est) || est < 1 || est > MAX_ESTIMATE_MINUTES) est = null;
    }

    return {
      id: task.id,
      title: trimmedTitle,
      projectId: p ? parseInt(p) : null,
      estimatedMinutes: est,
      priority: pr,
      notes: n.trim() || null,
      dateScheduled: ds || null,
      dueDate: dd || null,
    };
  }

  // Mirror the just-saved fields into focus.task so FocusMode reflects
  // the new values without waiting for a remount/refetch. No-op when the
  // edited task isn't the focused one.
  function mirrorToFocus(update: ReturnType<typeof buildUpdate>) {
    if (!update || !isFocusedTask) return;
    updateFocusTask({
      title: update.title,
      project_id: update.projectId,
      estimated_minutes: update.estimatedMinutes,
      priority: update.priority,
      notes: update.notes,
      date_scheduled: update.dateScheduled,
      due_date: update.dueDate,
    });
  }

  function debouncedSave(overrides: Record<string, string> = {}) {
    if (saveRef.current) clearTimeout(saveRef.current);
    if (savedFlashRef.current) {
      clearTimeout(savedFlashRef.current);
      savedFlashRef.current = null;
    }
    setSaveState("pending");
    saveRef.current = setTimeout(() => {
      saveRef.current = null;
      const update = buildUpdate(overrides);
      if (update) {
        onSave(update);
        mirrorToFocus(update);
        setSaveState("saved");
        savedFlashRef.current = setTimeout(() => {
          savedFlashRef.current = null;
          setSaveState("idle");
        }, 1500);
      } else {
        setSaveState("idle");
      }
    }, 600);
  }

  function flushSave() {
    if (saveRef.current) {
      clearTimeout(saveRef.current);
      saveRef.current = null;
    }
    if (savedFlashRef.current) {
      clearTimeout(savedFlashRef.current);
      savedFlashRef.current = null;
    }
    // Smart time parsing on commit: a trailing "~10" / "30m" / "1h"
    // suffix on the title gets stripped and routed into the estimate
    // field, matching DailyPlanner's add-task behavior. Only fires at
    // commit (Enter / close / scrim click) — running it in onChange
    // would clobber mid-typing patterns.
    const parsed = parseTimeFromTitle(title);
    const overrides: Record<string, string> = {};
    if (parsed.minutes != null && parsed.cleanTitle !== title) {
      overrides.title = parsed.cleanTitle;
      overrides.estimate = parsed.minutes.toString();
      setTitle(parsed.cleanTitle);
      setEstimate(parsed.minutes.toString());
    }
    const update = buildUpdate(overrides);
    if (update) {
      onSave(update);
      mirrorToFocus(update);
      setSaveState("saved");
      savedFlashRef.current = setTimeout(() => {
        savedFlashRef.current = null;
        setSaveState("idle");
      }, 1500);
    }
  }

  useEffect(() => {
    return () => {
      if (saveRef.current) clearTimeout(saveRef.current);
      if (savedFlashRef.current) clearTimeout(savedFlashRef.current);
      if (autoCloseRef.current) clearTimeout(autoCloseRef.current);
    };
  }, []);

  function handleClose() {
    flushSave();
    onClose();
  }

  // Global Escape: close the modal regardless of focus position. The
  // inline onKeyDown on the modal div only fires when focus sits inside
  // the modal, which isn't the case immediately after opening.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (openPopover) {
        e.preventDefault();
        setOpenPopover(null);
        return;
      }
      e.preventDefault();
      handleClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // handleClose closes over current state via flushSave/onSave references;
    // re-binding on openPopover changes is needed so the popover-precedence
    // check sees the latest value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPopover]);

  const autoTrackedNote = autoTrackedMinutes && autoTrackedMinutes > 0
    ? `+ ${formatDisplayMinutes(autoTrackedMinutes.toString())} tracked automatically`
    : undefined;

  // The Objective control — shared by the in-app properties rail AND the
  // calendar-task rail (via CalendarMetaRail's objectiveControl slot) so a
  // calendar-imported task can be assigned to an objective too. Same
  // ProjectPicker + setProjectId→debouncedSave path either way; project_id
  // is preserved across calendar re-sync, so the assignment sticks.
  const objectiveRow = (
    <PropertyRow
      label="Objective"
      labelAction={
        projectId ? (
          <button
            type="button"
            onClick={() => {
              // Close this task overlay before navigating so the
              // project-detail modal doesn't stack on top of it.
              onClose();
              openProject(parseInt(projectId));
            }}
            className="flex items-center gap-0.5 text-[11px] font-medium text-accent-blue hover:text-accent-blue-hover transition-colors cursor-pointer"
            title="Open objective details"
          >
            Open
            <svg
              width="11"
              height="11"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3.5 8.5L8.5 3.5" />
              <path d="M5 3.5H8.5V7" />
            </svg>
          </button>
        ) : undefined
      }
    >
      <ProjectPicker
        value={projectId}
        projects={objectiveOptions}
        onChange={(val) => {
          setProjectId(val);
          debouncedSave({ projectId: val });
        }}
      />
    </PropertyRow>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={handleClose}
    >
      <div className="absolute inset-0 bg-overlay-scrim" />
      <div
        className="relative bg-elevated rounded-[12px] w-[880px] max-w-[94vw] max-h-[88vh] flex flex-col overflow-hidden animate-scale-in"
        style={{ boxShadow: "var(--shadow-modal)" }}
        onClick={(e) => { e.stopPropagation(); handleModalClick(e); }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            if (openPopover) { setOpenPopover(null); } else { handleClose(); }
          }
        }}
      >
        {completionGlow && (
          <div
            className="absolute top-0 left-0 right-0 h-[220px] pointer-events-none animate-completion-glow z-10"
            style={{
              background:
                "linear-gradient(to bottom, var(--accent-green-glow) 0%, color-mix(in srgb, var(--accent-green-glow) 36%, transparent) 55%, transparent 100%)",
            }}
          />
        )}
        {/* Header strip — title hero. items-center keeps the check circle
            and Start button vertically centered with the title block on
            both 1- and 2-line titles. Generous pt-9/pb-8 give the title
            room to breathe from the modal edge and the divider below. */}
        <div className="flex items-center gap-3 px-8 pt-9 pb-8 border-b border-divider">
          {onToggle && (
            <button
              onClick={() => {
                const nextDone = localStatus !== "done";
                // Optimistic: flip locally so the UI updates without closing.
                setLocalStatus(nextDone ? "done" : "todo");
                onToggle(task);
                // Completing from the daily screen: let the check-draw + glow
                // register, then dismiss back to the daily list. Un-checking
                // keeps the overlay open. Clear any prior timer first so a
                // rapid toggle never double-fires a close.
                if (autoCloseRef.current) clearTimeout(autoCloseRef.current);
                if (nextDone) {
                  autoCloseRef.current = setTimeout(() => {
                    autoCloseRef.current = null;
                    handleClose();
                  }, 850);
                }
              }}
              title={localStatus === "done" ? "Mark as not done" : "Mark complete"}
              className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 cursor-pointer transition-colors ${
                localStatus === "done"
                  ? "bg-accent-green border-accent-green hover:bg-accent-green-hover hover:border-accent-green-hover"
                  : "border-line-strong hover:border-accent-green"
              }`}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                stroke={localStatus === "done" ? "var(--text-on-accent)" : "var(--text-faded)"}
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
          )}
          <textarea
            value={title}
            onChange={(e) => {
              const v = e.target.value.replace(/\n/g, "");
              setTitle(v);
              debouncedSave({ title: v });
            }}
            onKeyDown={(e) => {
              // Enter (no Shift) commits the title and closes the overlay,
              // returning the user to the page underneath (typically Daily
              // Plan). Shift+Enter is reserved if a future change ever
              // wants line breaks in titles, but onChange currently strips
              // newlines so it'd no-op today.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                flushSave();
                onClose();
              }
            }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = el.scrollHeight + "px";
            }}
            ref={titleRef}
            rows={1}
            placeholder="Untitled task"
            className={`flex-1 min-w-0 text-[24px] font-medium bg-transparent border-none outline-none leading-tight placeholder:text-fg-disabled resize-none overflow-hidden transition-colors duration-150 ease-out ${
              localStatus === "done"
                ? strikethroughCompleted
                  ? "text-fg-faded line-through"
                  : "text-fg-faded"
                : "text-fg"
            }`}
          />
          {localStatus !== "done" && liveSession ? (
            // This task IS the live focus session → Pause (running) / Resume
            // (paused), mirroring TaskCard / PiP / focus screen via the same
            // canonical togglePauseFocus. Never "Start" — that would read as
            // not-running and contradict every other surface. Doesn't close
            // the overlay (a pause toggle isn't a "leave" action).
            <button
              onClick={() => togglePauseFocus()}
              className={`ml-3 rounded-full cursor-pointer flex items-center justify-center gap-2 px-4 py-1.5 min-w-[104px] transition-colors flex-shrink-0 ${
                liveSession.paused
                  ? "border border-accent-blue/50 text-accent-blue-soft-fg hover:border-accent-blue hover:bg-accent-blue-soft"
                  : "bg-accent-blue-soft text-accent-blue-soft-fg hover:opacity-90"
              }`}
              title={liveSession.paused ? "Resume focus" : "Pause focus"}
            >
              {liveSession.paused ? (
                <>
                  <svg width="9" height="11" viewBox="0 0 8 10" fill="currentColor" className="ml-[1px]">
                    <path d="M0 0v10l8-5z" />
                  </svg>
                  <span className="text-[13px] font-medium">Resume</span>
                </>
              ) : (
                <>
                  <svg width="10" height="11" viewBox="0 0 10 11" fill="currentColor">
                    <rect x="1" y="0.5" width="2.6" height="10" rx="0.8" />
                    <rect x="6.4" y="0.5" width="2.6" height="10" rx="0.8" />
                  </svg>
                  <span className="text-[13px] font-medium">Pause</span>
                </>
              )}
            </button>
          ) : (
            onStartFocus && localStatus !== "done" && (
              <button
                onClick={() => {
                  flushSave();
                  onStartFocus(task);
                  onClose();
                }}
                // Outlined button: triangle + "Start" label. Same visual
                // language as the daily plan header's "Start focusing"
                // button, sized for the detail overlay's header. ml-3 adds
                // a buffer beyond the row's gap so a long title doesn't
                // wrap right against the button.
                className="ml-3 rounded-full border border-accent-blue/50 text-accent-blue-soft-fg hover:border-accent-blue hover:bg-accent-blue-soft cursor-pointer flex items-center gap-2 px-4 py-1.5 transition-colors flex-shrink-0"
                title="Start focus"
              >
                <svg width="9" height="11" viewBox="0 0 8 10" fill="currentColor" className="ml-[1px]">
                  <path d="M0 0v10l8-5z" />
                </svg>
                <span className="text-[13px] font-medium">Start</span>
              </button>
            )
          )}
          {/* No close button — Esc and outside-click both dismiss the
              overlay, which is enough. */}
        </div>

        {/* Body — split panel */}
        <div className="flex-1 flex min-h-0">
          {/* Left: Notes — work surface */}
          <div className="flex-1 min-w-0 px-8 py-7 overflow-y-auto">
            <div className="uppercase [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] text-fg-faded mb-4">
              Notes
            </div>
            <RichTextEditor
              value={notes}
              onChange={(html) => {
                setNotes(html);
                debouncedSave({ notes: html });
                // Broadcast so FocusMode (or any other surface
                // showing this task's notes) picks up the new value
                // without a remount / refetch.
                window.dispatchEvent(
                  new CustomEvent("verseday:task-notes-changed", {
                    detail: { taskId: task.id, html },
                  })
                );
              }}
              placeholder="..."
              className="w-full bg-elevated text-[13px] text-fg-secondary leading-relaxed min-h-[380px]"
            />
          </div>

          {/* Right: Properties rail. Calendar-imported tasks get a
              dedicated read-only panel with event metadata (time,
              attendees, location, description) instead of the in-app
              property rows that don't apply to a calendar event. */}
          {task.external_source === "calendar" ? (
            <CalendarMetaRail
              task={task}
              objectiveControl={objectiveRow}
              timeControl={
                <div data-time-pill>
                  <TimeFieldPill
                    label="Time spent"
                    hideLabel
                    value={liveTimeSpentValue ?? worked}
                    presets={WORKED_PRESETS}
                    isOpen={openPopover === "worked"}
                    onToggle={() => setOpenPopover(openPopover === "worked" ? null : "worked")}
                    onChange={(val) => {
                      setWorked(val);
                      if (onSetWorkedMinutes && val) {
                        const n = parseInt(val);
                        if (!isNaN(n) && n > 0) {
                          onSetWorkedMinutes(task.id, n);
                          if (isFocusedTask) setFocusPriorElapsedMs(task.id, n * 60 * 1000);
                        }
                      }
                    }}
                    onReset={
                      onSetWorkedMinutes
                        ? () => {
                            setWorked("");
                            onSetWorkedMinutes(task.id, 0);
                            if (isFocusedTask) setFocusPriorElapsedMs(task.id, 0);
                            setOpenPopover(null);
                          }
                        : undefined
                    }
                    autoTrackedNote={autoTrackedNote}
                  />
                </div>
              }
            />
          ) : (
          <div className="w-[320px] flex-shrink-0 border-l border-line-hairline bg-rail px-6 py-7 overflow-y-auto space-y-6">
            {objectiveRow}

            <div>
              <div className="uppercase [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] text-fg-faded mb-1.5">
                Dates
              </div>
              <DateRangeField
                defaultMode="single"
                emptyLabel="Set day"
                quickShortcuts
                value={{ start: dateScheduled || null, end: dueDate || null }}
                onChange={(v) => {
                  // Preserve the existing debouncedSave→onSave plumbing
                  // verbatim (one debounced write with both overrides — no
                  // two-debounce race). End maps to due_date (deadline);
                  // task placement is unchanged.
                  setDateScheduled(v.start ?? "");
                  setDueDate(v.end ?? "");
                  debouncedSave({ dateScheduled: v.start ?? "", dueDate: v.end ?? "" });
                }}
              />
            </div>

            <div>
              <div className="uppercase [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] text-fg-faded mb-1.5">
                Time
              </div>
              {USE_DAILY_PLAN_TIME_STYLE ? (
                // Compact "Xm / Ym" treatment — echoes the daily plan task
                // row's time pill. Each value is its own clickable pill with
                // its own popover; the slash between joins them visually.
                <div className="flex items-center gap-1.5">
                  <div data-time-pill className="flex-1">
                    <TimeFieldPill
                      label="Worked"
                      hideLabel
                      value={worked}
                      presets={WORKED_PRESETS}
                      isOpen={openPopover === "worked"}
                      onToggle={() => setOpenPopover(openPopover === "worked" ? null : "worked")}
                      onChange={(val) => {
                        setWorked(val);
                        if (onSetWorkedMinutes && val) {
                          const n = parseInt(val);
                          if (!isNaN(n) && n > 0) {
                            onSetWorkedMinutes(task.id, n);
                            if (isFocusedTask) setFocusPriorElapsedMs(task.id, n * 60 * 1000);
                          }
                        }
                      }}
                      onReset={
                        onSetWorkedMinutes
                          ? () => {
                              setWorked("");
                              onSetWorkedMinutes(task.id, 0);
                              if (isFocusedTask) setFocusPriorElapsedMs(task.id, 0);
                              setOpenPopover(null);
                            }
                          : undefined
                      }
                      autoTrackedNote={autoTrackedNote}
                    />
                  </div>
                  <span className="text-fg-disabled text-[13px] font-medium select-none">/</span>
                  <div data-time-pill className="flex-1">
                    <TimeFieldPill
                      label="Estimated"
                      hideLabel
                      value={estimate}
                      presets={ESTIMATE_PRESETS}
                      isOpen={openPopover === "estimate"}
                      onToggle={() => setOpenPopover(openPopover === "estimate" ? null : "estimate")}
                      onChange={(val) => {
                        setEstimate(val);
                        debouncedSave({ estimate: val });
                      }}
                      onReset={() => {
                        setEstimate("");
                        debouncedSave({ estimate: "" });
                        setOpenPopover(null);
                      }}
                    />
                  </div>
                </div>
              ) : (
              <div className="flex items-stretch gap-1.5">
                <div data-time-pill className="flex-1">
                  <TimeFieldPill
                    label="Worked"
                    value={worked}
                    presets={WORKED_PRESETS}
                    isOpen={openPopover === "worked"}
                    onToggle={() => setOpenPopover(openPopover === "worked" ? null : "worked")}
                    onChange={(val) => {
                      setWorked(val);
                      if (onSetWorkedMinutes && val) {
                        const n = parseInt(val);
                        if (!isNaN(n) && n > 0) {
                          onSetWorkedMinutes(task.id, n);
                          if (isFocusedTask) setFocusPriorElapsedMs(task.id, n * 60 * 1000);
                        }
                      }
                    }}
                    onReset={
                      onSetWorkedMinutes
                        ? () => {
                            // Wipe closed time entries for this task and
                            // reflect the reset everywhere — DailyPlanner's
                            // onSetWorkedMinutes prop calls
                            // setManualWorkedMinutes(id, 0) → deletes
                            // closed entries → loadData refreshes the
                            // workedMap so the row's pill shows 0m.
                            setWorked("");
                            onSetWorkedMinutes(task.id, 0);
                            if (isFocusedTask) setFocusPriorElapsedMs(task.id, 0);
                            setOpenPopover(null);
                          }
                        : undefined
                    }
                    autoTrackedNote={autoTrackedNote}
                  />
                </div>
                <div data-time-pill className="flex-1">
                  <TimeFieldPill
                    label="Estimated"
                    value={estimate}
                    presets={ESTIMATE_PRESETS}
                    isOpen={openPopover === "estimate"}
                    onToggle={() => setOpenPopover(openPopover === "estimate" ? null : "estimate")}
                    onChange={(val) => {
                      setEstimate(val);
                      debouncedSave({ estimate: val });
                    }}
                    onReset={() => {
                      setEstimate("");
                      debouncedSave({ estimate: "" });
                      setOpenPopover(null);
                    }}
                  />
                </div>
              </div>
              )}
            </div>

            {!isInstance && (
              <PropertyRow label="Repeat">
                <SimpleSelect
                  value={recurrenceFreq}
                  width="w-[140px]"
                  onChange={(freq) => {
                    setRecurrenceFreq(freq);
                    if (freq === "none") {
                      setTaskRecurrenceAction(task.id, null).catch(() => {});
                    } else if (freq === "weekly") {
                      setTaskRecurrenceAction(task.id, serializeRecurrence({ freq: "weekly", day: recurrenceDay, interval: recurrenceInterval })).catch(() => {});
                    } else {
                      setTaskRecurrenceAction(task.id, serializeRecurrence({ freq: freq as "daily" | "weekdays" })).catch(() => {});
                    }
                  }}
                  options={[
                    { value: "none", label: "None" },
                    { value: "daily", label: "Daily" },
                    { value: "weekdays", label: "Weekdays" },
                    { value: "weekly", label: "Weekly" },
                  ]}
                />
                {recurrenceFreq === "weekly" && (
                  <>
                    <SimpleSelect
                      value={String(recurrenceInterval)}
                      width="w-[170px]"
                      onChange={(v) => {
                        const interval = parseInt(v);
                        setRecurrenceInterval(interval);
                        setTaskRecurrenceAction(task.id, serializeRecurrence({ freq: "weekly", day: recurrenceDay, interval })).catch(() => {});
                      }}
                      options={[
                        { value: "1", label: "Every week" },
                        { value: "2", label: "Every other week" },
                        { value: "3", label: "Every 3 weeks" },
                        { value: "4", label: "Every 4 weeks" },
                        { value: "6", label: "Every 6 weeks" },
                      ]}
                    />
                    <SimpleSelect
                      value={String(recurrenceDay)}
                      width="w-[140px]"
                      onChange={(v) => {
                        const day = parseInt(v);
                        setRecurrenceDay(day);
                        setTaskRecurrenceAction(task.id, serializeRecurrence({ freq: "weekly", day, interval: recurrenceInterval })).catch(() => {});
                      }}
                      options={[
                        { value: "1", label: "Monday" },
                        { value: "2", label: "Tuesday" },
                        { value: "3", label: "Wednesday" },
                        { value: "4", label: "Thursday" },
                        { value: "5", label: "Friday" },
                        { value: "6", label: "Saturday" },
                        { value: "0", label: "Sunday" },
                      ]}
                    />
                  </>
                )}
              </PropertyRow>
            )}
            {isInstance && (
              <div className="text-[10px] text-fg-faded">Recurring task instance</div>
            )}

            {dayBreakdown.length > 1 && (
              <PropertyRow label="Worked on">
                <div className="flex flex-wrap gap-1.5 w-full">
                  {(() => {
                    // Hoisted out of the per-row map — was O(n²).
                    const maxMin = Math.max(...dayBreakdown.map((x) => x.minutes));
                    return dayBreakdown.map((d) => {
                    const barWidth = maxMin > 0 ? Math.max(12, Math.round((d.minutes / maxMin) * 100)) : 12;
                    return (
                      <div key={d.date} className="flex items-center gap-1.5 bg-elevated rounded-md px-2 py-1 border border-divider">
                        <div
                          className="h-[3px] rounded-full bg-accent-blue"
                          style={{ width: `${barWidth}%`, minWidth: 8, maxWidth: 48 }}
                        />
                        <span className="text-[10px] text-fg-muted whitespace-nowrap">
                          {new Date(d.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                        </span>
                        <span className="text-[10px] text-fg-secondary font-medium">{formatHoursMinutes(d.minutes)}</span>
                      </div>
                    );
                    });
                  })()}
                </div>
              </PropertyRow>
            )}
          </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-8 py-4 border-t border-line-hairline">
          {confirmingDelete && onDelete ? (
            <>
              <span className="flex-1 text-[12px]">
                <span className="text-accent-destructive">Delete this task?</span>{" "}
                <span className="text-fg-faded">Time entries will also be deleted.</span>
              </span>
              <button
                onClick={() => {
                  onDelete(task.id);
                  setConfirmingDelete(false);
                  onClose();
                }}
                className="bg-accent-destructive text-fg-on-accent rounded-md px-3 py-1 text-[12px] cursor-pointer hover:bg-accent-destructive-hover"
              >
                Delete
              </button>
              <button
                onClick={() => setConfirmingDelete(false)}
                className="text-fg-faded text-[12px] cursor-pointer hover:text-fg-secondary px-2 py-1"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <span
                className={`text-[10px] flex-1 transition-colors ${
                  saveState === "pending"
                    ? "text-fg-faded"
                    : saveState === "saved"
                      ? "text-accent-green"
                      : "text-fg-disabled"
                }`}
              >
                {saveState === "pending"
                  ? "Saving…"
                  : saveState === "saved"
                    ? "Saved"
                    : "Auto-saved"}
              </span>
              {onDelete && (
                <button
                  onClick={() => setConfirmingDelete(true)}
                  className="text-accent-destructive/60 hover:text-accent-destructive cursor-pointer p-2 rounded-md hover:bg-accent-destructive/10 transition-colors"
                  title="Delete task"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 4h12M5.33 4V2.67a1.33 1.33 0 011.34-1.34h2.66a1.33 1.33 0 011.34 1.34V4M13 4v9.33a1.33 1.33 0 01-1.33 1.34H4.33A1.33 1.33 0 013 13.33V4" />
                  </svg>
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
