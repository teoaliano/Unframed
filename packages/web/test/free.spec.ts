import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { openCanvas, shapeOnScreen, toast } from "./canvas.ts";
import { clickShape, composer, instructionBox, openComposer, pressSend, sendButton, sendRun } from "./generation.ts";
import { pngBytes } from "./images.ts";
import { filledMedia, promptRecord, putRecords } from "./media.ts";
import { expect, imageResults, runsChip, runsPopup, setFree, setRuns, test, tray, type TextGeneration } from "./texting.ts";

const FREE_TOOLTIP =
  "Free takes the number of runs from the selection. Select a prompt or text result listing what to generate, as sections split by lines containing only ---, or prose a text model can split, and each item becomes one image.";

const status = (page: Page) => composer(page).getByTestId("composer-status");

/** A text result as a run leaves it, holding `text`. */
const textResultRecord = (id: string, ref: string, text: string, at: { x: number; y: number }) =>
  promptRecord(id, ref, text, at, {
    unframed: { result: { sidecar: `${ref}.json`, medium: "text", model: "openai/gpt-5", batchId: "b-1", runIndex: 1, runCount: 1, cost: 0.001, sources: [] } },
  });

/** Selects `ids` from nothing, the first by a click and the rest with Shift. */
const select = async (page: Page, ids: string[]) => {
  await page.mouse.click(10, 400);
  for (const [index, id] of ids.entries()) await clickShape(page, id, index === 0 ? undefined : ["Shift"]);
};

const upload = (generation: TextGeneration, id: string, ref: string, at: { x: number; y: number }, seed: number) =>
  filledMedia(generation.engine, { id, type: "image", ref, at, bytes: pngBytes(30, 30, seed), name: `${ref}.png`, mime: "image/png", natural: { w: 30, h: 30 }, width: 120 });

