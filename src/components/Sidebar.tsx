import { type ReactNode, useState } from "react";
import { useAppStore } from "../stores/appStore";
import DisclosureCaret from "./DisclosureCaret";
import type { Page } from "../types";

function VerseDayLogo() {
  return (
    <svg width="32" height="32" viewBox="0 0 20 20" fill="none">
      <defs>
        <linearGradient id="verseday-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#E8D4F0" />
          <stop offset="35%" stopColor="#F8D0DC" />
          <stop offset="70%" stopColor="#FBC9A4" />
          <stop offset="100%" stopColor="#FCE5A8" />
        </linearGradient>
        <linearGradient id="verseday-ocean" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#A8CFE5" />
          <stop offset="100%" stopColor="#CFE5F0" />
        </linearGradient>
        <radialGradient id="verseday-sunglow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FFD9A0" stopOpacity={0.9} />
          <stop offset="60%" stopColor="#FFD9A0" stopOpacity={0.35} />
          <stop offset="100%" stopColor="#FFD9A0" stopOpacity={0} />
        </radialGradient>
        <clipPath id="verseday-clip">
          <circle cx="10" cy="10" r="5.8" />
        </clipPath>
      </defs>
      <g clipPath="url(#verseday-clip)">
        <rect x="4" y="4" width="12" height="7.7" fill="url(#verseday-sky)" />
        <circle cx="10" cy="11.05" r="3.9" fill="url(#verseday-sunglow)" />
        <circle cx="10" cy="11.05" r="1.1" fill="#FFD9A0" />
        <rect x="4" y="11.7" width="12" height="4.3" fill="url(#verseday-ocean)" />
        <rect x="4" y="11.66" width="12" height="0.06" fill="#FFFFFF" fillOpacity={0.45} />
      </g>
      <path d="M 4.15,4.54 A 8,8 0 0 1 15.85,4.54" stroke="#E89BB1" strokeWidth="1.92" strokeLinecap="round" />
      <path d="M 15.46,4.15 A 8,8 0 0 1 15.46,15.85" stroke="#F4B58E" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M 15.85,15.46 A 8,8 0 0 1 4.15,15.46" stroke="#A8CFE5" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M 4.54,15.85 A 8,8 0 0 1 4.54,4.15" stroke="#C9B5E0" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

interface NavItem {
  page: Page;
  label: string;
  icon: ReactNode;
  /** CSS color or var() — used as the icon chip's background. */
  tint: string;
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
      {/* Hour hand pointing to 4 (~120°) */}
      <line x1="7.5" y1="7.5" x2="9.2" y2="10" />
      {/* Minute hand pointing to 6 (180°) */}
      <line x1="7.5" y1="7.5" x2="7.5" y2="11" />
    </svg>
  );
}

function FocusIcon() {
  return (
    <svg width={iconSize} height={iconSize} viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7.5" cy="7.5" r="5.5" />
      <circle cx="7.5" cy="7.5" r="2.5" />
      <circle cx="7.5" cy="7.5" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

const focusItem: NavItem = {
  page: "focus_landing",
  label: "Focus",
  icon: <FocusIcon />,
  tint: "var(--nav-tint-focus)",
};

const planningItems: NavItem[] = [
  { page: "daily", label: "Daily Plan", icon: <DailyPlanIcon />, tint: "var(--nav-tint-daily)" },
  { page: "daily_shutdown", label: "Daily Shutdown", icon: <DailyShutdownIcon />, tint: "var(--nav-tint-daily)" },
  { page: "weekly", label: "Weekly Plan", icon: <WeeklyPlanIcon />, tint: "var(--nav-tint-weekly)" },
  { page: "shutdown", label: "Weekly Shutdown", icon: <ShutdownIcon />, tint: "var(--nav-tint-weekly)" },
  { page: "projects", label: "Objectives", icon: <ProjectsIcon />, tint: "var(--nav-tint-objectives)" },
];

function SettingsIcon() {
  return (
    <svg width={iconSize} height={iconSize} viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7.5" cy="7.5" r="2.5" />
      <path d="M7.5 1.5v1.5M7.5 12v1.5M1.5 7.5H3M12 7.5h1.5M3.25 3.25l1.06 1.06M10.69 10.69l1.06 1.06M3.25 11.75l1.06-1.06M10.69 4.31l1.06-1.06" />
    </svg>
  );
}

const manageItems: NavItem[] = [
  { page: "dashboard", label: "Dashboard", icon: <DashboardIcon />, tint: "var(--nav-tint-settings)" },
  { page: "settings", label: "Settings", icon: <SettingsIcon />, tint: "var(--nav-tint-settings)" },
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
      <div className="px-4 pt-4 pb-1.5 uppercase text-fg-faded [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)]">
        {label}
      </div>
      {items.map(({ page, label: itemLabel, icon, tint }) => {
        const isActive = activePage === page;
        return (
          <button
            key={page}
            onClick={() => onSelect(page)}
            className={`w-full flex items-center gap-3 px-4 py-2 cursor-pointer transition-colors ${
              isActive
                ? "bg-accent-blue-soft text-accent-blue-soft-fg"
                : "text-fg-secondary hover:bg-overlay-hover hover:text-fg"
            } [font-size:var(--font-size-body)] [font-weight:var(--font-weight-body)]`}
          >
            {/* w-8 slot matches the 32px logo above so icon centers and the
                label run on the same vertical line as the wordmark. */}
            <span className="w-8 flex items-center justify-center shrink-0">
              <span
                className="w-7 h-7 rounded-full flex items-center justify-center"
                style={{ backgroundColor: tint }}
              >
                {icon}
              </span>
            </span>
            {itemLabel}
          </button>
        );
      })}
    </div>
  );
}

// Compact icon-only version of a nav item for the collapsed rail.
function RailIconButton({
  item,
  isActive,
  onSelect,
}: {
  item: NavItem;
  isActive: boolean;
  onSelect: (page: Page) => void;
}) {
  return (
    <button
      onClick={() => onSelect(item.page)}
      title={item.label}
      aria-label={item.label}
      className={`w-9 h-9 rounded-full flex items-center justify-center cursor-pointer transition-colors ${
        isActive
          ? "ring-2 ring-accent-blue ring-offset-2 ring-offset-sidebar"
          : "hover:opacity-100 opacity-90"
      }`}
      style={{ backgroundColor: item.tint }}
    >
      {item.icon}
    </button>
  );
}

const SHORTCUTS = [
  { keys: "F", desc: "Focus on hovered task" },
  { keys: "F", desc: "Focus screen" },
  { keys: "T", desc: "Daily plan (today)" },
  { keys: "W", desc: "Weekly planning" },
  { keys: "O", desc: "Objectives" },
  { keys: "D", desc: "Dashboard" },
  { keys: "S", desc: "Settings" },
  { keys: "⌘ N", desc: "New task" },
  { keys: "Space", desc: "Pause / resume (focus)" },
  { keys: "Esc", desc: "Close / blur" },
];

export default function Sidebar() {
  const {
    currentPage,
    setPage,
    sidebarCollapsed,
    sidebarFocusExpanded,
    toggleSidebar,
  } = useAppStore();
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Focus pages still default to collapsed (immersive); the user can
  // expand via the chevron, which sets the ephemeral focus override.
  const isFocusScreen =
    currentPage === "focus_landing" || currentPage === "focus";
  const collapsed = isFocusScreen ? !sidebarFocusExpanded : sidebarCollapsed;

  function toggleCollapsed() {
    toggleSidebar();
  }

  // project_detail highlights the Projects nav item; focus highlights
  // the Focus nav item.
  const activePage =
    currentPage === "project_detail"
      ? "projects"
      : currentPage === "focus"
        ? "focus_landing"
        : (currentPage as Page);

  if (collapsed) {
    return (
      <aside className="w-[64px] shrink-0 h-screen bg-sidebar border-r border-line-hairline flex flex-col items-center pt-4 pb-3">
        <button
          onClick={() => setPage("daily")}
          className="cursor-pointer opacity-90 hover:opacity-100 transition-opacity"
          title="VerseDay — go to Daily Plan"
        >
          <VerseDayLogo />
        </button>

        <nav className="flex-1 flex flex-col items-center gap-2 mt-5 min-h-0 overflow-y-auto w-full py-1.5">
          <RailIconButton
            item={focusItem}
            isActive={activePage === focusItem.page}
            onSelect={setPage}
          />
          <RailDivider />
          {planningItems.map((it) => (
            <RailIconButton
              key={it.page}
              item={it}
              isActive={activePage === it.page}
              onSelect={setPage}
            />
          ))}
          <RailDivider />
          {manageItems.map((it) => (
            <RailIconButton
              key={it.page}
              item={it}
              isActive={activePage === it.page}
              onSelect={setPage}
            />
          ))}
        </nav>

        {/* Expand chevron — bottom of the rail */}
        <button
          onClick={toggleCollapsed}
          title="Expand sidebar"
          aria-label="Expand sidebar"
          className="w-7 h-7 rounded-full flex items-center justify-center cursor-pointer text-fg-faded hover:text-fg-secondary hover:bg-overlay-hover transition-colors mt-2"
        >
          <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 4l4 3-4 3" />
          </svg>
        </button>
      </aside>
    );
  }

  return (
    <aside className="w-[200px] shrink-0 h-screen bg-sidebar border-r border-line-hairline flex flex-col pt-4">
      <div className="px-4 pb-5 flex items-center gap-3 text-fg-faded">
        <VerseDayLogo />
        <span className="text-[20px] font-semibold text-accent-blue tracking-tight font-display">VerseDay</span>
        <button
          onClick={toggleCollapsed}
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
          className="ml-auto w-6 h-6 rounded-full flex items-center justify-center cursor-pointer text-fg-faded hover:text-fg-secondary hover:bg-overlay-hover transition-colors"
        >
          <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 4l-4 3 4 3" />
          </svg>
        </button>
      </div>
      <nav className="flex-1 flex flex-col min-h-0">
        {/* Focus — standalone, above Planning */}
        <button
          onClick={() => setPage("focus_landing")}
          className={`w-full flex items-center gap-3 px-4 py-2 cursor-pointer transition-colors ${
            activePage === "focus_landing"
              ? "bg-accent-blue-soft text-accent-blue-soft-fg"
              : "text-fg-secondary hover:bg-overlay-hover hover:text-fg"
          } [font-size:var(--font-size-body)] [font-weight:var(--font-weight-body)]`}
        >
          <span className="w-8 flex items-center justify-center shrink-0">
            <span
              className="w-7 h-7 rounded-full flex items-center justify-center"
              style={{ backgroundColor: "var(--nav-tint-focus)" }}
            >
              <FocusIcon />
            </span>
          </span>
          Focus
        </button>
        <NavSection label="Planning" items={planningItems} activePage={activePage} onSelect={setPage} />
        <div className="flex-1" />
        <NavSection label="Manage" items={manageItems} activePage={activePage} onSelect={setPage} />
      </nav>

      {/* Shortcut glossary — toggle row stays in flow; the list itself
          is an absolute overlay that opens upward (bottom-full anchors
          its bottom to the toggle row's top), covering whatever sits
          above (Manage section: Dashboard, Settings) instead of
          pushing them up. bg-sidebar keeps the overlay opaque. */}
      <div className="border-t border-line-hairline relative">
        {showShortcuts && (
          <div className="absolute bottom-full left-0 right-0 bg-sidebar border-t border-line-hairline px-4 pt-3 pb-2 space-y-1">
            {SHORTCUTS.map((s) => (
              <div key={`${s.keys}-${s.desc}`} className="flex items-center justify-between">
                <span className="text-[10px] text-fg-secondary">{s.desc}</span>
                <kbd className="text-[9px] text-fg-faded bg-overlay-hover px-1.5 py-0.5 rounded font-mono whitespace-nowrap shrink-0">
                  {s.keys}
                </kbd>
              </div>
            ))}
          </div>
        )}
        <button
          onClick={() => setShowShortcuts(!showShortcuts)}
          className="w-full flex items-center gap-3 px-4 py-2.5 text-[11px] text-fg-faded cursor-pointer hover:text-fg-muted transition-colors"
        >
          <span className="w-8 flex items-center justify-center shrink-0">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
              <rect x="1" y="3" width="10" height="7" rx="1.5" />
              <line x1="3.5" y1="6" x2="4.5" y2="6" />
              <line x1="6" y1="6" x2="7" y2="6" />
              <line x1="3.5" y1="8" x2="8.5" y2="8" />
            </svg>
          </span>
          Shortcuts
          <span className="ml-auto text-accent-orange-soft-fg/70 flex items-center">
            <DisclosureCaret expanded={showShortcuts} rotateExpanded={-90} />
          </span>
        </button>
      </div>
    </aside>
  );
}

function RailDivider() {
  return <div className="w-6 h-px bg-line-hairline my-1" />;
}
