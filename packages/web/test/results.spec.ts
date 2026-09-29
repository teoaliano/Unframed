import type { Page } from "@playwright/test";
import { gate } from "../../engine/test/openRouterStub.ts";
import { openCanvas, roomRecords, roomShapes, shapeOnScreen, toast, type AnyRecord } from "./canvas.ts";
import { clickShape, composer, expect, instructionBox, openComposer, pressSend, sendRun, settled, test, toolbar, type GenerationEngine } from "./generation.ts";
import { pngBytes } from "./images.ts";
import { expectSlot, expectToken, styleOf } from "./kit.ts";
import { filledMedia, putRecords } from "./media.ts";

const results = async (generation: GenerationEngine) => (await roomShapes(generation.engine, "default", "image")).filter((shape) => shape.meta?.unframed?.result);

/** Generates from the starter subject and answers the landed result. */
const makeResult = async (page: Page, generation: GenerationEngine, instruction = "") => {
  const before = (await results(generation)).length;
  // From nothing selected, so the click selects the prompt rather than editing it.
  await page.mouse.click(10, 400);
  await clickShape(page, "shape:starter-subject");
  await openComposer(page);
  if (instruction !== "") await page.keyboard.type(instruction);
  await sendRun(page);
  await expect.poll(async () => (await results(generation)).filter((shape) => shape.props.assetId).length).toBe(before + 1);
  const all = await results(generation);
  return all.find((shape) => shape.props.assetId && !shape.meta.unframed.run && all.indexOf(shape) >= before)!;
};

const sidecarOf = async (generation: GenerationEngine, shape: AnyRecord) => {
  const response = await generation.engine.request(`/api/file/default/${shape.meta.unframed.result.sidecar}`);
  return JSON.parse(response.text);
};

test("results land to the right of the selection, placeholder first, and a selected result shows its line", async ({ page, generation }) => {
  const held = gate<void>();
  generation.answer(async () => {
    await held.promise;
    return { kind: "image", bytes: pngBytes(96, 64), cost: 0.19, mediaType: "image/png" };
  });
  await openCanvas(page, generation.engine);
  await clickShape(page, "shape:starter-subject");
  await openComposer(page);
  await sendRun(page);

  const [placeholder] = await results(generation);
  const subject = (await roomRecords(generation.engine, "default")).find((record) => record.id === "shape:starter-subject")!;
  expect(placeholder!.x).toBeGreaterThan(subject.x!);
  expect(placeholder!.y).toBe(subject.y);
  await expect(shapeOnScreen(page, placeholder!.id).getByRole("status")).toHaveText("Generating…");
  await clickShape(page, placeholder!.id);
  await expect(toolbar(page).getByText("Generating…")).toBeVisible();

  held.release();
  await expect(shapeOnScreen(page, placeholder!.id).locator("img")).toBeVisible();
  await page.mouse.click(10, 400);
  await clickShape(page, placeholder!.id);
  await expect(toolbar(page).getByRole("button", { name: "Regenerate" })).toBeVisible();
  await expect(toolbar(page).getByRole("button", { name: "Vary" })).toBeVisible();
  await expect(toolbar(page).getByRole("button", { name: "Recipe" })).toBeVisible();
  await expect(toolbar(page).getByTestId("result-line")).toHaveText("gpt-image-2 · 96×64 · $0.1900");
  // Regenerate is the kit's primary Button, Vary its outline Button, Recipe its ghost Button.
  await page.mouse.move(5, 500);
  for (const name of ["Regenerate", "Vary", "Recipe"]) await expectSlot(toolbar(page).getByRole("button", { name }), "button");
  await expectToken(toolbar(page).getByRole("button", { name: "Regenerate" }), "background-color", "--primary");
  await expectToken(toolbar(page).getByRole("button", { name: "Vary" }), "border-top-color", "--color-input");
  expect(await styleOf(toolbar(page).getByRole("button", { name: "Recipe" }), "background-color")).toBe("rgba(0, 0, 0, 0)");
  await expectToken(toolbar(page).getByTestId("result-line"), "color", "--color-muted-foreground");
});

