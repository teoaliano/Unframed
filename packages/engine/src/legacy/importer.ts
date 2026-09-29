/**
 * The project importer (spec 11): the one-time import of a folder the old app made. It
 * runs inside the project database's opener, before the file is first created: it reads
 * the old files, maps them through the domain's legacy modules, writes the files an
 * import extracts, and builds `unframed.sqlite` in a temporary file renamed into place
 * only once every record and the report are in it. It never rewrites or deletes an old
 * file. One import per folder runs at a time; a failed one is remembered until retried.
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { TLRecord } from "@tldraw/tlschema";
import {
  imageDimensions,
  legacyRecords,
  legacyReferencedFiles,
  mapProject,
  normalise,
  rebuild,
  sidecarFileName,
  sidecarText,
  type Extraction,
  type LegacyDefaults,
  type LegacyJob,
  type PixelSize,
  type ProjectFacts,
} from "@unframed/domain";
import { writeFirstCanvas } from "../canvas/room.ts";
import { errorText } from "../log.ts";
import { readJobsLenient } from "../video/jobStore.ts";
import { writeImportReport } from "./reportTable.ts";

export const SNAPSHOT_FILE = "graph.json";
export const JOURNAL_FILE = "graph.log";
const DATABASE_FILE = "unframed.sqlite";
const TEMP_PREFIX = `${DATABASE_FILE}.import-`;

/** How the import of one folder stands, for the web's loading and failure states. */
export type ImportState = { readonly state: "none" } | { readonly state: "pending" } | { readonly state: "failed"; readonly message: string };

/** An import that did not finish. Nothing was written in place of the project database. */
export class ImportFailed extends Error {}

export const importFailedMessage = (reason: string): string =>
  `Could not import this project from the old Unframed: ${reason.replace(/\.$/, "")}. Its files are unchanged.`;

export interface ImporterDeps {
  /** Every migration a project database gets, in order. */
  readonly migrate: (db: DatabaseSync) => void;
  readonly outputDir: () => Promise<string>;
  readonly defaults: () => Promise<LegacyDefaults>;
}

const readOptional = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
};

const readJson = async (path: string): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    return undefined;
  }
};

const IMAGE_FILE = /\.(png|jpe?g|webp|gif|avif|svg)$/i;
const HEADER_BYTES = 64 * 1024;

