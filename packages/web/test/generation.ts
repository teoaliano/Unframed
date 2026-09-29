/**
 * Browser-seam helpers for generation: an engine with a key whose OpenRouter stub answers
 * the image catalogue, pricing and generation, and ways to find the toolbar and composer.
 */
import type { Locator, Page } from "@playwright/test";
import type { StubHandler, TestEngine } from "../../engine/test/engineProcess.ts";
import { imageCatalogue, imageGeneration, imagePricing, routes, type ImageAnswer, type ImageRequest } from "../../engine/test/openRouterStub.ts";
import { centre, shapeOnScreen } from "./canvas.ts";
import { expect, test as base, startHostedEngine } from "./fixtures.ts";
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

export const startGeneration = async (options: { key?: boolean; dotenv?: string; extra?: StubHandler[] } = {}): Promise<GenerationEngine> => {
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
    }, images.handler, ...(options.extra ?? [])),
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

export { expect };

/** The selection toolbar, as bar or composer. */
export const toolbar = (page: Page): Locator => page.getByTestId("selection-toolbar");

export const composer = (page: Page): Locator => page.getByTestId("composer");

/** The composer's instruction box. */
export const instructionBox = (page: Page): Locator => composer(page).getByRole("textbox", { name: "What should this make?" });

export const sendButton = (page: Page): Locator => composer(page).getByRole("button", { name: /^Generate/ });

/**
 * Opens the composer from the bar, and waits until a person could type and send: the model
 * chip names the model instead of "Loading models…", and the box has the caret.
 */
export const openComposer = async (page: Page): Promise<void> => {
  await toolbar(page).getByRole("button", { name: "Generate" }).click();
  await expect(composer(page)).toBeVisible();
  await expect(composer(page).getByTestId("model-chip")).toBeEnabled();
  await expect(instructionBox(page)).toBeFocused();
};

/** Presses Cmd+Enter once the send button shows a run can go. */
export const pressSend = async (page: Page): Promise<void> => {
  await expect(sendButton(page)).toBeEnabled();
  await page.keyboard.press("ControlOrMeta+Enter");
};

/** Sends, and waits for the acknowledgement that collapses the composer back to the bar. */
export const sendRun = async (page: Page): Promise<void> => {
  await pressSend(page);
  await expect(composer(page)).toHaveCount(0);
};

/** Where focus was when `openAndEscape` pressed Escape. */
export type EscapeFocus = "control" | "opened" | "elsewhere";

/**
 * Clicks a composer control and presses Escape on whatever has focus the moment the page shows
 * what the click opened: a quick Esc that lands before the menu, popup or dialog takes focus.
 * `shows` names the menu or dialog to wait for; without it, the one the control opens.
 */
export const openAndEscape = (control: Locator, shows?: string): Promise<EscapeFocus> =>
  control.evaluate(
    (element: HTMLElement, name: string | null) =>
      new Promise<EscapeFocus>((resolve, reject) => {
        const newest = (selector: string) => [...document.querySelectorAll(selector)].at(-1);
        const opened = (): Element | undefined =>
          name !== null
            ? newest(`[role=menu][aria-label="${name}"], [role=dialog][aria-label="${name}"]`)
            : element.getAttribute("aria-expanded") === "true"
              ? (newest("[role=menu], [role=dialog]") ?? element)
              : newest("[role=dialog]");
        const watch = new MutationObserver(() => {
          const popup = opened();
          if (!popup) return;
          watch.disconnect();
          // Right after the render that shows it, before its effects run: under load, a real
          // key press can land here, ahead of Base UI moving focus in and listening for Esc.
          const focus = document.activeElement ?? document.body;
          const where: EscapeFocus = focus === element ? "control" : popup !== element && popup.contains(focus) ? "opened" : "elsewhere";
          focus.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
          resolve(where);
        });
        watch.observe(document.body, { subtree: true, childList: true, attributes: true });
        setTimeout(() => reject(new Error("nothing opened")), 2000);
        const at = { bubbles: true, cancelable: true, composed: true, button: 0, pointerType: "mouse", isPrimary: true };
        element.focus();
        element.dispatchEvent(new PointerEvent("pointerdown", at));
        element.dispatchEvent(new MouseEvent("mousedown", at));
        element.dispatchEvent(new PointerEvent("pointerup", at));
        element.dispatchEvent(new MouseEvent("mouseup", at));
        element.dispatchEvent(new MouseEvent("click", at));
      }),
    shows ?? null,
  );

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

/** Waits until an element stops moving (a camera animation has finished). */
export const settled = async (locator: Locator): Promise<void> => {
  let last = "";
  await expect
    .poll(async () => {
      const box = await locator.boundingBox();
      const now = JSON.stringify(box);
      const still = now === last;
      last = now;
      return still;
    })
    .toBe(true);
};
