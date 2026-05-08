import SummaryOverlay from "./SummaryOverlay";
import { useAppStore } from "../stores/appStore";

// Singleton host for SummaryOverlay (M3.1). Mounted exactly once at the
// App shell. Reads `summaryOverlay` from the store and renders the
// overlay only when it's non-null. Mirrors TaskDetailOverlayHost's
// thin-wrapper pattern. Per-screen `showSummary` useState mounts in
// DailyPlanner / DailyShutdown retire in M3.1.b.
export default function SummaryOverlayHost() {
  const summaryOverlay = useAppStore((s) => s.summaryOverlay);
  const closeSummaryOverlay = useAppStore((s) => s.closeSummaryOverlay);
  if (!summaryOverlay) return null;
  return (
    <SummaryOverlay
      type={summaryOverlay.kind}
      anchorDate={summaryOverlay.anchorDate}
      onClose={closeSummaryOverlay}
    />
  );
}
