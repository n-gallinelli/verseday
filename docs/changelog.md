# Changelog

## Session — 2026-03-19

### Wave 1: Quick fixes (M38–M39, M44–M45)
- **M38** — Daily shutdown: replaced decimal hours ("0.7h") with "42m" / "1h 12m" format. Extracted `formatHoursMinutes` to shared `src/utils/format.ts`.
- **M39** — Daily planner header: swapped order to "Worked · Planned" (worked first).
- **M44** — Weekly shutdown button: made sticky at bottom of viewport so it's always visible when content scrolls.
- **M45** — Weekly planner projects panel: narrowed from 300px to 240px.

### Wave 2: Visual polish (M43, M42)
- **M43** — Replaced 8 preset project colors with softer pastels (muted blue, soft coral, sage green, warm sand, lavender, blush, sky, stone). Old colors kept as legacy for backward compat.
- **M42** — New projects auto-pick the first unused pastel color. `NewProjectPanel` accepts `activeColors` prop.

### Wave 3: Click targets + UI access (M34, M35)
- **M34** — Extracted `TaskDetailOverlay` shared component (~280 lines). Task titles now clickable everywhere: WeeklyShutdown "projects in progress", ProjectDetail task rows (removed standalone "Edit" button). DailyPlanner refactored to use shared overlay.
- **M35** — PiP orphan self-close: if no focus state in localStorage for 2+ seconds, PiP closes itself. Fixed to use Tauri `getCurrentWebviewWindow().close()` instead of `window.close()`.

### Wave 4: Expandable panels (M40, M41)
- **M40** — Daily planner right sidebar: projects are now expandable (chevron toggle). Shows unscheduled + today's tasks per project. Click-to-schedule via `pullTaskToDay`.
- **M41** — Projects page: each project card has expandable rows showing up to 5 open tasks. Click task → detail overlay. All expanded cards collapse on drag start to prevent layout shift.

### Wave 5: Schema changes (M37, M36)
- **M37** — Multi-day task spanning: added `getWorkedMinutesByDate(taskId)` query. Task detail overlay shows per-day breakdown ("Mon, Mar 16 20m · Tue, Mar 17 15m") when 2+ days.
- **M36** — Recurring tasks: migration v9 (recurrence TEXT, recurrence_source_id INTEGER). Template/instance model. Generation engine runs on daily plan load. Detail overlay has Repeat dropdown (None/Daily/Weekdays/Weekly + day picker).

### UI redesign: Task detail overlay time fields
- Replaced standalone estimate pills row and "TIME WORKED" section with two inline stacked pills ("Estimated" / "Worked") in the meta row.
- Click opens a 240px popover with presets + custom input. Only one popover open at a time.
- Added "3h" to estimate presets. Optional `autoTrackedMinutes` prop for showing tracked time note.

