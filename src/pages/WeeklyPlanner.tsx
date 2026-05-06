import ScheduleTab from "./weekly-plan/ScheduleTab";
import PlanTab from "./weekly-plan/PlanTab";
import PlanFridayBanner from "./weekly-plan/PlanFridayBanner";
import { useAppStore } from "../stores/appStore";
import { localDateIso, mondayOfWeek } from "../utils/dates";

type Tab = "schedule" | "plan";

function formatWeekLabel(mondayIso: string): string {
  const d = new Date(mondayIso + "T00:00:00");
  const friday = new Date(d);
  friday.setDate(d.getDate() + 4);
  const monthDay = (date: Date) =>
    date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${monthDay(d)} – ${monthDay(friday)}`;
}

// Host for the Weekly Plan screen. Two tabs: Plan (the Friday-anchored
// planning view, default) and Schedule (the existing calendar/week
// view). The Friday banner sits above both, prompting the user to
// advance to next week.
//
// Tab choice persists in appStore for the session — navigating away
// and back returns to whichever tab the user had open.
export default function WeeklyPlanner() {
  const { weeklyPlannerTab, setWeeklyPlannerTab, selectedWeek, setSelectedWeek, schedulePlannedMinutes } = useAppStore();
  const isThisWeek = selectedWeek === mondayOfWeek();
  const showPlannedReadout = weeklyPlannerTab === "schedule" && schedulePlannedMinutes > 0;
  const plannedHoursLabel = (Math.round(schedulePlannedMinutes / 6) / 10)
    .toFixed(1)
    .replace(/\.0$/, "");

  function changeWeek(offset: number) {
    const d = new Date(selectedWeek + "T00:00:00");
    d.setDate(d.getDate() + offset * 7);
    setSelectedWeek(localDateIso(d));
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PlanFridayBanner onAccept={() => setWeeklyPlannerTab("plan")} />

      {/* Unified header — arrows flanking the date label, "this week"
          marker, then the Plan/Schedule toggle pushed right. On the
          Schedule tab, the planned-hours readout sits inline next to
          the toggle instead of taking a row of its own. */}
      <div className="px-7 py-3 flex items-center gap-3 border-b border-line-hairline flex-shrink-0">
        <button
          onClick={() => changeWeek(-1)}
          className="w-7 h-7 rounded-full flex items-center justify-center text-fg-muted cursor-pointer hover:bg-overlay-hover transition-colors"
          title="Previous week"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 4l-4 4 4 4" />
          </svg>
        </button>
        <span className="text-[13px] font-medium text-fg">
          {formatWeekLabel(selectedWeek)}
        </span>
        <button
          onClick={() => changeWeek(1)}
          className="w-7 h-7 rounded-full flex items-center justify-center text-fg-muted cursor-pointer hover:bg-overlay-hover transition-colors"
          title="Next week"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 4l4 4-4 4" />
          </svg>
        </button>
        {isThisWeek ? (
          <span className="text-[10px] uppercase tracking-[0.06em] text-fg-faded">
            this week
          </span>
        ) : (
          <button
            onClick={() => setSelectedWeek(mondayOfWeek())}
            className="text-[11px] text-accent-orange-soft-fg hover:text-accent-orange cursor-pointer"
          >
            Jump to this week
          </button>
        )}
        <div className="ml-auto flex items-center gap-3">
          {showPlannedReadout && (
            <span className="text-[12px] text-fg-faded">
              Planned{" "}
              <span className="text-fg-secondary tabular-nums">
                {plannedHoursLabel}h
              </span>
            </span>
          )}
          <TabToggle tab={weeklyPlannerTab} onChange={setWeeklyPlannerTab} />
        </div>
      </div>

      <div
        key={weeklyPlannerTab}
        className="flex-1 min-h-0 flex flex-col animate-tab-fade"
      >
        {weeklyPlannerTab === "plan" ? <PlanTab /> : <ScheduleTab />}
      </div>
    </div>
  );
}

function TabToggle({
  tab,
  onChange,
}: {
  tab: Tab;
  onChange: (t: Tab) => void;
}) {
  return (
    <div className="inline-flex bg-overlay-hover rounded-full p-0.5 text-[12px]">
      <TabButton active={tab === "plan"} onClick={() => onChange("plan")}>
        Plan
      </TabButton>
      <TabButton active={tab === "schedule"} onClick={() => onChange("schedule")}>
        Schedule
      </TabButton>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-1 rounded-full transition-colors cursor-pointer ${
        active
          ? "bg-base text-fg shadow-sm"
          : "text-fg-faded hover:text-fg-secondary"
      }`}
      style={
        active
          ? { boxShadow: "0 1px 2px color-mix(in srgb, var(--text-faded) 25%, transparent)" }
          : undefined
      }
    >
      {children}
    </button>
  );
}
