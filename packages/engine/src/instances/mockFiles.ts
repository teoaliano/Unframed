import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { isMockFileName, MOCK_MODULES_FOLDER, mockFilesSource, mockLogKept, mockModulePaths, MOCKS_FOLDER, mockRuntimeSource, type MockLogEntry, type MockSourceFile } from "@unframed/domain";

const CHANGE_DEBOUNCE_MS = 120;
const MAX_MOCK_BYTES = 512_000;

export interface MockFiles {
  readonly files: () => Promise<ReadonlyArray<MockSourceFile>>;
  readonly runtime: () => Promise<string>;
  readonly source: () => Promise<string>;
  readonly module: (pathname: string) => Promise<string | undefined>;
  readonly touched: (path: string) => void;
  readonly subscribe: (listener: () => void) => () => void;
  readonly note: (entries: ReadonlyArray<MockLogEntry>) => void;
  readonly log: () => ReadonlyArray<MockLogEntry>;
}

const isUnder = (path: string, folder: string): boolean => {
  const normal = path.split(sep).join("/");
  return normal === folder || normal.startsWith(`${folder}/`);
};

export const listFiles = async (root: string, folder: string): Promise<string[]> => {
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
  const found: string[] = [];
  for (const entry of entries) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) found.push(...(await listFiles(root, path)));
    else if (entry.isFile()) found.push(relative(root, path).split(sep).join("/"));
  }
  return found;
};

export const mockFilesOf = (worktree: string): MockFiles => {
  const folder = join(worktree, MOCKS_FOLDER);
  const modulesFolder = join(worktree, MOCK_MODULES_FOLDER);
  const listeners = new Set<() => void>();
  let timer: NodeJS.Timeout | undefined;
  let modules: Promise<ReadonlySet<string>> | undefined;
  let entries: ReadonlyArray<MockLogEntry> = [];

  const files = async (): Promise<ReadonlyArray<MockSourceFile>> => {
    const names = (await readdir(folder).catch(() => [] as string[])).filter(isMockFileName).sort();
    const read: MockSourceFile[] = [];
    for (const name of names) {
      const path = join(folder, name);
      const info = await stat(path).catch(() => undefined);
      if (info === undefined || !info.isFile() || info.size > MAX_MOCK_BYTES) continue;
      read.push({ name, source: await readFile(path, "utf8") });
    }
    return read;
  };

  const listModules = (): Promise<ReadonlySet<string>> => {
    modules ??= listFiles(modulesFolder, modulesFolder).then((found) => new Set(found));
    return modules;
  };

  return {
    files,
    runtime: async () => mockRuntimeSource(await files()),
    source: async () => mockFilesSource(await files()),
    module: async (pathname) => {
      const known = await listModules();
      if (known.size === 0) return undefined;
      const hit = mockModulePaths(pathname).find((path) => known.has(path));
      return hit === undefined ? undefined : readFile(join(modulesFolder, hit), "utf8").catch(() => undefined);
    },
    touched: (path) => {
      if (!isUnder(path, MOCKS_FOLDER)) return;
      if (isUnder(path, MOCK_MODULES_FOLDER)) modules = undefined;
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        for (const listener of listeners) listener();
      }, CHANGE_DEBOUNCE_MS);
      timer.unref();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    note: (added) => {
      entries = mockLogKept(entries, added);
    },
    log: () => entries,
  };
};
