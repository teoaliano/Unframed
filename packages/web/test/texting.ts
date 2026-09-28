/**
 * Browser-seam helpers for spec 05: the generation engine of `generation.ts` with the text
 * catalogue and a scripted chat endpoint too, and ways to reach the text medium and the
 * Runs prop.
 */
import type { Locator, Page } from "@playwright/test";
import { chatCompletions, listedModel, textCatalogue, type ChatAnswer, type ChatRequest } from "../../engine/test/textStub.ts";
import { roomShapes, type AnyRecord } from "./canvas.ts";
import { expect, test as base } from "./fixtures.ts";
import { clickShape, composer, openComposer, startGeneration, type GenerationEngine } from "./generation.ts";

export const TEXT_CATALOGUE = [
  listedModel("google/gemini-3.5-flash-lite", ["text", "image"], ["text"], { name: "Google: Gemini 3.5 Flash Lite", created: 1_770_000_000 }),
  listedModel("openai/gpt-5", ["text", "image", "file"], ["text"], { name: "OpenAI: GPT-5", created: 1_760_000_000 }),
  listedModel("meta/llama-text-only", ["text"], ["text"], { name: "Meta: Llama" }),
];

export interface TextGeneration extends GenerationEngine {
  /** Every request the chat endpoint received, in order. */
  readonly chat: ChatRequest[];
  answerText(script: (request: ChatRequest) => ChatAnswer | Promise<ChatAnswer>): void;
}

export const startTextGeneration = async (): Promise<TextGeneration> => {
  let script: (request: ChatRequest) => ChatAnswer | Promise<ChatAnswer> = () => ({ kind: "text", text: "A fox on a windswept cliff.", cost: 0.0012 });
  const chat = chatCompletions((request) => script(request));
  const generation = await startGeneration({ extra: [textCatalogue({ data: TEXT_CATALOGUE }), chat.handler] });
  return {
    ...generation,
    chat: chat.requests,
    answerText: (next) => {
      script = next;
    },
  };
};

export const test = base.extend<{ generation: TextGeneration }>({
  generation: async ({}, use) => {
    const generation = await startTextGeneration();
    await use(generation);
    await generation.engine.dispose();
  },
});

export { expect };

/** The medium switch's option for `medium`. */
export const mediumOption = (page: Page, medium: "image" | "text"): Locator => composer(page).getByRole("radiogroup", { name: "Medium" }).getByRole("radio", { name: medium });

/** Switches the open composer to the text medium and waits for its model. */
export const chooseText = async (page: Page): Promise<void> => {
  await mediumOption(page, "text").click();
  await expect(mediumOption(page, "text")).toHaveAttribute("aria-checked", "true");
  await expect(composer(page).getByTestId("model-chip")).toBeEnabled();
};

export const runButton = (page: Page): Locator => composer(page).getByRole("button", { name: "Run", exact: true });

/** Sends the open composer's text run, and waits for the acknowledgement that collapses it. */
export const sendText = async (page: Page): Promise<void> => {
  await expect(runButton(page)).toBeEnabled();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(composer(page)).toHaveCount(0);
};

/** Runs `shapeId` (the starter subject by default) through the text medium and answers the landed text result. */
export const makeTextResult = async (page: Page, generation: TextGeneration, shapeId = "shape:starter-subject"): Promise<AnyRecord> => {
  const before = new Set((await textResults(generation)).map((shape) => shape.id));
  await page.mouse.click(10, 400);
  await clickShape(page, shapeId);
  await openComposer(page);
  await chooseText(page);
  await sendText(page);
  const landed = () => textResults(generation).then((shapes) => shapes.filter((shape) => !before.has(shape.id) && !shape.meta.unframed.run));
  await expect.poll(async () => (await landed()).length).toBe(1);
  return (await landed())[0]!;
};

/** Every text result in the room, placeholders included. */
export const textResults = async (generation: GenerationEngine): Promise<AnyRecord[]> =>
  (await roomShapes(generation.engine, "default", "text")).filter((shape) => shape.meta?.unframed?.result?.medium === "text");

/** Every image result in the room, placeholders included. */
export const imageResults = async (generation: GenerationEngine): Promise<AnyRecord[]> =>
  (await roomShapes(generation.engine, "default", "image")).filter((shape) => shape.meta?.unframed?.result);

export const tray = (page: Page): Locator => composer(page).getByTestId("composer-tray");

/** The Runs chip, when it is in the tray. */
export const runsChip = (page: Page): Locator => tray(page).locator('[data-prop="runs"]');

/** Opens `+ add prop` and adds Runs, which opens its popup. */
export const addRuns = async (page: Page): Promise<void> => {
  await tray(page).getByRole("button", { name: "+ add prop" }).click();
  await page.getByRole("menu", { name: "Add prop" }).getByRole("menuitem", { name: "Runs 1" }).click();
  await expect(runsPopup(page)).toBeVisible();
};

export const runsPopup = (page: Page): Locator => page.getByRole("dialog", { name: "Runs" });
export const runsField = (page: Page): Locator => runsPopup(page).getByRole("textbox", { name: "Number of runs" });

/** Sets Runs to a count through its field, and closes its popup. */
export const setRuns = async (page: Page, count: number): Promise<void> => {
  if (!(await runsPopup(page).isVisible())) {
    if ((await runsChip(page).count()) === 0) await addRuns(page);
    else await runsChip(page).click();
  }
  await runsField(page).fill(String(count));
  await page.keyboard.press("Escape");
  await expect(runsPopup(page)).toHaveCount(0);
};

/** Chooses Free, optionally with View final prompt, and closes the popup. */
export const setFree = async (page: Page, viewFinalPrompt = false): Promise<void> => {
  if (!(await runsPopup(page).isVisible())) {
    if ((await runsChip(page).count()) === 0) await addRuns(page);
    else await runsChip(page).click();
  }
  await runsPopup(page).getByRole("button", { name: "Free" }).click();
  const box = runsPopup(page).getByRole("checkbox", { name: "View final prompt" });
  if ((await box.isChecked()) !== viewFinalPrompt) await box.click();
  await page.keyboard.press("Escape");
  await expect(runsPopup(page)).toHaveCount(0);
};
