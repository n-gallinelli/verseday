import { useState } from "react";
import { useAppStore } from "../../stores/appStore";
import { localDateIso, mondayOfWeek } from "../../utils/dates";

// Add `days` to a Monday-ISO and return another local-formatted ISO.
// We parse with local midnight (`T00:00:00`) so DST transitions don't
// shift the resulting day.
function shiftMondayBy(mondayIso: string, days: number): string {
  const d = new Date(mondayIso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return localDateIso(d);
}

interface Props {
  onAccept: () => void;
}

export default function PlanFridayBanner({ onAccept }: Props) {
  const { selectedWeek, setSelectedWeek } = useAppStore();

  // Show only when:
  //   1. local day-of-week is Friday (getDay() is local-tz, so this is fine)
  //   2. selectedWeek matches "this week's Monday" via the same function
  //      the store uses to set selectedWeek — guaranteed lockstep, not a
  //      coincidence-based comparison
  const isFriday = new Date().getDay() === 5;
  const isThisWeek = selectedWeek === mondayOfWeek();
  const eligible = isFriday && isThisWeek;

  // Dismissal key is keyed off selectedWeek (stable for the whole local
  // week) rather than today's ISO. Otherwise the key flipped at UTC
  // midnight on Friday for west-of-UTC users — same Friday, same
  // dismissal intent, banner reappears.
  const dismissKey = `verseday_plan_friday_dismissed_${selectedWeek}`;
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(dismissKey) === "1"
  );

  if (!eligible || dismissed) return null;

  function accept() {
    // Next Monday = this Monday + 7 days. Derives from selectedWeek
    // (the load-bearing Monday-ISO invariant) so the result is
    // guaranteed to also be a Monday.
    setSelectedWeek(shiftMondayBy(selectedWeek, 7));
    onAccept();
  }

  function dismiss() {
    localStorage.setItem(dismissKey, "1");
    setDismissed(true);
  }

  return (
    <div className="flex items-center justify-between px-7 py-3 bg-accent-orange-soft border-b border-line-soft text-[12px] text-fg-secondary flex-shrink-0">
      <span>Ready to plan next week?</span>
      <div className="flex items-center gap-3">
        <button
          onClick={accept}
          className="text-[12px] font-medium text-accent-orange-soft-fg hover:text-accent-orange cursor-pointer"
        >
          Let's plan
        </button>
        <button
          onClick={dismiss}
          className="text-[11px] text-fg-faded hover:text-fg-secondary cursor-pointer"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