test("a failed run says why in a toast, a partial run counts its successes, and a full success says nothing", async ({ page, generation }) => {
  await openCanvas(page, generation.engine);
  generation.answer(() => ({ kind: "status", status: 500, body: { error: { message: "model overloaded" } } }));
  await clickShape(page, "shape:starter-subject");
  await openComposer(page);
  await pressSend(page);
  await expect(toast(page, "0 of 1 succeeded. OpenRouter (500): model overloaded")).toBeVisible();
  await expect.poll(async () => (await results(generation)).length).toBe(0);

  generation.answer(({ body }) => (body.prompt === "good" ? { kind: "image", bytes: pngBytes(8, 8) } : { kind: "status", status: 402, body: { error: { message: "no credit" } } }));
  await (await generation.engine.rpc()).call("run.image", {
    project: "default",
    params: {},
    selectionPrompt: "",
    instruction: "",
    outputs: [
      { prompt: "good", references: [] },
      { prompt: "bad", references: [] },
    ],
    sources: [],
    anchor: { x: 0, y: 600, w: 10, h: 10 },
  });
  await expect(toast(page, /^1 of 2 succeeded\. OpenRouter refused this as unpaid/)).toBeVisible();

  generation.answer(() => ({ kind: "image", bytes: pngBytes(8, 8) }));
  const count = await page.locator("[data-slot='toast-title']").count();
  await makeResult(page, generation);
  await page.waitForTimeout(500);
  await expect(page.locator("[data-slot='toast-title']")).toHaveCount(count);
});

test("the tether runs from each surviving source to the selected result, selects nothing and goes on deselect", async ({ page, generation }) => {
  await openCanvas(page, generation.engine);
  await clickShape(page, "shape:starter-subject");
  await clickShape(page, "shape:starter-scene", ["Shift"]);
  await openComposer(page);
  await sendRun(page);
  await expect.poll(async () => (await results(generation)).filter((shape) => shape.props.assetId).length).toBe(1);
  const [result] = await results(generation);
  expect(result!.meta.unframed.result.sources.sort()).toEqual(["shape:starter-scene", "shape:starter-subject"]);

  await page.mouse.click(10, 400);
  await expect(page.getByTestId("tether")).toHaveCount(0);
  await clickShape(page, result!.id);
  const lines = page.locator("[data-tether-from]");
  await expect(lines).toHaveCount(2);
  await expect(lines.first()).toHaveAttribute("stroke-dasharray", "4 5");
  await expect(page.getByTestId("tether")).toHaveCSS("pointer-events", "none");

  // Delete one source: its line goes, the other stays.
  await page.mouse.click(10, 400);
  await clickShape(page, "shape:starter-scene");
  await page.keyboard.press("Delete");
  await clickShape(page, result!.id);
  await expect(lines).toHaveCount(1);
  await expect(lines).toHaveAttribute("data-tether-from", "shape:starter-subject");
  await page.mouse.click(10, 400);
  await expect(page.getByTestId("tether")).toHaveCount(0);
});

