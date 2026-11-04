import type { Page } from "@playwright/test";
import { expect, test } from "./agent.ts";
import { fileOf, frameOf, htmlCount, onBoard, openEditor, parameters, preparedFile, selectByText, textOf } from "./editorHarness.ts";

const PAGE = `<!doctype html><html><head><style>body{margin:0;font:16px Georgia, serif}main{padding:16px}</style></head><body><main><h1 style="font-size: 32px; padding-top: 4px">Welcome</h1><p style="padding-top: 8px">Lead text</p><div class="card" style="height: 40px">Card</div></main></body></html>`;

const ROW_PAGE = `<!doctype html><html><head><style>body{margin:0;font:16px sans-serif}main{padding:16px}</style></head><body><main><div class="row" style="display: flex; gap: 4px; padding: 6px"><span>One</span><span>Two</span></div><p>Lead text</p></main></body></html>`;

const SHADOW_PAGE = `<!doctype html><html><head><style>body{margin:0;font:16px sans-serif}main{padding:16px}</style></head><body><main><div class="many" style="height: 40px; box-shadow: 0 1px 2px #000000, 0 2px 4px #111111">Many</div><div class="one" style="height: 40px; box-shadow: 0 1px 2px #000000">One</div></main></body></html>`;

const field = (page: Page, name: string) => parameters(page).getByRole("spinbutton", { name, exact: true });

