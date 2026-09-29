import type { Page } from "@playwright/test";
import { gate } from "../../engine/test/openRouterStub.ts";
import { openCanvas, roomRecords, shapeOnScreen, type AnyRecord } from "./canvas.ts";
import { clickShape, composer, openComposer, selectGroup, toolbar } from "./generation.ts";
import { pngBytes } from "./images.ts";
import { groupRecord, inGroup, promptRecord, putRecords } from "./media.ts";
import { expect, imageResults, test, textResults, tray } from "./texting.ts";

const group = (recipe: unknown, text = "a knight in silver armour") => [
  { ...groupRecord("shape:character", "character", { x: 420, y: 40 }), meta: { unframed: { recipe } } },
  inGroup(promptRecord("shape:line", "300", text), "shape:character", { x: 28, y: 56 }),
];

const IMAGE_RECIPE = { medium: "image", model: "openai/gpt-image-2", params: { quality: "high", aspect_ratio: "2:3" }, runs: 3 };

const barButtons = (page: Page) => toolbar(page).getByRole("button");

test("a recipe group's bar: Generate N×, its @name with the estimate, Recipe", async ({ page, generation }) => {
  await openCanvas(page, generation.engine);
  await putRecords(generation.engine, group({ ...IMAGE_RECIPE, params: { quality: "low", resolution: "1K" } }));
  await expect(shapeOnScreen(page, "shape:line")).toBeVisible();
  await selectGroup(page, "shape:character");
  await expect(barButtons(page)).toHaveText(["Generate 3×", "Recipe"]);
  // Three low 1K images at $0.011.
  await expect(toolbar(page).getByTestId("selection-hint")).toHaveText("@character · ~$0.033");

  await putRecords(generation.engine, group({ ...IMAGE_RECIPE, runs: 1 }));
  await expect(barButtons(page)).toHaveText(["Generate", "Recipe"]);
});

test("Generate on a recipe group runs the recipe at once: its model and params, no instruction, one batch, results beside the box", async ({ page, generation }) => {
  const gates = [0, 1, 2].map(() => gate<void>());
  generation.answer(async ({ index }) => {
    await gates[index]!.promise;
    return { kind: "image", bytes: pngBytes(96, 64), cost: 0.167 };
  });
  const { engine } = generation;
  await openCanvas(page, engine);
  await putRecords(engine, group(IMAGE_RECIPE));
  await expect(shapeOnScreen(page, "shape:line")).toBeVisible();
  await selectGroup(page, "shape:character");
  await toolbar(page).getByRole("button", { name: "Generate 3×" }).click();
  await expect(composer(page)).toHaveCount(0);

  await expect.poll(() => generation.requests.length).toBe(3);
  for (const request of generation.requests) {
    expect(request.body).toMatchObject({ model: "openai/gpt-image-2", prompt: "a knight in silver armour", quality: "high", aspect_ratio: "2:3" });
    expect(request.body).not.toHaveProperty("input_references");
  }
  await expect(toolbar(page).getByRole("button", { name: "Generating 0 / 3…" })).toBeVisible();
  gates[1]!.release();
  await expect(toolbar(page).getByRole("button", { name: "Generating 1 / 3…" })).toBeVisible();
  gates[0]!.release();
  gates[2]!.release();
  await expect(toolbar(page).getByRole("button", { name: "Generate 3×" })).toBeVisible();

  const results = await imageResults(generation);
  expect(results).toHaveLength(3);
  expect(new Set(results.map((shape: AnyRecord) => shape.meta.unframed.result.batchId)).size).toBe(1);
  const box = (await roomRecords(engine, "default")).find((record) => record.id === "shape:character")!;
  for (const shape of results) {
    // Beside the box, not inside it: the next run of the box does not include its own outputs.
    expect(shape.parentId).toBe("page:page");
    expect(shape.x!).toBeGreaterThan(box.x! + box.props.w);
  }
});

