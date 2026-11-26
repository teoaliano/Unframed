import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Instance, ScreenSnapshot } from "@unframed/contracts";
import { partExtension, pictureFileName, resolvePictureParts, screenSignature, screenSnapshotName, screenUrl, STEP_TIMEOUT_MS, stateRoute } from "@unframed/domain";
import type { TLRecord } from "@tldraw/tlschema";
import type { Page } from "puppeteer-core";
import type { HeadlessChrome } from "../artifacts/headlessChrome.ts";
import { stubSnapshotPng } from "../artifacts/snapshots.ts";
import { errorText, logError, logInfo } from "../log.ts";
import type { ScreenStatePayload } from "../instances/stateTokens.ts";
import { isScreenShape, type ScreenShape } from "./firstScreen.ts";
import { pictureContentType, pictureKey, type PictureRasters, type PictureStore } from "./pictureStore.ts";
import { screenStatePayload } from "./screenState.ts";

export const SCREEN_SNAPSHOT_FOLDER = join(".cache", "screens");

const DEBOUNCE_MS = 1000;
const SETTLE_MS = 500;
const LOAD_TIMEOUT_MS = 20_000;
const SNAPSHOT_TIMEOUT_MS = 15_000;
const PICTURE_ORIGIN = "http://picture.invalid";
const PICTURE_PAGE = `${PICTURE_ORIGIN}/page.html`;

export interface ScreenJob {
  readonly url: string;
  readonly w: number;
  readonly h: number;
  readonly dials: Readonly<Record<string, unknown>> | undefined;
  readonly steps?: number | undefined;
}

export interface PagePart {
  readonly url: string;
  readonly type: string;
  readonly data: string | null;
}

export interface PageCopy {
  readonly html: string;
  readonly w: number;
  readonly h: number;
  readonly parts: ReadonlyArray<PagePart>;
}

export interface ScreenCapture extends PictureRasters {
  readonly snapshot?: PageCopy | undefined;
}

export type ScreenRenderer = (job: ScreenJob) => Promise<ScreenCapture | undefined>;

export interface RasterJob {
  readonly html: string;
  readonly w: number;
  readonly h: number;
  readonly part: (name: string) => Promise<Buffer | undefined>;
}

export type ScreenRasterizer = (job: RasterJob) => Promise<PictureRasters | undefined>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const stubRasters = (text: Readonly<Record<string, unknown>>): PictureRasters => ({
  png: stubSnapshotPng({ ...text, variant: "full" }),
  w384: stubSnapshotPng({ ...text, variant: "w384" }),
  w128: stubSnapshotPng({ ...text, variant: "w128" }),
});

export const stubScreenRenderer: ScreenRenderer = async (job) => {
  await sleep(150);
  return {
    ...stubRasters({ url: job.url, w: job.w, h: job.h, dials: job.dials ?? null }),
    snapshot: {
      html: `<!doctype html><html><head><style>h1 { color: rgb(1, 2, 3); }</style></head><body><h1>Stub</h1><p>${escapeHtml(job.url)}</p></body></html>`,
      w: job.w,
      h: job.h,
      parts: [],
    },
  };
};

export const stubScreenRasterizer: ScreenRasterizer = async (job) => {
  await sleep(50 + Math.min(400, Math.floor(job.html.length / 100)));
  return stubRasters({ html: pictureKey(job.html, job.w, job.h), w: job.w, h: job.h });
};

const rastersOf = async (page: Page, w: number, h: number): Promise<PictureRasters> => {
  const png = Buffer.from(await page.screenshot({ type: "png" }));
  const at = (await page.evaluate("[window.scrollX, window.scrollY]")) as [number, number];
  const scaled = async (width: number) =>
    Buffer.from(await page.screenshot({ type: "png", clip: { x: at[0], y: at[1], width: w, height: h, scale: width / (w * 2) } }));
  return { png, w384: await scaled(384), w128: await scaled(128) };
};

const viewportOf = (w: number, h: number) => ({ width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)), deviceScaleFactor: 2 });

const isPageCopy = (value: unknown): value is PageCopy => {
  const copy = value as { html?: unknown; w?: unknown; h?: unknown; parts?: unknown } | null;
  return (
    typeof copy === "object" &&
    copy !== null &&
    typeof copy.html === "string" &&
    typeof copy.w === "number" &&
    typeof copy.h === "number" &&
    Array.isArray(copy.parts) &&
    copy.parts.every((part: { url?: unknown; type?: unknown; data?: unknown } | null) => typeof part === "object" && part !== null && typeof part.url === "string" && typeof part.type === "string" && (typeof part.data === "string" || part.data === null))
  );
};

