# Changelog

## Session — 2026-05-06

### Focus pip — drop progress bar
- Removed the bottom progress line (both the elapsed-vs-estimate fill
  and the no-estimate `pipPulse` sliding bar). The pip now relies on
  the existing 0.5px border + 18px radius for visual containment.
- Files: `src/components/FocusPip.tsx`

## Session — 2026-04-06

### AI-powered summaries + task highlights
- **Highlight stars**: completed tasks in Daily Shutdown can be starred as highlights (max 3). Gold star SVG, persisted via `is_highlight` column on tasks
- **Summary generation**: Claude API integration via Rust backend (`reqwest`). Tauri command `generate_summary` handles the HTTP call — API key never touches frontend JS
- **Audience profiles**: 3 hardcoded profiles (Cam, Dan, Nick) based on enneagram scores. Each profile has a tailored system prompt controlling tone and structure
  - Cam (default): Type 3 Achiever — results-first bullets, planned-vs-delivered
  - Dan: Type 8 Challenger — bold/direct, momentum-focused
  - Nick: Type 7 Enthusiast — narrative arc, insights, purpose-connected
- **SummaryOverlay component**: modal with audience pill selector, loading/error/success states, copy-to-clipboard, inline API key setup (type=password)
- **Daily Shutdown**: "Generate summary" button in footer, sends highlights + completed/incomplete tasks + worked time + mood + reflection
- **Daily Planner**: "Summarize plan" link in header stats bar, sends planned tasks + estimates + projects + notes
- **Schema**: migration v12 adds `is_highlight INTEGER` on tasks + `settings` table for API key storage
- **Weekly shutdown summary**: "Generate summary" button on weekly shutdown. Aggregates per-project progress (completed/incomplete counts, time worked) rather than listing every task. Same audience selector and overlay
- Files: `commands.rs` (new), `summaryPrompts.ts` (new), `summaryApi.ts` (new), `SummaryOverlay.tsx` (new), `lib.rs`, `Cargo.toml`, `types/index.ts`, `queries.ts`, `DailyShutdown.tsx`, `DailyPlanner.tsx`, `WeeklyShutdown.tsx`

### Settings page
- **New page**: Settings accessible from sidebar (gear icon)
- **Focus timer config**: Work duration, short break, long break, cycles before long break — all configurable, stored in `settings` table, loaded on focus start
- **API key management**: Enter/change/remove OpenAI API key. Shows configured/not-configured status badge
- Files: `Settings.tsx` (new), `FocusMode.tsx`, `Sidebar.tsx`, `App.tsx`, `types/index.ts`

### Weekly shutdown cleanup
- Removed "Next week" preview card (Mon–Fri dot grid) from right column
- Removed related state, queries, and derived data (`nextWeekTasks`, `nextWeekPlanned`, etc.)
- Files: `WeeklyShutdown.tsx`

### Projects page — UI overhaul
- **Left color bar**: 4px project color bar on left edge of each card (kanban-style visual identity)
- **Task count chip**: "X open ▸" pill replaces hidden chevron — communicates task count and acts as expand trigger
- **Inline project creation**: "New project..." input row at bottom of list — type name, press Enter, auto-picks unused color. Removed NewProjectPanel dependency
- **Completed project styling**: Checkmark icon + strikethrough name instead of just opacity dimming
- **Filter counts**: "All 12 · Active 8 · Completed 4" — counts shown in each filter pill
- **Search**: Search input in header bar, filters projects by name in real-time. Contextual empty state for no matches
- **Due date subtitle**: Target date shown under project name with color coding (red=overdue, orange=soon, gray=future)
- **Hover quick-action menu**: Three-dot menu on hover with Edit / Mark complete / Archive
- Files: `Projects.tsx`

