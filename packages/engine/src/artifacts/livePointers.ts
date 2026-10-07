/**
 * The live viewer's pointers (spec 09): one small file per artifact shape,
 * `unframed-live-<key>.js`, naming the shape's current file and dials. The engine rewrites
 * it whenever either changes, and the viewer in the person's own browser reads it every
 * second. Pointers and the viewer are helper files the engine keeps; the versioned artifact
 * files themselves are still never overwritten.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { artifactTitle, isArtifactKind, liveKey, livePointerFileName, livePointerSource } from "@unframed/domain";
import type { TLRecord } from "@tldraw/tlschema";
import { writeFileAtomic } from "../atomicFile.ts";
import { errorText, logError } from "../log.ts";
import { ensureLiveViewer } from "./artifactStore.ts";

type ArtifactRecord = TLRecord & { type: "page" | "motion"; props: { file: string; title?: unknown; fileName?: unknown; dials?: Record<string, unknown> } };

const isArtifact = (record: TLRecord | undefined): record is ArtifactRecord =>
  record?.typeName === "shape" && isArtifactKind(record.type) && typeof (record.props as { file?: unknown }).file === "string";

export class LivePointers {
  /** The text each pointer was last written with, by `<project> <file name>`. */
  private readonly written = new Map<string, string>();
  private queue: Promise<unknown> = Promise.resolve();
  private readonly folder: (project: string) => Promise<string | undefined>;

  constructor(folder: (project: string) => Promise<string | undefined>) {
    this.folder = folder;
  }

  /** Writes the pointer of every artifact among `records` whose file, title or dials changed. */
  update(project: string, records: Iterable<TLRecord>): void {
    const due: Array<{ name: string; text: string }> = [];
    for (const record of records) {
      if (!isArtifact(record)) continue;
      const key = liveKey(record.id);
      if (key === undefined) continue;
      const dials = record.props.dials;
      const text = livePointerSource({
        kind: record.type,
        file: record.props.file,
        title: artifactTitle(record.props),
        dials: dials !== undefined && Object.keys(dials).length > 0 ? dials : null,
      });
      const name = livePointerFileName(key);
      if (this.written.get(`${project} ${name}`) === text) continue;
      this.written.set(`${project} ${name}`, text);
      due.push({ name, text });
    }
    if (due.length === 0) return;
    // One chain, in commit order, so an older pointer never lands after a newer one.
    this.queue = this.queue
      .then(() => this.write(project, due))
      .catch((error: unknown) => {
        for (const { name } of due) this.written.delete(`${project} ${name}`);
        logError(`live viewer of ${project}: ${errorText(error)}`);
      });
  }

  /** Forgets a project that closed, so the next open compares with the files again. */
  forget(project: string): void {
    for (const key of [...this.written.keys()]) if (key.startsWith(`${project} `)) this.written.delete(key);
  }

  private async write(project: string, due: ReadonlyArray<{ name: string; text: string }>): Promise<void> {
    const folder = await this.folder(project);
    if (folder === undefined) return;
    await ensureLiveViewer(folder);
    for (const { name, text } of due) {
      const path = join(folder, name);
      if ((await readFile(path, "utf8").catch(() => undefined)) === text) continue;
      await writeFileAtomic(path, text);
    }
  }
}
