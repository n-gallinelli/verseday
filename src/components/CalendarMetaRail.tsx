// Right-rail panel for calendar-imported tasks. Replaces the standard
// Objective / Dates / Time / Repeat properties with read-only metadata
// from the calendar event itself: time, calendar name, location (with
// Zoom-link auto-detection), URL, attendees, and the event description.
//
// Notes column on the left of the overlay stays as-is — those are the
// user's *own* notes (tasks.notes). The event description from the
// calendar lives in tasks.external_notes and renders here.

import type { Task } from "../types";
import type { Attendee } from "../calendar/types";

interface Props {
  task: Task;
}

function parseAttendees(raw: string | null): Attendee[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function formatEventTime(start: string | null, end: string | null): string | null {
  if (!start) return null;
  // start/end are local-tz "YYYY-MM-DDTHH:MM" — pull the HH:MM out
  // and format. Don't construct a Date; that would round-trip
  // through UTC and risk a 1-day shift on the boundary.
  const startTime = start.split("T")[1]?.slice(0, 5);
  if (!startTime) return null;
  const startLabel = formatTimeLabel(startTime);
  if (!end) return startLabel;
  const endTime = end.split("T")[1]?.slice(0, 5);
  if (!endTime) return startLabel;
  return `${startLabel} – ${formatTimeLabel(endTime)}`;
}

function formatTimeLabel(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  const h = parseInt(hStr, 10);
  const m = mStr;
  const period = h >= 12 ? "PM" : "AM";
  const displayH = h % 12 === 0 ? 12 : h % 12;
  return m === "00" ? `${displayH} ${period}` : `${displayH}:${m} ${period}`;
}

function isUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

const ATTENDEE_STATUS_LABEL: Record<string, string> = {
  accepted: "✓",
  declined: "✗",
  tentative: "?",
  pending: "·",
  unknown: "·",
};

export default function CalendarMetaRail({ task }: Props) {
  const attendees = parseAttendees(task.external_attendees);
  const timeLabel = formatEventTime(task.external_start_local, task.external_end_local);
  const location = task.external_location?.trim() || null;
  const url = task.external_url?.trim() || null;
  const calendarName = task.external_calendar_name?.trim() || null;
  const organizer = task.external_organizer_email?.trim() || null;
  const description = task.external_notes?.trim() || null;

  // The location field is sometimes a Zoom/Meet/Teams URL itself —
  // detect and render as a link if so.
  const locationIsLink = location ? isUrl(location) : false;

  return (
    <div className="w-[320px] flex-shrink-0 border-l border-line-hairline bg-rail px-6 py-7 overflow-y-auto space-y-6">
      <Section label="From calendar">
        {calendarName && (
          <Row label="Calendar">
            <span className="text-[13px] text-fg">{calendarName}</span>
          </Row>
        )}
        {timeLabel && (
          <Row label="Time">
            <span className="text-[13px] text-fg tabular-nums">{timeLabel}</span>
          </Row>
        )}
        {location && (
          <Row label="Location">
            {locationIsLink ? (
              <a
                href={location}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[13px] text-accent-blue hover:underline break-all"
              >
                Join meeting →
              </a>
            ) : (
              <span className="text-[13px] text-fg break-words">{location}</span>
            )}
          </Row>
        )}
        {url && url !== location && (
          <Row label="Link">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[13px] text-accent-blue hover:underline break-all"
            >
              {url}
            </a>
          </Row>
        )}
      </Section>

      {attendees.length > 0 && (
        <Section label={`Attendees (${attendees.length})`}>
          <ul className="space-y-1.5">
            {attendees.map((a, i) => (
              <li key={i} className="flex items-baseline gap-2 text-[12px]">
                <span
                  className="text-fg-faded w-3 flex-shrink-0 tabular-nums"
                  title={a.status}
                  aria-label={a.status}
                >
                  {ATTENDEE_STATUS_LABEL[a.status] ?? "·"}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="text-fg-secondary">{a.name ?? a.email ?? "Unknown"}</span>
                  {a.name && a.email && (
                    <span className="text-fg-faded ml-1.5 text-[11px]">{a.email}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {organizer && !attendees.some((a) => a.email === organizer) && (
        <Section label="Organizer">
          <span className="text-[12px] text-fg-secondary">{organizer}</span>
        </Section>
      )}

      {description && (
        <Section label="Description">
          <p className="text-[13px] text-fg-secondary whitespace-pre-wrap leading-relaxed break-words">
            {description}
          </p>
        </Section>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="uppercase [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] text-fg-faded mb-2">
        {label}
      </div>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-[11px] text-fg-faded w-[64px] flex-shrink-0">{label}</span>
      <span className="flex-1 min-w-0">{children}</span>
    </div>
  );
}