const headerSize = async (path: string): Promise<PixelSize | undefined> => {
  try {
    const handle = await open(path, "r");
    try {
      const buffer = Buffer.alloc(HEADER_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, HEADER_BYTES, 0);
      return imageDimensions(new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead));
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
};

/** Whether the folder holds an old graph and no project database. */
export const needsImport = (folder: string): boolean =>
  !existsSync(join(folder, DATABASE_FILE)) && (existsSync(join(folder, SNAPSHOT_FILE)) || existsSync(join(folder, JOURNAL_FILE)));

/** What the mapper needs to know about the folder, the output folder's job store and the settings. */
const gatherFacts = async (folder: string, project: string, referenced: (jobs: ReadonlyArray<LegacyJob>) => string[], deps: ImporterDeps): Promise<ProjectFacts> => {
  const entries = await readdir(folder, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const present = new Set(files);
  const jobs = (await readJobsLenient(await deps.outputDir())).filter((job) => job.project === project) as unknown as LegacyJob[];
  const imageSizes: Record<string, PixelSize> = {};
  const sidecars: Record<string, unknown> = {};
  for (const file of referenced(jobs)) {
    if (!present.has(file)) continue;
    if (IMAGE_FILE.test(file)) {
      const size = await headerSize(join(folder, file));
      if (size) imageSizes[file] = size;
    }
    const sidecar = sidecarFileName(file);
    if (sidecar !== file && present.has(sidecar)) {
      const parsed = await readJson(join(folder, sidecar));
      if (parsed !== undefined) sidecars[file] = parsed;
    }
  }
  const textSidecars: Array<{ file: string; sidecar: unknown }> = [];
  for (const file of files) {
    if (!/-text-.*\.json$/.test(file)) continue;
    const parsed = await readJson(join(folder, file));
    if (parsed !== undefined) textSidecars.push({ file, sidecar: parsed });
  }
  let hasThreads = false;
  try {
    hasThreads = (await readdir(join(folder, "threads"))).length > 0;
  } catch {
    hasThreads = false;
  }
  return { files, imageSizes, sidecars, textSidecars, jobs, hasThreads, defaults: await deps.defaults() };
};

/**
 * Writes an extracted file under its deterministic name, unless a file of that name and
 * size is there already (a retry after a crash), and its sidecar when it has none.
 */
const writeExtraction = async (folder: string, extraction: Extraction): Promise<void> => {
  const target = join(folder, extraction.file);
  const existing = await stat(target).catch(() => undefined);
  if (existing?.size !== extraction.bytes.length) {
    const temp = join(folder, `.legacy-${randomUUID()}.tmp`);
    try {
      await writeFile(temp, extraction.bytes);
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => {});
      throw error;
    }
  }
  const sidecar = join(folder, sidecarFileName(extraction.file));
  if (!existsSync(sidecar)) {
    await writeFile(
      sidecar,
      sidecarText({ source: "legacy-graph", fileName: extraction.fileName, mime: extraction.mime, bytes: extraction.bytes.length, at: new Date().toISOString() }),
    );
  }
};

/** Removes what a crashed import left: its temporary database and SQLite's own files beside it. */
const removeLeftovers = async (folder: string): Promise<void> => {
  for (const name of await readdir(folder)) {
    if (name.startsWith(TEMP_PREFIX)) await rm(join(folder, name), { force: true });
  }
};

const runImport = async (folder: string, project: string, deps: ImporterDeps): Promise<void> => {
  await removeLeftovers(folder);
  const [snapshot, journal] = await Promise.all([readOptional(join(folder, SNAPSHOT_FILE)), readOptional(join(folder, JOURNAL_FILE))]);
  const rebuilt = rebuild(snapshot, journal);
  const normalised = normalise(rebuilt.graph);
  const facts = await gatherFacts(folder, project, (jobs) => legacyReferencedFiles(normalised.graph, jobs), deps);
  const mapped = mapProject(normalised.graph, facts, {
    source: rebuilt.stats,
    notes: [...rebuilt.notes, ...normalised.notes],
    importedAt: new Date().toISOString(),
    sha256: (bytes) => createHash("sha256").update(bytes).digest("hex"),
  });
  for (const extraction of mapped.extractions) await writeExtraction(folder, extraction);

  const shapeIds = new Map<string, string>();
  const idFor = (prefix: string, key: string) => {
    const known = shapeIds.get(`${prefix}${key}`);
    if (known !== undefined) return known;
    const id = `${prefix}${randomUUID()}`;
    shapeIds.set(`${prefix}${key}`, id);
    return id;
  };
  const records = legacyRecords(mapped.canvas.shapes, { page: "page:page", shape: (key) => idFor("shape:", key), asset: (key) => idFor("asset:", key) });

  const temp = join(folder, `${TEMP_PREFIX}${process.pid}.tmp`);
  const db = new DatabaseSync(temp);
  try {
    db.exec("PRAGMA journal_mode = DELETE");
    deps.migrate(db);
    writeFirstCanvas(db, [...records.assets, ...records.shapes] as unknown as TLRecord[], { kind: "system", id: "legacy-import" });
    writeImportReport(db, mapped.report);
    db.close();
    await rename(temp, join(folder, DATABASE_FILE));
  } catch (error) {
    if (db.isOpen) db.close();
    await removeLeftovers(folder).catch(() => {});
    throw error;
  }
};

export interface LegacyImporter {
  /** How the folder's import stands, without starting one. */
  readonly state: (folder: string) => ImportState;
  /**
   * Imports the folder when it needs it, or waits for the import already running. Rejects
   * with `ImportFailed` when this import, or the last one tried, failed.
   */
  readonly ensure: (folder: string, project: string) => Promise<void>;
  /** Forgets a failed import, so the next `ensure` tries again. */
  readonly forgetFailure: (folder: string) => void;
}

export const makeLegacyImporter = (deps: ImporterDeps): LegacyImporter => {
  const running = new Map<string, Promise<void>>();
  const failed = new Map<string, string>();

  const state = (folder: string): ImportState => {
    const failure = failed.get(folder);
    if (failure !== undefined && needsImport(folder)) return { state: "failed", message: failure };
    return running.has(folder) || needsImport(folder) ? { state: "pending" } : { state: "none" };
  };

  const ensure = async (folder: string, project: string): Promise<void> => {
    const live = running.get(folder);
    if (live) return live;
    if (!needsImport(folder)) return;
    const failure = failed.get(folder);
    if (failure !== undefined) throw new ImportFailed(failure);
    const work = runImport(folder, project, deps).then(
      () => {
        running.delete(folder);
      },
      (error: unknown) => {
        const message = importFailedMessage(errorText(error));
        failed.set(folder, message);
        running.delete(folder);
        throw new ImportFailed(message);
      },
    );
    running.set(folder, work);
    return work;
  };

  return { state, ensure, forgetFailure: (folder) => void failed.delete(folder) };
};
