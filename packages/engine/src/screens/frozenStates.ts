import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FREEZE_ID, frozenState, NO_STATE_BRIDGE, type FrozenState } from "@unframed/domain";
import type { Page } from "puppeteer-core";
import type { HeadlessChrome } from "../artifacts/headlessChrome.ts";

const STATES_FOLDER = "states";

export const freezeIdOf = (state: FrozenState): string => `s_${createHash("sha256").update(JSON.stringify(state)).digest("hex").slice(0, 32)}`;

export const writeFrozen = async (projectFolder: string, state: FrozenState): Promise<string> => {
  const id = freezeIdOf(state);
  await mkdir(join(projectFolder, STATES_FOLDER), { recursive: true });
  await writeFile(join(projectFolder, STATES_FOLDER, `${id}.json`), JSON.stringify(state));
  return id;
};

export const readFrozen = async (projectFolder: string | undefined, id: string): Promise<FrozenState | undefined> => {
  if (projectFolder === undefined || !FREEZE_ID.test(id)) return undefined;
  const text = await readFile(join(projectFolder, STATES_FOLDER, `${id}.json`), "utf8").catch(() => undefined);
  if (text === undefined) return undefined;
  try {
    return frozenState(JSON.parse(text));
  } catch {
    return undefined;
  }
};

export interface FreezeJob {
  readonly url: string;
  readonly w: number;
  readonly h: number;
  readonly steps: number;
}

export type Freeze = { readonly ok: true; readonly state: FrozenState } | { readonly ok: false; readonly reason: string };

export type Freezer = (job: FreezeJob) => Promise<Freeze | undefined>;

export interface RestoreProof {
  readonly restored: boolean;
  readonly png: Buffer;
}

export type RestoreProver = (job: FreezeJob) => Promise<RestoreProof | undefined>;

const LOAD_TIMEOUT_MS = 20_000;
const QUIET_MS = 800;
const STEP_ALLOWANCE_MS = 6_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const withPage = <A>(chrome: HeadlessChrome, job: FreezeJob, run: (page: Page) => Promise<A>) =>
  chrome.use(async (browser) => {
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: Math.max(1, Math.round(job.w)), height: Math.max(1, Math.round(job.h)), deviceScaleFactor: 1 });
      await page.goto(job.url, { waitUntil: "load", timeout: LOAD_TIMEOUT_MS });
      return await run(page);
    } finally {
      await page.close().catch(() => undefined);
    }
  });

export const chromeFreezer =
  (chrome: HeadlessChrome): Freezer =>
  (job): Promise<Freeze | undefined> =>
    withPage(chrome, job, async (page) => {
      if ((await page.evaluate("typeof window.__unframedFreeze === 'function'")) !== true) return { ok: false, reason: NO_STATE_BRIDGE };
      if (job.steps > 0) {
        await page.waitForFunction("window.__unframedStateResult !== undefined", { timeout: job.steps * STEP_ALLOWANCE_MS + LOAD_TIMEOUT_MS });
        const result = (await page.evaluate("window.__unframedStateResult")) as { ok?: boolean; reason?: string };
        if (result.ok !== true) return { ok: false, reason: result.reason ?? "a step failed" };
      }
      await sleep(QUIET_MS);
      const state = frozenState(await page.evaluate("window.__unframedFreeze()"));
      return state === undefined ? { ok: false, reason: "the page gave no state to freeze" } : { ok: true, state };
    });

export const chromeRestoreProver =
  (chrome: HeadlessChrome): RestoreProver =>
  (job): Promise<RestoreProof | undefined> =>
    withPage(chrome, job, async (page) => {
      const restored = await page
        .waitForFunction("window.__unframedRestored !== undefined", { timeout: job.steps * STEP_ALLOWANCE_MS + LOAD_TIMEOUT_MS + 20_000 })
        .then(() => page.evaluate("window.__unframedRestored === true"))
        .catch(() => false);
      await sleep(QUIET_MS);
      return { restored: restored === true, png: Buffer.from(await page.screenshot({ type: "png" })) };
    });
