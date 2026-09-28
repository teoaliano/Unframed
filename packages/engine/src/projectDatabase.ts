import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { UnframedError, unframedError } from "@unframed/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { errorText } from "./log.ts";
import { OpenProjects } from "./openProjects.ts";
import { SettingsStore } from "./settingsStore.ts";

export const DATABASE_FILE = "unframed.sqlite";

/**
 * One numbered migration. A persisted row must stay readable by every later version, so
 * a migration adds tables and optional columns and never renames or drops them.
 */
export interface Migration {
  readonly id: number;
  readonly name: string;
  readonly up: (db: DatabaseSync) => void;
}

/**
 * The one ordered list. Later specs add their tables here by name: tldraw sync storage
 * and `canvas_changes` (02), the orchestration and projection tables and `turn_changes`
 * (07), `legacy_import_report` (11).
 */
export const MIGRATIONS: ReadonlyArray<Migration> = [];

/** Applies every migration not yet recorded, each once inside its own transaction. */
export const applyMigrations = (db: DatabaseSync, migrations: ReadonlyArray<Migration> = MIGRATIONS): number => {
  db.exec(
    "CREATE TABLE IF NOT EXISTS unframed_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)",
  );
  const applied = new Set(
    db
      .prepare("SELECT id FROM unframed_migrations")
      .all()
      .map((row) => Number(row.id)),
  );
  let count = 0;
  for (const migration of [...migrations].sort((a, b) => a.id - b.id)) {
    if (applied.has(migration.id)) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      migration.up(db);
      db.prepare("INSERT INTO unframed_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(
        migration.id,
        migration.name,
        new Date().toISOString(),
      );
      db.exec("COMMIT");
      count++;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  return count;
};

export interface ProjectDb {
  readonly project: string;
  readonly path: string;
  readonly db: DatabaseSync;
}

/**
 * The only code that opens a project's `unframed.sqlite`. Every other module that needs
 * the file asks this one; none opens it itself or keeps a second SQLite file in the
 * project folder.
 */
export class ProjectDatabase extends Context.Service<
  ProjectDatabase,
  {
    /** The project's handle, opened (and the file created and migrated) on first use. `project` is a slug. */
    readonly open: (project: string) => Effect.Effect<ProjectDb, UnframedError>;
  }
>()("unframed/engine/ProjectDatabase") {}

export const projectDatabaseLayer = Layer.effect(
  ProjectDatabase,
  Effect.gen(function* () {
    const settings = yield* SettingsStore;
    const openProjects = yield* OpenProjects;
    const handles = new Map<string, ProjectDb>();

    const open = (project: string) =>
      Effect.gen(function* () {
        const cached = handles.get(project);
        if (cached) return cached;
        const path = join(yield* settings.outputDir, project, DATABASE_FILE);
        const handle = yield* Effect.try({
          try: () => {
            const db = new DatabaseSync(path);
            try {
              db.exec("PRAGMA journal_mode = WAL");
              db.exec("PRAGMA busy_timeout = 5000");
              db.exec("PRAGMA foreign_keys = ON");
              applyMigrations(db);
            } catch (error) {
              db.close();
              throw error;
            }
            return { project, path, db } satisfies ProjectDb;
          },
          catch: (error) => unframedError("internal", `Could not open the project database: ${errorText(error)}`),
        });
        handles.set(project, handle);
        yield* openProjects.register(
          project,
          "project database",
          Effect.sync(() => {
            if (handles.get(project) === handle) handles.delete(project);
            if (handle.db.isOpen) handle.db.close();
          }),
        );
        return handle;
      });

    return ProjectDatabase.of({ open });
  }),
);
