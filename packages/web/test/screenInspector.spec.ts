import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { clickShape } from "./generation.ts";
import { prepareReactApp } from "../../engine/test/reactFixture.ts";
import { putShapes, screenShapes, withRepository } from "./screenHarness.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";

const editor = (page: Page) => page.getByTestId("artifact-editor");
const panels = (page: Page) => editor(page).locator('[data-editor-column="parameters"]');
const app = (page: Page) => page.frameLocator('[data-screen-of][style*="visibility: visible"] iframe[data-screen-frame]');
const label = (page: Page) => page.locator('[data-edit-outline="selected"] [data-edit-label]');
const drafts = (page: Page) => editor(page).getByTestId("screen-drafts");
const field = (page: Page, name: string | RegExp) => panels(page).getByRole("spinbutton", { name });

const openReact = async (page: Page, engine: TestEngine, project: string) => {
  const [first] = await screenShapes(engine, project);
  await putShapes(engine, project, [{ ...first, props: { ...first.props, route: "/react" } }]);
  await clickShape(page, first.id);
  await page.getByRole("button", { name: "Editor", exact: true }).click();
  await expect(app(page).getByRole("heading", { name: "Agent" })).toBeVisible({ timeout: 30_000 });
};

const pick = async (page: Page, target: ReturnType<ReturnType<typeof app>["locator"]>, init: Record<string, unknown>, expected: RegExp) => {
  await expect(async () => {
    await target.dispatchEvent("click", init);
    await expect(label(page)).toHaveText(expected, { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
};

const pickHeader = (page: Page) => pick(page, app(page).getByRole("heading", { name: "Agent" }), { detail: 1 }, /^Header · in Header /);

const scrub = async (page: Page, name: string, dx: number) => {
  const handle = panels(page).locator(`[data-scrub="${name}"]`);
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let step = 1; step <= 6; step++) await page.mouse.move(box.x + box.width / 2 + (dx * step) / 6, box.y + box.height / 2);
  await page.mouse.up();
};

test("a field bound to a class shows its step, steps with the arrows, scrubs from its icon, and its dot discards the change", async ({ page }) => {
  await withRepository(
    page,
    {},
    async (engine, project) => {
      await openReact(page, engine, project);
      await pickHeader(page);
      await expect(field(page, "Height: h-12 (48)")).toHaveValue("12");
      await expect(field(page, "Horizontal padding: pl-3.5 (14) · pr-2 (8)")).toHaveValue("3.5, 2");
      await panels(page).getByRole("button", { name: "Individual padding" }).click();
      const left = field(page, /^Padding left/);
      await expect(left).toHaveAccessibleName("Padding left: pl-3.5 (14)");
      await expect(left).toHaveValue("3.5");
      await expect(panels(page).getByRole("button", { name: /^Changed from/ })).toHaveCount(0);

      await left.press("ArrowUp");
      await expect(app(page).locator("header")).toHaveCSS("padding-left", "15px");
      await expect(left).toHaveValue("15");
      await expect(left).toHaveAccessibleName("Padding left");
      await left.press("Shift+ArrowUp");
      await expect(app(page).locator("header")).toHaveCSS("padding-left", "25px");
      await expect(drafts(page)).toHaveText("1 change");

      await left.fill("1");
      await expect(app(page).locator("header")).toHaveCSS("padding-left", "25px");
      await left.press("Enter");
      await expect(app(page).locator("header")).toHaveCSS("padding-left", "1px");

      await scrub(page, "Padding left", 30);
      await expect(app(page).locator("header")).toHaveCSS("padding-left", "16px");
      await expect(left).toHaveValue("4");
      await expect(left).toHaveAccessibleName("Padding left: pl-4 (16)");

      const dot = panels(page).getByRole("button", { name: "Changed from 14 · click the dot to discard" });
      await expect(dot).toBeVisible();
      await dot.click();
      await expect(app(page).locator("header")).toHaveCSS("padding-left", "14px");
      await expect(left).toHaveValue("3.5");
      await expect(drafts(page)).toHaveCount(0);
    },
    prepareReactApp,
  );
});

const pickHeading = (page: Page) => pick(page, app(page).getByRole("heading", { name: "Agent" }), { detail: 2 }, /^Heading · in Header /);
const heading = (page: Page) => app(page).getByRole("heading", { name: "Agent" });

test("Typography shows the text style, picks a size preset, a weight, a font, scrubs line height and letter spacing, aligns, and sets decoration in Type settings", async ({ page }) => {
  await withRepository(
    page,
    {},
    async (engine, project) => {
      await openReact(page, engine, project);
      await pickHeader(page);
      await pickHeading(page);
      const typography = panels(page).getByRole("region", { name: "Typography" });
      await expect(typography.getByRole("button", { name: "Text style: text-sm · 14/20" })).toBeVisible();
      await expect(field(page, "Font size: text-sm (14)")).toHaveValue("sm");

      await typography.getByRole("button", { name: "Font size presets" }).click();
      await page.getByRole("menuitem", { name: /^text-lg 18/ }).click();
      await expect(heading(page)).toHaveCSS("font-size", "18px");
      await expect(field(page, "Font size: text-lg (18)")).toHaveValue("lg");

      await typography.getByRole("combobox", { name: "Font weight" }).click();
      await expect(page.getByRole("group", { name: "Italic" })).toBeVisible();
      await page.getByRole("option", { name: /^Bold font-bold/ }).click();
      await expect(heading(page)).toHaveCSS("font-weight", "700");
      await expect(typography.getByRole("combobox", { name: "Font weight" })).toHaveText(/Bold/);

      await typography.getByRole("button", { name: /^Font: / }).click();
      const fonts = page.getByRole("dialog", { name: "Fonts" });
      await expect(fonts.getByRole("group", { name: "System" })).toBeVisible();
      await fonts.getByRole("textbox", { name: "Search fonts" }).fill("geor");
      await fonts.getByRole("option", { name: /^Georgia/ }).click();
      await expect(heading(page)).toHaveCSS("font-family", /Georgia/);

      await scrub(page, "Line height", 30);
      await expect(heading(page)).toHaveCSS("line-height", "35px");
      await scrub(page, "Letter spacing", 20);
      await expect(heading(page)).toHaveCSS("letter-spacing", "1.8px");
      await expect(field(page, "Letter spacing")).toHaveValue("10%");

      await typography.getByRole("button", { name: "Align center" }).click();
      await expect(heading(page)).toHaveCSS("text-align", "center");

      await typography.getByRole("button", { name: "Type settings" }).click();
      const settings = page.getByRole("dialog", { name: "Type settings" });
      await settings.getByRole("button", { name: "Underline" }).click();
      await expect(heading(page)).toHaveCSS("text-decoration-line", "underline");
      await settings.getByRole("tab", { name: "Details" }).click();
      await settings.getByRole("button", { name: "Tabular" }).click();
      await expect(heading(page)).toHaveCSS("font-variant-numeric", "tabular-nums");
    },
    prepareReactApp,
  );
});

test("a component instance shows its props: a dropdown per cva variant with every option, a switch for a boolean, and read-only text, and a pick joins the drafts", async ({ page }) => {
  await withRepository(
    page,
    {},
    async (engine, project) => {
      await openReact(page, engine, project);
      await pick(page, app(page).getByRole("button", { name: "Save" }), { detail: 1 }, /^Button · in Button /);
      await expect(panels(page).getByTestId("screen-source-component")).toContainText("Button");
      const props = panels(page).getByRole("region", { name: "Instance" });
      const variant = props.getByRole("combobox", { name: "variant" });
      await expect(variant).toHaveText(/ghost/);
      await variant.click();
      await expect(page.getByRole("option")).toHaveText(["ghost", "outline", "destructive"]);
      await page.getByRole("option", { name: "outline" }).click();
      await expect(variant).toHaveText(/outline/);
      await expect(props.getByRole("combobox", { name: "size" })).toHaveText(/sm/);
      await expect(props.getByRole("switch", { name: "pressed" })).not.toBeChecked();
      await expect(drafts(page)).toHaveText("1 change");
      await panels(page).getByRole("button", { name: "Changed from ghost · click the dot to discard" }).click();
      await expect(variant).toHaveText(/ghost/);
      await expect(drafts(page)).toHaveCount(0);

      await pick(page, app(page).getByRole("heading", { name: "Third" }), { detail: 1 }, /^List item · in Card /);
      await expect(panels(page).getByRole("region", { name: "Instance" }).locator('[data-prop="title"]')).toContainText('"Third"');
    },
    prepareReactApp,
  );
});
