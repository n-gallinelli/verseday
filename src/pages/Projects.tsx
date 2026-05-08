import { useEffect, useMemo, useState, useCallback, useRef } from "react";
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
  updateProjectSortOrders,
  archiveProject,
  searchTasksByTitle,
  PRESET_COLORS,
} from "../db/queries";
import ErrorBanner from "../components/ErrorBanner";
import { errorMessage } from "../utils/errors";
import { formatHoursMinutes } from "../utils/format";
import DisclosureCaret from "../components/DisclosureCaret";
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
  const openTaskDetail = useAppStore((s) => s.openTaskDetail);
  const primeTasks = useAppStore((s) => s.primeTasks);
  const [projects, setProjects] = useState<Project[]>([]);
  const [statsMap, setStatsMap] = useState<
    Map<number, { total: number; done: number; lastDate: string | null }>
  >(new Map());
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterMode>("active");
  // View mode is persisted so the user's preference sticks across
  // sessions. Defaults to "cards" — flip to "list" via the toggle to
  // get the previous row layout (kept in place for easy revert).
  const [viewMode, setViewMode] = useState<"list" | "cards">(() => {
    const stored = localStorage.getItem("verseday_objectives_view");
    return stored === "list" ? "list" : "cards";
  });
  useEffect(() => {
    localStorage.setItem("verseday_objectives_view", viewMode);
  }, [viewMode]);
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<number>>(new Set());
  // M4 — Project-list-expand inline display now derives from the
  // canonical store (closes the M3.2.b.2 parking-lot item). Each
  // expanded project's task list resolves via taskIdsByProject +
  // tasksById; loadTasksForProject primes both. Replaces the local
  // useState<Map<number, Task[]>> + getTasksForProject(true) flow.
  const taskIdsByProject = useAppStore((s) => s.taskIdsByProject);
  const tasksById = useAppStore((s) => s.tasksById);
  const loadTasksForProject = useAppStore((s) => s.loadTasksForProject);
  // Memoized per-project task list for the expanded-projects render.
  // Subscribes to expandedProjectIds, taskIdsByProject, and tasksById;
  // re-derives only when one of those changes. A status flip /
  // rename / delete on a task in an expanded project flows through
  // tasksById and re-runs the memo.
  const projectTasksMap = useMemo(() => {
    const result = new Map<number, Task[]>();
    for (const projectId of expandedProjectIds) {
      const ids = taskIdsByProject.get(projectId) ?? [];
      const list: Task[] = [];
      for (const id of ids) {
        const t = tasksById.get(id);
        if (t) list.push(t);
      }
      result.set(projectId, list);
    }
    return result;
  }, [expandedProjectIds, taskIdsByProject, tasksById]);
  const [searchQuery, setSearchQuery] = useState("");
  // M3.2.b.2 — store IDs locally; resolve full Task data through the
  // canonical map at render time. Same hybrid pattern DailyPlanner's
  // sidebar uses: cross-cutting query produces an ID list,
  // tasksById is the live source for the rendered rows. A rename in
  // the detail overlay flows back here via the tasksById subscription
  // without re-running the SQL search.
  const [matchingTaskIds, setMatchingTaskIds] = useState<number[]>([]);
  const matchingTasks = useMemo(() => {
    const out: Task[] = [];
    for (const id of matchingTaskIds) {
      const t = tasksById.get(id);
      if (t) out.push(t);
    }
    return out;
  }, [matchingTaskIds, tasksById]);
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
      setError(errorMessage(e, "Failed to load projects"));
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // M3.2.b.5.b — verseday:task-updated/-deleted listener retired.
  // matchingTaskIds renders rely on canonical map reactivity — a
  // rename in the detail overlay re-renders the search row through
  // the tasksById subscription. getProjectStats values go stale on
  // task mutation until the next screen mount (browse-context
  // staleness, accepted per the M3.2.b.5 audit). Expanded-project
  // task caches load fresh on each expand anyway.

  // Search tasks alongside projects. Lightly debounced so each keystroke
  // doesn't hit SQLite. Empty query clears the result list.
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setMatchingTaskIds([]);
      return;
    }
    const timer = setTimeout(() => {
      searchTasksByTitle(q)
        .then((results) => {
          // Prime the canonical map first so the render below resolves
          // each id via tasksById without a flash of empty rows.
          primeTasks(results);
          setMatchingTaskIds(results.map((t) => t.id));
        })
        .catch(() => setMatchingTaskIds([]));
    }, 120);
    return () => clearTimeout(timer);
  }, [searchQuery, primeTasks]);

  async function handleCreate(name: string, color: string) {
    try {
      await createProject(name, color);
      setError(null);
      loadData();
    } catch (e) {
      setError(errorMessage(e, "Failed to create project"));
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
        // Always re-fetch on expand. loadTasksForProject is idempotent
        // and refreshes any task whose state changed since the last
        // load. Pre-M4 this gated on a local cache; canonical store
        // makes that gate unnecessary.
        void loadTasksForProject(projectId);
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
      setError(errorMessage(e, "Failed to reorder"));
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
    <div className="flex flex-col h-full bg-base overflow-hidden relative">
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
        <h2 className="text-[18px] font-medium text-fg font-display">Objectives</h2>
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

      {/* ── Filter pills with counts + view toggle ──────────────────── */}
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
        <div className="ml-auto flex items-center gap-0.5 rounded-md p-0.5 bg-input border border-line-soft">
          <button
            onClick={() => setViewMode("list")}
            title="List view"
            aria-label="List view"
            className={`w-6 h-6 rounded flex items-center justify-center cursor-pointer transition-colors ${
              viewMode === "list" ? "bg-elevated text-fg" : "text-fg-faded hover:text-fg-secondary"
            }`}
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
              <line x1="2" y1="4" x2="12" y2="4" />
              <line x1="2" y1="7" x2="12" y2="7" />
              <line x1="2" y1="10" x2="12" y2="10" />
            </svg>
          </button>
          <button
            onClick={() => setViewMode("cards")}
            title="Card view"
            aria-label="Card view"
            className={`w-6 h-6 rounded flex items-center justify-center cursor-pointer transition-colors ${
              viewMode === "cards" ? "bg-elevated text-fg" : "text-fg-faded hover:text-fg-secondary"
            }`}
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
              <rect x="2" y="2" width="4.5" height="4.5" rx="0.5" />
              <rect x="7.5" y="2" width="4.5" height="4.5" rx="0.5" />
              <rect x="2" y="7.5" width="4.5" height="4.5" rx="0.5" />
              <rect x="7.5" y="7.5" width="4.5" height="4.5" rx="0.5" />
            </svg>
          </button>
        </div>
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
              {searchQuery && filteredProjects.length === 0 && matchingTasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <p className="text-[14px] text-fg-faded">
                    No matches for &ldquo;{searchQuery}&rdquo;
                  </p>
                </div>
              ) : !searchQuery && filteredProjects.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <p className="text-[14px] text-fg-faded mb-1">
                    {filter === "all" ? "Start your first objective" : `No ${filter} objectives`}
                  </p>
                  {filter === "all" && (
                    <p className="text-[12px] text-fg-faded">
                      Give your work a home. Type a name below to begin.
                    </p>
                  )}
                </div>
              ) : (
                <>
                  {searchQuery && filteredProjects.length > 0 && (
                    <span className="uppercase text-fg-faded mt-1 mb-1 block [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)]">
                      Objectives
                    </span>
                  )}
                  {viewMode === "cards" ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                      {filteredProjects.map((project) => {
                        const stats = statsMap.get(project.id) ?? { total: 0, done: 0, lastDate: null };
                        const isCompleted = !!project.completed;
                        const dueDate = project.target_date;
                        const startDate = project.start_date;
                        const dueSoonOrPast = (() => {
                          if (!dueDate || isCompleted) return false;
                          const now = new Date(); now.setHours(0, 0, 0, 0);
                          const due = new Date(dueDate + "T00:00:00");
                          const diffDays = Math.ceil((due.getTime() - now.getTime()) / 86400000);
                          return diffDays <= 7;
                        })();
                        const isOverdue = (() => {
                          if (!dueDate || isCompleted) return false;
                          const now = new Date(); now.setHours(0, 0, 0, 0);
                          return new Date(dueDate + "T00:00:00") < now;
                        })();
                        return (
                          <SortableProjectRow key={project.id} id={project.id}>
                            <div
                              onClick={() => openProject(project.id)}
                              className={`bg-elevated rounded-[12px] overflow-hidden cursor-pointer hover:bg-overlay-hover transition-colors flex flex-col h-full ${
                                isCompleted ? "opacity-55" : ""
                              }`}
                              style={{ border: "0.5px solid var(--border-hairline)" }}
                            >
                              {/* Color stripe at top */}
                              <div
                                className="h-1 w-full"
                                style={{ backgroundColor: project.color }}
                              />
                              <div className="px-4 py-3 flex flex-col flex-1 gap-2">
                                <div className="flex items-start gap-2">
                                  {isCompleted && (
                                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--accent-green)" strokeWidth="2" strokeLinecap="round" className="shrink-0 mt-1">
                                      <path d="M3 8.5l3.5 3.5 6.5-7" />
                                    </svg>
                                  )}
                                  {/* min-h reserves space for up to 3 lines so
                                      every card is the same height regardless
                                      of how long the title is. */}
                                  <h3 className={`flex-1 text-[14px] font-medium leading-snug line-clamp-3 min-h-[63px] ${
                                    isCompleted ? "text-fg-muted line-through" : "text-fg"
                                  }`}>
                                    {project.name}
                                  </h3>
                                </div>

                                <div className="flex items-center flex-wrap gap-2 text-[11px] mt-auto">
                                  {isCompleted && dueDate ? (
                                    <span className="text-fg-faded">
                                      Completed {formatDate(dueDate)}
                                    </span>
                                  ) : dueDate ? (
                                    <>
                                      {dueSoonOrPast ? (
                                        <span
                                          className={`px-2 py-[2px] rounded-full font-medium ${
                                            isOverdue
                                              ? "text-accent-destructive bg-accent-destructive/[0.10]"
                                              : "text-accent-orange-soft-fg bg-accent-orange-soft"
                                          }`}
                                        >
                                          Due {formatDate(dueDate)}
                                        </span>
                                      ) : (
                                        <span className={getDueDateColor(dueDate)}>
                                          Due {formatDate(dueDate)}
                                        </span>
                                      )}
                                      {startDate && (
                                        <span className="text-fg-faded">
                                          {formatDate(startDate)} → {formatDate(dueDate)}
                                        </span>
                                      )}
                                    </>
                                  ) : (
                                    <span className="text-fg-faded">No due date</span>
                                  )}
                                  {stats.total > 0 && (
                                    <span className="text-fg-faded tabular-nums">
                                      · {stats.total} {stats.total === 1 ? "task" : "tasks"}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </SortableProjectRow>
                        );
                      })}
                    </div>
                  ) : (
                  filteredProjects.map((project) => {
                  const stats = statsMap.get(project.id) ?? { total: 0, done: 0, lastDate: null };
                  const isCompleted = !!project.completed;
                  const dueDate = project.target_date;
                  const isExpanded = expandedProjectIds.has(project.id);
                  const tasks = projectTasksMap.get(project.id) ?? [];

                  const startDate = project.start_date;
                  const dueSoonOrPast = (() => {
                    if (!dueDate || isCompleted) return false;
                    const now = new Date(); now.setHours(0, 0, 0, 0);
                    const due = new Date(dueDate + "T00:00:00");
                    const diffDays = Math.ceil((due.getTime() - now.getTime()) / 86400000);
                    return diffDays <= 7;
                  })();
                  const isOverdue = (() => {
                    if (!dueDate || isCompleted) return false;
                    const now = new Date(); now.setHours(0, 0, 0, 0);
                    return new Date(dueDate + "T00:00:00") < now;
                  })();
                  return (
                    <SortableProjectRow key={project.id} id={project.id}>
                      <div
                        className={`bg-elevated rounded-[10px] overflow-hidden ${
                          isCompleted ? "opacity-55" : ""
                        }`}
                        style={{
                          border: "0.5px solid var(--border-hairline)",
                          borderLeftWidth: dueSoonOrPast ? "3px" : undefined,
                          borderLeftColor: dueSoonOrPast ? project.color : undefined,
                        }}
                      >
                        <div className="flex-1 min-w-0">
                          <div
                            onClick={() => openProject(project.id)}
                            className="group/row px-5 py-4 cursor-pointer hover:bg-overlay-hover relative"
                          >
                            <div className="flex items-start gap-3">
                              <div className="flex-1 min-w-0">
                                {/* Title row — color dot + name */}
                                <div className="flex items-center gap-2.5">
                                  {!isCompleted && (
                                    <div
                                      className="w-[10px] h-[10px] rounded-full shrink-0"
                                      style={{ backgroundColor: project.color }}
                                    />
                                  )}
                                  {isCompleted && (
                                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--accent-green)" strokeWidth="2" strokeLinecap="round" className="shrink-0">
                                      <path d="M3 8.5l3.5 3.5 6.5-7" />
                                    </svg>
                                  )}
                                  <span className={`text-[15px] font-medium truncate ${
                                    isCompleted ? "text-fg-muted line-through" : "text-fg"
                                  }`}>
                                    {project.name}
                                  </span>
                                </div>

                                {/* Subline — due pill + date range, OR
                                    "No due date · X tasks" fallback */}
                                <div className="mt-1 ml-[18px] flex items-center gap-2.5 text-[11px]">
                                  {isCompleted && dueDate ? (
                                    <span className="text-fg-faded">
                                      Completed {formatDate(dueDate)}
                                    </span>
                                  ) : dueDate ? (
                                    <>
                                      {dueSoonOrPast && (
                                        <span
                                          className={`px-2 py-[2px] rounded-full font-medium ${
                                            isOverdue
                                              ? "text-accent-destructive bg-accent-destructive/[0.10]"
                                              : "text-accent-orange-soft-fg bg-accent-orange-soft"
                                          }`}
                                        >
                                          Due {formatDate(dueDate)}
                                        </span>
                                      )}
                                      {!dueSoonOrPast && (
                                        <span className={getDueDateColor(dueDate)}>
                                          Due {formatDate(dueDate)}
                                        </span>
                                      )}
                                      {startDate && (
                                        <span className="text-fg-faded">
                                          {formatDate(startDate)} → {formatDate(dueDate)}
                                        </span>
                                      )}
                                    </>
                                  ) : (
                                    <span className="text-fg-faded">
                                      No due date{stats.total > 0 ? ` · ${stats.total} ${stats.total === 1 ? "task" : "tasks"}` : ""}
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Open tasks button — outlined; toggles
                                  inline expansion. */}
                              {!isCompleted && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleProjectExpand(project.id);
                                  }}
                                  className="flex items-center gap-1.5 rounded-md border border-line-soft px-3 py-1.5 text-[12px] text-fg-secondary cursor-pointer hover:border-line-medium hover:bg-overlay-hover transition-colors flex-shrink-0"
                                >
                                  <span>Open tasks</span>
                                  <DisclosureCaret expanded={isExpanded} size={9} />
                                </button>
                              )}
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
                                    onClick={() => openTaskDetail(task.id)}
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
                                      <span className="text-[10px] text-fg-disabled">{formatHoursMinutes(task.estimated_minutes)}</span>
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

                  {/* ── Task search results ────────────────────────────── */}
                  {searchQuery && matchingTasks.length > 0 && (
                    <>
                      <span className="uppercase text-fg-faded mt-3 mb-1 block [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)]">
                        Tasks
                      </span>
                      {matchingTasks.map((task) => {
                        const taskProject = task.project_id != null
                          ? projects.find((p) => p.id === task.project_id) ?? null
                          : null;
                        const dateLabel = task.date_scheduled
                          ? new Date(task.date_scheduled + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })
                          : null;
                        const isDone = task.status === "done";
                        return (
                          <button
                            key={task.id}
                            onClick={() => openTaskDetail(task.id)}
                            className="bg-elevated rounded-[10px] px-4 py-[12px] flex items-center gap-2.5 text-left cursor-pointer hover:bg-overlay-hover transition-colors"
                            style={{ border: "0.5px solid var(--border-hairline)" }}
                          >
                            <svg
                              width="13" height="13" viewBox="0 0 16 16" fill="none"
                              stroke={isDone ? "var(--accent-green)" : "var(--text-disabled)"}
                              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                              className="shrink-0"
                            >
                              <path d="M3 8.5l3.5 3.5 6.5-7" />
                            </svg>
                            {taskProject && (
                              <span
                                className="w-[8px] h-[8px] rounded-full shrink-0"
                                style={{ backgroundColor: taskProject.color }}
                                title={taskProject.name}
                              />
                            )}
                            <span className={`flex-1 truncate text-[13px] ${isDone ? "text-fg-faded line-through" : "text-fg"}`}>
                              {task.title}
                            </span>
                            {taskProject && (
                              <span className="text-[11px] text-fg-faded shrink-0 max-w-[160px] truncate">
                                {taskProject.name}
                              </span>
                            )}
                            {dateLabel && (
                              <span className="text-[11px] text-fg-faded shrink-0">{dateLabel}</span>
                            )}
                          </button>
                        );
                      })}
                    </>
                  )}
                </>
              )}

            </div>
          </div>
        </SortableContext>
      </DndContext>

      {/* ── New objective bar — anchored at the bottom of the page,
          outside the scroll container so it stays visible regardless
          of how many objectives are listed. Hidden while searching. */}
      {!searchQuery && (
        <div
          className="px-6 py-3 flex-shrink-0"
          style={{ borderTop: "0.5px solid var(--border-hairline)" }}
        >
          <div
            className="flex items-center gap-2.5 bg-elevated rounded-[10px] px-4 py-[10px] overflow-hidden"
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
              placeholder="New objective..."
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
      )}

      {/* TaskDetailOverlay is mounted as a singleton at App.tsx
          (M1 — see TaskDetailOverlayHost). After M3.2.b.5.b, host
          mutations route through store actions — search-result rows
          re-render via canonical-map subscriptions automatically. */}
    </div>
  );
}
