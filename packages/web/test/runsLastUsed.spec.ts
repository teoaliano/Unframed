import type { Page } from "@playwright/test";
import { openCanvas } from "./canvas.ts";
import { clickShape, composer, openComposer, sendRun } from "./generation.ts";
import { chooseText, expect, mediumOption, runsChip, runsPopup, sendText, setFree, setRuns, test, tray, type TextGeneration } from "./texting.ts";

const stored = async (generation: TextGeneration, medium: "image" | "text") =>
  (await (await generation.engine.rpc()).call("preferences.get", { keys: [`lastUsed.${medium}`] })).values[`lastUsed.${medium}`];

const reopen = async (page: Page) => {
  await page.mouse.click(10, 400);
  await clickShape(page, "shape:starter-subject");
  await openComposer(page);
};

test("the composer reopens on the last Runs value, Free and View final prompt for image, and the last picked model for text", async ({ page, generation }) => {
  await openCanvas(page, generation.engine);
  await reopen(page);
  await setRuns(page, 3);
  await sendRun(page);
  await expect.poll(() => stored(generation, "image")).toMatchObject({ props: { runs: 3 } });

  await reopen(page);
  await expect(runsChip(page)).toHaveText("3×");
  await setFree(page, true);
  await page.keyboard.press("ControlOrMeta+Enter");
  const dialog = page.getByRole("dialog", { name: "Final prompt" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect.poll(() => stored(generation, "image")).toMatchObject({ props: { runs: "free", viewFinalPrompt: true } });
  await page.keyboard.press("Escape");
  await expect(composer(page)).toHaveCount(0);

  await reopen(page);
  await expect(runsChip(page)).toHaveText("Free");
  await runsChip(page).click();
  await expect(runsPopup(page).getByRole("checkbox", { name: "View final prompt" })).toBeChecked();
  await page.keyboard.press("Escape");

  // Text remembers the model picked in its dialog, and nothing else.
  await chooseText(page);
  await tray(page).getByTestId("model-chip").click();
  await page.getByRole("dialog").getByRole("button", { name: "gpt-5", exact: true }).click();
  await expect(tray(page).getByTestId("model-chip")).toHaveText("gpt-5");
  await sendText(page);
  await expect.poll(() => stored(generation, "text")).toEqual({ model: "openai/gpt-5", props: {} });

  await reopen(page);
  await expect(mediumOption(page, "text")).toHaveAttribute("aria-checked", "true");
  await expect(tray(page).getByTestId("model-chip")).toHaveText("gpt-5");
  await mediumOption(page, "image").click();
  await expect(runsChip(page)).toHaveText("Free");
});
