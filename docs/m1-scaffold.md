# M1: Scaffold — Decision Log

## Decisions
- **Tauri v2** chosen over Electron for smaller binary size and native performance
- **SQLite** via `tauri-plugin-sql` for zero-config local storage
- **TailwindCSS v4** with Vite plugin (no config file needed)
- **Zustand** for lightweight state management
- **Dark theme** as default — matches developer tooling aesthetic
- Window size set to 1200x800 for comfortable planning layout

## What was built
- Tauri + React + TypeScript project structure
- SQLite database with full schema (9 tables): projects, objectives, tasks, time_entries, daily_plans, weekly_plans, weekly_shutdowns, shutdown_checklist_items, links
- Sidebar navigation with all planned pages
- Daily Planner page (functional): date nav, add tasks, toggle completion, hour budget bar with overcommitment alert
- Placeholder pages for remaining milestones
- Database query layer (`db/queries.ts`) with core CRUD operations
- TypeScript types for all entities

## What's next
- M2: Projects CRUD UI
