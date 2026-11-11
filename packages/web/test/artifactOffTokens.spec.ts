import type { Page } from "@playwright/test";
import { expect, test } from "./agent.ts";
import { openCanvas } from "./canvas.ts";
import { fileOf, htmlCount, onBoard, openEditor, outline, parameters, preparedFile, selectByText, textOf } from "./editorHarness.ts";
import { putRecords } from "./media.ts";

const BRAND = {
  format: 1,
  name: "Brand",
  modes: ["light", "dark"],
  tokens: [
    { path: "color/brand/primary", type: "color", value: "#1a73e8" },
    { path: "dimension/space/md", type: "dimension", value: "16px" },
  ],
};

const PAGE = `<!doctype html><html><head><style>body{margin:0;font:16px sans-serif}main{margin:0}.card{padding-top: 16px}</style></head><body><main><h1 style="color: #1a73e8">Welcome</h1><p class="card">Card text</p></main></body></html>`;

const seedKit = async (page: Page, engine: Parameters<typeof openCanvas>[1]) => {
  await openCanvas(page, engine);
  await putRecords(engine, [{ id: "document:document", typeName: "document", gridSize: 10, name: "", meta: { unframed: { kit: BRAND } } }]);
};

const offTokensSection = (page: Page) => parameters(page).getByRole("group", { name: "Off-token values" });

const useTokenOf = (page: Page, text: string) => offTokensSection(page).locator("div.grid").filter({ hasText: text }).getByRole("button", { name: "Use token", exact: true });

test("the section counts the off-token values, lists each place, and selects an element or a rule's elements", async ({ page, agent }) => {
  await seedKit(page, agent);
  await onBoard(page, agent, PAGE);
  await openEditor(page);
  await selectByText(page, "Welcome");
  await preparedFile(agent);

  const toggle = parameters(page).getByRole("button", { name: "Off-token values (2)", exact: true });
  await expect(toggle).toBeVisible();
  await expect(parameters(page).getByRole("button", { name: "Use token", exact: true })).toHaveCount(0);

  await toggle.click();
  await expect(parameters(page).getByRole("button", { name: "Use token", exact: true })).toHaveCount(2);
  await expect(offTokensSection(page)).toContainText("color: #1a73e8 = --color-brand-primary");
  await expect(offTokensSection(page)).toContainText("padding-top: 16px = --dimension-space-md");
  await expect(offTokensSection(page)).toContainText("In styles: .card");

  await parameters(page).getByRole("button", { name: /In styles: \.card/ }).click();
  await expect(outline(page, "selected")).toHaveCount(1, { timeout: 4000 });
});

test("Use token writes a token edit on an inline value and on a style rule, and the count follows the file", async ({ page, agent }) => {
  await seedKit(page, agent);
  await onBoard(page, agent, PAGE);
  await openEditor(page);
  await selectByText(page, "Welcome");
  await preparedFile(agent);
  const countBefore = await htmlCount(agent);

  await parameters(page).getByRole("button", { name: "Off-token values (2)", exact: true }).click();
  await useTokenOf(page, "color: #1a73e8").click();
  await expect.poll(() => htmlCount(agent), { timeout: 8000 }).toBe(countBefore + 1);
  expect(await textOf(agent, (await fileOf(agent))!)).toMatch(/style="color:\s*var\(--color-brand-primary\)"/);
  await expect(parameters(page).getByRole("button", { name: "Off-token values (1)", exact: true })).toBeVisible({ timeout: 8000 });

  await useTokenOf(page, "padding-top: 16px").click();
  await expect.poll(() => htmlCount(agent), { timeout: 8000 }).toBe(countBefore + 2);
  expect(await textOf(agent, (await fileOf(agent))!)).toMatch(/\.card\{padding-top:\s*var\(--dimension-space-md\)\}|\.card \{\s*padding-top:\s*var\(--dimension-space-md\)/);
  await expect(parameters(page).getByRole("button", { name: "Off-token values (0)", exact: true })).toBeVisible({ timeout: 8000 });
  await expect(offTokensSection(page)).toContainText("Every value here is on the kit.");
});
