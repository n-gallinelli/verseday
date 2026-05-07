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
  updateTask,
} from "../db/queries";
import type { UpdateTaskInput } from "../db/queries";
import type { Project, Task } from "../types";

// Singleton host for TaskDetailOverlay (Verse rule 2 — one mount per
// cross-screen surface). Mounted exactly once at the App shell. Reads
// `selectedTaskDetailId` from the store; resolves the task via
// selectTaskDetailTask (transitional `tasksByIdCache` in M1; canonical
// `tasksById` after M3.2). Falls back to a one-shot getTaskById fetch
// on cache miss so the overlay opens even when no screen has primed
// the cache for that ID.
//
// Mutations broadcast `verseday:task-updated` so per-screen lists can
// refresh without prop drilling. M3.2 removes the event in favor of
// store subscriptions.
export default function TaskDetailOverlayHost() {
  const selectedTaskDetailId = useAppStore((s) => s.selectedTaskDetailId);
  const closeTaskDetail = useAppStore((s) => s.closeTaskDetail);
  const cacheTasks = useAppStore((s) => s.cacheTasks);
  const previewFocus = useAppStore((s) => s.previewFocus);
  const setPage = useAppStore((s) => s.setPage);
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
    closeTaskDetail();
    try {
      const priorMinutes = await getWorkedMinutesForTask(t.id);
      const prevPage = useAppStore.getState().currentPage;
      previewFocus(t, prevPage, priorMinutes * 60 * 1000);
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
