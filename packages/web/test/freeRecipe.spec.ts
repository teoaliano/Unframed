import { openCanvas, shapeOnScreen } from "./canvas.ts";
import { clickShape, composer, instructionBox, openComposer, sendButton, sendRun, settled, toolbar } from "./generation.ts";
import { pngBytes } from "./images.ts";
import { filledMedia, promptRecord, putRecords } from "./media.ts";
import { expect, imageResults, runsChip, setFree, test } from "./texting.ts";

test("Regenerate on a Free output reopens with Runs at 1 and sends that run's own prompt and references", async ({ page, generation }) => {
  const { engine } = generation;
  await openCanvas(page, engine);
  for (const [id, ref, y, seed] of [["shape:style", "300", 40, 1], ["shape:subject", "301", 240, 2]] as const) {
    await filledMedia(engine, { id, type: "image", ref, at: { x: 540, y }, bytes: pngBytes(30, 30, seed), name: `${ref}.png`, mime: "image/png", natural: { w: 30, h: 30 }, width: 120 });
  }
  await putRecords(engine, [promptRecord("shape:list", "302", "images: 2\n[1] alone\n---\nboth together", { x: 40, y: -80 })]);
  await expect(shapeOnScreen(page, "shape:list")).toBeVisible();

  await page.mouse.click(10, 400);
  await clickShape(page, "shape:list");
  await clickShape(page, "shape:style", ["Shift"]);
  await clickShape(page, "shape:subject", ["Shift"]);
  await openComposer(page);
  await setFree(page);
  await sendRun(page);
  await expect.poll(async () => (await imageResults(generation)).filter((shape) => shape.props.assetId && !shape.meta.unframed.run).length).toBe(2);
  const first = (await imageResults(generation)).find((shape) => shape.meta.unframed.result.runIndex === 1)!;
  const sent = generation.requests.find((request) => request.body.prompt === "image 1 alone")!;

  await page.mouse.click(10, 400);
  // One zoom step out, so the results clear the style panel.
  await page.keyboard.press("-");
  await settled(shapeOnScreen(page, first.id));
  await clickShape(page, first.id);
  await toolbar(page).getByRole("button", { name: "Regenerate" }).click();
  await expect(composer(page)).toBeVisible();
  await expect(composer(page).getByTestId("source-count")).toHaveText("recipe · 2 sources");
  await expect(composer(page).getByTestId("recipe-prompt")).toHaveText("image 1 alone");
  await expect(composer(page).getByTestId("recipe-references")).toHaveText("with 1 image");
  await expect(runsChip(page)).toHaveCount(0);
  await expect(sendButton(page)).toHaveText("Generate");

  await instructionBox(page).click();
  await page.keyboard.type("sharper");
  const before = generation.requests.length;
  await sendRun(page);
  await expect.poll(() => generation.requests.length).toBe(before + 1);
  const again = generation.requests.at(-1)!;
  expect(again.body.prompt).toBe("image 1 alone\n\nsharper");
  expect(again.body.input_references).toEqual(sent.body.input_references);
  expect(again.body.input_references).toHaveLength(1);
});
