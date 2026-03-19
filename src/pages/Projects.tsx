import { useEffect, useState, useCallback } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAppStore } from "../stores/appStore";
import {
  getProjects,
  createProject,
  getProjectStats,
  getTasksForProject,
  updateProjectSortOrders,
  updateTask,
  updateTaskStatus,
  deleteTask,
} from "../db/queries";
import ErrorBanner from "../components/ErrorBanner";
import NewProjectPanel from "../components/NewProjectPanel";
import TaskDetailOverlay from "../components/TaskDetailOverlay";
import type { Project, Task } from "../types";

type FilterMode = "all" | "active" | "completed";

function SortableProjectRow({
  id,
  children,
}: {
  id: number;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children}
    </div>
  );
}

function getDueDateColor(dueDate: string | null): string {
  if (!dueDate) return "text-black/30";
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const due = new Date(dueDate + "T00:00:00");
  const diffDays = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return "text-[#A32D2D]";
  if (diffDays <= 3) return "text-[#BA7517]";
  return "text-black/30";
}

function formatDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export default function Projects() {
  const { openProject } = useAppStore();
  const [projects, setProjects] = useState<Project[]>([]);
  const [statsMap, setStatsMap] = useState<
    Map<number, { total: number; done: number; lastDate: string | null }>
  >(new Map());
  const [error, setError] = useState<string | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<number>>(new Set());
  const [projectTasks, setProjectTasks] = useState<Map<number, Task[]>>(new Map());
  const [detailTask, setDetailTask] = useState<Task | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [p, stats] = await Promise.all([
        getProjects(false),
        getProjectStats(),
      ]);
      setProjects(p);
      setStatsMap(stats);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load projects");
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleCreate(name: string, color: string) {
    try {
      await createProject(name, color);
      setError(null);
      loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create project");
    }
  }

  async function toggleProjectExpand(projectId: number) {
    setExpandedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
        // Lazy-load tasks
        if (!projectTasks.has(projectId)) {
          getTasksForProject(projectId).then((tasks) => {
            setProjectTasks((m) => new Map(m).set(projectId, tasks.slice(0, 5)));
          }).catch(() => {});
        }
      }
      return next;
    });
  }

  function handleDragStart(_event: DragStartEvent) {
    setExpandedProjectIds(new Set());
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = projects.findIndex((p) => p.id === active.id);
    const newIndex = projects.findIndex((p) => p.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(projects, oldIndex, newIndex);
    setProjects(reordered);
    try {
      await updateProjectSortOrders(
        reordered.map((p, i) => ({ id: p.id, sortOrder: i }))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reorder");
      loadData();
    }
  }

  // Sort + filter
  const hasCustomOrder = projects.some((p) => p.sort_order != null);

  const sortedProjects = [...projects].sort((a, b) => {
    if (hasCustomOrder) {
      return (a.sort_order ?? 9999) - (b.sort_order ?? 9999);
    }
    const aOpen = (statsMap.get(a.id)?.total ?? 0) - (statsMap.get(a.id)?.done ?? 0);
    const bOpen = (statsMap.get(b.id)?.total ?? 0) - (statsMap.get(b.id)?.done ?? 0);
    return bOpen - aOpen;
  });

  const filteredProjects = sortedProjects.filter((p) => {
    if (filter === "active") return !p.completed;
    if (filter === "completed") return !!p.completed;
    return true;
  });

  const FILTERS: { key: FilterMode; label: string }[] = [
    { key: "all", label: "All" },
    { key: "active", label: "Active" },
    { key: "completed", label: "Completed" },
  ];

  return (
    <div className="flex flex-col h-full bg-[#f5f4f0] overflow-hidden relative">
      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-[18px] border-b border-black/[0.07] flex-shrink-0">
        <h2 className="text-[18px] font-medium text-[#2c2a35]">Projects</h2>
        <button
          onClick={() => setIsPanelOpen(true)}
          className="bg-[#7B9ED9] text-white border-none rounded-lg px-3.5 py-1.5 text-[12px] font-medium cursor-pointer hover:bg-[#6889c4]"
        >
          + New project
        </button>
      </div>

      {/* ── Filter pills ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 px-6 py-3 flex-shrink-0">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1 rounded-full text-[12px] cursor-pointer transition-colors border ${
              filter === f.key
                ? "bg-[#EEF3FB] border-[#7B9ED9] text-[#3D6FCC]"
                : "bg-black/[0.03] border-black/[0.08] text-black/40 hover:bg-black/[0.06]"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* ── Project list ──────────────────────────────────────────────── */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={filteredProjects.map((p) => p.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="flex-1 overflow-y-auto px-6 pb-6">
            <div className="flex flex-col gap-[6px]">
              {filteredProjects.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <p className="text-[14px] text-black/35 mb-1">
                    {filter === "all" ? "No projects yet" : `No ${filter} projects`}
                  </p>
                  {filter === "all" && (
                    <p className="text-[12px] text-black/25">
                      Click &ldquo;+ New project&rdquo; to get started
                    </p>
                  )}
                </div>
              ) : (
                filteredProjects.map((project) => {
                  const stats = statsMap.get(project.id) ?? { total: 0, done: 0, lastDate: null };
                  const openCount = stats.total - stats.done;
                  const progressPercent = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;
                  const isCompleted = !!project.completed;
                  const dueDate = project.target_date;
                  const isExpanded = expandedProjectIds.has(project.id);
                  const tasks = projectTasks.get(project.id) ?? [];

                  return (
                    <SortableProjectRow key={project.id} id={project.id}>
                      <div
                        className={`bg-white border border-black/[0.06] rounded-[10px] overflow-hidden transition-colors ${
                          isCompleted ? "opacity-55" : ""
                        }`}
                        style={{ borderWidth: "0.5px" }}
                      >
                        <div
                          onClick={() => openProject(project.id)}
                          className="px-4 py-[14px] cursor-pointer hover:bg-black/[0.01]"
                        >
                          {/* Top row */}
                          <div className="flex items-center gap-2.5 mb-2">
                            {/* Chevron */}
                            {openCount > 0 && !isCompleted && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleProjectExpand(project.id);
                                }}
                                className="text-[10px] text-black/25 cursor-pointer w-3 flex-shrink-0 hover:text-black/50"
                              >
                                {isExpanded ? "▾" : "▸"}
                              </button>
                            )}
                            <div
                              className="w-2 h-2 rounded-full flex-shrink-0"
                              style={{ backgroundColor: project.color }}
                            />
                            <span className="text-[14px] font-medium text-[#2c2a35] flex-1">
                              {project.name}
                            </span>
                            {isCompleted && dueDate ? (
                              <span className="text-[12px] text-black/30">
                                Completed {formatDate(dueDate)}
                              </span>
                            ) : dueDate ? (
                              <span className={`text-[12px] ${getDueDateColor(dueDate)}`}>
                                Due {formatDate(dueDate)}
                              </span>
                            ) : null}
                          </div>

                        </div>

                        {/* Expanded tasks */}
                        {isExpanded && tasks.length > 0 && (
                          <div className="border-t border-black/[0.05] px-4 py-2">
                            {tasks.map((task) => {
                              const dateLabel = task.date_scheduled
                                ? new Date(task.date_scheduled + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })
                                : null;
                              return (
                                <button
                                  key={task.id}
                                  onClick={() => setDetailTask(task)}
                                  className="w-full flex items-center gap-2 px-1 py-1.5 text-left rounded-md cursor-pointer hover:bg-black/[0.03] transition-colors"
                                >
                                  <span className="text-[12px] text-[#2c2a35] flex-1 truncate">{task.title}</span>
                                  {task.estimated_minutes != null && task.estimated_minutes > 0 && (
                                    <span className="text-[10px] text-black/20">{task.estimated_minutes}m</span>
                                  )}
                                  {dateLabel && (
                                    <span className="text-[10px] text-black/20">{dateLabel}</span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        )}
                        {isExpanded && tasks.length === 0 && (
                          <div className="border-t border-black/[0.05] px-4 py-2">
                            <p className="text-[11px] text-black/20">Loading...</p>
                          </div>
                        )}
                      </div>
                    </SortableProjectRow>
                  );
                })
              )}
            </div>
          </div>
        </SortableContext>
      </DndContext>

      {/* ── New project panel ───────────────────────────────────────────── */}
      <NewProjectPanel
        isOpen={isPanelOpen}
        onClose={() => setIsPanelOpen(false)}
        onCreate={handleCreate}
        activeColors={projects.filter((p) => !p.completed).map((p) => p.color)}
      />

      {/* Task detail overlay */}
      {detailTask && (
        <TaskDetailOverlay
          task={detailTask}
          projects={projects}
          onClose={() => { setDetailTask(null); loadData(); }}
          onSave={(updates) => updateTask(updates).then(() => {
            loadData();
            // Refresh expanded project tasks
            if (detailTask.project_id != null) {
              getTasksForProject(detailTask.project_id).then((t) => {
                setProjectTasks((m) => new Map(m).set(detailTask.project_id!, t.slice(0, 5)));
              }).catch(() => {});
            }
          }).catch(() => {})}
          onToggle={(t) => {
            updateTaskStatus(t.id, t.status === "done" ? "todo" : "done")
              .then(() => { setDetailTask(null); loadData(); })
              .catch(() => {});
          }}
          onDelete={(id) => {
            deleteTask(id).then(() => { setDetailTask(null); loadData(); }).catch(() => {});
          }}
        />
      )}
    </div>
  );
}