test("Regenerate repeats the recorded recipe beside the old result, even after its source is deleted", async ({ page, generation }) => {
  await openCanvas(page, generation.engine);
  const first = await makeResult(page, generation, "at dawn");
  await page.mouse.click(10, 400);
  await clickShape(page, "shape:starter-subject");
  await page.keyboard.press("Delete");
  await expect(shapeOnScreen(page, "shape:starter-subject")).toHaveCount(0);

  const before = generation.requests.length;
  await clickShape(page, first.id);
  await toolbar(page).getByRole("button", { name: "Regenerate" }).click();
  await expect.poll(async () => (await results(generation)).filter((shape) => shape.props.assetId).length).toBe(2);
  expect(generation.requests[before]!.body).toEqual(generation.requests[before - 1]!.body);
  const second = (await results(generation)).find((shape) => shape.id !== first.id)!;
  expect(second.x).toBeGreaterThan(first.x!);
  const sidecar = await sidecarOf(generation, second);
  expect(sidecar.recipe).toMatchObject({ selectionPrompt: "lone red fox", instruction: "at dawn", of: { sidecar: first.meta.unframed.result.sidecar, action: "regenerate" } });
  // Regenerate never writes last-used values.
  const stored = (await (await generation.engine.rpc()).call("preferences.get", { keys: ["lastUsed.image"] })).values["lastUsed.image"];
  expect(stored).toEqual({ props: { resolution: "1K", aspect_ratio: "1:1", quality: "low" } });
});

test("Vary adds the result itself as the last reference, and is disabled with a tooltip at the model's cap", async ({ page, generation }) => {
  const { engine } = generation;
  await openCanvas(page, engine);
  const first = await makeResult(page, generation);
  const before = generation.requests.length;
  const lastUsed = async () => (await (await engine.rpc()).call("preferences.get", { keys: ["lastUsed.image"] })).values;
  // The composer's send writes last-used values after its acknowledgement; wait for that write to land.
  await expect.poll(lastUsed).toHaveProperty(["lastUsed.image"]);
  const stored = await lastUsed();
  await clickShape(page, first.id);
  await toolbar(page).getByRole("button", { name: "Vary" }).click();
  await expect.poll(() => generation.requests.length).toBe(before + 1);
  // Vary never writes last-used values.
  expect(await lastUsed()).toEqual(stored);
  const file = (await roomRecords(engine, "default")).find((record) => record.id === first.props.assetId)!.props.src.replace("project-file:", "");
  const refs = generation.requests[before]!.body.input_references;
  expect(refs).toHaveLength(1);
  expect(refs[0].image_url.url).toBe(`data:image/png;base64,${pngBytes(96, 64).toString("base64")}`);
  await expect.poll(async () => (await results(generation)).filter((shape) => shape.props.assetId).length).toBe(2);
  const varied = (await results(generation)).find((shape) => shape.id !== first.id)!;
  expect((await sidecarOf(generation, varied)).recipe.references).toEqual([{ kind: "image", file }]);

  // A model that takes one reference, and a recipe that already sends one: Vary is disabled.
  await page.mouse.click(10, 400);
  await filledMedia(engine, { id: "shape:ref", type: "image", ref: "400", at: { x: -300, y: 0 }, bytes: pngBytes(30, 30), name: "ref.png", mime: "image/png", natural: { w: 30, h: 30 }, width: 140 });
  await expect(shapeOnScreen(page, "shape:ref").locator("img")).toBeVisible();
  await clickShape(page, "shape:ref");
  await clickShape(page, "shape:starter-subject", ["Shift"]);
  await openComposer(page);
  await composer(page).getByTestId("model-chip").click();
  await page.getByRole("dialog").getByRole("button", { name: "gemini-3-pro-image", exact: true }).click();
  await instructionBox(page).click();
  await sendRun(page);
  await expect.poll(async () => (await results(generation)).filter((shape) => shape.props.assetId).length).toBe(3);
  const capped = (await results(generation)).find((shape) => shape.meta.unframed.result.model === "google/gemini-3-pro-image")!;
  await page.mouse.click(10, 400);
  // Bring it where the test can click it, clear of the chrome.
  await putRecords(engine, [{ ...capped, x: -300, y: 200 }]);
  await expect(shapeOnScreen(page, capped.id).locator("img")).toBeVisible();
  await settled(shapeOnScreen(page, capped.id));
  await clickShape(page, capped.id);
  const vary = toolbar(page).getByRole("button", { name: "Vary" });
  await expect(vary).toBeDisabled();
  await vary.hover({ force: true });
  await expect(page.getByText("This model takes at most 1 references, and this recipe already uses them.")).toBeVisible();
});

