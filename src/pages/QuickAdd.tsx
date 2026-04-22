import { useState, useEffect, useRef, useCallback } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { invoke } from "@tauri-apps/api/core";
import { getProjects, createTask } from "../db/queries";
import type { Project } from "../types";

function todayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const ESTIMATE_PRESETS = [
  { label: "15m", value: 15 },
  { label: "30m", value: 30 },
  { label: "1h", value: 60 },
  { label: "2h", value: 120 },
];

export default function QuickAdd() {
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState<number | null>(null);
  const [estimateMinutes, setEstimateMinutes] = useState<number | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const projectPickerRef = useRef<HTMLDivElement>(null);

  const resetFields = useCallback(() => {
    setTitle("");
    setProjectId(null);
    setEstimateMinutes(null);
    setSubmitting(false);
    setShowProjectPicker(false);
  }, []);

  const loadProjects = useCallback(async () => {
    try {
      const all = await getProjects();
      setProjects(all);
    } catch {
      // silent
    }
  }, []);

  const focusTitle = useCallback(() => {
    requestAnimationFrame(() => titleRef.current?.focus());
    setTimeout(() => titleRef.current?.focus(), 80);
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const appWindow = getCurrentWebviewWindow();

    (async () => {
      unlisten = await appWindow.onFocusChanged(({ payload: focused }) => {
        if (focused) {
          resetFields();
          loadProjects();
          focusTitle();
        } else {
          invoke("dismiss_quick_add");
        }
      });
    })();

    return () => {
      unlisten?.();
    };
  }, [resetFields, loadProjects, focusTitle]);

  useEffect(() => {
    loadProjects();
    focusTitle();
  }, [loadProjects, focusTitle]);

  // Make the webview's html+body transparent so only the bar and dropdown
  // are visible against the desktop. Each Tauri window is its own webview,
  // so this doesn't affect the main window.
  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        showProjectPicker &&
        projectPickerRef.current &&
        !projectPickerRef.current.contains(e.target as Node)
      ) {
        setShowProjectPicker(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showProjectPicker]);

  const hideWindow = useCallback(() => {
    invoke("dismiss_quick_add");
    resetFields();
  }, [resetFields]);

  const handleSubmit = useCallback(async () => {
    const trimmed = title.trim();
    if (!trimmed || submitting) return;

    setSubmitting(true);
    try {
      await createTask({
        title: trimmed,
        projectId,
        dateScheduled: todayString(),
        estimatedMinutes: estimateMinutes,
        priority: "medium",
      });
      hideWindow();
    } catch (e) {
      console.error("QuickAdd: failed to create task", e);
      setSubmitting(false);
    }
  }, [title, projectId, estimateMinutes, submitting, hideWindow]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (showProjectPicker) {
          setShowProjectPicker(false);
        } else {
          hideWindow();
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      }
    },
    [hideWindow, handleSubmit, showProjectPicker],
  );

  const selectedProject = projects.find((p) => p.id === projectId);

  return (
    // Full-viewport transparent wrapper — bar is pinned to the bottom so
    // the project dropdown has room to open upward into the 360px window.
    <div className="w-full h-screen flex items-end justify-center pb-3" style={{ background: "transparent" }}>
      <div
        className="flex flex-col w-full max-w-[620px] mx-2.5 rounded-xl border border-black/[0.06] overflow-visible"
        style={{
          background: "rgba(239, 237, 232, 0.97)",
          boxShadow: "0 8px 40px rgba(0, 0, 0, 0.12), 0 1px 4px rgba(0, 0, 0, 0.06)",
        }}
      >
        {/* Header strip */}
        <div className="flex items-center gap-2 px-4 pt-2.5 pb-1.5">
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
            <defs>
              <linearGradient id="qa-sky" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#E8D4F0" />
                <stop offset="35%" stopColor="#F8D0DC" />
                <stop offset="70%" stopColor="#FBC9A4" />
                <stop offset="100%" stopColor="#FCE5A8" />
              </linearGradient>
              <linearGradient id="qa-ocean" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#A8CFE5" />
                <stop offset="100%" stopColor="#CFE5F0" />
              </linearGradient>
              <radialGradient id="qa-sun" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#FFD9A0" stopOpacity={0.9} />
                <stop offset="60%" stopColor="#FFD9A0" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#FFD9A0" stopOpacity={0} />
              </radialGradient>
              <clipPath id="qa-clip">
                <circle cx="10" cy="10" r="5.8" />
              </clipPath>
            </defs>
            <g clipPath="url(#qa-clip)">
              <rect x="4" y="4" width="12" height="7.7" fill="url(#qa-sky)" />
              <circle cx="10" cy="11.05" r="3.9" fill="url(#qa-sun)" />
              <circle cx="10" cy="11.05" r="1.1" fill="#FFD9A0" />
              <rect x="4" y="11.7" width="12" height="4.3" fill="url(#qa-ocean)" />
              <rect x="4" y="11.66" width="12" height="0.06" fill="#FFFFFF" fillOpacity={0.45} />
            </g>
            <path d="M 4.15,4.54 A 8,8 0 0 1 15.85,4.54" stroke="#E89BB1" strokeWidth="1.92" strokeLinecap="round" />
            <path d="M 15.46,4.15 A 8,8 0 0 1 15.46,15.85" stroke="#F4B58E" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M 15.85,15.46 A 8,8 0 0 1 4.15,15.46" stroke="#A8CFE5" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M 4.54,15.85 A 8,8 0 0 1 4.54,4.15" stroke="#C9B5E0" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <span className="text-[11px] font-semibold text-[#7B9ED9] tracking-tight">VerseDay</span>
          <span className="text-[10px] text-black/20 ml-auto">&#x2318;&#x21E7;A</span>
        </div>

        {/* Divider between header and input */}
        <div className="h-px bg-black/[0.05] mx-3" />

        {/* Input bar */}
        <div
          onKeyDown={handleKeyDown}
          className="flex items-center gap-2.5 px-4 py-3 relative"
        >
        {/* Plus icon */}
        <svg
          width="15"
          height="15"
          viewBox="0 0 15 15"
          fill="none"
          stroke="rgba(0,0,0,0.18)"
          strokeWidth="1.6"
          strokeLinecap="round"
          className="flex-shrink-0"
        >
          <line x1="7.5" y1="3" x2="7.5" y2="12" />
          <line x1="3" y1="7.5" x2="12" y2="7.5" />
        </svg>

        {/* Title input */}
        <input
          ref={titleRef}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a task..."
          autoFocus
          className="flex-1 min-w-0 text-[14px] text-[#2c2a35] bg-transparent border-none outline-none placeholder-black/25"
        />

        {/* Estimate chips */}
        <div className="flex gap-1 flex-shrink-0">
          {ESTIMATE_PRESETS.map((preset) => {
            const active = estimateMinutes === preset.value;
            return (
              <button
                key={preset.value}
                onClick={() => setEstimateMinutes(active ? null : preset.value)}
                className={`text-[11px] font-medium px-2 py-[3px] rounded-md cursor-pointer border transition-colors ${
                  active
                    ? "border-[#7B9ED9]/40 bg-[#7B9ED9]/10 text-[#6B84A3]"
                    : "border-black/[0.06] bg-white/50 text-black/30 hover:text-black/45 hover:bg-white/70"
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>

        {/* Divider */}
        <div className="w-px h-5 bg-black/[0.08] flex-shrink-0" />

        {/* Project picker */}
        <div ref={projectPickerRef} className="relative flex-shrink-0">
          <button
            onClick={() => setShowProjectPicker(!showProjectPicker)}
            className={`flex items-center gap-1.5 text-[12px] px-2.5 py-[5px] rounded-lg border cursor-pointer transition-colors ${
              selectedProject
                ? "border-black/[0.08] bg-white/70 text-[#2c2a35]"
                : "border-black/[0.06] bg-white/40 text-black/30 hover:text-black/45"
            }`}
            style={{ maxWidth: 150 }}
          >
            {selectedProject && (
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: selectedProject.color }}
              />
            )}
            <span className="truncate">
              {selectedProject ? selectedProject.name : "Project"}
            </span>
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="flex-shrink-0 opacity-40"
            >
              <path d="M2.5 4L5 6.5L7.5 4" />
            </svg>
          </button>

          {/* Project dropdown — opens upward */}
          {showProjectPicker && (
            <div
              className="absolute bottom-full right-0 mb-1.5 min-w-[200px] max-w-[260px] max-h-[260px] overflow-y-auto bg-white/[0.98] rounded-xl border border-black/[0.08] p-1 z-10"
              style={{
                boxShadow: "0 8px 32px rgba(0, 0, 0, 0.12), 0 1px 3px rgba(0, 0, 0, 0.06)",
              }}
            >
              {/* No project */}
              <button
                onClick={() => { setProjectId(null); setShowProjectPicker(false); }}
                className={`w-full flex items-center gap-2 px-2.5 py-[7px] rounded-lg text-[12px] text-left cursor-pointer transition-colors ${
                  projectId === null
                    ? "bg-[#7B9ED9]/[0.08] font-medium text-black/40"
                    : "text-black/35 hover:bg-black/[0.03]"
                }`}
              >
                <span className="w-2 h-2 rounded-full border border-dashed border-black/15 flex-shrink-0" />
                No project
              </button>

              {projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => { setProjectId(p.id); setShowProjectPicker(false); }}
                  className={`w-full flex items-center gap-2 px-2.5 py-[7px] rounded-lg text-[12px] text-left cursor-pointer transition-colors ${
                    projectId === p.id
                      ? "bg-[#7B9ED9]/[0.08] font-medium text-[#2c2a35]"
                      : "text-[#2c2a35] hover:bg-black/[0.03]"
                  }`}
                >
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: p.color }}
                  />
                  <span className="truncate">{p.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
