use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create initial tables",
            sql: "
                CREATE TABLE IF NOT EXISTS projects (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    color TEXT NOT NULL DEFAULT '#6366f1',
                    archived INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS objectives (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
                    title TEXT NOT NULL,
                    description TEXT,
                    status TEXT NOT NULL DEFAULT 'active',
                    target_date TEXT,
                    notes TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS tasks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
                    objective_id INTEGER REFERENCES objectives(id) ON DELETE SET NULL,
                    title TEXT NOT NULL,
                    description TEXT,
                    priority TEXT NOT NULL DEFAULT 'medium',
                    status TEXT NOT NULL DEFAULT 'todo',
                    estimated_minutes INTEGER,
                    date_scheduled TEXT,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    notes TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS time_entries (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                    start_time TEXT NOT NULL,
                    end_time TEXT,
                    entry_type TEXT NOT NULL DEFAULT 'tracked'
                );

                CREATE TABLE IF NOT EXISTS daily_plans (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    date TEXT NOT NULL UNIQUE,
                    notes TEXT,
                    hour_budget REAL NOT NULL DEFAULT 8.0
                );

                CREATE TABLE IF NOT EXISTS weekly_plans (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    week_start_date TEXT NOT NULL UNIQUE,
                    focus_areas TEXT,
                    notes TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS weekly_shutdowns (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    week_start_date TEXT NOT NULL UNIQUE,
                    reflections TEXT,
                    incomplete_items TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS shutdown_checklist_items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    label TEXT NOT NULL,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    is_default INTEGER NOT NULL DEFAULT 1
                );

                CREATE TABLE IF NOT EXISTS links (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    entity_type TEXT NOT NULL,
                    entity_id INTEGER NOT NULL,
                    url TEXT NOT NULL,
                    label TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                -- Seed default shutdown checklist
                INSERT INTO shutdown_checklist_items (label, sort_order) VALUES
                    ('Review completed tasks', 1),
                    ('Process incomplete tasks', 2),
                    ('Review next week''s calendar', 3),
                    ('Update objectives', 4),
                    ('Clear inbox', 5),
                    ('Write weekly reflection', 6);
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add description, target_date, notes to projects; remove objectives dependency",
            sql: "
                ALTER TABLE projects ADD COLUMN description TEXT;
                ALTER TABLE projects ADD COLUMN target_date TEXT;
                ALTER TABLE projects ADD COLUMN notes TEXT;

                -- Update shutdown checklist seed
                UPDATE shutdown_checklist_items SET label = 'Update projects' WHERE label = 'Update objectives';
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "add break_seconds to time_entries for accurate work time",
            sql: "
                ALTER TABLE time_entries ADD COLUMN break_seconds INTEGER NOT NULL DEFAULT 0;
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "add weekly_plan_projects join table for project timelines",
            sql: "
                CREATE TABLE IF NOT EXISTS weekly_plan_projects (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    week_start_date TEXT NOT NULL,
                    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    UNIQUE(week_start_date, project_id)
                );
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "add start_date to projects for date ranges",
            sql: "
                ALTER TABLE projects ADD COLUMN start_date TEXT;
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "add sort_order to projects for custom ordering",
            sql: "
                ALTER TABLE projects ADD COLUMN sort_order INTEGER;
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "add completed flag to projects",
            sql: "
                ALTER TABLE projects ADD COLUMN completed INTEGER NOT NULL DEFAULT 0;
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "add mood and reflection to daily_plans for daily shutdown",
            sql: "
                ALTER TABLE daily_plans ADD COLUMN mood TEXT;
                ALTER TABLE daily_plans ADD COLUMN reflection TEXT;
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "add recurrence and recurrence_source_id to tasks for recurring tasks",
            sql: "
                ALTER TABLE tasks ADD COLUMN recurrence TEXT;
                ALTER TABLE tasks ADD COLUMN recurrence_source_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL;
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "add mood to weekly_shutdowns",
            sql: "
                ALTER TABLE weekly_shutdowns ADD COLUMN mood TEXT;
            ",
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:verseday.db", migrations)
                .build(),
        )
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
