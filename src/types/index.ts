export interface Project {
  id: number;
  name: string;
  color: string;
  archived: number;
  description: string | null;
  start_date: string | null;
  target_date: string | null;
  notes: string | null;
  sort_order: number | null;
  completed: number;
  priority: number; // 0 = normal, 1 = high (sorts to top of Objectives)
  icon: string | null; // emoji grapheme, or null
  custom_icon_id: number | null; // FK → custom_icons.id (image takes precedence over emoji)
  created_at: string;
}

export interface CustomIcon {
  id: number;
  data: string; // PNG data URI (≤64×64, canvas-re-encoded)
  created_at: string;
}

export interface Task {
  id: number;
  project_id: number | null;
  objective_id: number | null;
  title: string;
  description: string | null;
  priority: string;
  status: "todo" | "in_progress" | "done";
  estimated_minutes: number | null;
  date_scheduled: string | null;
  sort_order: number;
  notes: string | null;
  recurrence: string | null;
  recurrence_source_id: number | null;
  original_date: string | null;
  rollover_count: number;
  is_highlight: number;
  completed_at: string | null;
  due_date: string | null;
  // v18: external-source provenance (NULL = task created in-app).
  external_source: string | null;
  external_id: string | null;
  external_dismissal_reason: string | null;
  // v21: calendar metadata for `external_source = 'calendar'` tasks.
  // All NULL for in-app tasks; populated by the calendar sync layer.
  external_notes: string | null;
  external_location: string | null;
  external_url: string | null;
  /** JSON array of `{name, email, status}` objects, or NULL. */
  external_attendees: string | null;
  external_organizer_email: string | null;
  external_calendar_name: string | null;
  external_start_local: string | null;
  external_end_local: string | null;
  created_at: string;
}

export interface TimeEntry {
  id: number;
  task_id: number;
  start_time: string;
  end_time: string | null;
  entry_type: "pomodoro" | "tracked" | "estimate_backfill";
}

export interface DailyPlan {
  id: number;
  date: string;
  notes: string | null;
  hour_budget: number;
  mood: string | null;
  reflection: string | null;
}

export interface WeeklyPlan {
  id: number;
  week_start_date: string;
  focus_areas: string | null;
  notes: string | null;
  created_at: string;
}

export interface WeeklyShutdown {
  id: number;
  week_start_date: string;
  reflections: string | null;
  incomplete_items: string | null;
  mood: string | null;
  created_at: string;
}

export interface Link {
  id: number;
  entity_type: "task" | "project" | "daily_plan" | "weekly_plan";
  entity_id: number;
  url: string;
  label: string | null;
  created_at: string;
}

export type Page =
  | "daily"
  | "daily_shutdown"
  | "weekly"
  | "shutdown"
  | "projects"
  | "project_detail"
  | "dashboard"
  | "focus"
  | "past_shutdowns"
  | "settings";