export const chromeScreenRenderer =
  (chrome: HeadlessChrome): ScreenRenderer =>
  (job) =>
    chrome.use(async (browser) => {
      const page = await browser.newPage();
      try {
        const viewport = viewportOf(job.w, job.h);
        await page.setViewport(viewport);
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
        const snapshot = await Promise.race([
          page.evaluate("window.__unframedSnapshot ? window.__unframedSnapshot() : null").catch(() => null),
          sleep(SNAPSHOT_TIMEOUT_MS).then(() => null),
        ]);
        const rasters = await rastersOf(page, viewport.width, viewport.height);
        return isPageCopy(snapshot) ? { ...rasters, snapshot } : rasters;
      } finally {
        await page.close().catch(() => undefined);
      }
    });

export const chromeScreenRasterizer =
  (chrome: HeadlessChrome): ScreenRasterizer =>
  (job) =>
    chrome.use(async (browser) => {
      const page = await browser.newPage();
      try {
        const viewport = viewportOf(job.w, job.h);
        await page.setViewport(viewport);
        await page.setJavaScriptEnabled(false);
        await page.setRequestInterception(true);
        page.on("request", (request) => {
          const url = request.url();
          if (url.startsWith("data:")) return void request.continue().catch(() => undefined);
          if (url === PICTURE_PAGE) return void request.respond({ status: 200, contentType: "text/html; charset=utf-8", body: job.html }).catch(() => undefined);
          const name = url.startsWith(`${PICTURE_ORIGIN}/parts/`) ? url.slice(`${PICTURE_ORIGIN}/parts/`.length) : undefined;
          if (name === undefined || pictureFileName(`parts/${name}`) === undefined) return void request.abort("blockedbyclient").catch(() => undefined);
          void job.part(name).then(
            (bytes) =>
              bytes === undefined
                ? request.abort("blockedbyclient")
                : request.respond({ status: 200, contentType: pictureContentType(name), body: bytes }),
            () => request.abort("blockedbyclient"),
          ).catch(() => undefined);
        });
        await page.goto(PICTURE_PAGE, { waitUntil: "load", timeout: LOAD_TIMEOUT_MS });
        await page.evaluate("document.fonts.ready.then(() => true)").catch(() => undefined);
        return await rastersOf(page, viewport.width, viewport.height);
      } finally {
        await page.close().catch(() => undefined);
      }
    });

interface LegacySignature {
  readonly w: number;
  readonly h: number;
}

interface ScreenSnapshotDeps {
  readonly renderer: ScreenRenderer | undefined;
  readonly rasterizer: ScreenRasterizer | undefined;
  readonly pictures: PictureStore;
  readonly folder: (project: string) => Promise<string | undefined>;
  readonly read: (project: string) => Promise<ReadonlyArray<TLRecord>>;
  readonly instance: (project: string, id: string) => Promise<Instance | undefined>;
  readonly stateToken: (project: string, id: string, payload: ScreenStatePayload) => Promise<string>;
  readonly setPicture: (project: string, shapeId: string, key: string) => Promise<void>;
}

interface ProjectScreens {
  readonly timers: Map<string, ReturnType<typeof setTimeout>>;
  readonly attempted: Map<string, string>;
}

export class ScreenCaptureRefused extends Error {}

export class ScreenSnapshots {
  private readonly deps: ScreenSnapshotDeps;
  private readonly projects = new Map<string, ProjectScreens>();
  private readonly liveStates = new Map<string, boolean>();
  private readonly revisions = new Map<string, number>();
  private readonly firstRevision = Date.now();
  private readonly latestCaptures = new Map<string, number>();
  private captureCount = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(deps: ScreenSnapshotDeps) {
    this.deps = deps;
  }

  opened(project: string, records: ReadonlyArray<TLRecord>): void {
    if (!this.projects.has(project)) this.projects.set(project, { timers: new Map(), attempted: new Map() });
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
    if (live && !was) this.reconsider(instance.repository, instance.id);
  }

