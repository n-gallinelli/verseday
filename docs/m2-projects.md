# M2: Projects CRUD — Decision Log

## Decisions
- 8 preset colors for project color picker (covers common palette without a full color picker dependency)
- Delete requires confirmation click (two-step) to prevent accidents
- Archived projects are hidden by default, toggled with a checkbox
- Project color dot shown inline on task cards in Daily Planner
- Project selector dropdown added to task creation form

## What was built
- Projects page: create, edit (name + color), archive/restore, delete with confirmation
- Project queries: updateProject, archiveProject, deleteProject, getProjectById
- Daily Planner updated: project selector on add-task form, project color dot + name on task cards
- ESLint + Prettier configured (Verse review item #6)
- All Verse must-fix items addressed: CSP enabled, error handling, input validation

## What's next
- M3: Objectives CRUD (linked to projects)
