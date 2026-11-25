import type { DatabaseSync } from "node:sqlite";
import { RepositorySetup, StoredRepositoryStatus, type ProjectKind, type StoredRepositoryStatus as StoredStatus } from "@unframed/contracts";
import { projectKindOf } from "@unframed/domain";
import * as Schema from "effect/Schema";

export const createRepositoryTables = (db: DatabaseSync): void => {
  db.exec(`
    CREATE TABLE project_info (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      kind TEXT NOT NULL
    );
    CREATE TABLE repository (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      root TEXT NOT NULL,
      git_common_dir TEXT NOT NULL,
      base_branch TEXT NOT NULL,
      status TEXT NOT NULL,
      setup TEXT,
      added_at TEXT NOT NULL
    );
  `);
};

export const addSetupChatColumn = (db: DatabaseSync): void => {
  db.exec("ALTER TABLE repository ADD COLUMN setup_chat TEXT");
};

export interface StoredRepository {
  readonly root: string;
  readonly gitCommonDir: string;
  readonly baseBranch: string;
  readonly status: StoredStatus;
  readonly setup: RepositorySetup | null;
  readonly addedAt: string;
  readonly setupChat: string | null;
}

const decodeStatus = Schema.decodeUnknownOption(StoredRepositoryStatus);
const decodeSetup = Schema.decodeUnknownOption(RepositorySetup);

const parsedSetup = (text: unknown): RepositorySetup | null => {
  if (typeof text !== "string") return null;
  try {
    const decoded = decodeSetup(JSON.parse(text));
    return decoded._tag === "Some" ? decoded.value : null;
  } catch {
    return null;
  }
};

export const readKind = (db: DatabaseSync): ProjectKind => {
  try {
    return projectKindOf(db.prepare("SELECT kind FROM project_info WHERE id = 1").get()?.kind);
  } catch {
    return "whiteboard";
  }
};

export const readRepository = (db: DatabaseSync): StoredRepository | undefined => {
  const row = db.prepare("SELECT root, git_common_dir, base_branch, status, setup, added_at, setup_chat FROM repository WHERE id = 1").get();
  if (row === undefined) return undefined;
  const status = decodeStatus(row.status);
  return {
    root: String(row.root),
    gitCommonDir: String(row.git_common_dir),
    baseBranch: String(row.base_branch),
    status: status._tag === "Some" ? status.value : "setting-up",
    setup: parsedSetup(row.setup),
    addedAt: String(row.added_at),
    setupChat: typeof row.setup_chat === "string" ? row.setup_chat : null,
  };
};

export const readRepositoryProject = (db: DatabaseSync): StoredRepository | undefined => (readKind(db) === "repository" ? readRepository(db) : undefined);

export const writeRepository = (db: DatabaseSync, repository: StoredRepository): void => {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("INSERT OR REPLACE INTO project_info (id, kind) VALUES (1, 'repository')").run();
    db.prepare(
      "INSERT OR REPLACE INTO repository (id, root, git_common_dir, base_branch, status, setup, added_at, setup_chat) VALUES (1, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      repository.root,
      repository.gitCommonDir,
      repository.baseBranch,
      repository.status,
      repository.setup === null ? null : JSON.stringify(repository.setup),
      repository.addedAt,
      repository.setupChat,
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
};
