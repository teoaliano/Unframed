import { gate } from "../../engine/test/openRouterStub.ts";
import { copySelection, openCanvas, roomShapes, shapeOnScreen } from "./canvas.ts";
import { clickShape, expect, openComposer, sendRun, test, type GenerationEngine } from "./generation.ts";
import { pngBytes } from "./images.ts";
import { filledMedia, putRecords } from "./media.ts";

// These copy and paste through the system clipboard, so they run in the clipboard project (playwright.config.ts).
test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const results = async (generation: GenerationEngine) => (await roomShapes(generation.engine, "default", "image")).filter((shape) => shape.meta?.unframed?.result);

test("a copied generating placeholder pastes as an empty image with no marker; a copied result keeps its result meta", async ({ page, generation }) => {
  const held = gate<void>();
  generation.answer(async () => {
    await held.promise;
    return { kind: "image", bytes: pngBytes(96, 64) };
  });
  await openCanvas(page, generation.engine);
  await clickShape(page, "shape:starter-subject");
  await openComposer(page);
  await sendRun(page);
  const [placeholder] = await results(generation);
  await expect(shapeOnScreen(page, placeholder!.id)).toBeVisible();

  await page.mouse.click(10, 400);
  await clickShape(page, placeholder!.id);
  await copySelection(page);
  await page.keyboard.press("ControlOrMeta+v");
  const pasted = await expect
    .poll(async () => (await roomShapes(generation.engine, "default", "image")).filter((shape) => shape.id !== placeholder!.id).length)
    .toBe(1)
    .then(async () => (await roomShapes(generation.engine, "default", "image")).find((shape) => shape.id !== placeholder!.id)!);
  expect(pasted.meta.unframed).toBeUndefined();
  expect(pasted.props.assetId).toBeNull();
  // The pasted copy sits over the original: move it aside.
  await putRecords(generation.engine, [{ ...pasted, x: -400, y: 0 }]);
  await expect.poll(async () => (await shapeOnScreen(page, pasted.id).boundingBox())?.x ?? 9999).toBeLessThan(200);

  held.release();
  await expect.poll(async () => (await roomShapes(generation.engine, "default", "image")).find((shape) => shape.id === placeholder!.id)?.props.assetId).toBeTruthy();
  const filled = (await roomShapes(generation.engine, "default", "image")).find((shape) => shape.id === placeholder!.id)!;
  // The pasted copy stays an ordinary empty image after the run lands.
  expect((await roomShapes(generation.engine, "default", "image")).find((shape) => shape.id === pasted.id)!.props.assetId).toBeNull();

  await expect(shapeOnScreen(page, filled.id).locator("img")).toBeVisible();
  await page.mouse.click(10, 400);
  await clickShape(page, filled.id);
  await copySelection(page, ["text/html", "image/png"]);
  await page.keyboard.press("ControlOrMeta+v");
  await expect.poll(async () => (await roomShapes(generation.engine, "default", "image")).length).toBe(3);
  const copy = (await roomShapes(generation.engine, "default", "image")).find((shape) => shape.id !== filled.id && shape.id !== pasted.id)!;
  expect(copy.meta.unframed.result).toEqual(filled.meta.unframed.result);
  expect(copy.meta.unframed.run).toBeUndefined();
});

test("a result pasted into another project brings its sidecar and its reference files, so its recipe still reads", async ({ page, generation }) => {
  const { engine } = generation;
  await openCanvas(page, engine);
  await (await engine.rpc()).call("projects.create", { name: "beta" });
  await filledMedia(engine, { id: "shape:ref", type: "image", ref: "400", at: { x: -300, y: 0 }, bytes: pngBytes(30, 30), name: "ref.png", mime: "image/png", natural: { w: 30, h: 30 }, width: 140 });
  await expect(shapeOnScreen(page, "shape:ref").locator("img")).toBeVisible();
  await clickShape(page, "shape:ref");
  await clickShape(page, "shape:starter-subject", ["Shift"]);
  await openComposer(page);
  await sendRun(page);
  await expect.poll(async () => (await results(generation)).filter((shape) => shape.props.assetId).length).toBe(1);
  const [result] = await results(generation);
  await expect(shapeOnScreen(page, result!.id).locator("img")).toBeVisible();
  await page.mouse.click(10, 400);
  await clickShape(page, result!.id);
  await copySelection(page, ["text/html", "image/png"]);

  await page.getByRole("button", { name: "Project", exact: true }).click();
  await page.getByRole("menuitem", { name: "beta" }).click();
  await expect(page.locator("[data-canvas-project='beta'] .tl-canvas")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+v");
  await expect
    .poll(async () => (await roomShapes(engine, "beta", "image")).find((shape) => shape.meta?.unframed?.result)?.meta.unframed.result.sidecar ?? null)
    .not.toBeNull();
  const pasted = (await roomShapes(engine, "beta", "image")).find((shape) => shape.meta.unframed.result)!;
  expect(pasted.meta.unframed.result.sidecar).not.toBe(result!.meta.unframed.result.sidecar);
  const recipe = await (await engine.rpc()).call("recipe.read", { project: "beta", shapeId: pasted.id });
  expect(recipe.selectionPrompt).toBe("lone red fox");
  expect(recipe.references).toHaveLength(1);
  const referenced = recipe.references[0] as { file: string };
  expect((await engine.request(`/api/file/beta/${referenced.file}`)).body).toEqual(pngBytes(30, 30));
});
