import type { Page } from "@playwright/test";
import { gate } from "../../engine/test/openRouterStub.ts";
import { openCanvas, shapeOnScreen, toast, type AnyRecord } from "./canvas.ts";
import { clickShape, composer, openComposer, sendButton, sendRun, settled, toolbar } from "./generation.ts";
import { pngBytes } from "./images.ts";
import { expect, imageResults, setRuns, test, type TextGeneration } from "./texting.ts";

const sidecarOf = async (generation: TextGeneration, shape: AnyRecord) =>
  JSON.parse((await generation.engine.request(`/api/file/default/${shape.meta.unframed.result.sidecar}`)).text);

const openOnSubject = async (page: Page) => {
  await page.mouse.click(10, 400);
  await clickShape(page, "shape:starter-subject");
  await openComposer(page);
};

test("Runs 4 reads Generate 4×, multiplies the estimate, and lands four results in run order sharing one batch id", async ({ page, generation }) => {
  const gates = [1, 2, 3, 4].map(() => gate<void>());
  generation.answer(async ({ index }) => {
    await gates[index]!.promise;
    return { kind: "image", bytes: pngBytes(96, 64), cost: 0.011 };
  });
  await openCanvas(page, generation.engine);
  await openOnSubject(page);
  await expect(composer(page).getByTestId("estimate")).toHaveText("est. ~$0.011");
  await setRuns(page, 4);
  await expect(sendButton(page)).toHaveText("Generate 4×");
  await expect(composer(page).getByTestId("estimate")).toHaveText("est. ~$0.044");
  await sendRun(page);

  await expect.poll(async () => (await imageResults(generation)).length).toBe(4);
  await expect.poll(() => generation.requests.length).toBe(4);
  expect(new Set(generation.requests.map((request) => request.body.prompt))).toEqual(new Set(["lone red fox"]));
  // Answered last to first: the row still reads in run order.
  for (const index of [3, 2, 1, 0]) gates[index]!.release();
  await expect.poll(async () => (await imageResults(generation)).filter((shape) => shape.props.assetId).length).toBe(4);

  const results = (await imageResults(generation)).sort((a, b) => a.meta.unframed.result.runIndex - b.meta.unframed.result.runIndex);
  expect(results.map((shape) => shape.meta.unframed.result.runIndex)).toEqual([1, 2, 3, 4]);
  expect(results.map((shape) => shape.meta.unframed.result.runCount)).toEqual([4, 4, 4, 4]);
  const xs = results.map((shape) => shape.x!);
  expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  const sidecars = await Promise.all(results.map((shape) => sidecarOf(generation, shape)));
  const batchId = sidecars[0].batchId;
  expect(batchId).toMatch(/^b-\d+$/);
  expect(sidecars.map((sidecar) => [sidecar.batchId, sidecar.runIndex, sidecar.runCount])).toEqual([1, 2, 3, 4].map((index) => [batchId, index, 4]));
});

test("a partial batch keeps its successes and says how many succeeded", async ({ page, generation }) => {
  generation.answer(({ index }) =>
    index === 1 ? { kind: "status", status: 500, body: { error: { message: "model overloaded" } } } : { kind: "image", bytes: pngBytes(96, 64), cost: 0.011 },
  );
  await openCanvas(page, generation.engine);
  await openOnSubject(page);
  await setRuns(page, 3);
  await sendRun(page);
  await expect(toast(page, "2 of 3 succeeded. OpenRouter (500): model overloaded")).toBeVisible();
  await expect.poll(async () => (await imageResults(generation)).filter((shape) => shape.props.assetId).length).toBe(2);
  expect(await imageResults(generation)).toHaveLength(2);
});

test("selecting every member of a batch shows its image count and total", async ({ page, generation }) => {
  generation.answer(() => ({ kind: "image", bytes: pngBytes(96, 64), cost: 0.168 }));
  await openCanvas(page, generation.engine);
  await openOnSubject(page);
  await setRuns(page, 3);
  await sendRun(page);
  await expect.poll(async () => (await imageResults(generation)).filter((shape) => shape.props.assetId && !shape.meta.unframed.run).length).toBe(3);
  const results = await imageResults(generation);

  await page.mouse.click(10, 400);
  // One zoom step out, so the whole row is on screen.
  await page.keyboard.press("-");
  await expect(shapeOnScreen(page, results[2]!.id)).toBeVisible();
  await settled(shapeOnScreen(page, results[2]!.id));
  await clickShape(page, results[0]!.id);
  await clickShape(page, results[1]!.id, ["Shift"]);
  await expect(toolbar(page).getByTestId("selection-hint")).toHaveText("2 selected");
  await clickShape(page, results[2]!.id, ["Shift"]);
  await expect(toolbar(page).getByTestId("selection-hint")).toHaveText("3 images · $0.5040");
});
