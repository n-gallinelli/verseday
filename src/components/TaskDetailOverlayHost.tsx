import { useEffect, useState } from "react";
import TaskDetailOverlay from "./TaskDetailOverlay";
import { selectTaskDetailTask, useAppStore } from "../stores/appStore";
import {
  getProjects,
  getTaskById,
  getWorkedMinutesForTask,
  startTimeEntry,
} from "../db/queries";
import type { UpdateTaskInput } from "../db/queries";
import type { Project, Task } from "../types";

// Singleton host for TaskDetailOverlay (Verse rule 2 — one mount per
// cross-screen surface). Mounted exactly once at the App shell. Reads
// `selectedTaskDetailId` from the store; resolves the task via
// selectTaskDetailTask, which reads from the canonical tasksById map
// (M3.2.a). Falls back to a one-shot getTaskById fetch when the map
// hasn't been primed for this ID, so the overlay opens regardless of
// which surface launched it.
//
// M3.2.b.5.b — all four mutation handlers (handleSave, handleToggle,
// handleDelete, handleSetWorkedMinutes) flow through store actions
// that own canonical-map updates. The verseday:task-updated/-deleted
// dispatches and the refreshCache helper retired with this commit:
// store actions write to tasksById atomically; subscribers re-render
// via Zustand reactivity without a custom event bus.
export default function TaskDetailOverlayHost() {
  const selectedTaskDetailId = useAppStore((s) => s.selectedTaskDetailId);
  const closeTaskDetail = useAppStore((s) => s.closeTaskDetail);
  const primeTasks = useAppStore((s) => s.primeTasks);
  const startFocus = useAppStore((s) => s.startFocus);
  const setPage = useAppStore((s) => s.setPage);
  const taskDetailAutoFocusTitle = useAppStore((s) => s.taskDetailAutoFocusTitle);
  const updateTaskAction = useAppStore((s) => s.updateTask);
  const deleteTaskAction = useAppStore((s) => s.deleteTaskAction);
  const setTaskStatusAction = useAppStore((s) => s.setTaskStatus);
  const setTaskWorkedMinutesAction = useAppStore((s) => s.setTaskWorkedMinutesAction);
  const task = useAppStore(selectTaskDetailTask);

  const [projects, setProjects] = useState<Project[]>([]);
  const [workedMinutes, setWorkedMinutes] = useState(0);

  // Cache-miss fallback. If a screen hasn't primed the canonical map
  // for this id (e.g., the overlay is opened from a context where the
  // task wasn't loaded into any screen's view), pull it directly.
  useEffect(() => {
    if (selectedTaskDetailId === null) return;
    if (task && task.id === selectedTaskDetailId) return;
    let cancelled = false;
    getTaskById(selectedTaskDetailId)
      .then((t) => {
        if (cancelled || !t) return;
        primeTasks([t]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedTaskDetailId, task, primeTasks]);

  useEffect(() => {
    let cancelled = false;
    getProjects()
      .then((list) => {
        if (!cancelled) setProjects(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!task) {
      setWorkedMinutes(0);
      return;
    }
    let cancelled = false;
    getWorkedMinutesForTask(task.id)
      .then((m) => {
        if (!cancelled) setWorkedMinutes(m);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [task?.id]);

  if (!task) return null;

  async function handleSave(updates: UpdateTaskInput) {
    try {
      await updateTaskAction(updates);
    } catch {
      // silent — surfaces via existing error pathways
    }
  }

  async function handleToggle(t: Task) {
    const nextStatus = t.status === "done" ? "todo" : "done";
    try {
      await setTaskStatusAction(t.id, nextStatus);
    } catch {
      // silent — surfaces via existing error pathways
    }
  }

  async function handleDelete(taskId: number) {
    try {
      await deleteTaskAction(taskId);
      closeTaskDetail();
    } catch {
      // silent — surfaces via existing error pathways
    }
  }

  async function handleStartFocus(t: Task) {
    // Mirrors the existing parent-screen pattern: create the time entry,
    // start active focus, navigate to the immersive Focus page. Each
    // parent (DailyPlanner/ProjectDetail/PlanTab/etc.) does this in its
    // own `handleStartFocus`; the host owns it now so M1.b can drop
    // those duplicates.
    closeTaskDetail();
    try {
      const priorMinutes = await getWorkedMinutesForTask(t.id);
      const entryId = await startTimeEntry(t.id, "tracked");
      const prevPage = useAppStore.getState().currentPage;
      startFocus(t, entryId, prevPage, priorMinutes * 60 * 1000);
      setPage("focus");
    } catch {
      // silent — surfaces via existing error pathways
    }
  }

  async function handleSetWorkedMinutes(id: number, minutes: number) {
    try {
      await setTaskWorkedMinutesAction(id, minutes);
      setWorkedMinutes(minutes);
    } catch {
      // silent — surfaces via existing error pathways
    }
  }

  return (
    <TaskDetailOverlay
      key={task.id}
      task={task}
      projects={projects}
      autoFocusTitle={taskDetailAutoFocusTitle}
      onClose={closeTaskDetail}
      onSave={handleSave}
      onToggle={handleToggle}
      onDelete={handleDelete}
      onStartFocus={handleStartFocus}
      workedMinutes={workedMinutes}
      onSetWorkedMinutes={handleSetWorkedMinutes}
    />
  );
}
