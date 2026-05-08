import SunsetOverlay from "./SunsetOverlay";
import { useAppStore } from "../stores/appStore";

// Singleton host for SunsetOverlay (M3.1). Mounted exactly once at the
// App shell, after SummaryOverlayHost so a sunset triggered while a
// summary is open layers on top in DOM order (Verse z-order hint).
// Per-screen `showSunset` useState mounts in DailyShutdown /
// WeeklyShutdown retire in M3.1.b.
export default function SunsetOverlayHost() {
  const sunsetOverlayOpen = useAppStore((s) => s.sunsetOverlayOpen);
  const closeSunsetOverlay = useAppStore((s) => s.closeSunsetOverlay);
  if (!sunsetOverlayOpen) return null;
  return <SunsetOverlay onDismiss={closeSunsetOverlay} />;
}
