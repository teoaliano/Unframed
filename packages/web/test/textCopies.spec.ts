import { copySelection, openCanvas, plainText, roomShapes, shapeOnScreen, toast } from "./canvas.ts";
import { clickShape } from "./generation.ts";
import { expect, makeTextResult, test } from "./texting.ts";

// These copy and paste through the system clipboard, so they run in the clipboard project (playwright.config.ts).
test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test("a copied text result is still a text result, in this project and pasted into another with its recipe", async ({ page, generation }) => {
  const { engine } = generation;
  generation.answerText(() => ({ kind: "text", text: "an answer about @100", cost: 0.0012 }));
  await openCanvas(page, engine);
  await (await engine.rpc()).call("projects.create", { name: "beta" });
  const result = await makeTextResult(page, generation);

  await page.mouse.click(10, 400);
  await clickShape(page, result.id);
  await copySelection(page);
  await page.keyboard.press("ControlOrMeta+v");
  await expect.poll(async () => (await roomShapes(engine, "default", "text")).length).toBe(4);
  const copy = (await roomShapes(engine, "default", "text")).find((shape) => ![result.id, "shape:starter-subject", "shape:starter-scene"].includes(shape.id))!;
  expect(copy.meta.unframed.result).toEqual(result.meta.unframed.result);
  expect(plainText(copy)).toBe("an answer about @100");
  await expect(shapeOnScreen(page, copy.id).locator(".unframed-shape-label")).toHaveText(`$0.0012 · @${copy.meta.ref}`);

  await page.getByRole("button", { name: "Project", exact: true }).click();
  await page.getByRole("menuitem", { name: "beta" }).click();
  await expect(page.locator("[data-canvas-project='beta'] .tl-canvas")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+v");
  await expect.poll(async () => (await roomShapes(engine, "beta", "text")).find((shape) => shape.meta?.unframed?.result)?.meta.unframed.result.sidecar ?? null).not.toBeNull();
  const pasted = (await roomShapes(engine, "beta", "text")).find((shape) => shape.meta?.unframed?.result)!;
  expect(pasted.meta.unframed.result.medium).toBe("text");
  const recipe = await (await engine.rpc()).call("recipe.read", { project: "beta", shapeId: pasted.id });
  expect(recipe).toMatchObject({ medium: "text", selectionPrompt: "lone red fox" });
  await expect(toast(page, /Could not copy the result's recipe/)).toHaveCount(0);
});
