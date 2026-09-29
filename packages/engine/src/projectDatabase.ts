import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { UnframedError, unframedError } from "@unframed/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { createCanvasChangesTable, createSyncStorageTables } from "./canvas/tables.ts";
import { createChatTables } from "./agent/chatTables.ts";
import { ImportFailed, makeLegacyImporter, type ImportState } from "./legacy/importer.ts";
import { createLegacyImportReportTable } from "./legacy/reportTable.ts";
import { errorText } from "./log.ts";
import { OpenProjects } from "./openProjects.ts";
import { Config } from "./services.ts";
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

/** The one ordered list. Every table a later spec adds to the project database is a migration here. */
export const MIGRATIONS: ReadonlyArray<Migration> = [
  { id: 1, name: "tldraw sync storage", up: createSyncStorageTables },
  { id: 2, name: "canvas_changes", up: createCanvasChangesTable },
  { id: 3, name: "chat store and turn_changes", up: createChatTables },
  { id: 4, name: "legacy_import_report", up: createLegacyImportReportTable },
];

/** `UNFRAMED_TEST_MIGRATION`'s extra migration, numbered far past any real one. */
const TEST_MIGRATION_ID = 1_000_000;

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
    /** How the project folder's import from the old app stands (spec 11), without starting it. */
    readonly importState: (project: string) => Effect.Effect<ImportState>;
    /** Forgets a failed import, so the next `open` runs it again. */
    readonly retryImport: (project: string) => Effect.Effect<void>;
  }
>()("unframed/engine/ProjectDatabase") {}

export const projectDatabaseLayer = Layer.effect(
  ProjectDatabase,
  Effect.gen(function* () {
    const config = yield* Config;
    const settings = yield* SettingsStore;
    const openProjects = yield* OpenProjects;
    const migrations: ReadonlyArray<Migration> =
      config.testMigrationSql === undefined
        ? MIGRATIONS
        : [...MIGRATIONS, { id: TEST_MIGRATION_ID, name: "test migration", up: (db) => db.exec(config.testMigrationSql!) }];
    // By file, not by name: after an output folder change the same name is another project.
    const handles = new Map<string, ProjectDb>();
    const importer = makeLegacyImporter({
      migrate: (db) => void applyMigrations(db, migrations),
      outputDir: () => Effect.runPromise(settings.outputDir),
      defaults: () => Effect.runPromise(Effect.map(settings.read, (live) => ({ image: live.imageModel, video: live.videoModel, text: live.textModel }))),
    });
    const folderOf = (project: string) => Effect.map(settings.outputDir, (outputDir) => join(outputDir, project));

    const open = (project: string) =>
      Effect.gen(function* () {
        const folder = yield* folderOf(project);
        const path = join(folder, DATABASE_FILE);
        const cached = handles.get(path);
        if (cached) return cached;
        // Spec 11: a folder that still holds an old graph is imported before its file is first created.
        yield* Effect.tryPromise({
          try: () => importer.ensure(folder, project),
          catch: (error) =>
            error instanceof ImportFailed
              ? unframedError("internal", error.message, { reason: "legacy_import" })
              : unframedError("internal", `Could not open the project database: ${errorText(error)}`),
        });
        const handle = yield* Effect.try({
          try: () => {
            const opened = handles.get(path);
            if (opened) return opened;
            const db = new DatabaseSync(path);
            try {
              db.exec("PRAGMA journal_mode = WAL");
              db.exec("PRAGMA busy_timeout = 5000");
              db.exec("PRAGMA foreign_keys = ON");
              applyMigrations(db, migrations);
            } catch (error) {
              db.close();
              throw error;
            }
            return { project, path, db } satisfies ProjectDb;
          },
          catch: (error) => unframedError("internal", `Could not open the project database: ${errorText(error)}`),
        });
        if (handles.get(path) === handle) return handle;
        handles.set(path, handle);
        yield* openProjects.register(
          project,
          "project database",
          Effect.sync(() => {
            if (handles.get(path) === handle) handles.delete(path);
            if (handle.db.isOpen) handle.db.close();
          }),
        );
        return handle;
      });

    return ProjectDatabase.of({
      open,
      importState: (project) => Effect.map(folderOf(project), (folder) => importer.state(folder)),
      retryImport: (project) => Effect.map(folderOf(project), (folder) => importer.forgetFailure(folder)),
    });
  }),
);
