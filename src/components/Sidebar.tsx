import { type ReactNode, useState } from "react";
import { useAppStore } from "../stores/appStore";
import type { Page } from "../types";

interface NavItem {
  page: Page;
  label: string;
  icon: ReactNode;
}

const iconSize = 15;

function DailyPlanIcon() {
  return (
    <svg width={iconSize} height={iconSize} viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.5" y="1.5" width="4.5" height="4.5" rx="1" />
      <rect x="9" y="1.5" width="4.5" height="4.5" rx="1" />
      <rect x="1.5" y="9" width="4.5" height="4.5" rx="1" />
      <rect x="9" y="9" width="4.5" height="4.5" rx="1" />
    </svg>
  );
}

function WeeklyPlanIcon() {
  return (
    <svg width={iconSize} height={iconSize} viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.5" y="2.5" width="12" height="10" rx="1.5" />
      <line x1="1.5" y1="6" x2="13.5" y2="6" />
      <line x1="5" y1="2.5" x2="5" y2="1" />
      <line x1="10" y1="2.5" x2="10" y2="1" />
    </svg>
  );
}

function ShutdownIcon() {
  return (
    <svg width={iconSize} height={iconSize} viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 7.5l2 2 4-4" />
      <circle cx="7.5" cy="7.5" r="5.5" />
    </svg>
  );
}

function ProjectsIcon() {
  return (
    <svg width={iconSize} height={iconSize} viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="1.5" width="11" height="12" rx="1.5" />
      <line x1="5" y1="5" x2="10" y2="5" />
      <line x1="5" y1="8" x2="9" y2="8" />
    </svg>
  );
}

function DashboardIcon() {
  return (
    <svg width={iconSize} height={iconSize} viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="8" width="2.5" height="5" rx="0.5" />
      <rect x="6.25" y="5" width="2.5" height="8" rx="0.5" />
      <rect x="10.5" y="2" width="2.5" height="11" rx="0.5" />
    </svg>
  );
}

function DailyShutdownIcon() {
  return (
    <svg width={iconSize} height={iconSize} viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7.5" cy="7.5" r="5.5" />
      <path d="M7.5 4v4" />
      <circle cx="7.5" cy="3" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

const planningItems: NavItem[] = [
  { page: "daily", label: "Daily Plan", icon: <DailyPlanIcon /> },
  { page: "daily_shutdown", label: "Daily Shutdown", icon: <DailyShutdownIcon /> },
  { page: "weekly", label: "Weekly Plan", icon: <WeeklyPlanIcon /> },
  { page: "shutdown", label: "Weekly Shutdown", icon: <ShutdownIcon /> },
];

const manageItems: NavItem[] = [
  { page: "projects", label: "Projects", icon: <ProjectsIcon /> },
  { page: "dashboard", label: "Dashboard", icon: <DashboardIcon /> },
];

function NavSection({
  label,
  items,
  activePage,
  onSelect,
}: {
  label: string;
  items: NavItem[];
  activePage: Page;
  onSelect: (page: Page) => void;
}) {
  return (
    <div>
      <div className="px-4 pt-4 pb-1.5 text-[10px] text-black/30 uppercase tracking-widest">
        {label}
      </div>
      {items.map(({ page, label: itemLabel, icon }) => {
        const isActive = activePage === page;
        return (
          <button
            key={page}
            onClick={() => onSelect(page)}
            className={`w-full flex items-center gap-2.5 px-4 py-2 text-[13px] cursor-pointer transition-colors ${
              isActive
                ? "bg-[#7B9ED9]/10 text-[#7B9ED9] border-r-2 border-[#7B9ED9]"
                : "text-black/40 hover:bg-black/[0.04] hover:text-black/60"
            }`}
          >
            {icon}
            {itemLabel}
          </button>
        );
      })}
    </div>
  );
}

const SHORTCUTS = [
  { keys: "F", desc: "Start focus on next task" },
  { keys: "⌘ 1", desc: "Daily Plan" },
  { keys: "⌘ 2", desc: "Daily Shutdown" },
  { keys: "⌘ 3", desc: "Weekly Plan" },
  { keys: "⌘ 4", desc: "Weekly Shutdown" },
  { keys: "⌘ 5", desc: "Projects" },
  { keys: "⌘ 6", desc: "Dashboard" },
  { keys: "⌘ N", desc: "New task" },
  { keys: "Space", desc: "Pause / resume (focus)" },
  { keys: "Esc", desc: "Close / blur" },
];

export default function Sidebar() {
  const { currentPage, setPage } = useAppStore();
  const [showShortcuts, setShowShortcuts] = useState(false);

  // project_detail highlights the Projects nav item
  const activePage =
    currentPage === "project_detail" ? "projects" : currentPage === "focus" ? "daily" : currentPage;

  return (
    <aside className="w-[200px] shrink-0 h-screen bg-[#efede8] border-r border-black/[0.06] flex flex-col pt-4">
      <div className="px-4 pb-5 text-[15px] font-medium text-[#7B9ED9] tracking-tight">
        VerseDay
      </div>
      <nav className="flex-1">
        <NavSection label="Planning" items={planningItems} activePage={activePage} onSelect={setPage} />
        <div className="h-px bg-black/[0.06] mx-4 my-1" />
        <NavSection label="Manage" items={manageItems} activePage={activePage} onSelect={setPage} />
      </nav>

      {/* Shortcut glossary */}
      <div className="border-t border-black/[0.06]">
        <button
          onClick={() => setShowShortcuts(!showShortcuts)}
          className="w-full flex items-center gap-1.5 px-4 py-2.5 text-[11px] text-black/30 cursor-pointer hover:text-black/45 transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
            <rect x="1" y="3" width="10" height="7" rx="1.5" />
            <line x1="3.5" y1="6" x2="4.5" y2="6" />
            <line x1="6" y1="6" x2="7" y2="6" />
            <line x1="3.5" y1="8" x2="8.5" y2="8" />
          </svg>
          Shortcuts
          <span
            className="ml-auto text-[9px] transition-transform duration-150"
            style={{ transform: showShortcuts ? "rotate(180deg)" : "rotate(0deg)" }}
          >
            ▾
          </span>
        </button>
        {showShortcuts && (
          <div className="px-4 pb-3 space-y-1">
            {SHORTCUTS.map((s) => (
              <div key={s.keys} className="flex items-center justify-between">
                <span className="text-[10px] text-black/35">{s.desc}</span>
                <kbd className="text-[9px] text-black/30 bg-black/[0.05] px-1.5 py-0.5 rounded font-mono">
                  {s.keys}
                </kbd>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
