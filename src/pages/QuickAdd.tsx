import { useState, useEffect, useRef, useCallback } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { getProjects, createTask } from "../db/queries";
import { todayString } from "../utils/dates";
import { parseTimeFromTitle } from "../utils/format";
import { activeObjectiveOptions } from "../utils/objectiveOptions";
import ProjectGlyph from "../components/ProjectGlyph";
import { useObjectiveNameTooltip } from "../components/useObjectiveNameTooltip";
import { useCustomIcons } from "../hooks/useCustomIcons";
import type { Project } from "../types";

const ESTIMATE_PRESETS = [
  { label: "5m", value: 5 },
  { label: "15m", value: 15 },
  { label: "30m", value: 30 },
  { label: "1h", value: 60 },
];

export default function QuickAdd() {
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState<number | null>(null);
  const [estimateMinutes, setEstimateMinutes] = useState<number | null>(null);
  // eslint-disable-next-line no-restricted-syntax -- QuickAdd is a separate Tauri webview; the canonical projectsById store doesn't cross the webview boundary, so it reads getProjects(false) from the shared DB on focus. Promoting this to cross-webview events is Phase 5.
  const [projects, setProjects] = useState<Project[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const projectPickerRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Click-away dismiss: blur-dismiss is armed only after the user has had
  // a beat with the window (a real interaction, or a short grace). macOS
  // fires a stray blur the instant the global-shortcut chord is released
  // (see the focus effect below); arming guards against that closing the
  // window immediately on summon.
  const blurArmedRef = useRef(false);
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Full-objective-name hover tooltip — same behavior as the Objective
  // dropdown on the Daily Plan task detail (shared hook).
  const { byId: iconsById } = useCustomIcons();
  const { showTip, hideTip, tooltip } = useObjectiveNameTooltip(iconsById);

  const resetFields = useCallback(() => {
    // Cancel a pending success-flash dismiss so a re-show (onFocusChanged)
    // can't be yanked closed by a stale timer from the previous add.
    if (flashTimerRef.current) {
      clearTimeout(flashTimerRef.current);
      flashTimerRef.current = null;
    }
    // Disarm blur-dismiss for the fresh session (re-armed after grace on
    // the next focus event) so a stale arm can't dismiss on summon.
    blurArmedRef.current = false;
    if (armTimerRef.current) {
      clearTimeout(armTimerRef.current);
      armTimerRef.current = null;
    }
    setTitle("");
    setProjectId(null);
    setEstimateMinutes(null);
    setSubmitting(false);
    setSubmitted(false);
    setShowProjectPicker(false);
    hideTip();
  }, [hideTip]);

  const loadProjects = useCallback(async () => {
    try {
      // Same source + filter the rest of the app uses (DailyPlanner,
      // TaskDetail): active objectives only. getProjects(false) drops
      // archived; activeObjectiveOptions additionally drops completed, so
      // the QuickAdd list can't drift from the canonical objective set.
      const all = await getProjects(false);
      setProjects(all);
    } catch {
      // silent
    }
  }, []);

  // Drive the cursor straight into the title input so the user can
  // start typing the moment the bar appears. A single setTimeout
  // wasn't enough on cold show — the WebView can take a beat to
  // deliver document focus after the chord lands. Retry on a short
  // ladder and short-circuit as soon as activeElement matches; later
  // attempts are harmless no-ops if the input already has focus.
  const focusTitle = useCallback(() => {
    function tryFocus(): boolean {
      const el = titleRef.current;
      if (!el) return false;
      el.focus();
      el.select();
      return document.activeElement === el;
    }
    if (tryFocus()) return;
    requestAnimationFrame(() => {
      if (tryFocus()) return;
      setTimeout(tryFocus, 40);
      setTimeout(tryFocus, 120);
      setTimeout(tryFocus, 280);
    });
  }, []);

  const hideWindow = useCallback(() => {
    invoke("dismiss_quick_add");
    resetFields();
  }, [resetFields]);

  // Arm blur-dismiss immediately on a genuine interaction (a keystroke, a
  // click inside the window). The grace timer in the focus effect also
  // arms after a beat, but interaction-arming makes a type-then-click-away
  // dismiss feel instant rather than waiting out the grace.
  const armBlurDismiss = useCallback(() => {
    blurArmedRef.current = true;
  }, []);

  // Reset + refocus the title input every time the window becomes visible,
  // and dismiss on blur once armed. Borderless transparent always-on-top
  // windows on macOS fire a stray blur the instant the user releases the
  // global-shortcut chord (the OS reconciles focus to whatever app was
  // frontmost). We absorb that by arming blur-dismiss only after a 450ms
  // grace from focus (or an earlier real interaction) — past that window,
  // a blur means the user genuinely clicked another app, so we dismiss.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const appWindow = getCurrentWebviewWindow();

    (async () => {
      unlisten = await appWindow.onFocusChanged(({ payload: focused }) => {
        if (focused) {
          resetFields(); // clears any prior arm
          loadProjects();
          focusTitle();
          armTimerRef.current = setTimeout(() => {
            blurArmedRef.current = true;
          }, 450);
        } else if (blurArmedRef.current) {
          hideWindow();
        }
      });
    })();

    return () => {
      unlisten?.();
      if (armTimerRef.current) {
        clearTimeout(armTimerRef.current);
        armTimerRef.current = null;
      }
    };
  }, [resetFields, loadProjects, focusTitle, hideWindow]);

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

  const handleSubmit = useCallback(async () => {
    const trimmed = title.trim();
    if (!trimmed || submitting) return;

    setSubmitting(true);
    try {
      const date = todayString();
      // Smart time parsing — mirror DailyPlanner (parseTimeFromTitle): when no
      // manual estimate preset is chosen, pull a duration out of the title
      // ("~10", "2h", "30 min") so the quick-add bar estimates exactly like the
      // daily add row does.
      let taskTitle = trimmed;
      let est = estimateMinutes;
      if (est == null) {
        const parsed = parseTimeFromTitle(taskTitle);
        if (parsed.minutes != null) {
          taskTitle = parsed.cleanTitle;
          est = parsed.minutes;
        }
      }
      await createTask({
        title: taskTitle,
        projectId,
        dateScheduled: date,
        estimatedMinutes: est,
        priority: "medium",
      });
      // Cross-webview notify: this is a separate window with its own store,
      // so the main window can't see the insert. A Tauri global event tells
      // it to re-read today's bucket from the DB so the task shows up
      // immediately. Awaited so delivery is guaranteed before we dismiss.
      await emit("verseday:task-created", { date });
      // Brief success flash so the user gets confirmation the task landed
      // before the window vanishes — otherwise the bar just blinks away with
      // no acknowledgement. `submitting` stays true so Enter can't re-fire
      // during the flash. The window is hidden, not destroyed, so this
      // component stays mounted and the timer runs to completion.
      setSubmitted(true);
      flashTimerRef.current = setTimeout(hideWindow, 600);
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

  // Canonical active-objective list, with the current selection always
  // retained even if it's since been completed/archived (matches the rest
  // of the app via the shared helper).
  const objectiveOptions = activeObjectiveOptions(
    projects,
    projectId != null ? String(projectId) : "",
  );
  const selectedProject = projects.find((p) => p.id === projectId);

  return (
    // Full-viewport transparent wrapper — bar is pinned to the bottom so
    // the project dropdown has room to open upward into the window. A
    // mousedown on the transparent area (anything NOT inside the card)
    // dismisses, so clicking away from the bar closes it. Clicks landing
    // outside the window entirely are handled by the blur-dismiss path.
    <div
      className="w-full h-screen flex items-end justify-center pb-3"
      style={{ background: "transparent" }}
      onMouseDownCapture={armBlurDismiss}
      onMouseDown={(e) => {
        if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
          // Staged like Esc: an open dropdown closes first, then the window.
          if (showProjectPicker) setShowProjectPicker(false);
          else hideWindow();
        }
      }}
    >
      <div
        ref={cardRef}
        className="flex flex-col w-full max-w-[720px] mx-2.5 rounded-xl border border-line-hairline overflow-visible"
        style={{
          background: "#ffffff",
          boxShadow: "var(--shadow-modal)",
        }}
      >
        {/* Header strip */}
        <div className="flex items-center gap-2.5 px-5 pt-3.5 pb-2.5">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
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
          <span className="text-[14px] font-semibold text-accent-blue tracking-tight">VerseDay</span>
          <span className="text-[11px] text-fg-disabled ml-auto">&#x2318;&#x21E7;A</span>
        </div>

        {/* Divider between header and input */}
        <div className="h-px bg-line-hairline mx-4" />

        <style>{`
          @keyframes qaCheckPop {
            0% { opacity: 0; transform: scale(0.6); }
            60% { transform: scale(1.08); }
            100% { opacity: 1; transform: scale(1); }
          }
          @keyframes qaCheckDraw {
            from { stroke-dashoffset: 16; }
            to { stroke-dashoffset: 0; }
          }
          .qa-added-icon { animation: qaCheckPop 0.28s ease-out both; }
          .qa-added-icon path { stroke-dasharray: 16; animation: qaCheckDraw 0.3s ease-out 0.1s both; }
          .qa-added-text { animation: qaCheckPop 0.3s ease-out 0.06s both; }
        `}</style>

        {/* Success flash — shown for ~600ms after a task is added, then the
            window dismisses. Matches the input bar's height (px-5 py-4) so
            there's no layout jump when it swaps in. */}
        {submitted ? (
          <div className="flex items-center justify-center gap-2.5 px-5 py-4">
            <span className="qa-added-icon flex items-center justify-center w-[18px] h-[18px] rounded-full bg-accent-green/15 flex-shrink-0">
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="var(--accent-green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2.5 6.2L4.8 8.5L9.5 3.5" />
              </svg>
            </span>
            <span className="qa-added-text text-[14px] font-medium text-accent-green">
              Task added
            </span>
          </div>
        ) : (
        /* Input bar */
        <div
          onKeyDown={handleKeyDown}
          className="flex items-center gap-3 px-5 py-4 relative"
        >
        {/* Plus icon */}
        <svg
          width="15"
          height="15"
          viewBox="0 0 15 15"
          fill="none"
          stroke="var(--text-disabled)"
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
          onChange={(e) => { setTitle(e.target.value); armBlurDismiss(); }}
          placeholder="Add a task..."
          autoFocus
          className="flex-1 min-w-0 text-[15px] text-fg bg-transparent border-none outline-none placeholder:text-fg-faded"
        />

        {/* Estimate chips */}
        <div className="flex gap-1 flex-shrink-0">
          {ESTIMATE_PRESETS.map((preset) => {
            const active = estimateMinutes === preset.value;
            return (
              <button
                key={preset.value}
                onClick={() => setEstimateMinutes(active ? null : preset.value)}
                className={`text-[12px] font-medium px-2.5 py-1 rounded-md cursor-pointer border transition-colors ${
                  active
                    ? "border-accent-blue/40 bg-accent-blue-soft text-accent-blue-soft-fg"
                    : "border-line-hairline bg-elevated/50 text-fg-secondary hover:text-fg hover:bg-elevated/70"
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>

        {/* Divider */}
        <div className="w-px h-5 bg-line-soft flex-shrink-0" />

        {/* Project picker */}
        <div ref={projectPickerRef} className="relative flex-shrink-0">
          <button
            onClick={() => { setShowProjectPicker((v) => !v); hideTip(); }}
            className={`flex items-center gap-1.5 text-[13px] px-3 py-1.5 rounded-lg border cursor-pointer transition-colors ${
              selectedProject
                ? "border-line-soft bg-elevated/70 text-fg"
                : "border-line-hairline bg-elevated/40 text-fg-secondary hover:text-fg"
            }`}
            style={{ maxWidth: 150 }}
          >
            {selectedProject && (
              <span className="flex-shrink-0">
                <ProjectGlyph project={selectedProject} iconsById={iconsById} size={14} />
              </span>
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
              className="absolute bottom-full right-0 mb-1.5 min-w-[200px] max-w-[260px] max-h-[260px] overflow-y-auto bg-elevated rounded-xl border border-line-soft p-1 z-10"
              style={{
                boxShadow: "var(--shadow-modal)",
              }}
            >
              {/* No project */}
              <button
                onClick={() => { setProjectId(null); setShowProjectPicker(false); hideTip(); }}
                className={`w-full flex items-center gap-2 px-2.5 py-[7px] rounded-lg text-[12px] text-left cursor-pointer transition-colors ${
                  projectId === null
                    ? "bg-accent-blue-soft font-medium text-fg-secondary"
                    : "text-fg-faded hover:bg-overlay-hover"
                }`}
              >
                <span className="w-2 h-2 rounded-full border border-dashed border-line-strong flex-shrink-0" />
                No project
              </button>

              {objectiveOptions.map((p) => (
                <button
                  key={p.id}
                  onClick={() => { setProjectId(p.id); setShowProjectPicker(false); hideTip(); }}
                  onMouseEnter={(e) => showTip(p, e.currentTarget)}
                  onMouseLeave={hideTip}
                  className={`w-full flex items-center gap-2 px-2.5 py-[7px] rounded-lg text-[12px] text-left cursor-pointer transition-colors ${
                    projectId === p.id
                      ? "bg-accent-blue-soft font-medium text-fg"
                      : "text-fg hover:bg-overlay-hover"
                  }`}
                >
                  <ProjectGlyph project={p} iconsById={iconsById} size={14} />
                  <span className="truncate">{p.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        </div>
        )}
      </div>
      {tooltip}
    </div>
  );
}
