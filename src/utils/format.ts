const MAX_ESTIMATE_MINUTES = 480;

export function parseTimeFromTitle(title: string): {
  cleanTitle: string;
  minutes: number | null;
} {
  // Match patterns like "20 minutes", "1.5 hours", "45m", "2h", "about 30 min", "~15min"
  const pattern =
    /(?:^|\s)(?:about|around|~)?\s*(\d+(?:\.\d+)?)\s*(minutes?|mins?|m|hours?|hrs?|h)\s*$/i;
  const match = title.match(pattern);
  if (!match) return { cleanTitle: title, minutes: null };

  const num = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  let minutes: number;

  if (unit.startsWith("h")) {
    minutes = Math.round(num * 60);
  } else {
    minutes = Math.round(num);
  }

  if (minutes < 1 || minutes > MAX_ESTIMATE_MINUTES) {
    return { cleanTitle: title, minutes: null };
  }

  const cleanTitle = title.slice(0, match.index).trim();
  return { cleanTitle, minutes };
}

export function formatHoursMinutes(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = Math.round(totalMinutes % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
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
