import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { artifactTitle, isArtifactKind, kitStamp, type ArtifactKind, liveKey, livePointerFileName, livePointerKey, livePointerSource, parseLivePointer, type Kit, type LivePointer } from "@unframed/domain";
import type { TLRecord } from "@tldraw/tlschema";
import { writeFileAtomic } from "../atomicFile.ts";
import { errorText, logError } from "../log.ts";
import { ensureLiveViewer } from "./artifactStore.ts";

type ArtifactRecord = TLRecord & { type: ArtifactKind; props: { file: string; title?: unknown; fileName?: unknown; dials?: Record<string, unknown> } };

const isArtifact = (record: TLRecord | undefined): record is ArtifactRecord =>
  record?.typeName === "shape" && isArtifactKind(record.type) && typeof (record.props as { file?: unknown }).file === "string";

const pointerOf = (shape: ArtifactRecord, kit: Kit | null): LivePointer => {
  const dials = shape.props.dials;
  const mode = (shape.props as { mode?: string }).mode;
  return {
    kind: shape.type,
    file: shape.props.file,
    title: artifactTitle(shape.props),
    dials: dials !== undefined && Object.keys(dials).length > 0 ? dials : null,
    ...(mode !== undefined ? { mode } : {}),
    ...(kit !== null ? { kit: kitStamp(kit) } : {}),
  };
};

type Next = { readonly key: string; readonly shape: ArtifactRecord | undefined };

export class LivePointers {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly folder: (project: string) => Promise<string | undefined>;

  constructor(folder: (project: string) => Promise<string | undefined>) {
    this.folder = folder;
  }

  open(project: string, shape: TLRecord | undefined, kit: Kit | null = null): Promise<boolean> {
    if (!isArtifact(shape)) return Promise.resolve(false);
    const key = liveKey(shape.id);
    if (key === undefined) return Promise.resolve(false);
    return this.enqueue(project, async (folder) => {
      await ensureLiveViewer(folder);
      await this.write(folder, key, livePointerSource(pointerOf(shape, kit)));
      return true;
    });
  }

  opened(project: string, records: ReadonlyArray<TLRecord>, kit: Kit | null = null): void {
    void this.enqueue(project, async (folder) => {
      const keys = (await readdir(folder).catch(() => [] as string[])).flatMap((name) => livePointerKey(name) ?? []);
      if (keys.length === 0) return;
      const byKey = new Map<string, ArtifactRecord>();
      for (const record of records) {
        const key = isArtifact(record) ? liveKey(record.id) : undefined;
        if (key !== undefined) byKey.set(key, record as ArtifactRecord);
      }
      await ensureLiveViewer(folder);
      await this.follow(folder, keys.map((key) => ({ key, shape: byKey.get(key) })), kit);
    }).catch(() => undefined);
  }

  committed(project: string, put: Iterable<TLRecord>, removed: ReadonlyArray<string>, kit: Kit | null = null): void {
    const next: Next[] = [];
    for (const record of put) {
      const key = isArtifact(record) ? liveKey(record.id) : undefined;
      if (key !== undefined) next.push({ key, shape: record as ArtifactRecord });
    }
    for (const id of removed) {
      const key = id.startsWith("shape:") ? liveKey(id) : undefined;
      if (key !== undefined) next.push({ key, shape: undefined });
    }
    if (next.length === 0) return;
    void this.enqueue(project, (folder) => this.follow(folder, next, kit)).catch(() => undefined);
  }

  kitChanged(project: string, records: ReadonlyArray<TLRecord>, kit: Kit | null): void {
    const next: Next[] = [];
    for (const record of records) {
      const key = isArtifact(record) ? liveKey(record.id) : undefined;
      if (key !== undefined) next.push({ key, shape: record as ArtifactRecord });
    }
    if (next.length === 0) return;
    void this.enqueue(project, (folder) => this.follow(folder, next, kit)).catch(() => undefined);
  }

  private enqueue<A>(project: string, work: (folder: string) => Promise<A>): Promise<A | false> {
    const run = this.queue.then(async () => {
      const folder = await this.folder(project);
      return folder === undefined ? (false as const) : work(folder);
    });
    this.queue = run.catch((error: unknown) => logError(`live viewer of ${project}: ${errorText(error)}`));
    return run;
  }

  private async follow(folder: string, next: ReadonlyArray<Next>, kit: Kit | null): Promise<void> {
    for (const { key, shape } of next) {
      const before = await readFile(join(folder, livePointerFileName(key)), "utf8").catch(() => undefined);
      if (before === undefined) continue;
      let text: string;
      if (shape !== undefined) text = livePointerSource(pointerOf(shape, kit));
      else {
        const last = parseLivePointer(before);
        if (last === undefined || last.deleted) continue;
        text = livePointerSource({ ...last, deleted: true });
      }
      if (text !== before) await this.write(folder, key, text);
    }
  }

  private async write(folder: string, key: string, text: string): Promise<void> {
    const path = join(folder, livePointerFileName(key));
    if ((await readFile(path, "utf8").catch(() => undefined)) === text) return;
    await writeFileAtomic(path, text);
  }
}
