import type { Page } from "@playwright/test";
import { expect, test } from "./agent.ts";
import { openCanvas } from "./canvas.ts";
import { fileOf, frameOf, htmlCount, onBoard, openEditor, parameters, preparedFile, selectByText, textOf } from "./editorHarness.ts";
import { putRecords } from "./media.ts";

/** The Design tab's token button (spec 19, The token button): the offered tokens with their values, a hover preview, a choice that writes a source edit. */

const PAGE = `<!doctype html><html><head><style>body{margin:0;font:16px Georgia, serif}main{padding:16px}</style></head><body><main><h1 style="font-size: 32px">Welcome</h1><p>Lead text</p></main></body></html>`;

const BRAND = {
  format: 1,
  name: "Brand",
  modes: ["light", "dark"],
  tokens: [
    { path: "color/brand/primary", type: "color", values: { light: "#1a73e8", dark: "#8ab4f8" } },
    { path: "dimension/space/md", type: "dimension", value: "16px" },
    {
      path: "type/body",
      type: "textStyle",
      value: { fontFamily: "Verdana, sans-serif", fontSize: "20px", fontWeight: 400, lineHeight: 1.5, letterSpacing: "0.5px" },
    },
  ],
};

/** The project kit, written into the canvas room the way a person's commit does (the room's document record). */
const seedKit = async (page: Page, engine: Parameters<typeof openCanvas>[1], kit: unknown) => {
  await openCanvas(page, engine);
  await putRecords(engine, [{ id: "document:document", typeName: "document", gridSize: 10, name: "", meta: { unframed: { kit } } }]);
};

/** A section's token button: the Text section's first one is its Text style picker, in the legend. */
const tokenButton = (page: Page, group: string) => parameters(page).getByRole("group", { name: group, exact: true }).getByRole("button", { name: /^Use a token/ }).first();

test("the Fill token button lists the colour tokens with their value, previews on hover, and a choice writes a token edit", async ({ page, agent }) => {
  await seedKit(page, agent, BRAND);
  await onBoard(page, agent, PAGE);
  await openEditor(page);
  await selectByText(page, "Welcome");
  await preparedFile(agent);
  const countBefore = await htmlCount(agent);

  await tokenButton(page, "Fill").click();
  const token = page.getByRole("button", { name: /color\/brand\/primary/ });
  await expect(token).toContainText("#1a73e8");
  await expect(page.getByRole("button", { name: "Edit kit", exact: true })).toBeVisible();
  // Only the colour tokens are offered for a fill.
  await expect(page.getByRole("button", { name: /dimension\/space\/md/ })).toHaveCount(0);

  await token.hover();
  await expect(frameOf(page).getByRole("heading", { name: "Welcome" })).toHaveCSS("background-color", "rgb(26, 115, 232)", { timeout: 2000 });
  expect(await htmlCount(agent)).toBe(countBefore);

  await token.click();
  await expect.poll(() => htmlCount(agent), { timeout: 8000 }).toBe(countBefore + 1);
  const file = (await fileOf(agent))!;
  expect(await textOf(agent, file)).toMatch(/background-color:\s*var\(--color-brand-primary\)/);
});

test("with no kit the token popover reads No kit yet., and Edit kit opens the empty Kit dialog", async ({ page, agent }) => {
  await onBoard(page, agent, PAGE);
  await openEditor(page);
  await selectByText(page, "Welcome");
  await preparedFile(agent);

  await tokenButton(page, "Fill").click();
  await expect(page.getByText("No kit yet.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit kit", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Kit" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("This project has no kit yet.");
});

test("the Text style picker writes the five text longhands of a text style, and the Kit line opens the dialog", async ({ page, agent }) => {
  await seedKit(page, agent, BRAND);
  await onBoard(page, agent, PAGE);
  await openEditor(page);
  await selectByText(page, "Welcome");
  await preparedFile(agent);
  const countBefore = await htmlCount(agent);

  await expect(parameters(page).getByRole("button", { name: "Kit: Brand", exact: true })).toBeVisible();
  await tokenButton(page, "Text").click();
  await page.getByRole("button", { name: /type\/body/ }).click();
  await expect.poll(() => htmlCount(agent), { timeout: 8000 }).toBe(countBefore + 1);
  const written = await textOf(agent, (await fileOf(agent))!);
  for (const suffix of ["font-family", "font-size", "font-weight", "line-height", "letter-spacing"]) {
    expect(written).toContain(`${suffix}: var(--type-body-${suffix})`);
  }

  await parameters(page).getByRole("button", { name: "Kit: Brand", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Kit" })).toBeVisible();
});

test("each token button has its field's name, and Escape or a choice hands focus back to it or to the chip that replaces it", async ({ page, agent }) => {
  await seedKit(page, agent, BRAND);
  await onBoard(page, agent, PAGE);
  await openEditor(page);
  await selectByText(page, "Welcome");
  await preparedFile(agent);

  const button = tokenButton(page, "Fill");
  await expect(button).toHaveAccessibleName(/^Use a token for /);
  await button.click();
  await expect(page.getByRole("button", { name: /color\/brand\/primary/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(button).toBeFocused();

  await button.click();
  await page.getByRole("button", { name: /color\/brand\/primary/ }).click();
  await expect(parameters(page).getByRole("group", { name: "Fill", exact: true }).locator('[title="color/brand/primary"]')).toBeFocused();
});