test("a text recipe runs through the text medium from the bar", async ({ page, generation }) => {
  await openCanvas(page, generation.engine);
  await putRecords(generation.engine, group({ medium: "text", model: "openai/gpt-5", params: {}, runs: 1 }, "Turn this into JSON."));
  await expect(shapeOnScreen(page, "shape:line")).toBeVisible();
  await selectGroup(page, "shape:character");
  await toolbar(page).getByRole("button", { name: "Generate", exact: true }).click();
  await expect.poll(() => generation.chat.length).toBe(1);
  expect(generation.chat[0]!.body).toMatchObject({ model: "openai/gpt-5", messages: [{ role: "user", content: [{ type: "text", text: "Turn this into JSON." }] }] });
  await expect.poll(async () => (await textResults(generation)).filter((shape) => !shape.meta.unframed.run).length).toBe(1);
});

test("a Free recipe's Generate stops at the final prompt and spends nothing until it is confirmed", async ({ page, generation }) => {
  await openCanvas(page, generation.engine);
  await putRecords(generation.engine, group({ medium: "image", model: "openai/gpt-image-2", params: {}, runs: "free" }, "a fox\n---\na hare"));
  await expect(shapeOnScreen(page, "shape:line")).toBeVisible();
  await selectGroup(page, "shape:character");
  await expect(barButtons(page)).toHaveText(["Generate", "Recipe"]);
  await toolbar(page).getByRole("button", { name: "Generate", exact: true }).click();

  const dialog = page.getByTestId("final-prompt");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("2 generations. Nothing has been sent yet.");
  await page.waitForTimeout(300);
  expect(generation.requests).toHaveLength(0);
  expect(generation.chat).toHaveLength(0);

  await dialog.getByRole("button", { name: "Generate 2×" }).click();
  await expect.poll(() => generation.requests.length).toBe(2);
  expect(generation.requests.map((request) => request.body.prompt).sort()).toEqual(["a fox", "a hare"]);
});

test("the recipe applies with loose shapes selected too; they join the sources in order", async ({ page, generation }) => {
  const { engine } = generation;
  await openCanvas(page, engine);
  await putRecords(engine, [...group({ ...IMAGE_RECIPE, runs: 1 }), promptRecord("shape:loose", "301", "at dusk, in the rain", { x: 420, y: 420 })]);
  await expect(shapeOnScreen(page, "shape:loose")).toBeVisible();
  await selectGroup(page, "shape:character");
  await clickShape(page, "shape:loose", ["Shift"]);
  await expect(barButtons(page)).toHaveText(["Generate", "Recipe"]);
  await expect(toolbar(page).getByTestId("selection-hint")).toHaveText(/^@character/);
  await toolbar(page).getByRole("button", { name: "Generate", exact: true }).click();
  await expect.poll(() => generation.requests.length).toBe(1);
  expect(generation.requests[0]!.body.prompt).toBe("a knight in silver armour\n\nat dusk, in the rain");
});

test("a recipe run leaves the composer's last-used values as they were", async ({ page, generation }) => {
  const { engine } = generation;
  await openCanvas(page, engine);
  await putRecords(engine, group({ medium: "image", model: "google/gemini-3-pro-image", params: { aspect_ratio: "16:9" }, runs: 1 }));
  await expect(shapeOnScreen(page, "shape:line")).toBeVisible();
  await selectGroup(page, "shape:character");
  await toolbar(page).getByRole("button", { name: "Generate", exact: true }).click();
  await expect.poll(async () => (await imageResults(generation)).filter((shape) => shape.props.assetId).length).toBe(1);
  expect(generation.requests[0]!.body.model).toBe("google/gemini-3-pro-image");

  const { values } = await (await engine.rpc()).call("preferences.get", { keys: ["lastUsed.image"] });
  expect(values).toEqual({});
  await page.mouse.click(10, 400);
  await clickShape(page, "shape:starter-subject");
  await openComposer(page);
  await expect(tray(page).getByTestId("model-chip")).toHaveText("gpt-image-2");
});
