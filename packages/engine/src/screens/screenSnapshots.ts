import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Instance, ScreenSnapshot } from "@unframed/contracts";
import { screenSnapshotName, screenUrl, STEP_TIMEOUT_MS, stateRoute } from "@unframed/domain";
import type { TLRecord } from "@tldraw/tlschema";
import type { HeadlessChrome } from "../artifacts/headlessChrome.ts";
import { stubSnapshotPng } from "../artifacts/snapshots.ts";
import { errorText, logError } from "../log.ts";
import type { ScreenStatePayload } from "../instances/stateTokens.ts";
import { isScreenShape, type ScreenShape } from "./firstScreen.ts";
import { screenStatePayload } from "./screenState.ts";

export const SCREEN_SNAPSHOT_FOLDER = join(".cache", "screens");

const DEBOUNCE_MS = 1000;
const SETTLE_MS = 500;
const LOAD_TIMEOUT_MS = 20_000;

export interface ScreenJob {
  readonly url: string;
  readonly w: number;
  readonly h: number;
  readonly dials: Readonly<Record<string, unknown>> | undefined;
  readonly steps?: number;
}

export type ScreenRenderer = (job: ScreenJob) => Promise<Buffer | undefined>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const stubScreenRenderer: ScreenRenderer = async (job) => {
  await sleep(150);
  return stubSnapshotPng({ url: job.url, w: job.w, h: job.h, dials: job.dials ?? null });
};

export const chromeScreenRenderer =
  (chrome: HeadlessChrome): ScreenRenderer =>
  (job) =>
    chrome.use(async (browser) => {
      const page = await browser.newPage();
      try {
        await page.setViewport({ width: Math.max(1, Math.round(job.w)), height: Math.max(1, Math.round(job.h)), deviceScaleFactor: 2 });
        await page.goto(job.url, { waitUntil: "load", timeout: LOAD_TIMEOUT_MS });
        if (job.steps !== undefined) {
          await page
            .waitForFunction("window.__unframedStateResult !== undefined || window.__unframedScreenBridge !== true", { timeout: job.steps * (STEP_TIMEOUT_MS + 1000) + LOAD_TIMEOUT_MS })
            .catch(() => undefined);
        }
        if (job.dials !== undefined && Object.keys(job.dials).length > 0) {
          await page.evaluate(`window.postMessage({ type: "unframed:dials:set", values: ${JSON.stringify(job.dials)} }, window.location.origin)`);
        }
        await sleep(SETTLE_MS);
        return Buffer.from(await page.screenshot({ type: "png" }));
      } finally {
        await page.close().catch(() => undefined);
      }
    });

interface Signature {
  readonly instance: string;
  readonly route: string;
  readonly w: number;
  readonly h: number;
  readonly dials: Readonly<Record<string, unknown>> | null;
  readonly state?: ScreenStatePayload;
}

const signatureOf = (shape: ScreenShape): Signature => {
  const state = screenStatePayload(shape.props);
  return {
    instance: shape.props.instance,
    route: shape.props.route,
    w: Math.round(shape.props.w),
    h: Math.round(shape.props.h),
    dials: shape.props.dials ?? null,
    ...(state === undefined ? {} : { state }),
  };
};

interface ScreenSnapshotDeps {
  readonly renderer: ScreenRenderer | undefined;
  readonly folder: (project: string) => Promise<string | undefined>;
  readonly read: (project: string) => Promise<ReadonlyArray<TLRecord>>;
  readonly instance: (project: string, id: string) => Promise<Instance | undefined>;
  readonly publish: (project: string, snapshot: ScreenSnapshot) => void;
  readonly stateToken?: (project: string, id: string, payload: ScreenStatePayload) => Promise<string>;
}

interface ProjectScreens {
  readonly timers: Map<string, ReturnType<typeof setTimeout>>;
  readonly sessions: Map<string, number>;
  readonly rendered: Map<string, number>;
}

export class ScreenSnapshots {
  private readonly deps: ScreenSnapshotDeps;
  private readonly projects = new Map<string, ProjectScreens>();
  private readonly liveStates = new Map<string, boolean>();
  private session = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(deps: ScreenSnapshotDeps) {
    this.deps = deps;
  }

  opened(project: string, records: ReadonlyArray<TLRecord>): void {
    if (!this.projects.has(project)) this.projects.set(project, { timers: new Map(), sessions: new Map(), rendered: new Map() });
    this.consider(project, records);
  }

  committed(project: string, put: ReadonlyArray<TLRecord>): void {
    if (this.projects.has(project)) this.consider(project, put);
  }

