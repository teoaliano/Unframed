import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import type { ArtifactSnapshot } from "@unframed/contracts";
import { artifactLayoutSize, artifactUrl, isArtifactKind, kitStamp, parseSnapshotFileName, type ArtifactKind, snapshotFileName, snapshotFits, snapshotSeekSeconds, type Kit } from "@unframed/domain";
import type { TLRecord } from "@tldraw/tlschema";
import { errorText, logError } from "../log.ts";
import { ArtifactLoads } from "./artifactLoads.ts";
import { ensurePinnedComponents } from "./artifactStore.ts";
import type { HeadlessChrome } from "./headlessChrome.ts";

export const SNAPSHOT_FOLDER = join(".cache", "snapshots");

const DEBOUNCE_MS = 1000;
const SETTLE_MS = 500;

interface SnapshotJob {
  readonly project: string;
  readonly kind: ArtifactKind;
  readonly file: string;
  readonly w: number;
  readonly h: number;
  readonly dials: Readonly<Record<string, unknown>> | undefined;
  readonly url: string;
  readonly mode: string | null;
  readonly kit: string | null;
}

export type SnapshotRenderer = (job: SnapshotJob) => Promise<Buffer | undefined>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const stubSnapshot = (text: Readonly<Record<string, unknown>>): Buffer => {
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

export const stubSnapshotRenderer: SnapshotRenderer = async (job) => {
  const startedAt = Date.now();
  await sleep(150);
  return stubSnapshot({ url: job.url, file: job.file, w: job.w, h: job.h, dials: job.dials ?? null, mode: job.mode, kit: job.kit, startedAt, finishedAt: Date.now() });
};

export const chromeSnapshotRenderer =
  (chrome: HeadlessChrome): SnapshotRenderer =>
  (job) =>
    chrome.use(async (browser) => {
      const page = await browser.newPage();
      try {
        await page.setViewport({ width: Math.max(1, Math.round(job.w)), height: Math.max(1, Math.round(job.h)), deviceScaleFactor: 2 });
        await page.goto(job.url, { waitUntil: "load", timeout: 20_000 });
        if (job.mode !== null) await page.evaluate(`window.postMessage({ type: "unframed:tokens:mode", mode: ${JSON.stringify(job.mode)} }, window.location.origin)`);
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
  readonly mode: string | null;
  readonly kit: string | null;
}

type ArtifactRecord = TLRecord & { type: ArtifactKind; props: { w: number; h: number; scale?: number; file: string; dials?: Record<string, unknown>; mode?: string } };

const isArtifact = (record: TLRecord | undefined): record is ArtifactRecord =>
  record?.typeName === "shape" && isArtifactKind(record.type) && typeof (record.props as { file?: unknown }).file === "string";

interface SnapshotDeps {
  readonly renderer: SnapshotRenderer | undefined;
  readonly folder: (project: string) => Promise<string | undefined>;
  readonly read: (project: string) => Promise<ReadonlyArray<TLRecord>>;
  readonly previewPort: number;
  readonly publish: (project: string, snapshot: ArtifactSnapshot) => void;
}

interface ProjectSnapshots {
  readonly seen: Map<string, Seen>;
  readonly timers: Map<string, ReturnType<typeof setTimeout>>;
  readonly fresh: Set<string>;
  readonly rendered: Map<string, string>;
  readonly known: Map<string, string>;
  readonly loads: ArtifactLoads;
}

export class Snapshots {
  private readonly deps: SnapshotDeps;
  private readonly projects = new Map<string, ProjectSnapshots>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(deps: SnapshotDeps) {
    this.deps = deps;
  }

  private of(project: string): ProjectSnapshots {
    let found = this.projects.get(project);
    if (found === undefined) {
      found = { seen: new Map(), timers: new Map(), fresh: new Set(), rendered: new Map(), known: new Map(), loads: new ArtifactLoads() };
      this.projects.set(project, found);
    }
    return found;
  }

  opened(project: string, records: ReadonlyArray<TLRecord>, kit: Kit | null = null): void {
    this.of(project);
    void this.know(project, records);
    for (const record of records) if (isArtifact(record)) this.consider(project, record, kit);
  }

  committed(project: string, put: ReadonlyArray<TLRecord>, kit: Kit | null = null): void {
    if (!this.projects.has(project)) return;
    void this.know(project, put);
    for (const record of put) if (isArtifact(record)) this.consider(project, record, kit);
  }

  kitChanged(project: string, records: ReadonlyArray<TLRecord>, kit: Kit | null): void {
    if (!this.projects.has(project)) return;
    for (const record of records) if (isArtifact(record)) this.consider(project, record, kit, true);
  }

  private async know(project: string, records: ReadonlyArray<TLRecord>): Promise<void> {
    const state = this.projects.get(project);
    const folder = state === undefined ? undefined : await this.deps.folder(project);
    if (state === undefined || folder === undefined) return;
    for (const record of records) {
      if (!isArtifact(record) || record.props.file === "" || state.known.has(record.props.file)) continue;
      const signature = await state.loads.signature(folder, record.props.file);
      if (!state.known.has(record.props.file)) state.known.set(record.props.file, signature);
    }
  }

  async filesChanged(project: string, names: ReadonlyArray<string>, records: ReadonlyArray<TLRecord>, kit: Kit | null): Promise<ReadonlyArray<string>> {
    const state = this.projects.get(project);
    const folder = state === undefined || names.length === 0 ? undefined : await this.deps.folder(project);
    if (state === undefined || folder === undefined) return [];
    const artifacts = records.filter((record): record is ArtifactRecord => isArtifact(record) && record.props.file !== "");
    const touched = await state.loads.touched(folder, names, artifacts.map((record) => record.props.file));
    const changed = new Map<string, string>();
    for (const file of touched) {
      const signature = await state.loads.signature(folder, file);
      const before = state.known.get(file);
      state.known.set(file, signature);
      if (before !== undefined && before !== signature) changed.set(file, signature);
    }
    if (this.projects.get(project) !== state) return [];
    for (const record of artifacts) {
      const signature = changed.get(record.props.file);
      if (signature === undefined || this.deps.renderer === undefined || state.timers.has(record.id)) continue;
      if (state.rendered.get(record.id) !== signature) this.schedule(project, record, false);
    }
    return [...changed.keys()];
  }

  forget(project: string): void {
    const state = this.projects.get(project);
    if (state === undefined) return;
    for (const timer of state.timers.values()) clearTimeout(timer);
    this.projects.delete(project);
  }

  private consider(project: string, shape: ArtifactRecord, kit: Kit | null, fromKit = false): void {
    if (this.deps.renderer === undefined || shape.props.file === "") return;
    const state = this.of(project);
    const mode = kit === null ? null : (typeof shape.props.mode === "string" && kit.modes.includes(shape.props.mode) ? shape.props.mode : kit.modes[0]!);
    const layout = artifactLayoutSize(shape.props);
    const now: Seen = { file: shape.props.file, w: layout.w, h: layout.h, dials: JSON.stringify(shape.props.dials ?? null), mode, kit: kit === null ? null : kitStamp(kit) };
    const last = state.seen.get(shape.id);
    if (last === undefined) state.fresh.add(shape.id);
    else if (last.file === now.file && last.dials === now.dials && last.mode === now.mode && last.kit === now.kit && snapshotFits(last, now)) return;
    else state.fresh.delete(shape.id);
    state.seen.set(shape.id, now);
    this.schedule(project, shape, fromKit);
  }

  private schedule(project: string, shape: ArtifactRecord, fromKit: boolean): void {
    const state = this.of(project);
    clearTimeout(state.timers.get(shape.id));
    const timer = setTimeout(() => {
      state.timers.delete(shape.id);
      this.queue = this.queue.then(() => this.render(project, state, shape.id, fromKit)).catch((error: unknown) => logError(`snapshot of ${shape.id} in ${project}: ${errorText(error)}`));
    }, DEBOUNCE_MS);
    timer.unref();
    state.timers.set(shape.id, timer);
  }

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

  private async render(project: string, state: ProjectSnapshots, shapeId: string, onlyIfTokens = false): Promise<void> {
    const renderer = this.deps.renderer;
    if (renderer === undefined || this.projects.get(project) !== state) return;
    const shape = (await this.deps.read(project)).find((record) => record.id === shapeId);
    if (!isArtifact(shape) || shape.props.file === "") return;
    const folder = await this.deps.folder(project);
    if (folder === undefined) return;
    const size = artifactLayoutSize(shape.props);
    if (onlyIfTokens && !(await readFile(join(folder, shape.props.file), "utf8").catch(() => "")).includes("unframed-tokens.js")) return;
    await ensurePinnedComponents(folder, shape.props.file);
    const want = state.seen.get(shapeId);
    const made = { mode: want?.mode ?? null, kit: want?.kit ?? null };
    const signature = await state.loads.signature(folder, shape.props.file);
    const dir = join(folder, SNAPSHOT_FOLDER);
    const name = snapshotFileName(shape.props.file, size, made);
    if (state.fresh.delete(shapeId)) {
      const stored = await readFile(join(dir, `${name}.sig`), "utf8").catch(() => undefined);
      const cached = stored === signature && (await this.list(project)).some((snapshot) => snapshot.file === shape.props.file && snapshotFits(snapshot, size) && (snapshot.mode ?? null) === made.mode && (snapshot.kit ?? null) === made.kit);
      if (cached) {
        state.rendered.set(shapeId, signature);
        return;
      }
    }
    state.rendered.set(shapeId, signature);
    const picture = await renderer({
      project,
      kind: shape.type,
      file: shape.props.file,
      w: size.w,
      h: size.h,
      dials: shape.props.dials,
      url: artifactUrl({ appHostname: "localhost", previewPort: this.deps.previewPort, project, file: shape.props.file, kind: shape.type }),
      ...made,
    });
    if (picture === undefined || this.projects.get(project) !== state) return;
    await mkdir(dir, { recursive: true });
    const temp = join(dir, `.${name}.${process.pid}.tmp`);
    await writeFile(temp, picture);
    await rename(temp, join(dir, name));
    await writeFile(join(dir, `${name}.sig`), signature);
    const info = await stat(join(dir, name));
    this.deps.publish(project, { file: shape.props.file, w: Math.round(size.w), h: Math.round(size.h), at: Math.floor(info.mtimeMs), ...made });
  }
}
