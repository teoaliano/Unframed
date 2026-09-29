/**
 * Artifact snapshots (spec 09): the still an artifact shows while it is not live. The engine
 * renders one in its headless Chrome whenever a shape has none for its current file and size,
 * and after every file change, every saved dial change and every resize of more than 10 %,
 * debounced a second per shape and one at a time. They go into the regenerable cache folder
 * and never get sidecars.
 */
import { mkdir, readdir, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import type { ArtifactSnapshot } from "@unframed/contracts";
import { artifactUrl, isArtifactKind, parseSnapshotFileName, snapshotFileName, snapshotFits, snapshotSeekSeconds } from "@unframed/domain";
import type { TLRecord } from "@tldraw/tlschema";
import { errorText, logError } from "../log.ts";
import type { HeadlessChrome } from "./headlessChrome.ts";

export const SNAPSHOT_FOLDER = join(".cache", "snapshots");

/** How long a shape's changes settle before its snapshot is made. */
const DEBOUNCE_MS = 1000;
/** What a page gets to draw once loaded, before the picture is taken. */
const SETTLE_MS = 500;

export interface SnapshotJob {
  readonly project: string;
  readonly kind: "page" | "motion";
  readonly file: string;
  readonly w: number;
  readonly h: number;
  readonly dials: Readonly<Record<string, unknown>> | undefined;
  /** The artifact on the preview origin, as the engine's own browser opens it. */
  readonly url: string;
}

/** Makes the picture of one artifact at one size. `undefined` means no picture could be made (no Chromium). */
export type SnapshotRenderer = (job: SnapshotJob) => Promise<Buffer | undefined>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A 1 by 1 PNG whose `tEXt` chunk says what it was asked to show: the test renderer's picture. */
export const stubSnapshot = (text: Readonly<Record<string, unknown>>): Buffer => {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("tEXt", Buffer.from(`unframed\0${JSON.stringify(text)}`, "latin1")),
    chunk("IDAT", deflateSync(Buffer.from([0, 255, 255, 255, 255]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

/** `UNFRAMED_TEST_RENDERER=ok`: no browser, a small picture that records what it was asked, a moment of work. */
export const stubSnapshotRenderer: SnapshotRenderer = async (job) => {
  const startedAt = Date.now();
  await sleep(150);
  return stubSnapshot({ url: job.url, file: job.file, w: job.w, h: job.h, dials: job.dials ?? null, startedAt, finishedAt: Date.now() });
};

/**
 * The real renderer: the artifact at the shape's size at 2x, its saved dials posted to it,
 * the load event plus 500 ms, a motion's player seeked by the domain rule.
 */
export const chromeSnapshotRenderer =
  (chrome: HeadlessChrome): SnapshotRenderer =>
  (job) =>
    chrome.use(async (browser) => {
      const page = await browser.newPage();
      try {
        await page.setViewport({ width: Math.max(1, Math.round(job.w)), height: Math.max(1, Math.round(job.h)), deviceScaleFactor: 2 });
        await page.goto(job.url, { waitUntil: "load", timeout: 20_000 });
        // Posted as the canvas would: the bridge (or the viewer, which relays it) applies them.
        if (job.dials !== undefined && Object.keys(job.dials).length > 0) {
          await page.evaluate(`window.postMessage({ type: "unframed:dials:set", values: ${JSON.stringify(job.dials)} }, window.location.origin)`);
        }
        if (job.kind === "motion") {
          await page.waitForFunction(`document.querySelector("hyperframes-player")?.ready === true`, { timeout: 10_000 }).catch(() => undefined);
          const duration = Number(await page.evaluate(`Number(document.querySelector("hyperframes-player")?.duration)`));
          await page.evaluate(
            `(() => { const player = document.querySelector("hyperframes-player"); player?.pause?.(); player?.seek?.(${snapshotSeekSeconds(duration)}); })()`,
          );
        }
        await sleep(SETTLE_MS);
        return Buffer.from(await page.screenshot({ type: "png" }));
      } finally {
        await page.close().catch(() => undefined);
      }
    });

interface Seen {
  readonly file: string;
  readonly w: number;
  readonly h: number;
  readonly dials: string;
}

type ArtifactRecord = TLRecord & { type: "page" | "motion"; props: { w: number; h: number; file: string; dials?: Record<string, unknown> } };

const isArtifact = (record: TLRecord | undefined): record is ArtifactRecord =>
  record?.typeName === "shape" && isArtifactKind(record.type) && typeof (record.props as { file?: unknown }).file === "string";

export interface SnapshotDeps {
  readonly renderer: SnapshotRenderer | undefined;
  /** The project folder, or `undefined` when there is none. */
  readonly folder: (project: string) => Promise<string | undefined>;
  readonly read: (project: string) => Promise<ReadonlyArray<TLRecord>>;
  readonly previewPort: number;
  readonly publish: (project: string, snapshot: ArtifactSnapshot) => void;
}

export class Snapshots {
  private readonly deps: SnapshotDeps;
  /** What each shape's snapshot was last made (or asked) for, by `<project> <shape id>`. */
  private readonly seen = new Map<string, Seen>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Shapes seen for the first time: rendered only when the cache has nothing that fits. */
  private readonly fresh = new Set<string>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(deps: SnapshotDeps) {
    this.deps = deps;
  }

  /** Looks at every artifact of a room that just opened. */
  opened(project: string, records: ReadonlyArray<TLRecord>): void {
    for (const record of records) if (isArtifact(record)) this.consider(project, record);
  }

  /** Looks at the artifacts a commit put. */
  committed(project: string, put: ReadonlyArray<TLRecord>): void {
    for (const record of put) if (isArtifact(record)) this.consider(project, record);
  }

  /** Forgets a project that closed: its timers stop, and the next open looks again. */
  forget(project: string): void {
    for (const [key, timer] of this.timers) {
      if (!key.startsWith(`${project} `)) continue;
      clearTimeout(timer);
      this.timers.delete(key);
    }
    for (const key of [...this.seen.keys()]) if (key.startsWith(`${project} `)) this.seen.delete(key);
  }

  private consider(project: string, shape: ArtifactRecord): void {
    if (this.deps.renderer === undefined || shape.props.file === "") return;
    const key = `${project} ${shape.id}`;
    const now: Seen = { file: shape.props.file, w: shape.props.w, h: shape.props.h, dials: JSON.stringify(shape.props.dials ?? null) };
    const last = this.seen.get(key);
    if (last === undefined) this.fresh.add(key);
    else if (last.file === now.file && last.dials === now.dials && snapshotFits(last, now)) return;
    // A real change since first sight: whatever the cache holds is not this.
    else this.fresh.delete(key);
    this.seen.set(key, now);
    clearTimeout(this.timers.get(key));
    const timer = setTimeout(() => {
      this.timers.delete(key);
      this.queue = this.queue.then(() => this.render(project, shape.id, key)).catch((error: unknown) => logError(`snapshot of ${shape.id} in ${project}: ${errorText(error)}`));
    }, DEBOUNCE_MS);
    timer.unref();
    this.timers.set(key, timer);
  }

  /** Every snapshot in the project's cache, newest last. */
  async list(project: string): Promise<ArtifactSnapshot[]> {
    const folder = await this.deps.folder(project);
    if (folder === undefined) return [];
    const dir = join(folder, SNAPSHOT_FOLDER);
    const names = await readdir(dir).catch(() => [] as string[]);
    const found: ArtifactSnapshot[] = [];
    for (const name of names) {
      const parsed = parseSnapshotFileName(name);
      if (!parsed) continue;
      const info = await stat(join(dir, name)).catch(() => undefined);
      if (info?.isFile()) found.push({ ...parsed, at: Math.floor(info.mtimeMs) });
    }
    return found.sort((a, b) => a.at - b.at);
  }

  private async render(project: string, shapeId: string, key: string): Promise<void> {
    const renderer = this.deps.renderer;
    if (renderer === undefined) return;
    const shape = (await this.deps.read(project)).find((record) => record.id === shapeId);
    if (!isArtifact(shape) || shape.props.file === "") return;
    const folder = await this.deps.folder(project);
    if (folder === undefined) return;
    const size = { w: shape.props.w, h: shape.props.h };
    if (this.fresh.delete(key)) {
      const cached = (await this.list(project)).some((snapshot) => snapshot.file === shape.props.file && snapshotFits(snapshot, size));
      if (cached) return;
    }
    const picture = await renderer({
      project,
      kind: shape.type,
      file: shape.props.file,
      w: size.w,
      h: size.h,
      dials: shape.props.dials,
      url: artifactUrl({ appHostname: "localhost", previewPort: this.deps.previewPort, project, file: shape.props.file, kind: shape.type }),
    });
    if (picture === undefined) return;
    const dir = join(folder, SNAPSHOT_FOLDER);
    await mkdir(dir, { recursive: true });
    const name = snapshotFileName(shape.props.file, size);
    const temp = join(dir, `.${name}.${process.pid}.tmp`);
    await writeFile(temp, picture);
    await rename(temp, join(dir, name));
    const info = await stat(join(dir, name));
    this.deps.publish(project, { file: shape.props.file, w: Math.round(size.w), h: Math.round(size.h), at: Math.floor(info.mtimeMs) });
  }
}
