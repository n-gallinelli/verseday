import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { serializeRecurrence, parseRecurrence } from "../../db/queries";
import { selectTemplates, useAppStore } from "../../stores/appStore";
import { formatHoursMinutes } from "../../utils/format";
import type { Task } from "../../types";

/** Parse "1h 30m" / "90m" / bare "90" → minutes. */
function parseEstimate(input: string): number {
  const h = input.match(/(\d+)\s*h/i);
  const m = input.match(/(\d+)\s*m/i);
  let total = 0;
  if (h) total += parseInt(h[1]) * 60;
  if (m) total += parseInt(m[1]);
  if (total === 0) {
    const n = parseInt(input, 10);
    if (!isNaN(n) && n > 0) total = n;
  }
  return total;
}

/**
 * One screen to see and edit every repeating task: change its cadence, title,
 * and estimate inline, or open it for full edit. Setting cadence to "Doesn't
 * repeat" removes the recurrence (stops the task repeating).
 *
 * P4 — templates read canonically from the store (selectTemplates over
 * tasksById, populated by loadTemplates) and every edit routes through a
 * reconciling store action, so the list stays live: a cadence change, a delete
 * from the "Edit…" overlay, or a rename all reflect via the selector without
 * the old verseday:task-deleted DOM listener or a manual reload.
 */
export default function RepeatingTasksSettings() {
  const templates = useAppStore(useShallow(selectTemplates));
  const [loaded, setLoaded] = useState(false);
  const openTaskDetail = useAppStore((s) => s.openTaskDetail);
  const loadTemplates = useAppStore((s) => s.loadTemplates);
  const setTaskRecurrenceAction = useAppStore((s) => s.setTaskRecurrenceAction);
  const updateTaskAction = useAppStore((s) => s.updateTask);

  useEffect(() => {
    let mounted = true;
    loadTemplates().finally(() => {
      if (mounted) setLoaded(true);
    });
    return () => {
      mounted = false;
    };
  }, [loadTemplates]);

  // Build a full UpdateTaskInput from a template task + a single-field patch
  // (the store's updateTask reconciles tasksById → selectTemplates re-renders).
  function buildUpdate(task: Task, patch: Partial<{ title: string; estimatedMinutes: number | null }>) {
    return {
      id: task.id,
      title: task.title,
      projectId: task.project_id,
      estimatedMinutes: task.estimated_minutes,
      priority: task.priority,
      notes: task.notes,
      dateScheduled: task.date_scheduled,
      dueDate: task.due_date,
      ...patch,
    };
  }

  async function changeCadence(task: Task, value: string) {
    try {
      if (value === "none") {
        await setTaskRecurrenceAction(task.id, null);
      } else if (value === "weekly") {
        // Keep an existing weekly day/interval if present; else default Mon.
        const cur = parseRecurrence(task.recurrence);
        await setTaskRecurrenceAction(
          task.id,
          serializeRecurrence({
            freq: "weekly",
            day: cur?.freq === "weekly" ? cur.day ?? 1 : 1,
            interval: cur?.freq === "weekly" ? cur.interval ?? 1 : 1,
          }),
        );
      } else {
        await setTaskRecurrenceAction(task.id, serializeRecurrence({ freq: value as "daily" | "weekdays" }));
      }
    } catch {
      // The action refetches DB truth on failure; the selector re-renders.
    }
  }

  async function commitTitle(task: Task, value: string) {
    const v = value.trim();
    if (!v || v === task.title) return;
    try {
      await updateTaskAction(buildUpdate(task, { title: v }));
    } catch {
      // reconciled by the action
    }
  }

  async function commitEstimate(task: Task, minutes: number | null) {
    if (minutes === (task.estimated_minutes ?? null)) return;
    try {
      await updateTaskAction(buildUpdate(task, { estimatedMinutes: minutes }));
    } catch {
      // reconciled by the action
    }
  }

  if (loaded && templates.length === 0) {
    return (
      <div className="text-[12px] text-fg-faded">
        No repeating tasks yet. Set a task to repeat from its detail screen
        (Repeat → Daily / Weekdays / Weekly).
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {templates.map((t) => (
        <RepeatingRow
          key={t.id}
          task={t}
          onCadence={(v) => changeCadence(t, v)}
          onCommitTitle={(v) => commitTitle(t, v)}
          onCommitEstimate={(m) => commitEstimate(t, m)}
          onOpen={() => openTaskDetail(t.id)}
        />
      ))}
    </div>
  );
}

function RepeatingRow({
  task,
  onCadence,
  onCommitTitle,
  onCommitEstimate,
  onOpen,
}: {
  task: Task;
  onCadence: (value: string) => void;
  onCommitTitle: (value: string) => void;
  onCommitEstimate: (minutes: number | null) => void;
  onOpen: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [estimate, setEstimate] = useState(
    task.estimated_minutes ? formatHoursMinutes(task.estimated_minutes) : ""
  );
  const freq = parseRecurrence(task.recurrence)?.freq ?? "daily";

  function commitTitle() {
    const v = title.trim();
    if (!v || v === task.title) {
      setTitle(task.title);
      return;
    }
    onCommitTitle(v);
  }

  function commitEstimate() {
    const total = parseEstimate(estimate);
    if (total === (task.estimated_minutes ?? 0)) {
      setEstimate(task.estimated_minutes ? formatHoursMinutes(task.estimated_minutes) : "");
      return;
    }
    onCommitEstimate(total > 0 ? total : null);
  }

  return (
    <div className="flex items-center gap-2 bg-elevated rounded-lg px-3 py-2" style={{ border: "0.5px solid var(--border-hairline)" }}>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={commitTitle}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          else if (e.key === "Escape") {
            setTitle(task.title);
            e.currentTarget.blur();
          }
        }}
        className="flex-1 min-w-0 bg-transparent border-none outline-none text-[13px] text-fg cursor-text"
      />
      <select
        value={freq}
        onChange={(e) => onCadence(e.target.value)}
        title="Cadence"
        className="bg-input border border-line-hairline rounded-md px-1.5 py-1 text-[12px] text-fg-secondary cursor-pointer outline-none focus:border-accent-blue w-[110px] flex-shrink-0"
      >
        <option value="daily">Daily</option>
        <option value="weekdays">Weekdays</option>
        <option value="weekly">Weekly</option>
        <option value="none">Doesn't repeat</option>
      </select>
      <input
        value={estimate}
        onChange={(e) => setEstimate(e.target.value)}
        onBlur={commitEstimate}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        placeholder="—"
        title="Estimated time (e.g. 20 or 1h 30m)"
        className="w-[64px] flex-shrink-0 bg-input border border-line-hairline rounded-md px-2 py-1 text-[12px] text-fg tabular-nums outline-none focus:border-accent-blue placeholder:text-fg-disabled"
      />
      <button
        type="button"
        onClick={onOpen}
        title="Open full detail"
        className="flex-shrink-0 text-[11px] text-fg-faded hover:text-fg-secondary cursor-pointer px-1.5 py-1 rounded-md hover:bg-overlay-hover"
      >
        Edit…
      </button>
    </div>
  );
}
