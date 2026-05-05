import type { Project } from "../../types";
import type { WeeklyPlanProjectStatus } from "../../db/queries";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri"];

interface Props {
  weekDates: string[]; // 5 ISO strings, Mon..Fri
  projects: Project[];
  commitments: Map<number, Map<number, number>>; // projectId → dayOffset → minutes
  statuses: Map<number, WeeklyPlanProjectStatus>;
  onSelectProject: (id: number) => void;
}

function formatHM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

function formatDayHeading(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// Read-only week summary shown when every active project has a status.
// Lists each Mon..Fri with its committed projects and minutes. Skipped
// projects (no commitments) appear in a small footer tally. Clicking a
// project name re-selects it in the parent so the user can edit.
export default function PlanWeekSummary({
  weekDates,
  projects,
  commitments,
  statuses,
  onSelectProject,
}: Props) {
  const projectById = new Map(projects.map((p) => [p.id, p]));

  // Build per-day rollup: for each day, list { project, minutes }.
  const dayRows: { project: Project; minutes: number }[][] = weekDates.map(
    (_, dayOffset) => {
      const rows: { project: Project; minutes: number }[] = [];
      for (const [projectId, dayMap] of commitments) {
        const m = dayMap.get(dayOffset);
        if (m == null) continue;
        const project = projectById.get(projectId);
        if (!project) continue;
        rows.push({ project, minutes: m });
      }
      // Sort by project name so the day strip reads consistently.
      rows.sort((a, b) => a.project.name.localeCompare(b.project.name));
      return rows;
    }
  );

  const skippedProjects = projects.filter(
    (p) => statuses.get(p.id) === "skipped"
  );

  // Total weekly commitment in minutes.
  const totalMinutes = dayRows.reduce(
    (sum, day) => sum + day.reduce((s, r) => s + r.minutes, 0),
    0
  );

  return (
    <section className="flex-1 flex flex-col min-w-0 overflow-y-auto px-8 pt-8 pb-10">
      <header className="mb-6">
        <h2 className="text-[20px] font-medium text-fg leading-tight font-display">
          Week reviewed
        </h2>
        <p className="text-[12px] text-fg-faded mt-1">
          {totalMinutes > 0
            ? `${formatHM(totalMinutes)} committed across the week. Click any project to revisit.`
            : "All projects reviewed. Click any project to revisit."}
        </p>
      </header>

      {/* Day rollup — five rows, one per weekday */}
      <div className="space-y-3">
        {weekDates.map((iso, dayOffset) => {
          const rows = dayRows[dayOffset];
          const dayTotal = rows.reduce((s, r) => s + r.minutes, 0);
          return (
            <div
              key={iso}
              className="flex gap-4 px-4 py-3 rounded-lg border border-line-soft bg-elevated"
            >
              <div className="w-[88px] flex-shrink-0">
                <div className="text-[12px] font-medium text-fg">
                  {DAY_NAMES[dayOffset]}
                </div>
                <div className="text-[11px] text-fg-faded">
                  {formatDayHeading(iso)}
                </div>
                {dayTotal > 0 && (
                  <div className="text-[11px] text-fg-muted tabular-nums mt-1">
                    {formatHM(dayTotal)}
                  </div>
                )}
              </div>
              <div className="flex-1 flex flex-col gap-1.5 min-w-0">
                {rows.length === 0 ? (
                  <span className="text-[12px] text-fg-faded italic">
                    Open
                  </span>
                ) : (
                  rows.map((r) => (
                    <button
                      key={r.project.id}
                      type="button"
                      onClick={() => onSelectProject(r.project.id)}
                      className="flex items-center gap-2 px-2 py-1 -mx-2 rounded text-left hover:bg-overlay-hover cursor-pointer"
                    >
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: r.project.color }}
                      />
                      <span className="flex-1 text-[13px] text-fg truncate">
                        {r.project.name}
                      </span>
                      <span className="text-[11px] text-fg-muted tabular-nums shrink-0">
                        {formatHM(r.minutes)}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Skipped projects — quiet footer tally */}
      {skippedProjects.length > 0 && (
        <div className="mt-6 pt-4 border-t border-line-hairline">
          <span className="uppercase text-fg-faded mb-2 block [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)]">
            Skipped this week
          </span>
          <div className="flex flex-wrap gap-2">
            {skippedProjects.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onSelectProject(p.id)}
                className="flex items-center gap-1.5 px-2 py-1 rounded-full border border-line-hairline hover:bg-overlay-hover cursor-pointer"
              >
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: p.color }}
                />
                <span className="text-[11px] italic text-fg-faded">
                  {p.name}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
