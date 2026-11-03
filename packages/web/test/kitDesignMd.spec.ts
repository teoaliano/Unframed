import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { centre, openCanvas, roomRecords, toast } from "./canvas.ts";
import { openLibrary, presetItem, shownNames } from "./library.ts";
import { dropFiles, putRecords } from "./media.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";

/** Spec 19: a DESIGN.md imports into the kit, the Kit dialog shows and edits the guidance, and ten kits ship in the library. */

type KitRecord = { name: string; modes: string[]; tokens: Array<{ path: string; type: string; value?: unknown; values?: Record<string, unknown> }>; guidance?: string; from?: { presetId: string } };

const kitDialog = (page: Page): Locator => page.getByRole("dialog", { name: "Kit" });

const kitOf = async (engine: TestEngine, project: string): Promise<KitRecord | undefined> => {
  const document = (await roomRecords(engine, project)).find((record) => record.typeName === "document") as { meta?: { unframed?: { kit?: KitRecord } } } | undefined;
  return document?.meta?.unframed?.kit;
};

const seedKit = (engine: TestEngine, kit: unknown) => putRecords(engine, [{ id: "document:document", typeName: "document", gridSize: 10, name: "", meta: { unframed: { kit } } }]);

const DESIGN_MD = [
  "---",
  "name: Acme-design-analysis",
  "description: A calm brand.",
  "colors:",
  '  primary: "#533afd"',
  '  canvas: "#ffffff"',
  "typography:",
  "  heading:",
  "    fontFamily: Inter",
  "    fontSize: 32px",
  "    fontWeight: 600",
  "    lineHeight: 1.1",
  "    letterSpacing: -0.5px",
  "rounded:",
  "  pill: 9999px",
  "components:",
  "  button:",
  '    backgroundColor: "{colors.primary}"',
  "---",
  "",
  "## Voice",
  "",
  "Fill one button per screen with `{colors.primary}`.",
  "",
].join("\n");

test("Import takes a DESIGN.md: the summary names what it skips, then Import writes tokens and guidance as one undo step", async ({ page, engine }) => {
  const project = await openCanvas(page, engine);
  await page.getByRole("button", { name: "Kit", exact: true }).click();
  await kitDialog(page).getByRole("button", { name: "Import" }).click();
  const importing = page.getByRole("dialog", { name: "Import" });
  await dropFiles(page, await centre(importing.getByTestId("import-drop")), [{ name: "DESIGN.md", mime: "text/markdown", bytes: Buffer.from(DESIGN_MD) }]);

  await expect(importing).toContainText("Adds 4 tokens, changes 0, adds the default mode. Sets the guidance. Skips 1 it could not read: components.button.");
  expect(await kitOf(engine, project)).toBeUndefined();
  await importing.getByRole("button", { name: "Import" }).click();

  await expect.poll(() => kitOf(engine, project)).toMatchObject({
    name: "Acme",
    modes: ["default"],
    tokens: [
      { path: "color/primary", type: "color", value: "#533afd" },
      { path: "color/canvas", type: "color", value: "#ffffff" },
      { path: "text/heading", type: "textStyle" },
      { path: "radius/pill", type: "dimension", value: "9999px" },
    ],
    guidance: "A calm brand.\n\n## Voice\n\nFill one button per screen with `var(--color-primary)`.",
  });
  const guidance = kitDialog(page).getByTestId("kit-guidance");
  await expect(guidance.getByRole("heading", { name: "Voice" })).toBeVisible();
  await expect(guidance).toContainText("Fill one button per screen with var(--color-primary).");

  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => kitOf(engine, project)).toBeUndefined();
});

