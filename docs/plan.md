# VerseDay — Project Plan

## Overview
A local desktop Mac app to replace Sunsama. Built with Tauri v2 + React + TypeScript + SQLite + TailwindCSS. Zero cost, all data stays on-device.

## Tech Stack
- **Tauri v2** — native Mac app (Rust backend, web frontend)
- **React + TypeScript** — frontend
- **SQLite** (via tauri-plugin-sql) — local database
- **TailwindCSS** — styling
- **Zustand** — state management

## Database Schema

### Tables
```sql
projects (id, name, color, archived, description, start_date, target_date, notes, sort_order, completed, created_at)
tasks (id, project_id, objective_id?, title, description, priority, status, estimated_minutes, date_scheduled, sort_order, notes, created_at)
time_entries (id, task_id, start_time, end_time, entry_type, break_seconds)
daily_plans (id, date, notes, hour_budget, mood, reflection)
weekly_plans (id, week_start_date, focus_areas, notes, created_at)
weekly_shutdowns (id, week_start_date, reflections, incomplete_items, created_at)
weekly_plan_projects (id, week_start_date, project_id, created_at) -- legacy, no longer used in UI
shutdown_checklist_items (id, label, sort_order, is_default) -- legacy, unused
links (id, entity_type, entity_id, url, label, created_at)
objectives (id, project_id, title, description, status, target_date, notes, created_at) -- legacy
```

### Migrations
1. Initial schema (all tables + shutdown checklist seed data)
2. Add description, target_date, notes to projects
3. Add break_seconds to time_entries
4. Add weekly_plan_projects join table
5. Add start_date to projects (date range support)
6. Add sort_order to projects (custom ordering)
7. Add completed flag to projects
8. Add mood and reflection to daily_plans (daily shutdown)

## Architecture
```
src/
  components/       # TaskCard, Sidebar, DatePicker, DurationPicker, SunsetOverlay, etc.
  pages/            # DailyPlanner, DailyShutdown, WeeklyPlanner, WeeklyShutdown, Projects, ProjectDetail, Dashboard, FocusMode
  stores/           # Zustand store (appStore)
  db/               # SQLite connection, queries
  types/            # TypeScript interfaces
```

## Milestones

### M1 — Scaffold ✅
Tauri + React scaffold, SQLite wired up, schema created.

### M2 — Projects CRUD ✅
Projects page with create/archive/delete.

### M3 — Objectives CRUD ✅
Objectives linked to projects (later merged into projects).

### M4 — Tasks CRUD ✅
Tasks with project assignment, drag-to-reorder, priority, notes.

### M5 — Daily Planner ✅
Drag tasks into today, time estimates, hour budget bar, overcommitment alert, daily notes.

### M6 — Pomodoro + Time Tracking ✅
Focus mode with 25-min pomodoro cycles, break prompts, start/stop tracking, daily time worked stat. Break time tracked separately (break_seconds column) for accurate worked hours.

### M7 — Weekly Planner ✅
Project-centric weekly view. Left panel: focus areas textarea, project cards with nested tasks (pinned + implicit from tasks). Right panel: Mon–Fri calendar with task chips (colored left border + project name subtext). Quick-add per day with project picker.

### M8 — Weekly Shutdown ✅
End-of-week review page. Results summary (tasks completed, hours worked). Projects in progress with per-task and per-project carry forward to next week. Next week preview (Mon–Fri task counts + planned hours). Reflections + carry forward notes with debounced auto-save. Persistent undo for carried tasks. "Complete Weekly Shutdown" button triggers sunset animation. Week summary showing per-project completed tasks.

### M9a — Dashboard ✅
Read-only analytics page. Summary cards (planned hours, worked hours, tasks completed). CSS-only bar chart (Mon–Fri, planned vs worked, data-driven y-axis). Project progress bars. Recent activity by day.

