import { useState, useEffect, useRef } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  updateTaskNotes,
  getLinksForEntity,
  createLink,
  deleteLink,
  isSafeUrl,
} from "../db/queries";
import RichTextEditor from "./RichTextEditor";
import type { Task, Project, Link } from "../types";

interface TaskCardProps {
  task: Task;
  project: Project | undefined;
  onToggle: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (id: number) => void;
  onToggleNotes: (id: number) => void;
  onStart?: (task: Task) => void;
  onOpenDetail?: (task: Task) => void;
  expandedNotes: boolean;
  showProject?: boolean;
  workedMinutes?: number;
}

function TrashButton({ onDelete }: { onDelete: () => void }) {
  const [armed, setArmed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleClick() {
    if (armed) {
      if (timerRef.current) clearTimeout(timerRef.current);
      onDelete();
    } else {
      setArmed(true);
      timerRef.current = setTimeout(() => setArmed(false), 2000);
    }
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <button
      onClick={handleClick}
      className={`w-6 h-6 rounded flex items-center justify-center cursor-pointer transition-colors ${
        armed
          ? "text-accent-destructive bg-accent-destructive/10"
          : "text-fg-faded hover:text-fg-muted hover:bg-overlay-hover"
      }`}
      title={armed ? "Click again to delete" : "Delete"}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 4h12" />
        <path d="M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1" />
        <path d="M13 4v9a1 1 0 01-1 1H4a1 1 0 01-1-1V4" />
        <line x1="6.5" y1="7" x2="6.5" y2="11" />
        <line x1="9.5" y1="7" x2="9.5" y2="11" />
      </svg>
    </button>
  );
}

export default function TaskCard({
  task,
  project,
  onToggle,
  onEdit,
  onDelete,
  onToggleNotes,
  onStart,
  onOpenDetail,
  expandedNotes,
  showProject = true,
  workedMinutes,
}: TaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const [notes, setNotes] = useState(task.notes ?? "");
  const [links, setLinks] = useState<Link[]>([]);
  const [newUrl, setNewUrl] = useState("");

  // Track status transition for one-shot done animation
  const prevStatusRef = useRef(task.status);
  const justCompleted = task.status === "done" && prevStatusRef.current !== "done";
  useEffect(() => { prevStatusRef.current = task.status; }, [task.status]);

  // Sync notes when task changes
  useEffect(() => {
    setNotes(task.notes ?? "");
  }, [task.notes]);

  // Load links when expanded
  useEffect(() => {
    if (expandedNotes) {
      getLinksForEntity("task", task.id)
        .then(setLinks)
        .catch(() => {});
    }
  }, [expandedNotes, task.id]);

  async function saveNotes(valueToSave: string = notes) {
    const trimmed = valueToSave.trim() || null;
    if (trimmed === task.notes) return;
    try {
      await updateTaskNotes(task.id, trimmed);
    } catch {
      // silent
    }
  }

  async function handleAddLink(e: React.FormEvent) {
    e.preventDefault();
    const url = newUrl.trim();
    if (!url) return;
    try {
      await createLink("task", task.id, url, null);
      setNewUrl("");
      const updated = await getLinksForEntity("task", task.id);
      setLinks(updated);
    } catch {
      // silent
    }
  }

  async function handleDeleteLink(linkId: number) {
    try {
      await deleteLink(linkId);
      setLinks((prev) => prev.filter((l) => l.id !== linkId));
    } catch {
      // silent
    }
  }

  const isHigh = task.priority === "high" || task.priority === "urgent";
  const hasContent = task.notes || expandedNotes;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`px-3 py-[7px] rounded-lg border transition-colors duration-150 ease-out group/row ${
        isHigh
          ? "bg-accent-orange-soft border-accent-orange/15 hover:bg-accent-orange-soft-hover"
          : "bg-elevated border-line-soft hover:bg-overlay-hover"
      }`}
    >
      <div className="flex items-center gap-3">
        {/* Drag handle */}
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-fg-faded shrink-0 select-none"
          title="Drag to reorder"
        >
          ⠿
        </div>

        {/* Checkbox */}
        <button
          onClick={() => onToggle(task)}
          title={task.status === "done" ? "Mark as not done" : "Mark complete"}
          className={`w-[22px] h-[22px] rounded-full border-2 flex items-center justify-center shrink-0 cursor-pointer transition-colors ${
            task.status === "done"
              ? `bg-accent-green border-accent-green hover:bg-accent-green-hover hover:border-accent-green-hover${justCompleted ? " animate-task-done" : ""}`
              : "border-line-strong hover:border-accent-green"
          }`}
        >
          <svg
            width="11"
            height="11"
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

        {/* Project color dot */}
        {showProject && project && (
          <div
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: project.color }}
            title={project.name}
          />
        )}

        {/* Title — clickable to open detail overlay */}
        <span
          className={`flex-1 text-fg [font-size:var(--font-size-body)] [font-weight:var(--font-weight-body)] ${task.status === "done" ? "line-through !text-fg-faded" : ""} ${onOpenDetail ? "cursor-pointer hover:text-accent-blue transition-colors" : ""}`}
          onClick={() => onOpenDetail?.(task)}
        >
          {task.title}
        </span>

        {/* Meta */}
        {showProject && project && (
          <span className="text-fg-faded [font-size:var(--font-size-meta)] [font-weight:var(--font-weight-meta)] [opacity:var(--opacity-meta)]">{project.name}</span>
        )}
        {/* Time: worked / estimated — always show both */}
        {(() => {
          const worked = workedMinutes ?? 0;
          const est = task.estimated_minutes ?? 0;
          const hasAny = worked > 0 || est > 0;
          if (!hasAny) return null;
          const overBudget = est > 0 && worked > est;
          return (
            <span className="text-[11px] tabular-nums flex items-center gap-0.5 shrink-0">
              <span className={overBudget ? "text-accent-danger font-medium" : "text-accent-blue-soft-fg font-medium"}>
                {worked > 0 ? `${worked}m` : "0m"}
              </span>
              <span className="text-fg-disabled">/</span>
              <span className="text-fg-faded">
                {est > 0 ? `${est}m` : "—"}
              </span>
            </span>
          );
        })()}

        {/* Actions — play centered, delete far right */}
        <div className="flex items-center gap-2 shrink-0">
          {onStart && task.status !== "done" && (
            <button
              onClick={() => onStart(task)}
              className="w-6 h-6 rounded-full bg-accent-blue text-fg-on-accent hover:bg-accent-blue-hover cursor-pointer flex items-center justify-center transition-all duration-200 ease-out hover:shadow-[0_0_0_5px_color-mix(in_srgb,var(--accent-blue)_18%,transparent)]"
              title="Start focus"
            >
              <svg width="8" height="10" viewBox="0 0 8 10" fill="currentColor" className="ml-[1px]">
                <path d="M0 0v10l8-5z" />
              </svg>
            </button>
          )}
          <div className="opacity-0 group-hover/row:opacity-100 transition-opacity duration-150">
            <TrashButton onDelete={() => onDelete(task.id)} />
          </div>
        </div>
      </div>

      {/* Expanded area: notes + links */}
      {expandedNotes && (
        <div className="mt-2 space-y-2">
          {/* Editable notes */}
          <RichTextEditor
            value={notes}
            onChange={(html) => {
              setNotes(html);
              saveNotes(html);
            }}
            placeholder="Add notes..."
            className="w-full p-2.5 rounded-md bg-base border border-line-hairline text-[12px] text-fg-secondary min-h-[60px] leading-relaxed focus-within:border-accent-blue"
          />

          {/* Links */}
          <div>
            {links.length > 0 && (
              <div className="space-y-1 mb-1.5">
                {links.map((link) => (
                  <div
                    key={link.id}
                    className="flex items-center gap-2 text-[11px]"
                  >
                    <span className="text-fg-faded">🔗</span>
                    {isSafeUrl(link.url) ? (
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent-blue-soft-fg hover:underline truncate flex-1"
                      >
                        {link.label || link.url}
                      </a>
                    ) : (
                      <span className="text-fg-secondary truncate flex-1">
                        {link.label || link.url}
                      </span>
                    )}
                    <button
                      onClick={() => handleDeleteLink(link.id)}
                      className="text-fg-faded hover:text-accent-destructive cursor-pointer text-[10px]"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            <form onSubmit={handleAddLink} className="flex gap-1.5">
              <input
                type="url"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="Add a URL..."
                className="flex-1 bg-base border border-line-hairline rounded-md px-2 py-1 text-[11px] text-fg placeholder:text-fg-disabled outline-none focus:border-accent-blue"
              />
              <button
                type="submit"
                className="text-[10px] text-accent-blue-soft-fg px-2 py-1 rounded-md border border-accent-blue/20 bg-accent-blue/[0.06] cursor-pointer hover:bg-accent-blue/[0.12]"
              >
                Add
              </button>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