test("Fill, Shape and Spacing fields write their declarations in one version, and the Font combobox lists the document's families", async ({ page, agent }) => {
  await onBoard(page, agent, PAGE);
  await openEditor(page);
  await selectByText(page, "Welcome");
  const before = await preparedFile(agent);
  const countBefore = await htmlCount(agent);

  await parameters(page).getByLabel("Font", { exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("option", { name: "Georgia", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  await parameters(page).getByRole("button", { name: "Background", exact: true }).click();
  await page.getByRole("textbox", { name: "Hex", exact: true }).fill("#00ff00");
  await page.getByRole("textbox", { name: "Hex", exact: true }).press("Enter");
  await page.keyboard.press("Escape");

  await field(page, "Corner radius").fill("8");
  await field(page, "Corner radius").press("Enter");
  await field(page, "Opacity").fill("50");
  await field(page, "Opacity").press("Enter");
  await field(page, "Padding top").fill("12");
  await field(page, "Padding top").press("Enter");

  await expect(frameOf(page).getByRole("heading", { name: "Welcome" })).toHaveCSS("background-color", "rgb(0, 255, 0)", { timeout: 2000 });
  expect(await htmlCount(agent)).toBe(countBefore);

  await expect.poll(() => htmlCount(agent), { timeout: 8000 }).toBe(countBefore + 1);
  await expect.poll(() => fileOf(agent), { timeout: 8000 }).not.toBe(before);
  const written = await textOf(agent, (await fileOf(agent))!);
  expect(written).toMatch(/background-color:\s*#00ff00/);
  expect(written).toMatch(/border-radius:\s*8px/);
  expect(written).toMatch(/opacity:\s*0\.5/);
  expect(written).toMatch(/padding-top:\s*12px/);
});

test("Layout shows only for a flex element, Gap for flex or grid, and a Direction change writes flex-direction", async ({ page, agent }) => {
  await onBoard(page, agent, ROW_PAGE);
  await openEditor(page);
  await selectByText(page, "Lead text");
  await preparedFile(agent);
  await expect(parameters(page).getByRole("combobox", { name: "Direction", exact: true })).toHaveCount(0);
  await expect(field(page, "Gap")).toHaveCount(0);

  await frameOf(page).locator(".row").click({ position: { x: 2, y: 2 } });
  await expect(parameters(page).getByRole("combobox", { name: "Direction", exact: true })).toBeVisible();
  await expect(field(page, "Gap")).toHaveValue("4");

  const countBefore = await htmlCount(agent);
  await parameters(page).getByRole("combobox", { name: "Direction", exact: true }).click();
  await page.getByRole("option", { name: "column", exact: true }).click();
  await expect.poll(() => htmlCount(agent), { timeout: 8000 }).toBe(countBefore + 1);
  expect(await textOf(agent, (await fileOf(agent))!)).toMatch(/flex-direction:\s*column/);
});

test("a value with several shadows is read-only with its sentence, and one shadow is editable", async ({ page, agent }) => {
  await onBoard(page, agent, SHADOW_PAGE);
  await openEditor(page);
  await selectByText(page, "Many");
  await preparedFile(agent);
  await expect(parameters(page).getByText("Several shadows. Ask the agent to change them.")).toBeVisible();
  await expect(field(page, "Shadow x")).toBeDisabled();

  await selectByText(page, "One");
  await expect(field(page, "Shadow x")).toBeEnabled();
  const countBefore = await htmlCount(agent);
  await field(page, "Shadow x").fill("4");
  await field(page, "Shadow x").press("Enter");
  await expect.poll(() => htmlCount(agent), { timeout: 8000 }).toBe(countBefore + 1);
  expect(await textOf(agent, (await fileOf(agent))!)).toMatch(/box-shadow:\s*4px 1px 2px 0px #000000/);
});

test("two selected elements show Mixed where they differ, and one edit reaches both", async ({ page, agent }) => {
  await onBoard(page, agent, PAGE);
  await openEditor(page);
  await selectByText(page, "Welcome");
  const before = await preparedFile(agent);
  await frameOf(page).getByText("Lead text", { exact: true }).click({ modifiers: ["Shift"] });
  await expect(page.locator('[data-edit-outline="selected"]')).toHaveCount(2);

  await expect(field(page, "Padding top")).toHaveAttribute("placeholder", "Mixed");
  await field(page, "Padding top").fill("10");
  await field(page, "Padding top").press("Enter");
  await expect.poll(() => fileOf(agent), { timeout: 8000 }).not.toBe(before);
  const written = await textOf(agent, (await fileOf(agent))!);
  expect(written.match(/padding-top:\s*10px/g) ?? []).toHaveLength(2);
});

test("Visible switches an element off with the hide edit, and back on", async ({ page, agent }) => {
  await onBoard(page, agent, PAGE);
  await openEditor(page);
  await selectByText(page, "Lead text");
  await preparedFile(agent);
  const countBefore = await htmlCount(agent);

  await parameters(page).getByRole("switch", { name: "Visible", exact: true }).click();
  await expect.poll(() => htmlCount(agent), { timeout: 8000 }).toBe(countBefore + 1);
  const hidden = await textOf(agent, (await fileOf(agent))!);
  expect(hidden).toMatch(/data-uf-hidden/);
  expect(hidden).toMatch(/display:\s*none\s*!important/);
});

test("Visible shows the new state at once, and a shown element returns in the frame before the burst commits", async ({ page, agent }) => {
  await onBoard(page, agent, PAGE);
  await openEditor(page);
  await selectByText(page, "Lead text");
  await preparedFile(agent);
  const visible = parameters(page).getByRole("switch", { name: "Visible", exact: true });

  await visible.click();
  await expect(visible).toHaveAttribute("aria-checked", "false", { timeout: 500 });
  await expect(frameOf(page).getByText("Lead text")).toBeHidden({ timeout: 500 });
  await expect.poll(async () => (await textOf(agent, (await fileOf(agent))!)).match(/data-uf-hidden/) !== null, { timeout: 8000 }).toBe(true);

  await visible.click();
  await expect(visible).toHaveAttribute("aria-checked", "true", { timeout: 500 });
  await expect(frameOf(page).getByText("Lead text")).toBeVisible({ timeout: 500 });
});

test("a refused Font value goes back to the family the element had, with the refusal sentence", async ({ page, agent }) => {
  await onBoard(page, agent, PAGE);
  await openEditor(page);
  await selectByText(page, "Lead text");
  await preparedFile(agent);
  const font = parameters(page).getByLabel("Font", { exact: true });
  await expect(font).toHaveValue("Georgia");

  await font.fill("</style><script>window.__pwned=1</script>");
  await font.press("Enter");
  await expect(page.getByText(/Font cannot be/).first()).toBeVisible();
  await expect(font).toHaveValue("Georgia");
  expect(await textOf(agent, (await fileOf(agent))!)).not.toMatch(/__pwned|<script>window/);
});

test("Design rows: Opacity lines up with the other number fields, the Shape sub-fields have labels, and empty line height and letter spacing show their keyword", async ({ page, agent }) => {
  await onBoard(page, agent, PAGE);
  await openEditor(page);
  await selectByText(page, "Lead text");
  await preparedFile(agent);

  const size = await field(page, "Size").boundingBox();
  const opacity = await field(page, "Opacity").boundingBox();
  const radius = await field(page, "Corner radius").boundingBox();
  expect(opacity!.width).toBeCloseTo(size!.width, 0);
  expect(radius!.width).toBeCloseTo(size!.width, 0);

  for (const caption of ["Width", "Style", "Colour", "X", "Y", "Blur", "Spread"]) {
    await expect(parameters(page).getByText(caption, { exact: true }).first()).toBeVisible();
  }
  await expect(field(page, "Line height")).toHaveAttribute("placeholder", "auto");
  await expect(field(page, "Letter spacing")).toHaveAttribute("placeholder", "normal");
});