test("a DESIGN.md imported into a kit with modes writes to its default mode and adds no mode", async ({ page, engine }) => {
  const project = await openCanvas(page, engine);
  await seedKit(engine, { format: 1, name: "Brand", modes: ["light", "dark"], tokens: [{ path: "color/primary", type: "color", values: { light: "#000000", dark: "#ffffff" } }] });
  await page.getByRole("button", { name: "Kit", exact: true }).click();
  await kitDialog(page).getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Import…" }).click();
  const importing = page.getByRole("dialog", { name: "Import" });
  await importing.getByRole("textbox", { name: "Paste" }).fill(DESIGN_MD);
  await expect(importing).toContainText("Adds 3 tokens, changes 1, Sets the guidance. Skips 1 it could not read: components.button.");
  await importing.getByRole("button", { name: "Import" }).click();

  await expect.poll(() => kitOf(engine, project)).toMatchObject({ name: "Brand", modes: ["light", "dark"], guidance: expect.stringContaining("## Voice") });
  expect((await kitOf(engine, project))!.tokens.find((token) => token.path === "color/primary")).toEqual({ path: "color/primary", type: "color", values: { light: "#533afd", dark: "#ffffff" } });
});

test("the Guidance section edits the guidance as text, saves it as one undo step, and Cancel keeps it", async ({ page, engine }) => {
  const project = await openCanvas(page, engine);
  await seedKit(engine, { format: 1, name: "Brand", modes: ["default"], tokens: [] });
  await page.getByRole("button", { name: "Kit", exact: true }).click();
  const guidance = kitDialog(page).getByTestId("kit-guidance");
  await expect(guidance).toContainText("No guidance yet.");

  await guidance.getByRole("button", { name: "Add guidance" }).click();
  const field = guidance.getByRole("textbox", { name: "Guidance markdown" });
  await field.fill("## Layout\n\n- One idea per screen.");
  await guidance.getByRole("button", { name: "Save" }).click();
  await expect(guidance.getByRole("heading", { name: "Layout" })).toBeVisible();
  await expect(guidance.getByRole("listitem")).toHaveText("One idea per screen.");
  await expect.poll(() => kitOf(engine, project)).toMatchObject({ guidance: "## Layout\n\n- One idea per screen." });

  await guidance.getByRole("button", { name: "Edit" }).click();
  await expect(field).toHaveValue("## Layout\n\n- One idea per screen.");
  await field.fill("Something else");
  await guidance.getByRole("button", { name: "Cancel" }).click();
  await expect(guidance.getByRole("heading", { name: "Layout" })).toBeVisible();
  await expect.poll(() => kitOf(engine, project)).toMatchObject({ guidance: "## Layout\n\n- One idea per screen." });

  await page.keyboard.press("Escape");
  await expect(kitDialog(page)).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await kitOf(engine, project))?.guidance).toBeUndefined();
  expect(await kitOf(engine, project)).toMatchObject({ name: "Brand" });
});

test("ten kits ship in the library: the Kits filter lists them as System, and Apply copies one in with its guidance", async ({ page, engine }) => {
  const project = await openCanvas(page, engine);
  const dialog = await openLibrary(page);
  await dialog.getByRole("button", { name: "Kits", exact: true }).click();
  await dialog.getByRole("button", { name: "System", exact: true }).click();
  expect(await shownNames(page)).toEqual(["Apple", "Claude", "Vercel", "Notion", "Airbnb", "Linear", "Stripe", "Figma", "BMW M", "Coinbase"]);

  const stripe = presetItem(page, "Stripe");
  await expect(stripe).toContainText("Deep navy ink, electric indigo and an atmospheric gradient mesh.");
  await expect(stripe.getByTestId("preset-chips").locator("[data-chip]")).toHaveText(["Kit", "System"]);
  await expect(stripe.getByRole("button", { name: /^Delete/ })).toHaveCount(0);
  await stripe.getByRole("button", { name: "Apply", exact: true }).click();

  await expect(toast(page, "Applied “Stripe” to this project.")).toBeVisible();
  await expect.poll(() => kitOf(engine, project)).toMatchObject({ name: "Stripe", modes: ["default"], from: { presetId: "kit-stripe" } });
  const kit = (await kitOf(engine, project))!;
  expect(kit.tokens).toContainEqual({ path: "color/primary", type: "color", value: "#533afd" });
  expect(kit.guidance).toContain("var(--color-primary)");

  await page.getByRole("button", { name: "Kit", exact: true }).click();
  await expect(kitDialog(page)).toContainText("From “Stripe” in your library.");
  await kitDialog(page).getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("menuitem", { name: "Update in library" })).toHaveCount(0);
});
