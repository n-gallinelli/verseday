import { useEffect, useState, useCallback, useRef } from "react";
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
  archiveProject,
  completeProject,
  PRESET_COLORS,
} from "../db/queries";
import ErrorBanner from "../components/ErrorBanner";
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
  const [filter, setFilter] = useState<FilterMode>("all");
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<number>>(new Set());
  const [projectTasks, setProjectTasks] = useState<Map<number, Task[]>>(new Map());
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [archivedUndo, setArchivedUndo] = useState<{ id: number; name: string } | null>(null);
  const archiveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Inline create state
  const [inlineCreateName, setInlineCreateName] = useState("");
  const inlineInputRef = useRef<HTMLInputElement>(null);

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

  async function handleInlineCreate() {
    const name = inlineCreateName.trim();
    if (!name) return;
    // Auto-pick first unused color
    const usedColors = new Set(projects.map((p) => p.color));
    const color = PRESET_COLORS.slice(0, 8).find((c) => !usedColors.has(c)) ?? PRESET_COLORS[0];
    await handleCreate(name, color);
    setInlineCreateName("");
    inlineInputRef.current?.focus();
  }

  async function toggleProjectExpand(projectId: number) {
    setExpandedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
        if (!projectTasks.has(projectId)) {
          getTasksForProject(projectId, true).then((tasks) => {
            setProjectTasks((m) => new Map(m).set(projectId, tasks));
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

  // Sort + filter + search
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
    if (filter === "active" && p.completed) return false;
    if (filter === "completed" && !p.completed) return false;
    if (searchQuery) {
      return p.name.toLowerCase().includes(searchQuery.toLowerCase());
    }
    return true;
  });

  // Filter counts
  const allCount = projects.length;
  const activeCount = projects.filter((p) => !p.completed).length;
  const completedCount = projects.filter((p) => !!p.completed).length;

  const FILTERS: { key: FilterMode; label: string; count: number }[] = [
    { key: "all", label: "All", count: allCount },
    { key: "active", label: "Active", count: activeCount },
    { key: "completed", label: "Completed", count: completedCount },
  ];

  return (
    <div className="flex flex-col h-full bg-[#f5f4f0] overflow-hidden relative" onClick={() => setMenuOpenId(null)}>
      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {/* Undo archive banner */}
      {archivedUndo && (
        <div className="px-6 py-2 bg-[#2c2a35] flex items-center gap-3 flex-shrink-0">
          <span className="text-[12px] text-white/70">
            Archived &ldquo;{archivedUndo.name}&rdquo;
          </span>
          <button
            onClick={async () => {
              await archiveProject(archivedUndo.id, false);
              setArchivedUndo(null);
              if (archiveTimerRef.current) clearTimeout(archiveTimerRef.current);
              loadData();
            }}
            className="text-[12px] text-[#7B9ED9] hover:text-white cursor-pointer"
          >
            Undo
          </button>
        </div>
      )}

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-[18px] border-b border-black/[0.07] flex-shrink-0">
        <h2 className="text-[18px] font-medium text-[#2c2a35]">Projects</h2>
        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth="1.3" strokeLinecap="round" className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
              <circle cx="6" cy="6" r="4.5" />
              <path d="M9.5 9.5L12.5 12.5" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search..."
              className="w-[160px] pl-8 pr-3 py-1.5 text-[12px] bg-black/[0.03] border border-black/[0.08] rounded-lg text-[#2c2a35] placeholder-black/25 outline-none focus:border-[#7B9ED9]/40 focus:bg-white transition-colors"
            />
          </div>
        </div>
      </div>

      {/* ── Filter pills with counts ─────────────────────────────────── */}
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
            <span className={`ml-1 ${filter === f.key ? "text-[#3D6FCC]/60" : "text-black/20"}`}>
              {f.count}
            </span>
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
                    {searchQuery
                      ? `No projects matching "${searchQuery}"`
                      : filter === "all"
                        ? "No projects yet"
                        : `No ${filter} projects`}
                  </p>
                  {filter === "all" && !searchQuery && (
                    <p className="text-[12px] text-black/25">
                      Type a name below to create your first project
                    </p>
                  )}
                </div>
              ) : (
                filteredProjects.map((project) => {
                  const stats = statsMap.get(project.id) ?? { total: 0, done: 0, lastDate: null };
                  const openCount = stats.total - stats.done;
                  const isCompleted = !!project.completed;
                  const dueDate = project.target_date;
                  const isExpanded = expandedProjectIds.has(project.id);
                  const tasks = projectTasks.get(project.id) ?? [];

                  return (
                    <SortableProjectRow key={project.id} id={project.id}>
                      <div
                        className={`bg-white rounded-[10px] overflow-hidden flex ${
                          isCompleted ? "opacity-55" : ""
                        }`}
                        style={{ border: "0.5px solid rgba(0,0,0,0.06)" }}
                      >
                        {/* Left color bar */}
                        <div
                          className="w-[4px] flex-shrink-0 rounded-l-[10px]"
                          style={{ backgroundColor: project.color }}
                        />
                        <div className="flex-1 min-w-0">
                          <div
                            onClick={() => openProject(project.id)}
                            className="group/row px-4 py-[14px] cursor-pointer hover:bg-black/[0.01] relative"
                          >
                            <div className="flex items-center gap-2.5">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  {/* Completed checkmark */}
                                  {isCompleted && (
                                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#6A9E7F" strokeWidth="2" strokeLinecap="round" className="shrink-0">
                                      <path d="M3 8.5l3.5 3.5 6.5-7" />
                                    </svg>
                                  )}
                                  <span className={`block truncate [font-size:var(--font-size-primary)] [font-weight:var(--font-weight-primary)] ${
                                    isCompleted ? "text-black/40 line-through" : "text-[#2c2a35]"
                                  }`}>
                                    {project.name}
                                  </span>
                                </div>
                                {dueDate && !isCompleted && (
                                  <span className={`text-[11px] ${getDueDateColor(dueDate)}`}>
                                    Due {formatDate(dueDate)}
                                  </span>
                                )}
                                {isCompleted && dueDate && (
                                  <span className="text-[11px] text-black/30">
                                    Completed {formatDate(dueDate)}
                                  </span>
                                )}
                              </div>

                              {/* Task count chip — also toggles expand */}
                              {stats.total > 0 && !isCompleted && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleProjectExpand(project.id);
                                  }}
                                  className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] cursor-pointer transition-colors flex-shrink-0 ${
                                    isExpanded
                                      ? "bg-[#EEF3FB] text-[#3D6FCC]"
                                      : "bg-black/[0.04] text-black/35 hover:bg-black/[0.07]"
                                  }`}
                                >
                                  <span>{openCount} open</span>
                                  <span className="text-[9px]">{isExpanded ? "▾" : "▸"}</span>
                                </button>
                              )}

                              {/* Quick-action menu */}
                              <div className="relative flex-shrink-0">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setMenuOpenId(menuOpenId === project.id ? null : project.id);
                                  }}
                                  className={`w-7 h-7 flex items-center justify-center rounded-md text-black/25 hover:text-black/50 hover:bg-black/[0.04] cursor-pointer transition-opacity ${
                                    menuOpenId === project.id ? "opacity-100" : "opacity-0 group-hover/row:opacity-100"
                                  }`}
                                >
                                  <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                                    <circle cx="3" cy="7" r="1.2" />
                                    <circle cx="7" cy="7" r="1.2" />
                                    <circle cx="11" cy="7" r="1.2" />
                                  </svg>
                                </button>
                                {menuOpenId === project.id && (
                                  <div
                                    className="absolute right-0 top-8 z-20 bg-white rounded-lg shadow-lg border border-black/[0.08] py-1 min-w-[140px]"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <button
                                      onClick={() => { setMenuOpenId(null); openProject(project.id); }}
                                      className="w-full text-left px-3 py-1.5 text-[12px] text-[#2c2a35] hover:bg-black/[0.03] cursor-pointer"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      onClick={async () => {
                                        setMenuOpenId(null);
                                        await completeProject(project.id, !isCompleted);
                                        loadData();
                                      }}
                                      className="w-full text-left px-3 py-1.5 text-[12px] text-[#2c2a35] hover:bg-black/[0.03] cursor-pointer"
                                    >
                                      {isCompleted ? "Mark active" : "Mark complete"}
                                    </button>
                                    <button
                                      onClick={async () => {
                                        setMenuOpenId(null);
                                        await archiveProject(project.id, true);
                                        setArchivedUndo({ id: project.id, name: project.name });
                                        if (archiveTimerRef.current) clearTimeout(archiveTimerRef.current);
                                        archiveTimerRef.current = setTimeout(() => setArchivedUndo(null), 5000);
                                        loadData();
                                      }}
                                      className="w-full text-left px-3 py-1.5 text-[12px] text-[#C0614A] hover:bg-black/[0.03] cursor-pointer"
                                    >
                                      Archive
                                    </button>
                                  </div>
                                )}
                              </div>
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
                                    {task.status === "done" ? (
                                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#6A9E7F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                                        <path d="M3 8.5l3.5 3.5 6.5-7" />
                                      </svg>
                                    ) : (
                                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="rgba(0,0,0,0.15)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                                        <path d="M3 8.5l3.5 3.5 6.5-7" />
                                      </svg>
                                    )}
                                    <span className={`text-[12px] flex-1 truncate ${task.status === "done" ? "text-black/30 line-through" : "text-[#2c2a35]"}`}>{task.title}</span>
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
                      </div>
                    </SortableProjectRow>
                  );
                })
              )}

              {/* ── Inline create row ─────────────────────────────────────── */}
              <div
                className="flex items-center gap-2.5 bg-white rounded-[10px] px-4 py-[12px] overflow-hidden"
                style={{ border: "0.5px solid rgba(0,0,0,0.06)" }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="rgba(0,0,0,0.2)" strokeWidth="1.5" strokeLinecap="round" className="shrink-0">
                  <path d="M7 2v10M2 7h10" />
                </svg>
                <input
                  ref={inlineInputRef}
                  type="text"
                  value={inlineCreateName}
                  onChange={(e) => setInlineCreateName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleInlineCreate();
                    if (e.key === "Escape") {
                      setInlineCreateName("");
                      inlineInputRef.current?.blur();
                    }
                  }}
                  placeholder="New project..."
                  maxLength={100}
                  className="flex-1 text-[13px] text-[#2c2a35] placeholder-black/20 bg-transparent outline-none"
                />
                {inlineCreateName.trim() && (
                  <button
                    onClick={handleInlineCreate}
                    className="text-[11px] text-[#7B9ED9] hover:text-[#3D6FCC] cursor-pointer flex-shrink-0"
                  >
                    Create
                  </button>
                )}
              </div>
            </div>
          </div>
        </SortableContext>
      </DndContext>

      {/* Task detail overlay */}
      {detailTask && (
        <TaskDetailOverlay
          key={detailTask.id}
          task={detailTask}
          projects={projects}
          onClose={() => { setDetailTask(null); loadData(); }}
          onSave={(updates) => updateTask(updates).then(() => {
            loadData();
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
