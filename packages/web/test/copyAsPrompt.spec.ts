import { centre, openCanvas, plainText, roomShapes, shapeOnScreen } from "./canvas.ts";
import { clickShape, openComposer, sendRun } from "./generation.ts";
import { expect, makeTextResult, mediumOption, test } from "./texting.ts";

test("Copy as prompt places a plain prompt with the answer beside the text result, and its @ tokens resolve", async ({ page, generation }) => {
  generation.answerText(() => ({ kind: "text", text: "a portrait of @100" }));
  await openCanvas(page, generation.engine);
  const result = await makeTextResult(page, generation);

  await page.mouse.click(10, 400);
  await page.mouse.click(...(Object.values(await centre(shapeOnScreen(page, result.id).locator(".tl-rich-text"))) as [number, number]), { button: "right" });
  const menu = page.getByTestId("context-menu");
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "Copy as prompt" }).click();

  await expect.poll(async () => (await roomShapes(generation.engine, "default", "text")).length).toBe(4);
  const copy = (await roomShapes(generation.engine, "default", "text")).find((shape) => ![result.id, "shape:starter-subject", "shape:starter-scene"].includes(shape.id))!;
  expect(plainText(copy)).toBe("a portrait of @100");
  expect(copy.meta.unframed?.result).toBeUndefined();
  expect(copy.meta.ref).not.toBe(result.meta.ref);
  expect(copy.x).toBeGreaterThan(result.x!);
  expect(copy.y).toBe(result.y);
  // The text result is unchanged.
  expect(plainText((await roomShapes(generation.engine, "default", "text")).find((shape) => shape.id === result.id))).toBe("a portrait of @100");

  await page.mouse.click(10, 400);
  await clickShape(page, copy.id);
  await openComposer(page);
  await mediumOption(page, "image").click();
  await sendRun(page);
  await expect.poll(() => generation.requests.length).toBe(1);
  expect(generation.requests[0]!.body.prompt).toBe("a portrait of lone red fox");
});
