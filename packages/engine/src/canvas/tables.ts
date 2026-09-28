import type { DatabaseSync } from "node:sqlite";

/** tldraw's SQLite sync storage keeps its tables under this prefix in the project database. */
export const SYNC_TABLE_PREFIX = "tldraw_";

/**
 * tldraw's sync storage tables, as its own storage migration 3 leaves them. The metadata
 * row's empty schema means "never initialised", so the room seeds the starter content the
 * first time it opens, and tldraw's own migrations continue from version 3.
 */
export const createSyncStorageTables = (db: DatabaseSync): void => {
  const p = SYNC_TABLE_PREFIX;
  db.exec(`
    CREATE TABLE ${p}documents (
      id TEXT PRIMARY KEY,
      state BLOB NOT NULL,
      lastChangedClock INTEGER NOT NULL
    );
    CREATE INDEX idx_${p}documents_lastChangedClock ON ${p}documents(lastChangedClock);
    CREATE TABLE ${p}tombstones (
      id TEXT PRIMARY KEY,
      clock INTEGER NOT NULL
    );
    CREATE INDEX idx_${p}tombstones_clock ON ${p}tombstones(clock);
    CREATE TABLE ${p}metadata (
      migrationVersion INTEGER NOT NULL,
      documentClock INTEGER NOT NULL,
      tombstoneHistoryStartsAtClock INTEGER NOT NULL,
      schema TEXT NOT NULL
    );
    INSERT INTO ${p}metadata (migrationVersion, documentClock, tombstoneHistoryStartsAtClock, schema) VALUES (3, 0, 0, '');
    CREATE TABLE ${p}objects (
      id TEXT PRIMARY KEY,
      state BLOB NOT NULL,
      lastChangedClock INTEGER NOT NULL
    );
    CREATE INDEX idx_${p}objects_lastChangedClock ON ${p}objects(lastChangedClock);
  `);
};

/**
 * The one canvas change log: every change the room commits, with who asked for it.
 * Spec 07 reads it and adds none of its own. It is never truncated.
 */
export const createCanvasChangesTable = (db: DatabaseSync): void => {
  db.exec(`
    CREATE TABLE canvas_changes (
      clock INTEGER PRIMARY KEY,
      origin_kind TEXT NOT NULL,
      origin_id TEXT NOT NULL,
      at TEXT NOT NULL,
      put TEXT NOT NULL,
      removed TEXT NOT NULL
    );
    CREATE INDEX idx_canvas_changes_origin ON canvas_changes(origin_kind, clock);
  `);
};
