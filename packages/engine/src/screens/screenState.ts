import type { ScreenStep } from "@unframed/contracts";
import { checkMocks, checkSteps, NO_STATE_BRIDGE, screenUrl, STEP_TIMEOUT_MS, stateRoute, stepFailure } from "@unframed/domain";
import type { Page } from "puppeteer-core";
import type { HeadlessChrome } from "../artifacts/headlessChrome.ts";
import type { ScreenStatePayload } from "../instances/stateTokens.ts";

export const screenStatePayload = (props: { readonly steps?: unknown; readonly mocks?: unknown }): ScreenStatePayload | undefined => {
  const steps = checkSteps(props.steps);
  const mocks = checkMocks(props.mocks);
  const payload = { steps: "steps" in steps ? steps.steps : [], mocks: "mocks" in mocks ? mocks.mocks : [] };
  return payload.steps.length === 0 && payload.mocks.length === 0 ? undefined : payload;
};

export interface ProofJob {
  readonly url: string;
  readonly w: number;
  readonly h: number;
  readonly steps: number;
}

export type Proof = { readonly ok: true; readonly png: Buffer } | { readonly ok: false; readonly step: number | undefined; readonly reason: string; readonly png: Buffer };

export type StateProver = (job: ProofJob) => Promise<Proof | undefined>;

const LOAD_TIMEOUT_MS = 20_000;
const SETTLE_MS = 300;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const onScreen = <T>(chrome: HeadlessChrome, job: { readonly url: string; readonly w: number; readonly h: number }, use: (page: Page) => Promise<T>): Promise<T | undefined> =>
  chrome.use(async (browser) => {
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: Math.max(1, Math.round(job.w)), height: Math.max(1, Math.round(job.h)), deviceScaleFactor: 1 });
      await page.goto(job.url, { waitUntil: "load", timeout: LOAD_TIMEOUT_MS });
      return await use(page);
    } finally {
      await page.close().catch(() => undefined);
    }
  });

export const chromeStateProver =
  (chrome: HeadlessChrome): StateProver =>
  (job) =>
    onScreen(chrome, job, async (page) => {
      const shot = async () => Buffer.from(await page.screenshot({ type: "png" }));
      if ((await page.evaluate("window.__unframedScreenBridge === true")) !== true) return { ok: false, step: undefined, reason: NO_STATE_BRIDGE, png: await shot() };
      await page.waitForFunction("window.__unframedStateResult !== undefined", { timeout: job.steps * (STEP_TIMEOUT_MS + 1000) + LOAD_TIMEOUT_MS });
      const result = (await page.evaluate("window.__unframedStateResult")) as { ok?: boolean; step?: number; reason?: string };
      await sleep(SETTLE_MS);
      const png = await shot();
      return result.ok === true ? { ok: true, png } : { ok: false, step: typeof result.step === "number" ? result.step : undefined, reason: result.reason ?? "the step failed", png };
    });

export const proofUrl = (proxyPort: number, route: string, token: string | undefined): string => screenUrl(proxyPort, token === undefined ? route : stateRoute(route, token));

export const proofFailure = (proof: Extract<Proof, { ok: false }>, steps: ReadonlyArray<ScreenStep>): string => {
  return proof.step === undefined ? proof.reason : stepFailure(steps, proof.step, proof.reason);
};

export interface LocateJob {
  readonly url: string;
  readonly w: number;
  readonly h: number;
  readonly steps: number;
  readonly selector: string;
}

export interface Located {
  readonly bridge: boolean;
  readonly matched: boolean;
  readonly tag: string | null;
  readonly found: {
    readonly key: string;
    readonly selfMapped: boolean;
    readonly tag: string;
    readonly owner: string | null;
    readonly instanceOf: string | null;
    readonly props: Readonly<Record<string, unknown>> | null;
    readonly instanceIndex: number;
    readonly instanceCount: number;
    readonly source: { readonly file: string; readonly line: number; readonly col: number; readonly mapped: boolean } | null;
  } | null;
}

export type ElementLocator = (job: LocateJob) => Promise<Located | undefined>;

export const chromeElementLocator =
  (chrome: HeadlessChrome): ElementLocator =>
  (job) =>
    onScreen(chrome, job, async (page) => {
      if ((await page.evaluate("window.__unframedScreenBridge === true")) !== true) return { bridge: false, matched: false, tag: null, found: null };
      if (job.steps > 0) await page.waitForFunction("window.__unframedStateResult !== undefined", { timeout: job.steps * (STEP_TIMEOUT_MS + 1000) + LOAD_TIMEOUT_MS });
      await sleep(SETTLE_MS);
      const answer = (await page.evaluate(
        `(async () => { const el = document.querySelector(${JSON.stringify(job.selector)}); if (el === null) return { matched: false, tag: null, found: null }; const found = window.__unframedSource ? await window.__unframedSource.resolve(el) : null; return { matched: true, tag: el.tagName.toLowerCase(), found }; })()`,
      )) as Omit<Located, "bridge">;
      return { bridge: true, ...answer };
    });
