# Verseday

A personal focus and time-tracking desktop app for macOS — plan your day, run a focus timer that
tracks real worked time, and close out with a daily shutdown ritual.

## Features

- **Daily planner** — schedule tasks for the day, drag to reorder, quick-add from anywhere.
- **Focus mode** — a full-screen focus timer that tracks worked time per task down to the second,
  with a floating picture-in-picture timer, break controls, and meeting-aware behavior.
- **Projects (objectives)** — group tasks under projects with custom icons and per-project views.
- **Weekly plan** — lay out the week and map tasks to days.
- **Dashboard** — worked-vs-planned time charts and trends.
- **Daily shutdown** — an end-of-day review; browse past shutdowns.
- **Recurring tasks** — daily/weekly/monthly repeats with template edits that propagate to future
  instances.
- **Rich-text notes** — inline task notes with links (TipTap), including tidy link pills.
- **Notifications & reminders** — native notifications that jump you straight to the relevant task.

## Stack

- [Tauri 2](https://tauri.app) (Rust shell) + **React** + **TypeScript**
- **Zustand** for state, canonical stores reconciled against SQLite
- **SQLite** via `@tauri-apps/plugin-sql` (versioned migrations)
- **TipTap** for rich-text notes, **@dnd-kit** for drag-and-drop

## Development

```sh
npm install
npm run tauri dev        # run the app in dev
npm run tauri build      # produce a release build / .app
npm run lint             # lint
npm test                 # tests
```

### Requirements

- [Rust](https://www.rust-lang.org/tools/install) (stable) + Xcode command-line tools
- Node.js 18+

## Notes

A personal project. Data lives in a local SQLite database on your machine; nothing is synced to a
server. Database migrations are append-only — once a migration's SQL has been applied anywhere, its
bytes are frozen and schema changes go in the next migration.
