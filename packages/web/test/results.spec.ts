import type { Page } from "@playwright/test";
import { gate } from "../../engine/test/openRouterStub.ts";
import { openCanvas, roomRecords, roomShapes, shapeOnScreen, toast, type AnyRecord } from "./canvas.ts";
import { clickShape, composer, expect, instructionBox, openComposer, pressSend, sendRun, settled, test, toolbar, type GenerationEngine } from "./generation.ts";
import { pngBytes } from "./images.ts";
import { expectSlot, expectToken } from "./kit.ts";

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
  await expect(toolbar(page).getByRole("button")).toHaveText(["Regenerate", "Agent", "Generate"]);
  await expect(toolbar(page).getByTestId("result-line")).toHaveText("gpt-image-2 · 96×64 · $0.1900");
  // Generate is the kit's primary Button, Regenerate its outline Button.
  await page.mouse.move(5, 500);
  for (const name of ["Generate", "Regenerate"]) await expectSlot(toolbar(page).getByRole("button", { name, exact: true }), "button");
  await expectToken(toolbar(page).getByRole("button", { name: "Generate", exact: true }), "background-color", "--primary");
  await expectToken(toolbar(page).getByRole("button", { name: "Regenerate" }), "border-top-color", "--color-input");
  await expectToken(toolbar(page).getByTestId("result-line"), "color", "--color-muted-foreground");

  // Generate opens the composer on the result as on any selection, and sends the result itself.
  await toolbar(page).getByRole("button", { name: "Generate", exact: true }).click();
  await expect(composer(page).getByTestId("source-count")).toHaveText("1 selected");
  await expect(instructionBox(page)).toHaveText("");
  await page.keyboard.type("as a sketch");
  const before = generation.requests.length;
  await sendRun(page);
  await expect.poll(() => generation.requests.length).toBe(before + 1);
  expect(generation.requests[before]!.body.prompt).toBe("as a sketch");
  const refs = generation.requests[before]!.body.input_references;
  expect(refs).toHaveLength(1);
  expect(refs[0].image_url.url).toBe(`data:image/png;base64,${pngBytes(96, 64).toString("base64")}`);

  // Its Regenerate shows the reference it sends; there is no recorded prompt, only the instruction.
  await expect.poll(async () => (await results(generation)).filter((shape) => shape.props.assetId && !shape.meta.unframed.run).length).toBe(2);
  const sketch = (await results(generation)).find((shape) => shape.id !== placeholder!.id)!;
  await page.mouse.click(10, 400);
  await page.keyboard.press("Shift+1");
  await settled(shapeOnScreen(page, sketch.id));
  await clickShape(page, sketch.id);
  await toolbar(page).getByRole("button", { name: "Regenerate" }).click();
  await expect(composer(page).getByTestId("recipe-references")).toHaveText("1 image");
  await expect(composer(page).getByTestId("recipe-prompt")).toHaveCount(0);
  await expect(instructionBox(page)).toHaveText("as a sketch");
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

test("Regenerate sends the recorded run again from the composer, beside the old result, even after its source is deleted", async ({ page, generation }) => {
  await openCanvas(page, generation.engine);
  const first = await makeResult(page, generation, "at dawn");
  await page.mouse.click(10, 400);
  await clickShape(page, "shape:starter-subject");
  await page.keyboard.press("Delete");
  await expect(shapeOnScreen(page, "shape:starter-subject")).toHaveCount(0);

  const before = generation.requests.length;
  await clickShape(page, first.id);
  await toolbar(page).getByRole("button", { name: "Regenerate" }).click();
  await expect(composer(page).getByTestId("source-count")).toHaveText("recipe · 1 source");
  // What it sends ahead of the box shows as recorded, though its source is gone.
  const sent = composer(page).getByTestId("recipe-sent");
  await expect(sent).toContainText("Sent ahead of your instruction:");
  await expect(sent.getByTestId("recipe-prompt")).toHaveText("lone red fox");
  await expect(sent.getByTestId("recipe-prompt")).toHaveAttribute("title", "lone red fox");
  await expect(sent.getByTestId("recipe-references")).toHaveCount(0);
  await expect(instructionBox(page)).toHaveText("at dawn");
  await sendRun(page);
  await expect.poll(async () => (await results(generation)).filter((shape) => shape.props.assetId).length).toBe(2);
  expect(generation.requests[before]!.body).toEqual(generation.requests[before - 1]!.body);
  const second = (await results(generation)).find((shape) => shape.id !== first.id)!;
  expect(second.x).toBeGreaterThan(first.x!);
  const sidecar = await sidecarOf(generation, second);
  expect(sidecar.recipe).toMatchObject({ selectionPrompt: "lone red fox", instruction: "at dawn", of: { sidecar: first.meta.unframed.result.sidecar, action: "recipe" } });
});

test("Regenerate reopens the composer on the recorded run to change it; a selection change leaves recipe mode and keeps the tray and box", async ({ page, generation }) => {
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
  await toolbar(page).getByRole("button", { name: "Regenerate" }).click();
  await expect(composer(page)).toBeVisible();
  await expect(composer(page).getByTestId("source-count")).toHaveText("recipe · 1 source");
  await expect(instructionBox(page)).toHaveText("moody");
  await expect(composer(page).locator("[data-prop]")).toHaveText(["1K", "1:1", "high"]);
  await expect(page.locator("[data-role-for]")).toHaveCount(0);

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

  // Regenerate again, then a click that changes the selection: the live selection, same tray and box.
  await page.mouse.click(10, 400);
  await clickShape(page, result!.id);
  await toolbar(page).getByRole("button", { name: "Regenerate" }).click();
  await expect(composer(page).getByTestId("source-count")).toHaveText("recipe · 1 source");
  await composer(page).locator("[data-prop]").filter({ hasText: "high" }).click();
  await page.getByRole("menu", { name: "Quality" }).getByRole("menuitemradio", { name: "medium" }).click();
  // The composer covers the prompt's centre; its left end is clear.
  const scene = (await shapeOnScreen(page, "shape:starter-scene").boundingBox())!;
  await page.mouse.click(scene.x + 8, scene.y + scene.height / 2);
  await expect(composer(page).getByTestId("source-count")).toHaveText("2 selected");
  await expect(instructionBox(page)).toHaveText("moody");
  await expect(composer(page).locator("[data-prop]")).toHaveText(["1K", "1:1", "medium"]);
});
