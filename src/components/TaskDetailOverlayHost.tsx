import { useEffect, useState } from "react";
import TaskDetailOverlay from "./TaskDetailOverlay";
import { selectTaskDetailTask, useAppStore } from "../stores/appStore";
import {
  deleteTask,
  getProjects,
  getTaskById,
  getWorkedMinutesForTask,
  setManualWorkedMinutes,
  setTaskStatusFromUI,
  startTimeEntry,
  updateTask,
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
// Mutations broadcast `verseday:task-updated` so per-screen lists can
// refresh without prop drilling. M3.2.b.5 retires the event once
// every screen has migrated to selector-driven reads.
export default function TaskDetailOverlayHost() {
  const selectedTaskDetailId = useAppStore((s) => s.selectedTaskDetailId);
  const closeTaskDetail = useAppStore((s) => s.closeTaskDetail);
  const cacheTasks = useAppStore((s) => s.cacheTasks);
  const startFocus = useAppStore((s) => s.startFocus);
  const setPage = useAppStore((s) => s.setPage);
  const taskDetailAutoFocusTitle = useAppStore((s) => s.taskDetailAutoFocusTitle);
  const task = useAppStore(selectTaskDetailTask);

  const [projects, setProjects] = useState<Project[]>([]);
  const [workedMinutes, setWorkedMinutes] = useState(0);

  // Cache-miss fallback. If a screen hasn't primed the cache for this id
  // (e.g., the overlay is opened from a context where the task wasn't
  // loaded into the page's local state), pull it directly.
  useEffect(() => {
    if (selectedTaskDetailId === null) return;
    if (task && task.id === selectedTaskDetailId) return;
    let cancelled = false;
    getTaskById(selectedTaskDetailId)
      .then((t) => {
        if (cancelled || !t) return;
        cacheTasks([t]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedTaskDetailId, task, cacheTasks]);

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

  function emitUpdated(taskId: number) {
    window.dispatchEvent(
      new CustomEvent("verseday:task-updated", { detail: { taskId } })
    );
  }

  async function refreshCache(id: number) {
    const fresh = await getTaskById(id).catch(() => null);
    if (fresh) cacheTasks([fresh]);
  }

  async function handleSave(updates: UpdateTaskInput) {
    try {
      await updateTask(updates);
      await refreshCache(updates.id);
      emitUpdated(updates.id);
    } catch {
      // silent — surfaces via existing error pathways
    }
  }

  async function handleToggle(t: Task) {
    const nextStatus = t.status === "done" ? "today" : "done";
    try {
      await setTaskStatusFromUI(t.id, nextStatus);
      await refreshCache(t.id);
      emitUpdated(t.id);
    } catch {
      // silent — surfaces via existing error pathways
    }
  }

  async function handleDelete(taskId: number) {
    try {
      await deleteTask(taskId);
      window.dispatchEvent(
        new CustomEvent("verseday:task-deleted", { detail: { taskId } })
      );
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
      await setManualWorkedMinutes(id, minutes);
      setWorkedMinutes(minutes);
      await refreshCache(id);
      emitUpdated(id);
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