### Project Detail — accent color + polish pass
- **Orange → slate blue (#6B84A3)**: Add button, focus ring, link color, inline edit borders all switched
- **Priority colors**: High = `#C97B5A` (terracotta), no more saturated red
- **Mark Complete button**: Restyled from ghost to filled (`#6B84A3` white text)
- **Task add row**: Now framed with border + border-radius for clear input area
- **Section padding**: DESCRIPTION, DATES, NOTES standardized to 16px vertical padding
- **Completed checkbox**: Green `#6A9E7F` instead of orange
- **Delete button**: Softened to `#C0614A`
- Files: `ProjectDetail.tsx`

### Task Detail Modal — polish pass
- **Checkbox**: Standardized to green `#6A9E7F`
- **Unified pill styling**: All meta row elements (project, date, priority, time) use consistent `border-black/[0.12] rounded-[6px] px-[10px]`
- **Priority colors**: High = `#C97B5A` (terracotta dot + text), Medium = `#BBBBBB` dot
- **Date field**: Shows "No date" instead of "—" when empty
- **Notes background**: `#F4F4F1` with border for deliberate inset
- **Delete task color**: Softened to `#C0614A`
- Files: `TaskDetailOverlay.tsx`

### Priority removal
- Removed priority toggle from task creation (DailyPlanner, ProjectDetail)
- Removed priority display from TaskCard (red dot) and ProjectDetail task rows
- Removed priority button from TaskDetailOverlay meta row
- Type changed from union to `string` for backward compat with existing DB data
- Files: `types/index.ts`, `TaskDetailOverlay.tsx`, `ProjectDetail.tsx`, `DailyPlanner.tsx`, `TaskCard.tsx`

### Settings page — stepper buttons + polish
- Added +/- stepper buttons flanking each focus timer number input
- Added "Reset to defaults" link (only visible when values differ from defaults)
- Added section icons (timer, key) for visual anchoring
- Files: `Settings.tsx`

### Task Detail — worked-on redesign + trash icon
- **Worked on section**: Redesigned from flat text to **day pills** with proportional blue bars showing relative time per day
- **Delete task**: Replaced text link with a trash can SVG icon (same soft red `#C0614A`)
- Now shows worked-on section even for single-day tasks (was hidden unless 2+ days)
- Files: `TaskDetailOverlay.tsx`

### Project Detail — font uniformity
- Standardized all section labels to `10px` uppercase tracking
- Standardized all body/input text to `13px`
- Start/Due labels bumped to `12px` for readability
- Color picker dot enlarged from 9px to 12px with hover ring
- Files: `ProjectDetail.tsx`

### Sidebar — Daily Shutdown icon
- Replaced abstract icon with a clock face showing hands at 4:30 position
- Files: `Sidebar.tsx`

### Mood order reversed (both shutdowns)
- Bad (left) → Rough → Okay → Good → Great (right)
- More natural left-to-right progression from negative to positive
- Files: `DailyShutdown.tsx`, `WeeklyShutdown.tsx`

### Project Detail as modal
- Converted from full-page to a **720px modal overlay** rendered on top of the current page
- Click backdrop or press Escape to close, returns to previous page
- Removed ProjectSwitcher right sidebar (close modal to switch projects)
- Added close button (✕) in the project header
- Added **flush-on-close**: debounced edits save immediately before unmount
- **Escape key isolation**: TaskDetailOverlay now stops propagation on Escape so inner modal closes first
- Files: `ProjectDetail.tsx`, `App.tsx`, `TaskDetailOverlay.tsx`

### Custom CalendarPicker component
- Replaced all native `<input type="date">` with a **custom calendar popover**
- 280px min-width, white card with shadow, 36x36px day cells, rounded
- Month/year header with ← → navigation arrows
- Today and selected date shown as slate blue filled circles with white text
- Day-of-week row in uppercase gray
- Used in ProjectDetail task-add row and TaskDetailOverlay date field
- Files: `CalendarPicker.tsx` (new), `ProjectDetail.tsx`, `TaskDetailOverlay.tsx`

### Task ordering fix
- New tasks now append at the bottom (not top) via `MAX(sort_order) + 1`
- Null-safe: scopes to project_id if set, else date_scheduled, else global
- Files: `queries.ts`

### Focus Landing page
- **New sidebar page** at top of Planning section (crosshair icon)
- Shows "Next up" card with task title, project, estimate, and large "Start focusing" button
- Lists remaining tasks below with hover-to-start
- Empty state for no tasks / all tasks done
- Clicking Start launches the existing FocusMode timer
- Focus Mode now highlights "Focus" in sidebar (not Daily Plan)
- Files: `FocusLanding.tsx` (new), `Sidebar.tsx`, `App.tsx`, `types/index.ts`

### App icon template
- Created SVG template (`src-tauri/icons/app-icon.svg`) using app colors: off-white `#f5f4f0` bg, blue `#7B9ED9` V letterform, slate `#6B84A3` accent dot
- Export to PNG at required sizes to replace default Tauri icons

## Session — 2026-03-25

### Focus screen redesign
- **Timer**: counts up showing total time worked on the task across all sessions. Sub-label shows "of X:XX" (estimated time), "worked" (no estimate), "paused", or "break"
- **Progress arc**: 7px stroke SVG circle, fills based on worked time vs estimated time. Muted blue `#7B9ED9`, green `#4a9e6e` during breaks
- **Breathing glow**: duplicate 14px arc on a `<div>` wrapper (WebKit SVG transform workaround), pulsing opacity 0.2→0.6 and scale 1.0→1.06 on 4s loop. Stops when paused
- **Ambient background**: 25-minute CSS animation from cool blue-neutral to warm amber-neutral
- **Notes panel**: always-visible textarea between title and arc, auto-saves on blur (debounced 600ms), minimal borderless styling
- **Icon buttons**: checkmark (done), pause bars/play triangle, stop square — horizontal row with done as the large center button
- **Removed**: "RUNNING" label, time stats, session indicators, "Session X of Y"
- Files: `FocusMode.tsx`, `queries.ts` (`updateTaskNotes`), `index.css` (keyframes)

### Unfinished task rollover
- **Auto-rollover**: unfinished tasks from previous days automatically move to today on daily planner load (guarded to today only, not navigated dates)
- **4-day limit**: `rollover_count` increments each day; after 4 rollovers the task is unscheduled (`date_scheduled = null`) and drops to the Unscheduled bucket
- **original_date**: preserved on first rollover to track where the task was originally scheduled
- **Sidebar section**: "Unfinished" collapsible always visible at ~66% down the right panel, powered by `getUnfinishedRolloverTasks()` query. Shows amber "Xd" badge per task, count in header, clickable to open detail overlay. Shows "All caught up" when empty
- **Schema**: migration v11 adds `original_date TEXT` and `rollover_count INTEGER DEFAULT 0` to tasks
- Files: `lib.rs` (migration), `types/index.ts`, `queries.ts` (2 new functions), `DailyPlanner.tsx`

### Expand/collapse arrows — app-wide
- Bumped all `▸`/`▾` arrows from 9–11px to 18px with `leading-none` for vertical alignment
- Widened hitboxes (`w-3`→`w-5`, ProjectCard `w-6`→`w-7`)
- Sidebar shortcuts arrow changed from `▾`+rotate(180°) to `▸`+rotate(90°) for consistency
- Files: `DailyPlanner.tsx`, `Projects.tsx`, `WeeklyPlanner.tsx`, `Sidebar.tsx`, `ProjectCard.tsx`

### Task checkbox redesign
- **Not done**: gray checkmark SVG (`rgba(0,0,0,0.15)`) inside subtle bordered box
- **Done**: green background (`#4a9e6e`) with white checkmark SVG
- File: `TaskCard.tsx`

### Projects — completed tasks visible
- **Projects page**: expanded project cards now load all tasks including completed (removed 5-task limit). Done tasks show green checkmark + strikethrough below incomplete tasks
- **Project detail**: `showDone` defaults to `true` so completed tasks appear on first load
- Files: `Projects.tsx`, `ProjectDetail.tsx`

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
