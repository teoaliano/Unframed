import type { DatabaseSync } from "node:sqlite";

export const createInstanceTables = (db: DatabaseSync): void => {
  db.exec(`
    CREATE TABLE instances (
      id TEXT PRIMARY KEY,
      branch TEXT NOT NULL,
      base_ref TEXT NOT NULL,
      base_commit TEXT NOT NULL,
      worktree TEXT NOT NULL,
      installed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      removed_at TEXT
    );
  `);
};

export interface StoredInstance {
  readonly id: string;
  readonly branch: string;
  readonly baseRef: string;
  readonly baseCommit: string;
  readonly worktree: string;
  readonly installed: boolean;
  readonly createdAt: string;
  readonly removedAt: string | null;
}

const asStored = (row: Record<string, unknown>): StoredInstance => ({
  id: String(row.id),
  branch: String(row.branch),
  baseRef: String(row.base_ref),
  baseCommit: String(row.base_commit),
  worktree: String(row.worktree),
  installed: Number(row.installed) === 1,
  createdAt: String(row.created_at),
  removedAt: row.removed_at === null || row.removed_at === undefined ? null : String(row.removed_at),
});

export const readInstances = (db: DatabaseSync): StoredInstance[] =>
  db
    .prepare("SELECT id, branch, base_ref, base_commit, worktree, installed, created_at, removed_at FROM instances ORDER BY created_at, rowid")
    .all()
    .map((row) => asStored(row));

export const insertInstance = (db: DatabaseSync, instance: StoredInstance): void => {
  db.prepare("INSERT INTO instances (id, branch, base_ref, base_commit, worktree, installed, created_at, removed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    instance.id,
    instance.branch,
    instance.baseRef,
    instance.baseCommit,
    instance.worktree,
    instance.installed ? 1 : 0,
    instance.createdAt,
    instance.removedAt,
  );
};

export const markInstalled = (db: DatabaseSync, id: string): void => {
  db.prepare("UPDATE instances SET installed = 1 WHERE id = ?").run(id);
};

export const markRemoved = (db: DatabaseSync, id: string, at: string): void => {
  db.prepare("UPDATE instances SET removed_at = ? WHERE id = ?").run(at, id);
};
