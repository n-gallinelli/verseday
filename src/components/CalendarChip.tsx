// Visual indicator for tasks imported from the user's calendar (M4).
// Rendered by TaskCard when `task.external_source === 'calendar'`.

interface CalendarChipProps {
  className?: string;
}

export default function CalendarChip({ className = "" }: CalendarChipProps) {
  return (
    <span
      className={`inline-flex items-center justify-center flex-shrink-0 ${className}`}
      aria-label="Imported from calendar"
      title="Imported from calendar"
    >
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="var(--text-faded)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="10" height="9" rx="1" />
        <path d="M2 5.5h10" />
        <path d="M5 2v2M9 2v2" />
      </svg>
    </span>
  );
}
