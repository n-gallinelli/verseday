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
