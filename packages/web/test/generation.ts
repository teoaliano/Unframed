/**
 * Browser-seam helpers for generation: an engine with a key whose OpenRouter stub answers
 * the image catalogue, pricing and generation, and ways to find the toolbar and composer.
 */
import type { Locator, Page } from "@playwright/test";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { imageCatalogue, imageGeneration, imagePricing, routes, type ImageAnswer, type ImageRequest } from "../../engine/test/openRouterStub.ts";
import { centre, shapeOnScreen } from "./canvas.ts";
import { test as base, startHostedEngine } from "./fixtures.ts";
import { pngBytes } from "./images.ts";

export const KEY = "sk-or-v1-browser-test-0000";

const enumOf = (...values: string[]) => ({ type: "enum", values });

/** A small image catalogue: the default model with every prop, and a few others. */
export const CATALOGUE = [
  {
    id: "openai/gpt-image-2",
    name: "OpenAI: GPT Image 2",
    created: 1_760_000_000,
    supported_parameters: {
      resolution: enumOf("1K", "2K", "4K"),
      aspect_ratio: enumOf("1:1", "2:3", "3:2", "16:9"),
      quality: enumOf("low", "medium", "high", "auto"),
      background: enumOf("auto", "transparent", "opaque"),
      output_format: enumOf("png", "webp"),
      input_references: { type: "range", min: 0, max: 4 },
    },
  },
  {
    id: "google/gemini-3-pro-image",
    name: "Google: Gemini 3 Pro Image",
    created: 1_770_000_000,
    supported_parameters: { aspect_ratio: enumOf("1:1", "9:16", "16:9"), input_references: { type: "range", min: 0, max: 1 } },
  },
  { id: "recraft/recraft-v4", name: "Recraft: V4", created: 1_750_000_000, supported_parameters: { output_format: enumOf("svg") } },
  { id: "~black-forest-labs/flux-2", name: "Black Forest Labs: FLUX.2", created: 1_740_000_000, supported_parameters: { aspect_ratio: ["1:1", "4:3"] } },
  { id: "openai/gpt-image-1-mini", name: "OpenAI: GPT Image 1 Mini", created: null, supported_parameters: { quality: ["low", "high"] } },
];

const sku = (cost: number, variant?: string) => ({ unit: "image", billable: "output_image", cost_usd: cost, ...(variant === undefined ? {} : { variant }) });

export const PRICING: Record<string, unknown> = {
  "openai/gpt-image-2": {
    data: { endpoints: [{ pricing: [sku(0.011, "low_1k"), sku(0.042, "medium_1k"), sku(0.167, "high_1k"), sku(0.25, "high_2k"), { unit: "image", billable: "input_image", cost_usd: 0.01 }] }] },
  },
  "google/gemini-3-pro-image": { data: { endpoints: [{ pricing: [{ unit: "token", billable: "output_image", cost_usd: 0.00003 }] }] } },
  "recraft/recraft-v4": { data: { endpoints: [{ pricing: [sku(0.035)] }] } },
  "~black-forest-labs/flux-2": { data: { endpoints: [{ pricing: [sku(0.04)] }] } },
  "openai/gpt-image-1-mini": { data: { endpoints: [{ pricing: [sku(0.005)] }] } },
};

export interface GenerationEngine {
  readonly engine: TestEngine;
  readonly requests: ImageRequest[];
  answer(script: (request: ImageRequest) => ImageAnswer | Promise<ImageAnswer>): void;
  /** Holds pricing answers for a model until released. */
  holdPricing(model: string): () => void;
}

export const startGeneration = async (options: { key?: boolean; dotenv?: string } = {}): Promise<GenerationEngine> => {
  let script: (request: ImageRequest) => ImageAnswer | Promise<ImageAnswer> = () => ({ kind: "image", bytes: pngBytes(96, 64), cost: 0.19 });
  const images = imageGeneration((request) => script(request));
  const held = new Map<string, Promise<void>>();
  const pricing = imagePricing(PRICING);
  const engine = await startHostedEngine({
    dotenv: options.dotenv ?? (options.key === false ? "" : `OPENROUTER_API_KEY=${KEY}\n`),
    stub: routes(imageCatalogue({ data: CATALOGUE }), (req, body, res) => {
      const match = /^\/api\/v1\/images\/models\/(.+)\/endpoints$/.exec(new URL(req.url ?? "/", "http://stub").pathname);
      const hold = match ? held.get(decodeURIComponent(match[1]!)) : undefined;
      if (!hold) return pricing(req, body, res);
      void hold.then(() => pricing(req, body, res));
      return true;
    }, images.handler),
  });
  return {
    engine,
    requests: images.requests,
    answer: (next) => {
      script = next;
    },
    holdPricing: (model) => {
      let release!: () => void;
      held.set(model, new Promise<void>((resolve) => (release = resolve)));
      return () => {
        held.delete(model);
        release();
      };
    },
  };
};

export const test = base.extend<{ generation: GenerationEngine }>({
  generation: async ({}, use) => {
    const generation = await startGeneration();
    await use(generation);
    await generation.engine.dispose();
  },
});

export { expect } from "./fixtures.ts";

/** The selection toolbar, as bar or composer. */
export const toolbar = (page: Page): Locator => page.getByTestId("selection-toolbar");

export const composer = (page: Page): Locator => page.getByTestId("composer");

/** The composer's instruction box. */
export const instructionBox = (page: Page): Locator => composer(page).getByRole("textbox", { name: "What should this make?" });

/** The send button of the Generate tray. */
export const sendButton = (page: Page): Locator => composer(page).getByRole("button", { name: /^Generate/ });

/** Clicks the middle of a shape, as a person selects it. */
export const clickShape = async (page: Page, id: string, modifiers?: Array<"Shift">): Promise<void> => {
  const at = await centre(shapeOnScreen(page, id));
  if (modifiers?.includes("Shift")) await page.keyboard.down("Shift");
  await page.mouse.click(at.x, at.y);
  if (modifiers?.includes("Shift")) await page.keyboard.up("Shift");
};

/** Selects a group by clicking its label. */
export const selectGroup = async (page: Page, id: string): Promise<void> => {
  const box = (await shapeOnScreen(page, id).boundingBox())!;
  await page.mouse.click(box.x + 10, box.y - 8);
};
