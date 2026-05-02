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
  if (!dueDate) return "text-fg-faded";
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const due = new Date(dueDate + "T00:00:00");
  const diffDays = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return "text-accent-danger";
  if (diffDays <= 3) return "text-accent-warning-soft-fg";
  return "text-fg-faded";
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
  const [filter, setFilter] = useState<FilterMode>("active");
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
    { key: "active", label: "Active", count: activeCount },
    { key: "completed", label: "Completed", count: completedCount },
    { key: "all", label: "All", count: allCount },
  ];

  return (
    <div className="flex flex-col h-full bg-base overflow-hidden relative" onClick={() => setMenuOpenId(null)}>
      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {/* Undo archive banner */}
      {archivedUndo && (
        <div className="px-6 py-2 bg-banner flex items-center gap-3 flex-shrink-0" style={{ color: "var(--text-banner)" }}>
          <span className="text-[12px] opacity-70">
            Archived &ldquo;{archivedUndo.name}&rdquo;
          </span>
          <button
            onClick={async () => {
              await archiveProject(archivedUndo.id, false);
              setArchivedUndo(null);
              if (archiveTimerRef.current) clearTimeout(archiveTimerRef.current);
              loadData();
            }}
            className="text-[12px] text-accent-blue-soft-fg cursor-pointer transition-colors"
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-banner)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = ""; }}
          >
            Undo
          </button>
        </div>
      )}

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-[18px] border-b border-line-soft flex-shrink-0">
        <h2 className="text-[18px] font-medium text-fg font-display">Projects</h2>
        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--text-faded)" strokeWidth="1.3" strokeLinecap="round" className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
              <circle cx="6" cy="6" r="4.5" />
              <path d="M9.5 9.5L12.5 12.5" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search..."
              className="w-[160px] pl-8 pr-3 py-1.5 text-[12px] bg-input border border-line-soft rounded-lg text-fg placeholder:text-fg-faded outline-none focus:border-accent-blue focus:bg-elevated transition-colors"
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
                ? "bg-accent-blue-soft border-accent-blue text-accent-blue-soft-fg"
                : "bg-input border-line-soft text-fg-secondary hover:bg-input-hover"
            }`}
          >
            {f.label}
            <span className={`ml-1 ${filter === f.key ? "text-accent-blue-soft-fg/60" : "text-fg-disabled"}`}>
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
                  <p className="text-[14px] text-fg-faded mb-1">
                    {searchQuery
                      ? `No projects matching "${searchQuery}"`
                      : filter === "all"
                        ? "Start your first project"
                        : `No ${filter} projects`}
                  </p>
                  {filter === "all" && !searchQuery && (
                    <p className="text-[12px] text-fg-faded">
                      Give your work a home. Type a name below to begin.
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
                        className={`bg-elevated rounded-[10px] overflow-hidden ${
                          isCompleted ? "opacity-55" : ""
                        }`}
                        style={{ border: "0.5px solid var(--border-hairline)" }}
                      >
                        <div className="flex-1 min-w-0">
                          <div
                            onClick={() => openProject(project.id)}
                            className="group/row px-4 py-[14px] cursor-pointer hover:bg-overlay-hover relative"
                          >
                            <div className="flex items-center gap-2.5">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  {/* Project color dot */}
                                  {!isCompleted && (
                                    <div
                                      className="w-[8px] h-[8px] rounded-full shrink-0"
                                      style={{ backgroundColor: project.color }}
                                    />
                                  )}
                                  {/* Completed checkmark */}
                                  {isCompleted && (
                                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--accent-green)" strokeWidth="2" strokeLinecap="round" className="shrink-0">
                                      <path d="M3 8.5l3.5 3.5 6.5-7" />
                                    </svg>
                                  )}
                                  <span className={`block truncate [font-size:var(--font-size-primary)] [font-weight:var(--font-weight-primary)] ${
                                    isCompleted ? "text-fg-muted line-through" : "text-fg"
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
                                  <span className="text-[11px] text-fg-faded">
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
                                      ? "bg-accent-blue-soft text-accent-blue-soft-fg"
                                      : "bg-overlay-hover text-fg-faded hover:bg-overlay-pressed"
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
                                  className={`w-7 h-7 flex items-center justify-center rounded-md text-fg-faded hover:text-fg-secondary hover:bg-overlay-hover cursor-pointer transition-opacity ${
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
                                    className="absolute right-0 top-8 z-20 bg-elevated rounded-lg border border-line-soft py-1 min-w-[140px]"
                                    style={{ boxShadow: "var(--shadow-card)" }}
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <button
                                      onClick={() => { setMenuOpenId(null); openProject(project.id); }}
                                      className="w-full text-left px-3 py-1.5 text-[12px] text-fg hover:bg-overlay-hover cursor-pointer"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      onClick={async () => {
                                        setMenuOpenId(null);
                                        await completeProject(project.id, !isCompleted);
                                        loadData();
                                      }}
                                      className="w-full text-left px-3 py-1.5 text-[12px] text-fg hover:bg-overlay-hover cursor-pointer"
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
                                      className="w-full text-left px-3 py-1.5 text-[12px] text-accent-destructive hover:bg-overlay-hover cursor-pointer"
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
                            <div className="border-t border-line-hairline px-4 py-2">
                              {tasks.map((task) => {
                                const dateLabel = task.date_scheduled
                                  ? new Date(task.date_scheduled + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })
                                  : null;
                                return (
                                  <button
                                    key={task.id}
                                    onClick={() => setDetailTask(task)}
                                    className="w-full flex items-center gap-2 px-1 py-1.5 text-left rounded-md cursor-pointer hover:bg-overlay-hover transition-colors"
                                  >
                                    {task.status === "done" ? (
                                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="var(--accent-green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                                        <path d="M3 8.5l3.5 3.5 6.5-7" />
                                      </svg>
                                    ) : (
                                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="var(--text-disabled)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                                        <path d="M3 8.5l3.5 3.5 6.5-7" />
                                      </svg>
                                    )}
                                    <span className={`text-[12px] flex-1 truncate ${task.status === "done" ? "text-fg-faded line-through" : "text-fg"}`}>{task.title}</span>
                                    {task.estimated_minutes != null && task.estimated_minutes > 0 && (
                                      <span className="text-[10px] text-fg-disabled">{task.estimated_minutes}m</span>
                                    )}
                                    {dateLabel && (
                                      <span className="text-[10px] text-fg-disabled">{dateLabel}</span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                          {isExpanded && tasks.length === 0 && (
                            <div className="border-t border-line-hairline px-4 py-2">
                              <p className="text-[11px] text-fg-disabled">Loading...</p>
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
                className="flex items-center gap-2.5 bg-elevated rounded-[10px] px-4 py-[12px] overflow-hidden"
                style={{ border: "0.5px solid var(--border-hairline)" }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--text-disabled)" strokeWidth="1.5" strokeLinecap="round" className="shrink-0">
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
                  className="flex-1 text-[13px] text-fg placeholder:text-fg-disabled bg-transparent outline-none"
                />
                {inlineCreateName.trim() && (
                  <button
                    onClick={handleInlineCreate}
                    className="text-[11px] text-accent-blue-soft-fg hover:text-accent-blue cursor-pointer flex-shrink-0"
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
