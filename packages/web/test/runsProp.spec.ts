import type { Page } from "@playwright/test";
import { openCanvas } from "./canvas.ts";
import { clickShape, composer, openAndEscape, openComposer } from "./generation.ts";
import { addRuns, expect, runsChip, runsField, runsPopup, setRuns, test, tray } from "./texting.ts";

const openOnSubject = async (page: Page) => {
  await clickShape(page, "shape:starter-subject");
  await openComposer(page);
};

const pickModel = async (page: Page, part: string) => {
  await tray(page).getByTestId("model-chip").click();
  await page.getByRole("dialog").getByRole("button", { name: part, exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
};

test("Runs: + add prop lists it at 1, its chip reads the count, Remove puts it back to 1, and a model change leaves it", async ({ page, generation }) => {
  await openCanvas(page, generation.engine);
  await openOnSubject(page);
  await expect(runsChip(page)).toHaveCount(0);

  await tray(page).getByRole("button", { name: "+ add prop" }).click();
  await expect(page.getByRole("menu", { name: "Add prop" }).getByRole("menuitem", { name: "Runs 1" })).toBeVisible();
  await page.keyboard.press("Escape");

  await addRuns(page);
  await runsField(page).fill("4");
  await page.keyboard.press("Escape");
  await expect(runsPopup(page)).toHaveCount(0);
  await expect(runsChip(page)).toHaveText("4×");
  await expect(composer(page)).toBeVisible();

  // Not a model trait: a model change resets the model's props and leaves Runs.
  await pickModel(page, "gemini-3-pro-image");
  await expect(runsChip(page)).toHaveText("4×");
  await expect(tray(page).locator("[data-prop]")).toHaveText(["1:1", "4×"]);

  await runsChip(page).click();
  await runsPopup(page).getByRole("button", { name: "Remove" }).click();
  await expect(runsChip(page)).toHaveCount(0);
  await tray(page).getByRole("button", { name: "+ add prop" }).click();
  await expect(page.getByRole("menu", { name: "Add prop" }).getByRole("menuitem", { name: "Runs 1" })).toBeVisible();
  await page.keyboard.press("Escape");

  // Left at 1, it leaves the tray when its popup closes.
  await setRuns(page, 1);
  await expect(runsChip(page)).toHaveCount(0);
});

test("an Escape the moment the Runs popup opens closes only the popup", async ({ page, generation }) => {
  await openCanvas(page, generation.engine);
  await openOnSubject(page);
  await setRuns(page, 4);
  expect(await openAndEscape(runsChip(page))).toEqual({ focusOnControl: true });
  await expect(runsPopup(page)).toHaveCount(0);
  await expect(runsChip(page)).toHaveText("4×");
  await expect(composer(page)).toBeVisible();
});

test("the Runs field keeps digits only, clamps as you type, shows the clamped value on blur, and focusing it leaves Free", async ({ page, generation }) => {
  await openCanvas(page, generation.engine);
  await openOnSubject(page);
  await addRuns(page);
  const field = runsField(page);

  await field.fill("");
  await field.pressSequentially("4x");
  await expect(field).toHaveValue("4");
  await expect(runsChip(page)).toHaveText("4×");

  await field.fill("");
  await field.pressSequentially("15");
  await expect(field).toHaveValue("15");
  await expect(runsChip(page)).toHaveText("10×");
  await page.keyboard.press("Tab");
  await expect(field).toHaveValue("10");

  await field.fill("");
  await field.pressSequentially("0");
  await expect(field).toHaveValue("0");
  await expect(runsChip(page)).toHaveText("1×");
  await page.keyboard.press("Tab");
  await expect(field).toHaveValue("1");

  await field.fill("");
  await field.pressSequentially("7");
  await field.pressSequentially("123");
  await expect(field).toHaveValue("71");
  await expect(runsChip(page)).toHaveText("10×");

  // Free, then back to a count by focusing the field.
  const free = runsPopup(page).getByRole("button", { name: "Free" });
  await free.click();
  await expect(free).toHaveAttribute("aria-pressed", "true");
  await expect(runsChip(page)).toHaveText("Free");
  await field.click();
  await expect(free).toHaveAttribute("aria-pressed", "false");
  await expect(runsChip(page)).toHaveText("1×");
});