### Layout + UX changes (M46–M62)
- **M46** — "Shut Down" → "Shutdown" across all user-visible text.
- **M47** — Smart time parsing: "send email to jess ~15min" → title stripped, estimate set. Extracted `parseTimeFromTitle` to shared utils. Fixed regex for `~` prefix. Added to ProjectDetail task creation.
- **M48** — Weekly planner projects panel: widened back to 280px.
- **M49** — Weekly planner: tasks without a project render in separate "Unassigned" section at bottom of sidebar (no project card styling).
- **M50** — Weekly shutdown button: made prominent with accent color, always visible (shows "Shutdown again" after completion).
- **M51** — Daily shutdown layout: left column = mood + reflection + button, right column = stats + completed + incomplete tasks.
- **M52** — Sentence case for all buttons: "Shutdown Day" → "Shutdown day", "Complete Shutdown" → "Complete shutdown".
- **M53** — Weekly shutdown buttons: orange → blue (#7B9ED9).
- **M54** — Removed "This week" badge and "Week complete" pill from weekly shutdown top bar.
- **M55** — Removed left overflow panel from daily planner. Overdue + unscheduled tasks moved to right sidebar. Overdue tasks get red count badge on parent projects.
- **M56** — Removed dedicated "Overdue" section. Overdue tasks merged into parent project's expanded list (no special styling). Orphan overdue tasks go to "Unscheduled".

### Count + progress removal
- Removed all task count displays app-wide (project headers, sidebar badges, section counts, "X open · Y done", "X/Y completed", percentage labels) — deliberate product decision to reduce anxiety.
- Removed all progress bars (projects list, project detail, weekly shutdown, dashboard) except focus timer bar.

### PiP improvements (M57–M59)
- **M57** — PiP expand direction reversed: controls slide in from the right, play/pause anchored to right edge always visible.
- **M58** — Verified collapse on cursor leave works with new direction.
- **M59** — Verified PiP visibility cleanup chain covers all exit paths. Fixed `window.close()` → Tauri API. PiP renders nothing when no active session.

### New features
- **M60** — Daily wrap-up reminder at 4:30 PM. Global toast (WrapUpReminder.tsx in App.tsx), shows once per day, auto-dismiss 60s, localStorage tracking with 7-day cleanup. "VerseDay" branding + "Wrap up your day" + navigate to shutdown.
- **M61** — Removed "No project" group from weekly shutdown's "Projects in progress" and week summary.
- **M62** — Task detail date field: shows "—" when no date, formatted "Mar 19" when set, native picker on click, ✕ to clear.
- Weekly planner now uses shared `TaskDetailOverlay` (replaced inline overlay) — date can be cleared from any page.

### Shutdown screen redesign (M63–M64)
- **M63** — Daily shutdown: tinted header (#EEF3FB), "DAILY SHUTDOWN" label in #3D6FCC, two-column body (left: mood + reflection, right: 180px cards for time/done/didn't get to), full-width footer button.
- **M64** — Weekly shutdown: tinted header (#F0F9F5), teal accent (#5DCAA5), mood selector added (migration v10: mood column on weekly_shutdowns), two-column body (left: mood + reflection + carry forward, right: 180px cards for time/projects this week/next week), per-project qualitative note textareas, removed all task-level display.

## M6 — Pomodoro Integration (2026-03-18)
- Pomodoro timer integrated into Focus Mode: 25-minute work cycles with break prompts
- After cycles 1-3: "Take a 5 min break?" → Yes / In 5 min / No
- After every 4th cycle: "Take a 15 min break?" → 15 min / 5 min / No break
- Snooze ("In 5 min") re-prompts after 5 more minutes of work
- Break countdown timer in green with skip option
- Visual pomodoro counter (4 dots + label)
- Pause works correctly during both work and break phases
- Total elapsed time always visible in footer
- No DB schema changes — purely UI/state logic

## Light Theme + UI Refresh (2026-03-18)
- Full color system rewrite from dark to light theme
- CSS variables updated: bg #f5f4f0, surface white, text #2c2a35, primary #6b5fd4
- Sidebar: grouped nav sections with SVG icons, light palette
- DailyPlanner: new date header, progress bar, task input pills, empty state, daily notes
- All components updated to warm off-white / muted lavender design system

## Focus Mode (2026-03-18)
- Full-screen distraction-free focus view: task name + running timer only
- Start button on every non-completed task (Daily Planner + Project Detail)
- Timer counts up with pause/resume support (tracks paused time accurately)
- Two exit options: "Done" (saves time + marks task complete) or "Stop" (saves time only)
- Records a time_entry with start/end timestamps
- Returns to the page you started from after stopping
- No sidebar, no chrome — pure focus

## Refactor — Merge Objectives into Projects (2026-03-18)
- Removed Objectives as separate concept — projects now directly contain tasks
- Projects gained description, target_date, notes fields (DB migration v2)
- New ProjectDetail page: edit project info + add/manage tasks from project view
- Click project name on list page to open detail
- Removed Objectives page, sidebar nav item, and all objective queries/types
- Simplified data model: Projects → Tasks → Time Entries

## M5 — Daily Planner Enhancements (2026-03-18)
- Drag-to-reorder tasks with @dnd-kit (optimistic UI, persisted to DB)
- Inline editable hour budget (click to edit, 0.5–24h range)
- Collapsible daily notes section
- TaskCard extracted as standalone component with drag handle
- Priority dot shape changed (square) to distinguish from round project dot
- Verse M4 fixes: validatePriority/validateTaskStatus, object params for createTask/updateTask, objectives filtered by project

## M4 — Tasks CRUD (2026-03-18)
- Full task editing: title, project, objective, estimate, priority, notes
- Task deletion with confirmation and time entry cascade warning
- Priority system (low/med/high/urgent) with color-coded dots
- Objective selector on task creation and editing
- Expandable notes per task
- Cmd+Enter to save, Escape to cancel in edit mode
- Verse M3 fixes: safety comment on dynamic SQL, objective delete guard, state resets on filter changes

## M3 — Objectives CRUD (2026-03-18)
- Objectives page: create, edit, status management (active/paused/completed), delete with dependency warning
- Filter by project and status
- Notes field (expandable) + description + target date
- Keyboard shortcuts (Escape to cancel)
- Objective task count check before deletion

## M2 — Projects CRUD (2026-03-18)
- Projects page: create, edit, archive/restore, delete with confirmation
- 8 preset color palette for projects
- Project selector on Daily Planner task creation
- Project color dot + name displayed on task cards
- Addressed all Verse review items: CSP, error handling, input validation, Error Boundary, LIMIT clauses, ESLint + Prettier

## M1 — Scaffold (2026-03-18)
- Initialized Tauri v2 + React + TypeScript + TailwindCSS + SQLite project
- Created full database schema (9 tables)
- Built sidebar navigation and Daily Planner page
- Hour budget bar with overcommitment alert
- Task add/complete functionality