test("Recipe reopens the composer on the recorded run; a selection change leaves recipe mode and keeps the tray and box", async ({ page, generation }) => {
  await openCanvas(page, generation.engine);
  await clickShape(page, "shape:starter-subject");
  await openComposer(page);
  await composer(page).locator("[data-prop]").filter({ hasText: "low" }).click();
  await page.getByRole("menu", { name: "Quality" }).getByRole("menuitemradio", { name: "high" }).click();
  await instructionBox(page).click();
  await page.keyboard.type("moody");
  await sendRun(page);
  await expect.poll(async () => (await results(generation)).filter((shape) => shape.props.assetId).length).toBe(1);
  const [result] = await results(generation);

  await page.mouse.click(10, 400);
  await clickShape(page, result!.id);
  await toolbar(page).getByRole("button", { name: "Recipe" }).click();
  await expect(composer(page)).toBeVisible();
  await expect(composer(page).getByTestId("source-count")).toHaveText("recipe · 1 sources");
  await expect(instructionBox(page)).toHaveText("moody");
  await expect(composer(page).locator("[data-prop]")).toHaveText(["1K", "1:1", "high"]);
  await expect(page.locator(".unframed-role-badge")).toHaveCount(0);

  // "Same thing, bigger": change a prop, add to the instruction (resolved like a prompt's) and send.
  await composer(page).locator("[data-prop]").filter({ hasText: "1K" }).click();
  await page.getByRole("menu", { name: "Size" }).getByRole("menuitemradio", { name: "2K" }).click();
  const before = generation.requests.length;
  await instructionBox(page).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" like @101 ");
  await pressSend(page);
  await expect.poll(() => generation.requests.length).toBe(before + 1);
  expect(generation.requests[before]!.body).toEqual({
    model: "openai/gpt-image-2",
    prompt: "lone red fox\n\nmoody like A lone red fox on a windswept cliff at golden hour, cinematic, 35mm",
    resolution: "2K",
    aspect_ratio: "1:1",
    quality: "high",
  });
  // The recorded model was not picked in the model dialog, so it is not stored as last-used.
  await expect.poll(async () => ((await (await generation.engine.rpc()).call("preferences.get", { keys: ["lastUsed.image"] })).values["lastUsed.image"] as { props?: unknown })?.props).toEqual({ resolution: "2K", aspect_ratio: "1:1", quality: "high" });
  expect(((await (await generation.engine.rpc()).call("preferences.get", { keys: ["lastUsed.image"] })).values["lastUsed.image"] as { model?: string }).model).toBeUndefined();
  await expect.poll(async () => (await results(generation)).filter((shape) => shape.props.assetId).length).toBe(2);
  const remade = (await results(generation)).find((shape) => shape.id !== result!.id)!;
  expect((await sidecarOf(generation, remade)).recipe.of).toEqual({ sidecar: result!.meta.unframed.result.sidecar, action: "recipe" });

  // Recipe mode again, then a click that changes the selection: the live selection, same tray and box.
  await page.mouse.click(10, 400);
  await clickShape(page, result!.id);
  await toolbar(page).getByRole("button", { name: "Recipe" }).click();
  await expect(composer(page).getByTestId("source-count")).toHaveText("recipe · 1 sources");
  await composer(page).locator("[data-prop]").filter({ hasText: "high" }).click();
  await page.getByRole("menu", { name: "Quality" }).getByRole("menuitemradio", { name: "medium" }).click();
  await clickShape(page, "shape:starter-scene");
  await expect(composer(page).getByTestId("source-count")).toHaveText("2 selected");
  await expect(instructionBox(page)).toHaveText("moody");
  await expect(composer(page).locator("[data-prop]")).toHaveText(["1K", "1:1", "medium"]);
});
