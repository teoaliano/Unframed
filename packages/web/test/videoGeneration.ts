/**
 * Browser-seam helpers for video: an engine with a key whose OpenRouter stub answers the
 * image catalogue, the video catalogue and its video-input finder, and the video jobs.
 */
import type { Locator, Page } from "@playwright/test";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { imageCatalogue, routes } from "../../engine/test/openRouterStub.ts";
import { videoCatalogue, videoInputFinder, videoJobs, type VideoJobs } from "../../engine/test/videoStub.ts";
import { expect, test as base, startHostedEngine } from "./fixtures.ts";
import { CATALOGUE, composer, KEY } from "./generation.ts";

export const SEEDANCE = "bytedance/seedance-2.0";

/** The default model with frames, tiers, ratios and audio; a model with exact sizes; one that takes no frames or video. */
export const VIDEO_CATALOGUE = [
  {
    id: SEEDANCE,
    name: "ByteDance: Seedance 2.0",
    created: 1_770_000_000,
    supported_durations: [5, 10],
    supported_resolutions: ["480p", "720p"],
    supported_aspect_ratios: ["16:9", "9:16", "1:1"],
    supported_frame_images: ["first_frame", "last_frame"],
    generate_audio: true,
    pricing_skus: { cents_per_second_output: 10, cents_per_second_output_720p: 20 },
  },
  {
    id: "google/veo-3.1",
    name: "Google: Veo 3.1",
    created: 1_775_000_000,
    supported_durations: [8, 4],
    supported_sizes: ["1280x720", "720x1280"],
    supported_frame_images: ["first_frame"],
    pricing_skus: { duration_seconds: 0.4 },
  },
  {
    id: "kwaivgi/kling-3",
    name: "Kling: 3",
    created: 1_760_000_000,
    supported_durations: [5],
    supported_aspect_ratios: ["16:9"],
  },
];

export interface VideoEngine {
  readonly engine: TestEngine;
  readonly jobs: VideoJobs;
}

export const startVideoGeneration = async (options: { env?: Record<string, string> } = {}): Promise<VideoEngine> => {
  const jobs = videoJobs();
  const engine = await startHostedEngine({
    dotenv: `OPENROUTER_API_KEY=${KEY}\n`,
    ...(options.env === undefined ? {} : { env: options.env }),
    stub: routes(
      imageCatalogue({ data: CATALOGUE }),
      videoCatalogue({ data: VIDEO_CATALOGUE }),
      videoInputFinder({ slugs: [{ slug: SEEDANCE, input_modalities: ["text", "image", "video"] }, { slug: "kwaivgi/kling-3", input_modalities: ["text"] }] }),
      jobs.handler,
    ),
  });
  return { engine, jobs };
};

export const test = base.extend<{ videoEngine: VideoEngine }>({
  // Not named "video": that is Playwright's own recording option. The pages close before the
  // engine goes: a live tab would otherwise reconnect to whichever engine is given the freed
  // port next and push this test's canvas into another test.
  videoEngine: async ({ context }, use) => {
    const video = await startVideoGeneration();
    await use(video);
    await context.close();
    await video.engine.dispose();
  },
});

export { expect };

export const tray = (page: Page): Locator => composer(page).getByTestId("composer-tray");
export const chips = (page: Page): Locator => tray(page).locator("[data-prop]");

/** Switches the open composer to the video medium and waits for the video catalogue. */
export const chooseVideo = async (page: Page): Promise<void> => {
  await composer(page).getByRole("radio", { name: "video" }).click();
  await expect(tray(page).getByTestId("model-chip")).toHaveText("seedance-2.0");
};

export const pickModel = async (page: Page, part: string): Promise<void> => {
  await tray(page).getByTestId("model-chip").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: part, exact: true }).click();
  await expect(dialog).toHaveCount(0);
};

/** Picks a value in a prop chip's menu. */
export const setProp = async (page: Page, label: string, value: string): Promise<void> => {
  await tray(page).locator(`[aria-label^="${label} "]`).click();
  await page.getByRole("menu", { name: label }).getByRole("menuitemradio", { name: value }).click();
  await expect(page.getByRole("menu", { name: label })).toHaveCount(0);
};

/** Adds a prop from "+ add prop" and closes the value menu it opens. */
export const addProp = async (page: Page, item: string, label: string): Promise<void> => {
  await tray(page).getByRole("button", { name: "+ add prop" }).click();
  await page.getByRole("menu", { name: "Add prop" }).getByRole("menuitem", { name: item }).click();
  await expect(page.getByRole("menu", { name: label })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu", { name: label })).toHaveCount(0);
};

export const badge = (page: Page, id: string): Locator => page.locator(`[data-role-for="${id}"]`);

export const statusLines = (page: Page): Locator => composer(page).getByTestId("composer-status").locator("p");
