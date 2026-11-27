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

test("the colour picker lists the project's colour tokens by group, searches them, and a token or a custom colour joins the drafts", async ({ page }) => {
  await withRepository(
    page,
    {},
    async (engine, project) => {
      await openReact(page, engine, project);
      await pickHeader(page);
      await pickHeading(page);
      const colour = panels(page).getByRole("region", { name: "Colour" });
      await colour.getByRole("button", { name: "Text colour", exact: true }).click();
      const picker = page.getByRole("dialog", { name: "Text colour picker" });
      const tokens = picker.getByRole("listbox", { name: "Colour tokens" });
      await expect(tokens.getByRole("group", { name: "Text" }).getByRole("option")).toHaveText([/text-default\s*27272A/]);
      await expect(tokens.getByRole("group", { name: "Surfaces" })).toBeVisible();
      await expect(tokens.getByRole("group", { name: "Button" })).toContainText("2");
      await picker.getByRole("textbox", { name: "Search name, hex or class" }).fill("0084");
      await expect(tokens.getByRole("option")).toHaveText([/color-sky-600\s*0084D1/, /action-highlight\s*0084D1/]);
      await tokens.getByRole("option", { name: "action-highlight" }).click();
      await expect(heading(page)).toHaveCSS("color", "rgb(0, 132, 209)");
      await expect(colour.getByRole("button", { name: "Text colour", exact: true })).toContainText("action-highlight");
      await expect(drafts(page)).toHaveText("1 change");

      await colour.getByRole("button", { name: "Text colour", exact: true }).click();
      await expect(picker.getByRole("group", { name: "Current" })).toContainText("→ color-sky-600");
      await picker.getByRole("tab", { name: "Custom" }).click();
      await expect(picker.getByTestId("colour-same-as")).toHaveText("Same as action-highlight");
      await picker.getByRole("textbox", { name: "Hex" }).fill("C0392B");
      await picker.getByRole("textbox", { name: "Hex" }).press("Enter");
      await expect(heading(page)).toHaveCSS("color", "rgb(192, 57, 43)");
      await page.keyboard.press("Escape");
      await field(page, "Text colour opacity").fill("50");
      await field(page, "Text colour opacity").press("Enter");
      await expect(heading(page)).toHaveCSS("color", "rgba(192, 57, 43, 0.5)");
      await colour.getByRole("button", { name: /^Changed from #000000/ }).click();
      await expect(heading(page)).toHaveCSS("color", "rgb(0, 0, 0)");

      await pick(page, app(page).locator("header"), { detail: 1 }, /^Header · in Header /);
      const fill = panels(page).getByRole("region", { name: "Fill" });
      await fill.getByRole("button", { name: "Add fill" }).click();
      await expect(app(page).locator("header")).toHaveCSS("background-color", "rgb(255, 255, 255)");
      await fill.getByRole("button", { name: "Remove fill" }).click();
      await expect(app(page).locator("header")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    },
    prepareReactApp,
  );
});

const header = (page: Page) => app(page).locator("header");

test("Size, Flexbox, Border and radius, Shadow, Appearance and Position each write their property", async ({ page }) => {
  await withRepository(
    page,
    {},
    async (engine, project) => {
      await openReact(page, engine, project);
      await pickHeader(page);
      const section = (name: string) => panels(page).getByRole("region", { name });

      await expect(field(page, "Height: h-12 (48)")).toHaveValue("12");
      await section("Size").getByRole("button", { name: "Width sizing" }).click();
      await page.getByRole("menuitem", { name: "Hug contents" }).click();
      await expect(header(page)).toHaveCSS("width", /^(?!0px)\d+(\.\d+)?px$/);
      await expect(section("Size").getByRole("button", { name: "Width sizing" })).toHaveText("Hug");
      await section("Size").getByRole("button", { name: "Width sizing" }).click();
      await page.getByRole("menuitem", { name: "Add min width…" }).click();
      await field(page, "Min width").fill("100");
      await field(page, "Min width").press("Enter");
      await expect(header(page)).toHaveCSS("min-width", "100px");

      const flexbox = section("Flexbox");
      await flexbox.getByRole("button", { name: "Column · flex-direction: column" }).click();
      await expect(header(page)).toHaveCSS("flex-direction", "column");
      await flexbox.getByRole("radio", { name: "Align bottom right" }).click();
      await expect(header(page)).toHaveCSS("justify-content", "flex-end");
      await expect(header(page)).toHaveCSS("align-items", "flex-end");
      await expect(flexbox.getByRole("radio", { name: "Align bottom right" })).toHaveAttribute("aria-checked", "true");
      await flexbox.getByRole("button", { name: "Gap between items presets" }).click();
      await page.getByRole("menuitem", { name: /^gap-2 8/ }).click();
      await expect(header(page)).toHaveCSS("row-gap", "8px");
      await expect(field(page, "Gap between items: gap-2 (8)")).toHaveValue("2");
      await flexbox.getByRole("checkbox", { name: "Clip content" }).click();
      await expect(header(page)).toHaveCSS("overflow", "hidden");

      const border = section("Border & radius");
      await border.getByRole("button", { name: "Add stroke" }).click();
      await expect(header(page)).toHaveCSS("border-top-width", "1px");
      await expect(header(page)).toHaveCSS("border-top-color", "rgb(228, 228, 231)");
      await border.getByRole("button", { name: "Border sides" }).click();
      await page.getByRole("menuitemradio", { name: "Bottom" }).click();
      await expect(header(page)).toHaveCSS("border-top-width", "0px");
      await expect(header(page)).toHaveCSS("border-bottom-width", "1px");
      await expect(field(page, "Stroke weight")).toHaveValue("1 · bottom");
      await border.getByRole("button", { name: "Corner radius" }).click();
      await field(page, "Corner radius").fill("12");
      await field(page, "Corner radius").press("Enter");
      await expect(header(page)).toHaveCSS("border-top-left-radius", "12px");

      const shadow = section("Shadow");
      await shadow.getByRole("button", { name: "Add effect" }).click();
      await page.getByRole("menuitem", { name: "Drop shadow" }).click();
      await expect(header(page)).toHaveCSS("box-shadow", "rgba(0, 0, 0, 0.25) 0px 4px 4px 0px");
      await field(page, "Shadow blur").fill("10");
      await field(page, "Shadow blur").press("Enter");
      await expect(header(page)).toHaveCSS("box-shadow", "rgba(0, 0, 0, 0.25) 0px 4px 10px 0px");
      await shadow.getByRole("button", { name: "Add effect" }).click();
      await page.getByRole("menuitem", { name: "Layer blur" }).click();
      await expect(header(page)).toHaveCSS("filter", "blur(4px)");

      await section("Appearance").getByRole("combobox", { name: "Blend mode" }).click();
      await page.getByRole("option", { name: "Multiply" }).click();
      await expect(header(page)).toHaveCSS("mix-blend-mode", "multiply");

      await field(page, "Rotation").fill("5");
      await field(page, "Rotation").press("Enter");
      await expect(header(page)).toHaveCSS("rotate", "5deg");
      await section("Position").getByRole("button", { name: "position: absolute · where it is" }).click();
      await expect(header(page)).toHaveCSS("position", "absolute");

      await pick(page, app(page).getByRole("heading", { name: "Second" }), { detail: 1 }, /^List item · in Card /);
      await expect(field(page, "Corner radius: rounded-lg (8)")).toHaveValue("lg");
      await expect(panels(page).getByRole("region", { name: "Layout" })).toContainText("display: list-item");
      await panels(page).getByRole("region", { name: "Layout" }).getByRole("button", { name: "Use flexbox" }).click();
      await expect(app(page).locator("li").nth(1)).toHaveCSS("display", "flex");

      await pick(page, app(page).getByRole("heading", { name: "Agent" }), { metaKey: true }, /^Heading · in Header /);
      await panels(page).getByRole("region", { name: "Size" }).getByRole("button", { name: "Auto width" }).click();
      await expect(app(page).getByRole("heading", { name: "Agent" })).toHaveCSS("white-space", "nowrap");
    },
    prepareReactApp,
  );
});