  forget(project: string): void {
    const state = this.projects.get(project);
    if (state === undefined) return;
    for (const timer of state.timers.values()) clearTimeout(timer);
    this.projects.delete(project);
  }

  instanceChanged(instance: Instance): void {
    const key = `${instance.repository}/${instance.id}`;
    const live = instance.state === "live" && instance.proxyPort !== null;
    const was = this.liveStates.get(key) ?? false;
    this.liveStates.set(key, live);
    const state = this.projects.get(instance.repository);
    if (!live || was || state === undefined) return;
    state.sessions.set(instance.id, ++this.session);
    void this.deps.read(instance.repository).then(
      (records) => this.consider(instance.repository, records.filter((record) => isScreenShape(record) && record.props.instance === instance.id)),
      () => undefined,
    );
  }

  async list(project: string): Promise<ScreenSnapshot[]> {
    const folder = await this.deps.folder(project);
    if (folder === undefined) return [];
    const dir = join(folder, SCREEN_SNAPSHOT_FOLDER);
    const names = await readdir(dir).catch(() => [] as string[]);
    const found: ScreenSnapshot[] = [];
    for (const name of names) {
      if (!name.endsWith(".png")) continue;
      const bare = name.slice(0, -".png".length);
      const signature = await readFile(join(dir, `${bare}.json`), "utf8").then((text) => JSON.parse(text) as Signature, () => undefined);
      const info = await stat(join(dir, name)).catch(() => undefined);
      if (signature !== undefined && info?.isFile()) found.push({ shape: `shape:${bare}`, w: signature.w, h: signature.h, at: Math.floor(info.mtimeMs) });
    }
    return found.sort((a, b) => a.at - b.at);
  }

  private consider(project: string, records: ReadonlyArray<TLRecord>): void {
    if (this.deps.renderer === undefined) return;
    const state = this.projects.get(project);
    if (state === undefined) return;
    for (const record of records) {
      if (!isScreenShape(record) || screenSnapshotName(record.id) === undefined) continue;
      clearTimeout(state.timers.get(record.id));
      const timer = setTimeout(() => {
        state.timers.delete(record.id);
        this.queue = this.queue.then(() => this.render(project, state, record.id)).catch((error: unknown) => logError(`snapshot of ${record.id} in ${project}: ${errorText(error)}`));
      }, DEBOUNCE_MS);
      timer.unref();
      state.timers.set(record.id, timer);
    }
  }

  private async render(project: string, state: ProjectScreens, shapeId: string): Promise<void> {
    const renderer = this.deps.renderer;
    if (renderer === undefined || this.projects.get(project) !== state) return;
    const shape = (await this.deps.read(project)).find((record) => record.id === shapeId);
    const name = screenSnapshotName(shapeId);
    if (!isScreenShape(shape) || name === undefined) return;
    const instance = await this.deps.instance(project, shape.props.instance);
    if (instance === undefined || instance.state !== "live" || instance.proxyPort === null) return;
    const folder = await this.deps.folder(project);
    if (folder === undefined) return;
    const dir = join(folder, SCREEN_SNAPSHOT_FOLDER);
    const bare = name.slice(0, -".png".length);
    const signature = signatureOf(shape);
    const text = JSON.stringify(signature);
    const session = state.sessions.get(instance.id) ?? 0;
    const stored = await readFile(join(dir, `${bare}.json`), "utf8").catch(() => undefined);
    if (stored === text && state.rendered.get(shapeId) === session) return;
    state.rendered.set(shapeId, session);
    const token = signature.state === undefined || this.deps.stateToken === undefined ? undefined : await this.deps.stateToken(project, instance.id, signature.state);
    const picture = await renderer({
      url: screenUrl(instance.proxyPort, token === undefined ? signature.route : stateRoute(signature.route, token)),
      w: signature.w,
      h: signature.h,
      dials: shape.props.dials,
      ...(token === undefined ? {} : { steps: signature.state!.steps.length }),
    });
    if (picture === undefined || this.projects.get(project) !== state) return;
    await mkdir(dir, { recursive: true });
    const temp = join(dir, `.${name}.${process.pid}.tmp`);
    await writeFile(temp, picture);
    await rename(temp, join(dir, name));
    await writeFile(join(dir, `${bare}.json`), text);
    const info = await stat(join(dir, name));
    this.deps.publish(project, { shape: shapeId, w: signature.w, h: signature.h, at: Math.floor(info.mtimeMs) });
  }
}
