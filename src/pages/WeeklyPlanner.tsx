import ScheduleTab from "./weekly-plan/ScheduleTab";
import PlanTab from "./weekly-plan/PlanTab";
import PlanFridayBanner from "./weekly-plan/PlanFridayBanner";
import { useAppStore } from "../stores/appStore";

type Tab = "schedule" | "plan";

// Host for the Weekly Plan screen. Two tabs: Plan (the Friday-anchored
// planning view, default) and Schedule (the existing calendar/week
// view, extracted to ScheduleTab in M2a). The Friday banner sits above
// both, prompting the user to advance to next week.
//
// Tab choice persists in appStore for the session — navigating away
// and back returns to whichever tab the user had open.
export default function WeeklyPlanner() {
  const { weeklyPlannerTab, setWeeklyPlannerTab } = useAppStore();

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PlanFridayBanner onAccept={() => setWeeklyPlannerTab("plan")} />
      <TabToggle tab={weeklyPlannerTab} onChange={setWeeklyPlannerTab} />
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
    <div className="flex items-center justify-center pt-3 pb-2 flex-shrink-0 border-b border-line-hairline">
      <div className="inline-flex bg-overlay-hover rounded-full p-0.5 text-[12px]">
        <TabButton active={tab === "plan"} onClick={() => onChange("plan")}>
          Plan
        </TabButton>
        <TabButton active={tab === "schedule"} onClick={() => onChange("schedule")}>
          Schedule
        </TabButton>
      </div>
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
