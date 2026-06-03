// Pure subquery-selection for createTask's sort_order, extracted so the
// precedence is unit-pinnable (the integrity test runs THIS, not a copied
// INSERT, so it guards production — same discipline as rolloverSql.ts). No
// Tauri/runtime imports.
//
// A new task lands at the TOP of its scope: sort_order = MIN(scope) - 1
// (monotonic decrement; SQLite INTEGER is 64-bit). The subquery runs INSIDE the
// INSERT so two concurrent creates (main window + QuickAdd webview) can't read
// the same MIN and collide.
//
// Scope precedence — dateScheduled BEFORE projectId. sort_order is one shared
// column serving both the date list and the Objective list, with independently
// drifting counters; only one bucket can be made correct-on-create. The daily
// planner is the primary ordered surface and the target of new-task-to-top, so
// a dated task tops its DATE list even when it also has an Objective (it will
// then also tend to top that Objective's list — accepted). Undated project
// tasks fall through to project scope; tasks with neither use the global scope.
//
// $2 = project_id, $3 = date_scheduled — matching createTask's bound params, so
// no extra binds are needed.
export function createTaskSortSubquery(opts: {
  projectId: number | null;
  dateScheduled: string | null;
}): string {
  if (opts.dateScheduled != null) {
    return "(SELECT COALESCE(MIN(sort_order), 1) - 1 FROM tasks WHERE date_scheduled = $3)";
  }
  if (opts.projectId != null) {
    return "(SELECT COALESCE(MIN(sort_order), 1) - 1 FROM tasks WHERE project_id = $2)";
  }
  return "(SELECT COALESCE(MIN(sort_order), 1) - 1 FROM tasks)";
}