### M9b — Daily Shutdown ✅
End-of-day ritual in Daily Planner. Shutdown mode panel (day stats + reflection textarea). "Complete Shutdown" triggers SunsetOverlay (CSS sunset gradient animation + randomly selected quote from Klopp/Shankly/Paisley with paired attribution). Shutdown state in localStorage. "Day complete" badge.

### M9c — Weekly Shutdown Revamp ✅
Removed mechanical checklist. Added results summary, project-grouped carry forward, next week preview. Cleaned up dead ShutdownChecklistItem type and query.

### M10 — Polish ✅
Keyboard shortcuts (Cmd+1-5 nav, Cmd+N focus input, Cmd+Shift+S shutdown, Space pause in focus). CSS transitions (page fade-in, picker scale-in, task list stagger on initial mount). Sidebar section separator. Custom app icon (purple checkmark, generated via `tauri icon`).

### Pre-M10 Fixes ✅
- **DatePicker** — month grid calendar dropdown for date navigation
- **DurationPicker** — dropdown with presets + custom input
- **Smart time parsing** — extracts duration from task title on submit (e.g. "review PR 30m")
- **Priority simplification** — binary High toggle replaces 4-level system
- **Task notes + URLs** — editable notes in TaskCard expanded area, URL management via links table
- **Project notes + URLs** — links section in ProjectDetail with add/delete
- **XSS protection** — `isSafeUrl()` validates URL protocols at save + render time
- **Undo delete** — timed undo for task deletion in ProjectDetail

### M11 — Project Timelines ✅
Projects can be pinned to specific weeks independent of tasks. New `weekly_plan_projects` join table (migration 4). Weekly planner merges pinned + implicit projects. ProjectDetail shows "Planned" weeks with pin/unpin. Add/remove from both views.

### M12 — Daily Planner Overhaul ✅
Left sidebar (260px) showing overdue tasks (capped at 14 days) and unscheduled tasks. Click to assign to current date. Daily notes always visible (removed collapsible toggle).

### M13 — Project Experience Overhaul ✅
Projects page clicks navigate directly to ProjectDetail (removed overlay modal). ProjectDetail is fully inline-editable — name, description, notes, color, target date, links all always visible with debounced auto-save. No edit mode toggle.

### M14 — Weekly Flow Improvements ✅
- Weekly planner: "Add all from last week" and "Add all active projects" batch pin actions
- Weekly shutdown: "Carry project → next week (N tasks)" pins project + moves tasks
- Weekly shutdown: per-project week summary (completed tasks + estimated hours)
- Expanded quotes: 32 quotes (16 Klopp, 8 Shankly, 8 Paisley) as `{ text, author }` pairs

### M15 — Project Detail Redesign ✅
- **Date range**: Replaced single "Target" date with Start + Due date fields, inline summary (e.g., "Mar 19 → Mar 23"). Migration v5 added `start_date` column.
- **Description & Notes labels**: Added visible section headers ("DESCRIPTION", "NOTES") with visual separation. Both wrapped in white card sections with borders for distinct visual identity.
- **Links section removed**: Removed project-level links UI. URLs pasted into notes auto-shorten to clickable hostname links when not editing (rendered view vs textarea edit mode).
- **Section reorder**: Title+stats → Description → Date range → Notes → Tasks. Tasks are the last and largest section.
- **"Not assigned to any week" → "Not scheduled"**: Updated label with tooltip.

### M16 — Weekly Planner: Collapsible Projects + Drag to Calendar ✅
- **Collapsible project cards**: Chevron toggle on each project card header. Task list collapses/expands. Defaults to expanded.
- **Drag tasks from sidebar → calendar days**: Each task row in project cards has a drag handle. All 5 day columns (Mon–Fri) are droppable. Updates `date_scheduled` on drop.
- **Drag between calendar days**: CalendarTaskChip made draggable. Drag any task chip from one day column to another.
- **All outstanding tasks shown per project**: Project cards show ALL incomplete tasks (via `getIncompleteTasksForProjectIds`), not just tasks scheduled for current week.

