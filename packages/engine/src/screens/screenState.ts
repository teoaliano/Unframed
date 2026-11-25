import type { ScreenStep } from "@unframed/contracts";
import { checkMocks, checkSteps, NO_STATE_BRIDGE, screenUrl, STEP_TIMEOUT_MS, stateRoute, stepFailure } from "@unframed/domain";
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

export type Proof = { readonly ok: true; readonly png: Buffer } | { readonly ok: false; readonly step: number | undefined; readonly reason: string; readonly png: Buffer | undefined };

export type StateProver = (job: ProofJob) => Promise<Proof | undefined>;

const LOAD_TIMEOUT_MS = 20_000;
const SETTLE_MS = 300;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const chromeStateProver =
  (chrome: HeadlessChrome): StateProver =>
  (job) =>
    chrome.use(async (browser) => {
      const page = await browser.newPage();
      try {
        await page.setViewport({ width: Math.max(1, Math.round(job.w)), height: Math.max(1, Math.round(job.h)), deviceScaleFactor: 1 });
        await page.goto(job.url, { waitUntil: "load", timeout: LOAD_TIMEOUT_MS });
        const shot = async () => Buffer.from(await page.screenshot({ type: "png" }));
        if ((await page.evaluate("window.__unframedScreenBridge === true")) !== true) return { ok: false, step: undefined, reason: NO_STATE_BRIDGE, png: await shot() };
        await page.waitForFunction("window.__unframedStateResult !== undefined", { timeout: job.steps * (STEP_TIMEOUT_MS + 1000) + LOAD_TIMEOUT_MS });
        const result = (await page.evaluate("window.__unframedStateResult")) as { ok?: boolean; step?: number; reason?: string };
        await sleep(SETTLE_MS);
        const png = await shot();
        return result.ok === true ? { ok: true, png } : { ok: false, step: typeof result.step === "number" ? result.step : undefined, reason: result.reason ?? "the step failed", png };
      } finally {
        await page.close().catch(() => undefined);
      }
    });

export const proofUrl = (proxyPort: number, route: string, token: string | undefined): string => screenUrl(proxyPort, token === undefined ? route : stateRoute(route, token));

export const proofFailure = (proof: Extract<Proof, { ok: false }>, steps: ReadonlyArray<ScreenStep>): string => {
  return proof.step === undefined ? proof.reason : stepFailure(steps, proof.step, proof.reason);
};