  touched(project: string, id: string): void {
    const key = `${project}/${id}`;
    this.revisions.set(key, this.revisionOf(project, id) + 1);
    this.reconsider(project, id);
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
      const signature = await readFile(join(dir, `${bare}.json`), "utf8").then((text) => JSON.parse(text) as LegacySignature, () => undefined);
      const info = await stat(join(dir, name)).catch(() => undefined);
      if (signature !== undefined && info?.isFile()) found.push({ shape: `shape:${bare}`, w: signature.w, h: signature.h, at: Math.floor(info.mtimeMs) });
    }
    return found.sort((a, b) => a.at - b.at);
  }

  async capture(project: string, shapeId: string, copy: PageCopy): Promise<string | null> {
    const shape = (await this.deps.read(project)).find((record) => record.id === shapeId);
    if (!isScreenShape(shape)) throw new ScreenCaptureRefused(`There is no Screen ${shapeId} on this canvas.`);
    const of = `${project}/${shapeId}`;
    const ticket = ++this.captureCount;
    this.latestCaptures.set(of, ticket);
    try {
      const html = await this.storeCopy(project, copy);
      const key = pictureKey(html, copy.w, copy.h);
      if (!(await this.deps.pictures.has(project, key))) {
        const rasterizer = this.deps.rasterizer;
        if (rasterizer === undefined) return null;
        const rasters = await rasterizer({ html, w: copy.w, h: copy.h, part: (name) => this.deps.pictures.read(project, `parts/${name}`) });
        if (rasters === undefined) return null;
        if ((await this.deps.pictures.putPicture(project, { html, w: copy.w, h: copy.h, ...rasters })) !== key) return null;
      }
      if (this.latestCaptures.get(of) !== ticket) return key;
      const latest = (await this.deps.read(project)).find((record) => record.id === shapeId);
      if (isScreenShape(latest)) await this.deps.pictures.remember(project, this.signatureOf(project, latest), key);
      await this.deps.setPicture(project, shapeId, key);
      logInfo(`${project}: stored a live picture of ${shapeId}`);
      return key;
    } finally {
      if (this.latestCaptures.get(of) === ticket) this.latestCaptures.delete(of);
    }
  }

  private revisionOf(project: string, id: string): number {
    return this.revisions.get(`${project}/${id}`) ?? this.firstRevision;
  }

  private signatureOf(project: string, shape: ScreenShape): string {
    return screenSignature({
      instance: shape.props.instance,
      revision: this.revisionOf(project, shape.props.instance),
      route: shape.props.route,
      steps: Array.isArray(shape.props.steps) ? shape.props.steps : [],
      mocks: Array.isArray(shape.props.mocks) ? shape.props.mocks : [],
      w: shape.props.w,
      h: shape.props.h,
      dials: shape.props.dials ?? null,
    });
  }

  private async storeCopy(project: string, copy: PageCopy): Promise<string> {
    const names: Array<string | undefined> = [];
    for (const part of copy.parts) {
      names.push(part.data === null || partExtension(part.type) === undefined ? undefined : await this.deps.pictures.putPart(project, Buffer.from(part.data, "base64"), part.type));
    }
    return resolvePictureParts(copy.html, names);
  }

  private reconsider(project: string, id: string): void {
    if (!this.projects.has(project)) return;
    void this.deps.read(project).then(
      (records) => this.consider(project, records.filter((record) => isScreenShape(record) && record.props.instance === id)),
      () => undefined,
    );
  }

  private consider(project: string, records: ReadonlyArray<TLRecord>): void {
    const state = this.projects.get(project);
    if (state === undefined) return;
    for (const record of records) {
      if (!isScreenShape(record) || screenSnapshotName(record.id) === undefined) continue;
      clearTimeout(state.timers.get(record.id));
      const timer = setTimeout(() => {
        state.timers.delete(record.id);
        this.queue = this.queue.then(() => this.render(project, state, record.id)).catch((error: unknown) => logError(`picture of ${record.id} in ${project}: ${errorText(error)}`));
      }, DEBOUNCE_MS);
      timer.unref();
      state.timers.set(record.id, timer);
    }
  }

  private async render(project: string, state: ProjectScreens, shapeId: string): Promise<void> {
    if (this.projects.get(project) !== state) return;
    const shape = (await this.deps.read(project)).find((record) => record.id === shapeId);
    if (!isScreenShape(shape)) return;
    const signature = this.signatureOf(project, shape);
    const known = await this.deps.pictures.keyFor(project, signature);
    if (known !== undefined && (await this.deps.pictures.has(project, known))) {
      if (shape.props.picture !== known) await this.deps.setPicture(project, shapeId, known);
      return;
    }
    const renderer = this.deps.renderer;
    if (renderer === undefined || state.attempted.get(shapeId) === signature) return;
    const instance = await this.deps.instance(project, shape.props.instance);
    if (instance === undefined || instance.state !== "live" || instance.proxyPort === null) return;
    state.attempted.set(shapeId, signature);
    const payload = screenStatePayload(shape.props);
    const token = payload === undefined ? undefined : await this.deps.stateToken(project, instance.id, payload);
    const captured = await renderer({
      url: screenUrl(instance.proxyPort, token === undefined ? shape.props.route : stateRoute(shape.props.route, token)),
      w: Math.round(shape.props.w),
      h: Math.round(shape.props.h),
      dials: shape.props.dials,
      steps: payload?.steps.length,
    });
    if (captured === undefined || this.projects.get(project) !== state) return;
    const html = captured.snapshot === undefined ? undefined : await this.storeCopy(project, captured.snapshot);
    const key = await this.deps.pictures.putPicture(project, { html, w: captured.snapshot?.w ?? shape.props.w, h: captured.snapshot?.h ?? shape.props.h, png: captured.png, w384: captured.w384, w128: captured.w128 });
    if (key === undefined) return;
    await this.deps.pictures.remember(project, signature, key);
    await this.deps.setPicture(project, shapeId, key);
    logInfo(`${project}: captured a picture of ${shapeId}`);
  }
}
