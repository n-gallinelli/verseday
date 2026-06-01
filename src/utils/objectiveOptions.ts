import type { Project } from "../types";

/**
 * The objectives offered in a task's "Objective" dropdown: **active only** —
 * completed objectives are not assignable choices.
 *
 * The task's CURRENT objective is always kept in the list (even if it's been
 * completed since), so an existing assignment still displays and isn't silently
 * blanked — it just isn't offered to other tasks. `currentValue` is the
 * picker's value: a project id as a string, or "" for none.
 *
 * Archived projects are already excluded upstream (getProjects() filters
 * archived = 0), so this only needs to drop completed ones.
 */
export function activeObjectiveOptions(
  projects: Project[],
  currentValue: string,
): Project[] {
  const active = projects.filter((p) => !p.completed);
  if (currentValue && !active.some((p) => String(p.id) === currentValue)) {
    const current = projects.find((p) => String(p.id) === currentValue);
    if (current) return [...active, current];
  }
  return active;
}
