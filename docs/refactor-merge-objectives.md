# Refactor: Merge Objectives into Projects

## Why
Objectives and projects were redundant — both served as containers for tasks. Merging simplifies the data model to: Projects → Tasks → Time Entries.

## What changed
- Removed Objectives page, queries, and type from active code
- Objectives table remains in DB (no destructive migration) but is unused
- Projects gained: description, target_date, notes columns (migration v2)
- New ProjectDetail page: view/edit project info + manage tasks directly
- Projects list page: click project name to open detail view
- Sidebar: removed Objectives nav item
- DailyPlanner: removed objective selectors from create/edit forms
- TaskCard: removed objective display
- updateProject refactored to accept UpdateProjectInput object
- getProjectDependencyCount simplified to getProjectTaskCount
- New query: getTasksForProject (with show/hide done filter)

## Files removed
- src/pages/Objectives.tsx

## Files added
- src/pages/ProjectDetail.tsx

## Data model after refactor
Projects (with description, target_date, notes) → Tasks → Time Entries
