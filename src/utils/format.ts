const MAX_ESTIMATE_MINUTES = 480;

export function parseTimeFromTitle(title: string): {
  cleanTitle: string;
  minutes: number | null;
} {
  // Pattern with explicit unit: "20 minutes", "1.5 hours", "45m", "2h",
  // "about 30 min", "~15min". Requires a unit so bare numbers in titles like
  // "Call Alex at 5" don't get treated as estimates.
  const withUnit =
    /(?:^|\s)(?:about|around|~)?\s*(\d+(?:\.\d+)?)\s*(minutes?|mins?|m|hours?|hrs?|h)\s*$/i;
  // Pattern with the ~ prefix and a bare number: "~20" → 20 minutes. The ~
  // makes the user's intent unambiguous, so we default to minutes when no
  // unit is given.
  const tildeBare = /(?:^|\s)~(\d+(?:\.\d+)?)\s*$/;

  // A parse is only valid when a real title remnant survives the strip. A bare
  // "2h" / "~10" (no other words) strips to nothing, which isn't a titled task
  // — return no-parse so callers keep the literal title and never create a
  // blank task. Centralized here so all call sites inherit it identically.
  const m1 = title.match(withUnit);
  if (m1) {
    const num = parseFloat(m1[1]);
    const unit = m1[2].toLowerCase();
    const minutes = unit.startsWith("h") ? Math.round(num * 60) : Math.round(num);
    const cleanTitle = title.slice(0, m1.index).trim();
    if (minutes >= 1 && minutes <= MAX_ESTIMATE_MINUTES && cleanTitle !== "") {
      return { cleanTitle, minutes };
    }
  }

  const m2 = title.match(tildeBare);
  if (m2) {
    const minutes = Math.round(parseFloat(m2[1]));
    const cleanTitle = title.slice(0, m2.index).trim();
    if (minutes >= 1 && minutes <= MAX_ESTIMATE_MINUTES && cleanTitle !== "") {
      return { cleanTitle, minutes };
    }
  }

  return { cleanTitle: title, minutes: null };
}

export function formatHoursMinutes(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = Math.round(totalMinutes % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  // Zero-pad the minutes part when hours are present so "1h 09m"
  // reads as a fixed-width duration rather than mixing widths
  // (1h 9m looked off in the daily-plan column).
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

export interface EmptyDayMessage {
  title: string;
  subtitle: string;
}

/**
 * Returns a time-of-day-aware empty-state message for an unplanned day.
 * Buckets: morning (5–11), midday (11–14), afternoon (14–17), evening (17–22), late (22–5).
 */
export function getEmptyDayMessage(now: Date = new Date()): EmptyDayMessage {
  const h = now.getHours();
  if (h >= 5 && h < 11) {
    return {
      title: "Morning's all yours",
      subtitle: "Nothing planned. Whatever you queue up first becomes the day.",
    };
  }
  if (h >= 11 && h < 14) {
    return {
      title: "Midday and wide open",
      subtitle: "Drop in the one thing worth getting done before the day slips.",
    };
  }
  if (h >= 14 && h < 17) {
    return {
      title: "Quiet afternoon",
      subtitle: "Nothing on the list — pick something small or call it a soft day.",
    };
  }
  if (h >= 17 && h < 22) {
    return {
      title: "Evening's clear",
      subtitle: "No tasks tonight. Rest, or sneak one thing in if it'll bug you.",
    };
  }
  return {
    title: "Late and unplanned",
    subtitle: "Tomorrow's a fresh start — or queue something up now while it's quiet.",
  };
}
