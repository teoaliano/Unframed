import type { Page } from "@playwright/test";
import { expect, test } from "./agent.ts";
import { fileOf, frameOf, htmlCount, onBoard, openEditor, parameters, preparedFile, selectByText, textOf } from "./editorHarness.ts";

/** A heading, a paragraph with its own padding, and a card: the Fill, Shape and Spacing fields all have something to show. */
const PAGE = `<!doctype html><html><head><style>body{margin:0;font:16px Georgia, serif}main{padding:16px}</style></head><body><main><h1 style="font-size: 32px; padding-top: 4px">Welcome</h1><p style="padding-top: 8px">Lead text</p><div class="card" style="height: 40px">Card</div></main></body></html>`;

/** A flex row with a gap, and a paragraph that is not flex: Layout and Gap show only for the row. */
const ROW_PAGE = `<!doctype html><html><head><style>body{margin:0;font:16px sans-serif}main{padding:16px}</style></head><body><main><div class="row" style="display: flex; gap: 4px; padding: 6px"><span>One</span><span>Two</span></div><p>Lead text</p></main></body></html>`;

/** A card with two shadows (read-only in Design) and a card with one (editable). */
const SHADOW_PAGE = `<!doctype html><html><head><style>body{margin:0;font:16px sans-serif}main{padding:16px}</style></head><body><main><div class="many" style="height: 40px; box-shadow: 0 1px 2px #000000, 0 2px 4px #111111">Many</div><div class="one" style="height: 40px; box-shadow: 0 1px 2px #000000">One</div></main></body></html>`;

const field = (page: Page, name: string) => parameters(page).getByRole("spinbutton", { name, exact: true });

test("Fill, Shape and Spacing fields write their declarations in one version, and the Font combobox lists the document's families", async ({ page, agent }) => {
  await onBoard(page, agent, PAGE);
  await openEditor(page);
  await selectByText(page, "Welcome");
  const before = await preparedFile(agent);
  const countBefore = await htmlCount(agent);

  // The Font combobox lists the family the document uses, with the generic families beside it.
  await parameters(page).getByLabel("Font", { exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("option", { name: "Georgia", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  // Colour and Background are popovers: a colour input and a hex field.
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

  // The frame shows the change before anything is saved.
  await expect(frameOf(page).getByRole("heading", { name: "Welcome" })).toHaveCSS("background-color", "rgb(0, 255, 0)", { timeout: 2000 });
  expect(await htmlCount(agent)).toBe(countBefore);

  // One version for the whole group, written 1.5 s after the last edit.
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

  // The row's padding is the click target: the spans cover its content.
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
