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
  created_at: string;
}

export interface TimeEntry {
  id: number;
  task_id: number;
  start_time: string;
  end_time: string | null;
  entry_type: "pomodoro" | "tracked";
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
  | "focus_landing"
  | "settings";
