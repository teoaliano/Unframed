import { openCanvas } from "./canvas.ts";
import { clickShape, composer, instructionBox, openComposer } from "./generation.ts";
import { pngBytes } from "./images.ts";
import { filledMedia } from "./media.ts";
import { chooseText, expect, mediumOption, runButton, test, tray } from "./texting.ts";

test("the text medium: the switch offers text, the tray holds only the model, the send reads Run, and an empty prompt says so", async ({ page, generation }) => {
  const { engine } = generation;
  await openCanvas(page, engine);
  await filledMedia(engine, { id: "shape:photo", type: "image", ref: "300", at: { x: 420, y: 320 }, bytes: pngBytes(30, 30), name: "photo.png", mime: "image/png", natural: { w: 30, h: 30 }, width: 140 });

  await clickShape(page, "shape:starter-subject");
  await openComposer(page);
  await expect(mediumOption(page, "text")).toBeVisible();
  await chooseText(page);

  await expect(tray(page).getByTestId("model-chip")).toHaveText("gemini-3.5-flash-lite");
  await expect(tray(page).locator("[data-prop]")).toHaveCount(0);
  await expect(tray(page).getByRole("button", { name: "+ add prop" })).toHaveCount(0);
  await expect(runButton(page)).toBeEnabled();
  await expect(composer(page).getByTestId("estimate")).toHaveCount(0);

  // The text catalogue lists only models that read images.
  await tray(page).getByTestId("model-chip").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Text models" })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Browse on OpenRouter" })).toHaveAttribute("href", "https://openrouter.ai/models?output_modalities=text&input_modalities=image");
  await expect(dialog.locator("tbody tr td:first-child")).toHaveText(["gemini-3.5-flash-lite", "gpt-5"]);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // An image alone gives a text run nothing to say.
  await page.keyboard.press("Escape");
  await expect(composer(page)).toHaveCount(0);
  await page.mouse.click(10, 400);
  await clickShape(page, "shape:photo");
  await openComposer(page);
  await chooseText(page);
  await expect(composer(page).getByTestId("composer-status")).toHaveText("Nothing to run. Select a prompt, or type an instruction.");
  await expect(runButton(page)).toBeDisabled();
  await instructionBox(page).click();
  await page.keyboard.type("describe it");
  await expect(runButton(page)).toBeEnabled();
  await expect(composer(page).getByTestId("composer-status")).toHaveCount(0);
});
