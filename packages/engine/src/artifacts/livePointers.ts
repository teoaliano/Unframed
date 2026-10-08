/**
 * The live viewer's pointers (spec 09): one small file, `unframed-live-<key>.js`, for each
 * artifact shape the person opened in a tab, naming the shape's current file and dials, or
 * that it was deleted. "Open in a new tab" writes the first one; from then on the pointer
 * file on disk is what marks the shape as followed, and the engine rewrites it after every
 * commit that touches the shape and when the project opens. Pointers, the viewer and the
 * check are helper files the engine keeps; the versioned artifact files are still never
 * overwritten.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { artifactTitle, isArtifactKind, liveKey, livePointerFileName, livePointerKey, livePointerSource, parseLivePointer, type LivePointer } from "@unframed/domain";
import type { TLRecord } from "@tldraw/tlschema";
import { writeFileAtomic } from "../atomicFile.ts";
import { errorText, logError } from "../log.ts";
import { ensureLiveViewer } from "./artifactStore.ts";

type ArtifactRecord = TLRecord & { type: "page" | "motion"; props: { file: string; title?: unknown; fileName?: unknown; dials?: Record<string, unknown> } };

const isArtifact = (record: TLRecord | undefined): record is ArtifactRecord =>
  record?.typeName === "shape" && isArtifactKind(record.type) && typeof (record.props as { file?: unknown }).file === "string";

const pointerOf = (shape: ArtifactRecord): LivePointer => {
  const dials = shape.props.dials;
  return {
    kind: shape.type,
    file: shape.props.file,
    title: artifactTitle(shape.props),
    dials: dials !== undefined && Object.keys(dials).length > 0 ? dials : null,
  };
};

/** What a shape's pointer should say now: its current state, or deleted, keeping what it last named. */
type Next = { readonly key: string; readonly shape: ArtifactRecord | undefined };

export class LivePointers {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly folder: (project: string) => Promise<string | undefined>;

  constructor(folder: (project: string) => Promise<string | undefined>) {
    this.folder = folder;
  }

  /** "Open in a new tab" on `shape`: writes its pointer, and the viewer and check beside it. */
  open(project: string, shape: TLRecord | undefined): Promise<boolean> {
    if (!isArtifact(shape)) return Promise.resolve(false);
    const key = liveKey(shape.id);
    if (key === undefined) return Promise.resolve(false);
    return this.enqueue(project, async (folder) => {
      await ensureLiveViewer(folder);
      await this.write(folder, key, livePointerSource(pointerOf(shape)));
      return true;
    });
  }

  /** A room opened: every followed shape's pointer is brought up to date, or marked deleted. */
  opened(project: string, records: ReadonlyArray<TLRecord>): void {
    void this.enqueue(project, async (folder) => {
      const keys = (await readdir(folder).catch(() => [] as string[])).flatMap((name) => livePointerKey(name) ?? []);
      if (keys.length === 0) return;
      const byKey = new Map<string, ArtifactRecord>();
      for (const record of records) {
        const key = isArtifact(record) ? liveKey(record.id) : undefined;
        if (key !== undefined) byKey.set(key, record as ArtifactRecord);
      }
      await ensureLiveViewer(folder);
      await this.follow(folder, keys.map((key) => ({ key, shape: byKey.get(key) })));
    }).catch(() => undefined);
  }

  /** A commit: the followed shapes it put are brought up to date, the ones it removed marked deleted. */
  committed(project: string, put: Iterable<TLRecord>, removed: ReadonlyArray<string>): void {
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
    void this.enqueue(project, (folder) => this.follow(folder, next)).catch(() => undefined);
  }

  /** One chain, in commit order, so an older pointer never lands after a newer one. */
  private enqueue<A>(project: string, work: (folder: string) => Promise<A>): Promise<A | false> {
    const run = this.queue.then(async () => {
      const folder = await this.folder(project);
      return folder === undefined ? (false as const) : work(folder);
    });
    this.queue = run.catch((error: unknown) => logError(`live viewer of ${project}: ${errorText(error)}`));
    return run;
  }

  /** Rewrites the pointers that exist among `next`. A shape with no pointer was never opened in a tab. */
  private async follow(folder: string, next: ReadonlyArray<Next>): Promise<void> {
    for (const { key, shape } of next) {
      const before = await readFile(join(folder, livePointerFileName(key)), "utf8").catch(() => undefined);
      if (before === undefined) continue;
      let text: string;
      if (shape !== undefined) text = livePointerSource(pointerOf(shape));
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
