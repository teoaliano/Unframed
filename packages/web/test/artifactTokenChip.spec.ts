import type { Page } from "@playwright/test";
import { expect, test } from "./agent.ts";
import { openCanvas } from "./canvas.ts";
import { fileOf, htmlCount, onBoard, openEditor, parameters, preparedFile, selectByText, textOf } from "./editorHarness.ts";
import { putRecords } from "./media.ts";

const BRAND = {
  format: 1,
  name: "Brand",
  modes: ["light", "dark"],
  tokens: [
    { path: "color/brand/primary", type: "color", values: { light: "#1a73e8", dark: "#8ab4f8" } },
    { path: "color/brand/accent", type: "color", value: "#e8711a" },
    {
      path: "type/body",
      type: "textStyle",
      value: { fontFamily: "Verdana, sans-serif", fontSize: "20px", fontWeight: 400, lineHeight: 1.5, letterSpacing: "0.5px" },
    },
  ],
};

const TOKENISED = `<!doctype html><html><head><style>body{margin:0;font:16px sans-serif}main{padding:16px}</style></head><body><main><h1 style="color: var(--color-brand-primary)">Welcome</h1><p style="font-family: var(--type-body-font-family); font-size: var(--type-body-font-size); font-weight: var(--type-body-font-weight); line-height: var(--type-body-line-height); letter-spacing: var(--type-body-letter-spacing)">Body copy</p><p style="color: var(--nope)">Unknown token</p></main></body></html>`;

const seedKit = async (page: Page, engine: Parameters<typeof openCanvas>[1]) => {
  await openCanvas(page, engine);
  await putRecords(engine, [{ id: "document:document", typeName: "document", gridSize: 10, name: "", meta: { unframed: { kit: BRAND } } }]);
};

test("a var() of the kit shows a chip with its short path and value, another token replaces it, and Detach writes the value", async ({ page, agent }) => {
  await seedKit(page, agent);
  await onBoard(page, agent, TOKENISED);
  await openEditor(page);
  await selectByText(page, "Welcome");
  await preparedFile(agent);
  const countBefore = await htmlCount(agent);

  const chip = parameters(page).getByRole("button", { name: /brand\/primary/ });
  await expect(chip).toBeVisible();
  await expect(chip).toContainText("#1a73e8");
  await chip.hover();
  await expect(page.locator("[data-slot='tooltip-popup']")).toHaveText("color/brand/primary");

  await chip.click();
  await page.getByRole("button", { name: /color\/brand\/accent/ }).click();
  await expect.poll(() => htmlCount(agent), { timeout: 8000 }).toBe(countBefore + 1);
  expect(await textOf(agent, (await fileOf(agent))!)).toMatch(/color:\s*var\(--color-brand-accent\)/);
  await expect(parameters(page).getByRole("button", { name: /brand\/accent/ })).toBeVisible();

  await parameters(page).getByRole("button", { name: /brand\/accent/ }).click();
  await page.getByRole("button", { name: "Detach", exact: true }).click();
  await expect.poll(() => htmlCount(agent), { timeout: 8000 }).toBe(countBefore + 2);
  const detached = await textOf(agent, (await fileOf(agent))!);
  expect(detached).toMatch(/color:\s*#e8711a/);
  expect(detached).not.toMatch(/var\(--color-brand-accent\)/);
  await expect(parameters(page).getByRole("button", { name: /brand\/accent/ })).toHaveCount(0);
});

test("a var() the kit does not have stays as written: no chip and no Detach", async ({ page, agent }) => {
  await seedKit(page, agent);
  await onBoard(page, agent, TOKENISED);
  await openEditor(page);
  await selectByText(page, "Unknown token");
  await preparedFile(agent);

  await expect(parameters(page).getByRole("button", { name: /nope/ })).toHaveCount(0);
  await expect(parameters(page).getByRole("button", { name: /brand/ })).toHaveCount(0);
  await parameters(page).getByRole("group", { name: "Text", exact: true }).getByRole("button", { name: /^Use a token/ }).first().click();
  await expect(page.getByRole("button", { name: "Detach", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
});

test("a text style whose five fields hold its sub-names shows a text style chip, and Detach writes the five values", async ({ page, agent }) => {
  await seedKit(page, agent);
  await onBoard(page, agent, TOKENISED);
  await openEditor(page);
  await selectByText(page, "Body copy");
  await preparedFile(agent);
  const countBefore = await htmlCount(agent);

  const styleChip = parameters(page).getByRole("group", { name: "Text", exact: true }).getByRole("button", { name: /type\/body/ }).first();
  await expect(styleChip).toBeVisible();
  await styleChip.click();
  await page.getByRole("button", { name: "Detach", exact: true }).click();
  await expect.poll(() => htmlCount(agent), { timeout: 8000 }).toBe(countBefore + 1);
  const written = await textOf(agent, (await fileOf(agent))!);
  expect(written).not.toMatch(/var\(--type-body-/);
  expect(written).toMatch(/font-size:\s*20px/);
  expect(written).toMatch(/letter-spacing:\s*0\.5px/);
});