test("Free: its tooltip, View final prompt, the Generate label, a per-image estimate, and what it says without a list", async ({ page, generation }) => {
  const { engine } = generation;
  await openCanvas(page, engine);
  await upload(generation, "shape:photo", "300", { x: 540, y: 40 }, 1);
  await putRecords(engine, [promptRecord("shape:blank", "301", "", { x: 40, y: 200 }), textResultRecord("shape:answer", "302", "", { x: 400, y: 200 })]);
  await expect(shapeOnScreen(page, "shape:answer")).toBeVisible();

  await select(page, ["shape:photo"]);
  await openComposer(page);
  await setRuns(page, 3);
  await runsChip(page).click();
  const free = runsPopup(page).getByRole("button", { name: "Free" });
  await expect(runsPopup(page).getByRole("checkbox", { name: "View final prompt" })).toHaveCount(0);
  await free.hover();
  await expect(page.getByText(FREE_TOOLTIP)).toBeVisible();
  await free.click();
  await expect(runsPopup(page).getByRole("checkbox", { name: "View final prompt" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(runsChip(page)).toHaveText("Free");
  await expect(sendButton(page)).toHaveText("Generate");
  await expect(composer(page).getByTestId("estimate")).toHaveText("est. ~$0.021 / image");

  // No prompt or text result selected: nothing lists what to make.
  await expect(status(page)).toHaveText('Select a prompt or a text result. Each item turns into one generation: a "---" separated list, or prose a text model can split.');
  await expect(sendButton(page)).toBeDisabled();
  // Clicks add to the selection while the composer is open.
  await clickShape(page, "shape:blank");
  await expect(status(page)).toHaveText("The prompt is empty. It lists what to generate.");
  await clickShape(page, "shape:answer");
  await expect(status(page)).toHaveText("The text result is empty. It lists what to generate.");
  await expect(sendButton(page)).toBeDisabled();
});

const dataUrl = (seed: number) => `data:image/png;base64,${pngBytes(30, 30, seed).toString("base64")}`;
const sentImages = (request: { body: any }) => (request.body.input_references ?? []).map((ref: any) => ref.image_url?.url);
const sidecarOf = async (generation: TextGeneration, shape: { meta?: any }) =>
  JSON.parse((await generation.engine.request(`/api/file/default/${shape.meta.unframed.result.sidecar}`)).text);

/** Selects `ids`, opens the composer on Free, and types `instruction`. */
const freeOn = async (page: Page, ids: string[], instruction = "", viewFinalPrompt = false) => {
  await select(page, ids);
  await openComposer(page);
  await setFree(page, viewFinalPrompt);
  if (instruction !== "") {
    await instructionBox(page).click();
    await page.keyboard.type(instruction);
  }
};

test("Free with a ready list makes one image per section, the shared context and instruction around each, and no text call", async ({ page, generation }) => {
  const { engine } = generation;
  await openCanvas(page, engine);
  await upload(generation, "shape:photo", "300", { x: 540, y: 40 }, 1);
  await putRecords(engine, [promptRecord("shape:list", "301", "a fox\n---\na wolf\n  ---  \na hare", { x: 40, y: -80 })]);
  await expect(shapeOnScreen(page, "shape:list")).toBeVisible();

  await freeOn(page, ["shape:list", "shape:starter-scene", "shape:photo"], "in ink");
  await sendRun(page);
  await expect.poll(() => generation.requests.length).toBe(3);
  expect(generation.chat).toHaveLength(0);
  const scene = "A lone red fox on a windswept cliff at golden hour, cinematic, 35mm";
  expect(generation.requests.map((request) => request.body.prompt).sort()).toEqual([`${scene}\n\na fox\n\nin ink`, `${scene}\n\na hare\n\nin ink`, `${scene}\n\na wolf\n\nin ink`]);
  for (const request of generation.requests) expect(sentImages(request)).toEqual([dataUrl(1)]);

  await expect.poll(async () => (await imageResults(generation)).filter((shape) => shape.props.assetId && !shape.meta.unframed.run).length).toBe(3);
  const results = (await imageResults(generation)).sort((a, b) => a.meta.unframed.result.runIndex - b.meta.unframed.result.runIndex);
  const sidecars = await Promise.all(results.map((shape) => sidecarOf(generation, shape)));
  expect(new Set(sidecars.map((sidecar) => sidecar.batchId)).size).toBe(1);
  expect(sidecars.map((sidecar) => sidecar.recipe.selectionPrompt)).toEqual([`${scene}\n\na fox`, `${scene}\n\na wolf`, `${scene}\n\na hare`]);
  expect(sidecars.map((sidecar) => sidecar.recipe.instruction)).toEqual(["in ink", "in ink", "in ink"]);
  expect(sidecars.map((sidecar) => sidecar.free)).toEqual([1, 2, 3].map(() => ({ picks: null, dropped: [] })));
  expect(results.map((shape) => shape.meta.unframed.result.batchExtraCost)).toEqual([undefined, undefined, undefined]);
});

/** The asset's system prompt blocks, read the way the asset writes them. */
const repairBlocks = async () => {
  const text = await readFile(new URL("../../../assets/prompts/free-repair.md", import.meta.url), "utf8");
  const [base, images] = [...text.matchAll(/```text\n([\s\S]*?)\n```/g)].map((match) => match[1]!);
  return { base: base!, images: images! };
};

test("Free with prose makes one repair call, system rules apart from the text, images attached, and runs the re-split list", async ({ page, generation }) => {
  const { engine } = generation;
  await openCanvas(page, engine);
  await upload(generation, "shape:photo", "300", { x: 540, y: 40 }, 1);
  await putRecords(engine, [promptRecord("shape:list", "301", "three versions of a fox", { x: 40, y: -80 })]);
  await expect(shapeOnScreen(page, "shape:list")).toBeVisible();
  generation.answerText(() => ({ kind: "text", text: "a red fox\n---\na grey fox\n---\na white fox", cost: 0.002 }));

  await freeOn(page, ["shape:list", "shape:photo"]);
  await sendRun(page);
  await expect.poll(() => generation.requests.length).toBe(3);
  expect(generation.chat).toHaveLength(1);
  const { base, images } = await repairBlocks();
  expect(generation.chat[0]!.body.model).toBe("google/gemini-3.5-flash-lite");
  expect(generation.chat[0]!.body.messages).toEqual([
    { role: "system", content: `${base}\n${images.replace("<N> reference images are attached, numbered 1 to <N>.", "1 reference image is attached, numbered 1 to 1.")}` },
    { role: "user", content: [{ type: "text", text: "Text to rewrite:\n\nthree versions of a fox" }, { type: "image_url", image_url: { url: dataUrl(1) } }] },
  ]);
  expect(generation.requests.map((request) => request.body.prompt).sort()).toEqual(["a grey fox", "a red fox", "a white fox"]);
  await expect(toast(page, "re-split into 3 sections")).toBeVisible();

  // The repair's cost counts once in the batch, and its sidecar carries the batch id.
  await expect.poll(async () => (await imageResults(generation)).filter((shape) => shape.props.assetId && !shape.meta.unframed.run).length).toBe(3);
  const results = await imageResults(generation);
  expect(results.map((shape) => shape.meta.unframed.result.batchExtraCost)).toEqual([0.002, 0.002, 0.002]);
  const batchId = results[0]!.meta.unframed.result.batchId;
  const projectDir = join(engine.dataDir, "output", "default");
  const repairSidecar = (await readdir(projectDir)).find((name) => /-text-text-to-rewrite/.test(name))!;
  expect(JSON.parse(await readFile(join(projectDir, repairSidecar), "utf8"))).toMatchObject({ kind: "text", batchId, cost: 0.002 });
  expect((await readdir(projectDir)).filter((name) => /-text-/.test(name))).toHaveLength(1);
});

test("a repair that still finds one section runs the original text as one image, and says so", async ({ page, generation }) => {
  const { engine } = generation;
  await openCanvas(page, engine);
  await putRecords(engine, [promptRecord("shape:list", "301", "a fox at dawn", { x: 40, y: -80 })]);
  await expect(shapeOnScreen(page, "shape:list")).toBeVisible();
  generation.answerText(() => ({ kind: "text", text: "A fox at dawn, rewritten.", cost: 0.001 }));

  await freeOn(page, ["shape:list"]);
  await sendRun(page);
  await expect.poll(() => generation.requests.length).toBe(1);
  const { base } = await repairBlocks();
  expect(generation.chat[0]!.body.messages[0]).toEqual({ role: "system", content: base });
  expect(generation.chat[0]!.body.messages[1].content).toEqual([{ type: "text", text: "Text to rewrite:\n\na fox at dawn" }]);
  expect(generation.requests[0]!.body.prompt).toBe("a fox at dawn");
  await expect(toast(page, "no sections found, running as a single generation")).toBeVisible();
});

test("Free picks: each run receives only its images, with dropped numbers and skipped sections in the report", async ({ page, generation }) => {
  const { engine } = generation;
  await openCanvas(page, engine);
  await upload(generation, "shape:style", "300", { x: 540, y: 40 }, 1);
  await upload(generation, "shape:subject", "301", { x: 540, y: 240 }, 2);
  await putRecords(engine, [promptRecord("shape:list", "302", "images: 2\n[1] alone\n---\nimages: 1, 5\nthe style of [1]\n---\nimages: 1\n---\nImage: 3 women in a row", { x: 40, y: -80 })]);
  await expect(shapeOnScreen(page, "shape:list")).toBeVisible();

  await freeOn(page, ["shape:list", "shape:style", "shape:subject"]);
  await sendRun(page);
  await expect.poll(() => generation.requests.length).toBe(3);
  expect(generation.chat).toHaveLength(0);
  const byPrompt = new Map(generation.requests.map((request) => [request.body.prompt, sentImages(request)]));
  expect(byPrompt.get("image 1 alone")).toEqual([dataUrl(2)]);
  expect(byPrompt.get("the style of image 1")).toEqual([dataUrl(1)]);
  expect(byPrompt.get("Image: 3 women in a row")).toEqual([dataUrl(1), dataUrl(2)]);
  await expect(toast(page, "skipped 1 section with no prompt text · no image 5 selected")).toBeVisible();

  await expect.poll(async () => (await imageResults(generation)).filter((shape) => shape.props.assetId && !shape.meta.unframed.run).length).toBe(3);
  const results = (await imageResults(generation)).sort((a, b) => a.meta.unframed.result.runIndex - b.meta.unframed.result.runIndex);
  const sidecars = await Promise.all(results.map((shape) => sidecarOf(generation, shape)));
  expect(sidecars.map((sidecar) => sidecar.free)).toEqual([
    { picks: [2], dropped: [] },
    { picks: [1], dropped: [5] },
    { picks: null, dropped: [] },
  ]);
  expect(sidecars[0].recipe.references).toEqual([{ kind: "image", file: expect.stringMatching(/301\.png$/) }]);
});