### M17 — Task Detail Overlay ✅
- **Daily + Weekly**: Click task title → opens modal overlay with editable title, project selector, priority toggle, time estimate, notes textarea, play button.
- **Auto-save**: All fields debounce-save at 600ms. No Save/Cancel buttons. Closing flushes pending save.
- **Overlay sizing**: 540px wide, 85vh max height, flex-wrap meta row, `whitespace-nowrap` on dates.

### M18 — TaskCard Redesign ✅
- **Play button**: Replaced "Start" text with round play icon (SVG triangle, centered with `ml-[1px]`).
- **Notes/Edit buttons removed**: Clicking task title opens the detail overlay instead.
- **Title clickable**: Hover shows accent highlight, click fires `onOpenDetail`.
- **Trash icon**: "Del" text replaced with 14px trash SVG. First click arms (turns red), second click within 2s confirms delete.
- **Notes always visible**: Full notes text displayed (no 80-char truncation), `whitespace-pre-wrap`.
- **Worked time display**: Shows "12m / 30m" (worked in accent color / estimated in muted).

### M19 — Color Accent: Purple → Orange → Slate Blue ✅
- **First pass**: Purple `#6b5fd4` → Orange `#e0873e` across 13 UI files (102 occurrences). CSS variables updated.
- **Second pass**: Orange → Slate blue `#7B9ED9` across Daily Plan, TaskCard, DurationPicker, DatePicker, Sidebar, FocusMode. Hover variant `#6889c4`.

### M20 — Daily Plan Improvements ✅
- **Progress bar removed**: Kept planned/worked hour labels.
- **Focus button in header**: Large prominent "Start focusing" / "Focusing..." CTA. Padding 10px 28px, 15px font. Left-aligned on own row.
- **Task input collapses**: Only placeholder + Add button when unfocused. Click expands to reveal project dropdown, time presets, priority toggle.
- **Duration picker redesign**: Quick presets (0m, 15m, 30m, 45m, 1h, 90m) as inline pills. "..." button opens expanded picker with custom input. Overflow fixed with `right-0`.
- **Priority toggle shrunk**: Small, pushed to far right with flex spacer.
- **Project selector**: Changed from click-to-cycle button to proper `<select>` dropdown.
- **Tasks grouped by project**: Section headers with color dot + project name (11px, uppercase, tracking). Tasks under each header.
- **Project name removed from task rows**: `showProject={false}` — already grouped by project.
- **Project group headers clickable**: Click navigates to project detail.
- **Planned/Worked format**: Changed from "1.5h" decimal to "1h 30m" format.
- **Right sidebar panel**: 200px fixed right panel showing active projects with color dot, name, progress bar. Matches left sidebar styling.

