// Right-rail panel for calendar-imported tasks. Replaces the standard
// Objective / Dates / Time / Repeat properties with read-only metadata
// from the calendar event itself: time, calendar name, location (with
// Zoom-link auto-detection), URL, attendees, and the event description.
//
// Notes column on the left of the overlay stays as-is — those are the
// user's *own* notes (tasks.notes). The event description from the
// calendar lives in tasks.external_notes and renders here.

import { openUrl } from "@tauri-apps/plugin-opener";
import type { Task } from "../types";
import type { Attendee } from "../calendar/types";
import { htmlToSegments, type NoteSegment } from "../utils/linkify";

/** Render parsed note segments: text (newlines preserved by the container's
 *  whitespace-pre-wrap) and links opened via the Tauri opener — never a raw
 *  target=_blank, and the parser only ever emits http(s) links. */
function renderSegments(segments: NoteSegment[]): React.ReactNode[] {
  return segments.map((seg, i) => {
    if (seg.type === "link") {
      return (
        <a
          key={i}
          href={seg.url}
          onClick={(e) => {
            e.preventDefault();
            openUrl(seg.url).catch(() => {});
          }}
          className="text-accent-blue hover:underline break-all cursor-pointer"
        >
          {seg.label}
        </a>
      );
    }
    return <span key={i}>{seg.content}</span>;
  });
}

interface Props {
  task: Task;
  /** Editable "time spent" control for the meeting. Rendered at the top of the
   *  rail. Supplied by TaskDetailOverlay (which owns the worked-minutes state +
   *  handlers) so this panel stays a dumb presenter. Calendar events are
   *  otherwise read-only, but logging time against a meeting is a real edit. */
  timeControl?: React.ReactNode;
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

/** Google Calendar inserts decorative ASCII dividers around the
 *  conferencing-info block (e.g. `::~:~::~:~:~:~:~:~::-`). Strip lines
 *  that are pure separator characters so the description reads as
 *  prose. We require at least one `:` or `~` so legitimate dashes /
 *  bullet rules in user-authored descriptions stay intact. */
function cleanDescription(desc: string): string {
  return desc
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return true;
      const isDivider = /^[\s:~\-]+$/.test(trimmed) && /[:~]/.test(trimmed);
      return !isDivider;
    })
    .join("\n");
}

/** Split text on URLs and render the URLs as anchors, leaving the
 *  rest as text. Capture-group split puts matches at odd indices. */
function renderTextWithLinks(text: string): React.ReactNode[] {
  const urlPattern = /(https?:\/\/[^\s<>)]+)/g;
  const parts = text.split(urlPattern);
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      // Trim trailing punctuation that's almost certainly not part of
      // the URL (period at end of sentence, comma, closing paren).
      const trailing = part.match(/[.,!?;:)]+$/);
      const url = trailing ? part.slice(0, -trailing[0].length) : part;
      const tail = trailing ? trailing[0] : "";
      return (
        <span key={i}>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-blue hover:underline break-all"
          >
            {url}
          </a>
          {tail}
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

const ATTENDEE_STATUS_LABEL: Record<string, string> = {
  accepted: "✓",
  declined: "✗",
  tentative: "?",
  pending: "·",
  unknown: "·",
};

export default function CalendarMetaRail({ task, timeControl }: Props) {
  const attendees = parseAttendees(task.external_attendees);
  const timeLabel = formatEventTime(task.external_start_local, task.external_end_local);
  const location = task.external_location?.trim() || null;
  const url = task.external_url?.trim() || null;
  const calendarName = task.external_calendar_name?.trim() || null;
  const organizer = task.external_organizer_email?.trim() || null;
  const rawDescription = task.external_notes?.trim() || null;
  const description = rawDescription ? cleanDescription(rawDescription) : null;
  // Detect markup so plain-text descriptions keep the simpler linkify path.
  const descriptionIsHtml = description ? /<[a-z][\s\S]*>/i.test(description) : false;

  // The location field is sometimes a Zoom/Meet/Teams URL itself —
  // detect and render as a link if so.
  const locationIsLink = location ? isUrl(location) : false;

  return (
    <div className="w-[320px] flex-shrink-0 border-l border-line-hairline bg-rail px-6 py-7 overflow-y-auto space-y-6">
      {timeControl && <Section label="Time spent">{timeControl}</Section>}

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
          {/* Google Calendar descriptions arrive as HTML. Render them as
              readable structured text (lists get bullet/number markers) via the
              inert DOMParser walk — NO innerHTML, http(s)-only links — which is
              the right safety posture for this MORE-untrusted external field,
              doubly so in Tauri where an injected script could reach IPC. Plain-
              text descriptions keep the bare-URL linkify + pre-wrap path. */}
          <div className="text-[13px] text-fg-secondary whitespace-pre-wrap leading-relaxed break-words">
            {descriptionIsHtml
              ? renderSegments(htmlToSegments(description, { maxChars: Infinity, listMarkers: true }))
              : renderTextWithLinks(description)}
          </div>
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
