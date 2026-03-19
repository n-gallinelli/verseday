# M3: Objectives CRUD — Decision Log

## Decisions
- Objectives are linked to projects (optional) and can be filtered by project
- Status model: active → paused ↔ active → completed (can reopen completed)
- Delete shows task count warning, same pattern as project delete
- Notes field supports freeform text (markdown-intended), expandable on click to keep list compact
- Description is a short summary, notes are for longer-form content
- Input validation: title max 200, description max 1000, notes max 5000
- Filter bar: status filter (active+paused vs all) + project filter

## What was built
- Objectives page: create, inline edit, status toggle (active/paused/completed/reopen), delete with dependency warning
- Objective queries: getObjectives (with project + status filtering), createObjective, updateObjective, updateObjectiveStatus, deleteObjective, getObjectiveTaskCount
- Create form: title, project selector, target date, description, notes
- Expandable notes section per objective
- Keyboard support: Escape to cancel edit
- Shared ErrorBanner component used

## What's next
- M4: Tasks CRUD + link to projects & objectives