### M21 — Projects Page Redesign ✅
- **Grid → list layout**: Full-width rows (white bg, 0.5px border, 10px radius, 14px/16px padding, 6px gap).
- **Row layout**: Top: color dot + name + "3 open · 1 done" + due date. Bottom: 3px progress bar with % label.
- **Due date conditional coloring**: Red if past, amber if within 3 days, muted otherwise.
- **Completed projects**: 55% opacity, inline, shows "Completed [date]".
- **Filter pills**: All / Active / Completed. Selected: blue tint (#EEF3FB bg, #7B9ED9 border, #3D6FCC text). Filters by `project.completed` flag, not task counts.
- **Color bar removed**: Color dot only.
- **"+ New project" button**: Updated to #7B9ED9.
- **Drag-to-reorder**: dnd-kit with `verticalListSortingStrategy`. Persists via `sort_order` column (migration v6).
- **Auto-sort**: Projects with most incomplete tasks appear first when no custom order exists.
- **Archive removed**: Removed archive button, "Show archived" toggle, and all archive UI.

### M22 — Project Completion ✅
- **Manual completion**: "Mark Complete" / "✓ Completed" toggle button on ProjectDetail. `completed` column (migration v7).
- **Completion is manual only**: Task counts don't auto-complete a project. Only explicit user action.
- **Completed projects in weekly planner**: Excluded from auto-shown sidebar. Only non-archived, non-completed projects appear.

### M23 — Weekly Planner: Auto-Show Projects ✅
- **All active projects auto-appear**: Removed pin/unpin system entirely. All non-archived, non-completed projects with incomplete tasks show in left sidebar.
- **Removed all pin UI**: "+ Add" button, "Add all from last week", "Add all active", unpin buttons — all gone.
- **Planned weeks removed from ProjectDetail**: Date range handles scheduling. Pin/unpin section removed.

### M24 — Weekly Shutdown: Two-Column Layout ✅
- **Left column**: Stats cards + Reflections textarea + Carry forward textarea.
- **Right column**: Projects in progress (with carry-forward buttons) + Week summary + Next week preview.
- **Two-step shutdown**: "Start Weekly Shutdown" (subtle) → confirmation panel → "Complete Shutdown" (prominent).

### M25 — Timer Accumulation + Task Time Display ✅
- **Timer continues from accumulated time**: `priorElapsedMs` added to FocusState. When starting focus, queries all prior time entries for the task.
- **Timer display**: Shows total accumulated time (prior + current session). Footer shows both total and current session.
- **Worked time per task**: Each task in daily view shows worked/estimated (e.g., "12m / 30m"). Batch query `getWorkedMinutesForTaskIds`.
- **Both entry points**: DailyPlanner and ProjectDetail both pass prior elapsed time when starting focus.

### M26 — Focus Mode Redesign ✅
- **Top context bar**: Project name with 6px colored dot, centered at top.
- **Task name**: 15px, font-weight 500, muted color. Context, not hero.
- **Timer**: 88px, font-weight 500, letter-spacing -2px. Slate blue when running, muted when paused.
- **State label**: "Running" / "Paused" below timer. 12px, uppercase, neutral.
- **Buttons**: "Stop & save" (secondary), "Resume" (primary blue when paused), "Mark done" (outlined green).
- **Time meta**: Two stat blocks — "Total time on task" and "This session" with 10px uppercase labels and 16px values.
- **Session count**: Bottom of screen, "Session 1 of 4", 11px muted.
- **Chime notification**: Web Audio API two-tone chime (C5→E5) on break prompt and break end.
- **Dot indicators removed**: Replaced by session count.

### M27 — Navigation + Shortcuts ✅
- **"F" key shortcut**: Press F from any page to start focus on next incomplete task for today. Queries today's tasks, finds first non-done, starts with accumulated time.
- **Shortcut glossary**: Collapsible panel at bottom-left of sidebar. Keyboard icon + "Shortcuts" label. Shows all shortcuts with `<kbd>` styled keys.
- **Back button**: Thin bar above page content with "← Back" link. Page history stack (up to 20 entries) in Zustand store. `goBack()` pops history.
- **Keyboard shortcuts updated**: Cmd+1-6 for all pages including Daily Shutdown.

### M28 — Daily Shutdown Page ✅
- **New dedicated page**: `src/pages/DailyShutdown.tsx`. Accessible from sidebar and "Shut Down Day" button on Daily Plan.
- **Active mode**: Stats (tasks completed, time worked), done tasks list, incomplete tasks with "→ Tomorrow" carry-forward, mood emoji selector (5 options: 🔥 Great, 😊 Good, 😐 Okay, 😓 Rough, 😞 Bad), reflection textarea, "Complete Daily Shutdown" button → sunset overlay.
- **Review mode**: Completed shutdowns show read-only summary with saved mood, reflection. "Day complete" badge.
- **Auto-save**: Mood and reflection debounce-save at 600ms to `daily_plans.mood` and `daily_plans.reflection` columns (migration v8). Separate from working notes.
- **Date navigation**: Respects `selectedDate` from store. Can browse past shutdowns.
- **Inline shutdown removed**: DailyPlanner's inline shutdown panel replaced with nav button to the shutdown page.

### UI Polish (misc) ✅
- **Select dropdowns**: Removed native browser gradient. Custom flat appearance with chevron SVG via global CSS.
- **ProjectCard "0" bug**: Fixed `{project.completed && (...)}` rendering `0` for falsy numbers. Changed to `{!!project.completed && (...)}`.

## Key Design Decisions
- **Zero cost** — no external APIs, no cloud services, all data local
- **Priority is binary** — High or default (no 4-level system)
- **Daily shutdown state** — localStorage (`daily-shutdown-{date}`)
- **Weekly shutdown state** — localStorage (`weekly-shutdown-{weekStartDate}`)
- **Checklist state was removed** — replaced by actionable review content
- **Project timelines** — join table approach, pinned vs implicit distinction
- **URL safety** — protocol validation (http/https/mailto/ftp only) at save + render
- **Auto-save pattern** — 600ms debounce with ref-based week/date tracking to avoid stale closures
- **Break time accuracy** — break_seconds column on time_entries, subtracted in worked minutes queries
- **Project completion is manual** — `completed` flag set only by user action, not derived from task counts
- **Archive removed** — Projects only have active/completed states, no archive
- **Timer accumulation** — `priorElapsedMs` in FocusState tracks previously worked time; timer starts from total
- **Accent color: #7B9ED9** (slate blue / Wild Blue Yonder) — applied to all interactive elements
- **Daily shutdown = separate page** — reviewable record with mood + reflection, not just an inline action
- **Mood + reflection separate from notes** — `daily_plans.mood` and `daily_plans.reflection` columns, working notes stay independent
- **Projects auto-show in weekly planner** — no manual pinning; all non-completed active projects appear automatically
- **Date range replaces planned weeks** — `start_date` + `target_date` on projects; weekly_plan_projects table no longer used in UI
- **Task detail overlays auto-save** — no Save/Cancel buttons; 600ms debounce, flush on close
- **Page history stack** — Zustand-managed, up to 20 entries, enables back navigation across all pages
- **Chime via Web Audio API** — no external audio files; two-tone sine wave (C5→E5) generated on demand
- **Manual worked time adjustment** — `setManualWorkedMinutes` creates adjustment time entries; focus mode adds on top
- **PiP command bus** — localStorage-based bidirectional communication between FocusMode and PiP window
- **PiP collapsed/expanded** — hover to reveal controls, auto-collapse after 2s

### M29 — Projects Panel: Show All Active Projects ✅
Right sidebar on Daily Plan now shows all non-completed projects regardless of task count. Progress bars removed — just color dot + name.

### M31 — ProjectDetail Layout: Description Small, Notes Prominent ✅
- Description: shrunk to 1 row, 11px, compact padding, muted styling
- Notes: enlarged to 5 rows, 13px, relaxed leading, more padding — visually dominant

### M32 — Weekly Planner: Full-Height Day Columns ✅
Day columns stretch to fill full screen height. Removed `min-h-[280px]`. Grid uses `items-stretch`.

### M33 — Daily Plan Header: Inline Focus Button ✅
"Start focusing" / "Focusing..." button moved inline with date nav + planned/worked stats. Single compact row.

### Daily Shutdown Fixes ✅
- Removed "Today" and "Day complete" badges from shutdown page
- All controls always interactive (mood, reflection, carry-forward) — no read-only lock
- Fixed dangling ternary syntax error
- Button shows "Save & Shut Down Again" if already completed
- Two-column layout: left (mood + reflection + shutdown button), right (done tasks + incomplete tasks)

### Focus Mode: Task Name Hero ✅
- Task name: 28px, font-weight 600, full color — the hero element
- Timer: shrunk to 36px, secondary to task name
- Max width widened to 560px

### Focus PiP: Full Redesign ✅
- **Collapsed state**: Task name (14px) + session timer (12px) on left, play/pause icon on right. Minimal.
- **Expanded state** (on hover, 150ms slide): Icon row — play/pause, complete (checkmark), stop (square), break (coffee cup with "BREAK" label). Auto-collapses after 2s.
- **Break prompt state**: "Ready for a break?" with Take/5min/10min buttons. Timer visible below.
- **Break countdown state**: Teal #5DCAA5 countdown timer + "End break early" button.
- **Calming sound**: Three-note ascending arpeggio (C4→E4→G4, sine waves) on break prompt and break end.
- **State broadcast**: FocusMode writes `{ elapsed, paused, phase, breakRemaining, taskTitle }` to localStorage. PiP reads at 200ms. Commands flow back via separate key.
- **Commands supported**: pause, done, stop, requestBreak, takeBreak, snooze5, snooze10, noBreak, skipBreak.
- **PiP window**: 260x130px, always-on-top, borderless, corner position.

### Task Time Display: Both Expected + Worked ✅
- Every task shows both times: worked (accent blue) / estimated (muted)
- Format: "12m / 30m" — over budget turns red with bold
- Shows "0m / 30m" when no time worked yet, "12m / —" when no estimate

### Manual Worked Time in Task Detail ✅
- New "Time worked" section in both Daily and Weekly task detail overlays
- Preset pills: 15m, 30m, 45m, 1h, 1h 30m, 2h (blue tint when selected)
- Custom input accepts "1h 30m" / "90m" format
- `setManualWorkedMinutes` query: calculates diff from current worked time, inserts adjustment time entry
- Focus mode picks up manual time — timer continues from total (manual + tracked)

### Vertical Alignment Fix ✅
Today bubble and planned/worked stats aligned with `leading-none` and consistent padding.

### Select Dropdown Styling ✅
Global CSS removes native browser gradient, adds flat appearance with custom chevron SVG.

### PiP: Horizontal Expand + Progress Bar ✅
- Expand direction changed from vertical to horizontal (icons slide in from left)
- Collapsed: 220x56px. Task name + timer anchored right, play/pause icon on far right.
- Expanded: icon controls (play/pause, complete, stop, break) slide in from left, 150ms ease transition.
- Progress bar: 3px flush bottom, no border-radius. With estimate: blue fill, turns coral #D85A30 on overtime. Without estimate: pulsing animation.
- `estimatedMinutes` added to PiP state broadcast.

---

## Upcoming Milestones (Pending Verse Review)

### Wave 1: Quick fixes (no schema changes, minimal risk)

### M38 — Daily Shutdown: Hours/Minutes Format
- Replace decimal hours ("0.7h") with "42m" or "1h 12m" format using `formatHoursMinutes()` helper
- Apply to both stat cards on the daily shutdown page
- Files: `DailyShutdown.tsx`

### M39 — Daily Plan: Swap Planned/Worked Order
- Change header to: Worked first, then Planned ("Worked 1h 30m · Planned 2h")
- Worked is what matters most — it should come first
- Files: `DailyPlanner.tsx` (one line swap)

### M44 — Weekly Shutdown: Fix Missing Shutdown Button
- Verify "Start Weekly Shutdown" → "Complete Shutdown" two-step flow renders without scrolling
- If below fold, make the button sticky at the bottom of the viewport
- Files: `WeeklyShutdown.tsx`

### M45 — Weekly Planner: Narrower Projects Panel
- Reduce left panel from 300px to 240px
- Day columns gain 60px extra width
- Files: `WeeklyPlanner.tsx`

### Wave 2: Visual polish (no schema changes)

### M43 — Pastel Color Palette
- Replace 8 PRESET_COLORS with softer pastel variants (muted blue, soft coral, sage green, warm sand, lavender, blush, sky, stone)
- Update `queries.ts` PRESET_COLORS and `NewProjectPanel.tsx` PANEL_COLORS
- Keep legacy hex values in PRESET_COLORS array for backward compat with existing project data

### M42 — Default Project Color: Auto-Pick Unused
- When creating a project, default to the first PRESET_COLOR not used by any active non-completed project
- Falls back to first color if all taken
- Files: `NewProjectPanel.tsx`, may need to pass active project colors as a prop

### Wave 3: Click targets + UI access patterns

### M34 — Task Detail: Click Title Everywhere
- Weekly shutdown "projects in progress": task titles become clickable → opens task detail overlay
- Project detail page: task titles clickable → opens detail overlay. Remove standalone "Edit" button.
- Consistent pattern: anywhere a task title appears, clicking opens the detail overlay
- Files: `WeeklyShutdown.tsx`, `ProjectDetail.tsx`

### M35 — PiP Lifecycle: Ensure Clean Destruction
- Verify `handleDone` and `handleStop` both trigger PiP close via the existing `useEffect` cleanup
- Add self-close in PiP: if no focus state in localStorage for 2+ seconds, close own window
- Handles edge case of app crash leaving orphan PiP
- Files: `FocusPip.tsx`, `FocusMode.tsx`

### Wave 4: Expandable panels

### M40 — Daily Plan Projects Panel: Expandable with Draggable Tasks
- Each project in the right sidebar becomes expandable (chevron toggle)
- Expanded: shows project's unscheduled + today's tasks
- Tasks are draggable from panel into the main task list (assigns to today)
- Files: `DailyPlanner.tsx` (right sidebar section)

### M41 — Projects Page: Expandable Rows
- Each project row gets an expand toggle (chevron)
- Shows up to 5 open tasks inline when expanded
- Click task → detail overlay. Click project name → project detail page.
- Files: `Projects.tsx`

### Wave 5: Multi-day + recurring (schema changes)

### M37 — Multi-Day Task Spanning
- No schema change needed — time already accumulates across all days via `getWorkedMinutesForTask`
- UI improvement: task detail overlay shows "Worked on: Mon 20m, Tue 15m" breakdown
- Allow re-scheduling tasks day to day without losing accumulated time (already works)
- New query: `getWorkedMinutesByDate(taskId)` to show per-day breakdown
- Files: `queries.ts`, `DailyPlanner.tsx` overlay

### M36 — Repeating/Recurring Tasks
- Migration v9: add `recurrence TEXT` and `recurrence_source_id INTEGER` to tasks table
- Recurrence format: `{"freq":"daily"|"weekly"|"weekdays","day":0-6,"time":"15:00"}`
- Task detail overlay: "Repeat" control — dropdown: None, Daily, Weekdays, Weekly + day picker. Optional time field.
- Generation engine: on daily plan load, for each recurring template, check if an instance exists for that date. If not, create one with `recurrence_source_id` pointing to the template.
- Completing an instance doesn't affect future instances
- Files: `lib.rs` (migration), `types/index.ts`, `queries.ts`, `DailyPlanner.tsx`, task detail overlay in both Daily + Weekly

### Execution Order (M34–M45)
M38 → M39 → M44 → M45 → M43 → M42 → M34 → M35 → M40 → M41 → M37 → M36

### Post-wave milestones (M46–M64) — all completed 2026-03-19
- M46: "Shut Down" → "Shutdown" text fix
- M47: Smart time parsing from task titles (shared util)
- M48: Weekly planner panel 240→280px
- M49: Weekly planner "Unassigned" section for no-project tasks
- M50: Weekly shutdown button visibility fix
- M51: Daily shutdown layout restructure (left=reflection, right=stats+tasks)
- M52: Sentence case for all buttons
- M53: Weekly shutdown buttons orange→blue
- M54: Remove "This week"/"Week complete" pills from weekly shutdown
- M55: Remove left overflow panel, move overdue/unscheduled to right sidebar
- M56: Remove overdue section, merge into project groups
- M57: PiP expand direction left→right
- M58: PiP collapse on cursor leave (verified)
- M59: PiP visibility cleanup (verified, Tauri API fix)
- M60: Daily wrap-up reminder at 4:30 PM
- M61: Remove "No project" from weekly shutdown
- M62: Task detail date field shows "—" when empty
- M63: Daily shutdown redesign (slate blue accent, tinted header, two-column)
- M64: Weekly shutdown redesign (teal accent, mood selector, migration v10, per-project notes)
