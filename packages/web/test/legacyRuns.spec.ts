import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { splitJsonArray } from "@unframed/domain";
import { plainText, roomRecords, shapeOnScreen, waitForRoom, type AnyRecord } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { clickShape, composer, selectGroup, toolbar } from "./generation.ts";
import { canvasOf, openImported, reportDialog, startLegacyApp, type LegacyApp } from "./legacy.ts";
import { libraryDialog, openLibrary, presetItem } from "./library.ts";

const byRef = (records: AnyRecord[], ref: string) => records.find((record) => record.typeName === "shape" && (record.type === "frame" ? record.props?.name === ref : record.meta?.ref === ref))!;

/** Opens `everything` after its import and dismisses the report. */
const openEverything = async (page: Page, app: LegacyApp) => {
  await openImported(page, app.engine);
  await reportDialog(page).getByRole("button", { name: "Got it" }).click();
  await expect(reportDialog(page)).toHaveCount(0);
  return roomRecords(app.engine, "everything");
};

/** Zooms onto a shape by selecting it and pressing tldraw's zoom to selection. */
const zoomOnto = async (page: Page, id: string) => {
  await clickShape(page, id);
  await expect(page.locator(".tl-container.tl-container__focused")).toHaveCount(1);
  await page.keyboard.press("Shift+2");
  await page.waitForTimeout(600);
};

test("Recipe on an imported result shows what the old app sent, and Regenerate runs from its sources as they are now", async ({ page }) => {
  const app = await startLegacyApp();
  try {
    const records = await openEverything(page, app);
    const result = byRef(records, "141");
    expect(result.meta.unframed.result.recipe).toMatchObject({ approximate: true });
    await zoomOnto(page, result.id);
    await expect(toolbar(page).getByRole("button", { name: "Regenerate" })).toBeVisible();

    await toolbar(page).getByRole("button", { name: "Recipe" }).click();
    await expect(composer(page)).toBeVisible();
    const sent = composer(page).getByTestId("recipe-sent");
    await expect(sent).toContainText("Imported from the old app. It sent:");
    await expect(sent).toContainText("A red fox standing on a windswept cliff at golden hour, 35mm");
    await expect(composer(page).getByTestId("source-count")).toHaveText("recipe · 2 sources");
    await page.keyboard.press("Escape");
    await expect(composer(page)).toHaveCount(0);

    await clickShape(page, result.id);
    await toolbar(page).getByRole("button", { name: "Regenerate" }).click();
    await expect.poll(() => app.requests.length).toBe(1);
    const [request] = app.requests;
    // Prompt @100 now reads through @101, which the journal changed to "lone red fox".
    expect(request!.body).toMatchObject({
      model: "openai/gpt-image-2",
      prompt: "A lone red fox standing on a windswept cliff at golden hour, 35mm",
      resolution: "1K",
      quality: "low",
      aspect_ratio: "3:2",
      output_format: "png",
    });
    expect(request!.body.input_references).toHaveLength(1);
    const landed = await waitForRoom(app.engine, "everything", (all) => all.find((record) => record.typeName === "shape" && record.meta?.unframed?.result?.sidecar && !records.some((old) => old.id === record.id)));
    expect(landed.meta.unframed.result).toMatchObject({ medium: "image", model: "openai/gpt-image-2" });
    expect(landed.meta.unframed.result.recipe).toBeUndefined();
  } finally {
    await app.dispose();
  }
});

test("a recipe group made from an old image output runs from the toolbar with the old model and params", async ({ page }) => {
  const app = await startLegacyApp();
  try {
    const records = await openEverything(page, app);
    const group = byRef(records, "140");
    const member = byRef(records, "100");
    expect(member.parentId).toBe(group.id);
    await zoomOnto(page, member.id);
    await selectGroup(page, group.id);
    await expect(toolbar(page).getByRole("button", { name: "Generate 3×" })).toBeVisible();
    await toolbar(page).getByRole("button", { name: "Generate 3×" }).click();
    await expect.poll(() => app.requests.length).toBe(3);
    for (const request of app.requests) {
      expect(request.body).toMatchObject({
        model: "openai/gpt-image-2",
        prompt: "A lone red fox standing on a windswept cliff at golden hour, 35mm",
        resolution: "1K",
        quality: "low",
        aspect_ratio: "3:2",
      });
      expect(request.body.input_references).toHaveLength(1);
    }
  } finally {
    await app.dispose();
  }
});

test("the Library shows old presets from the old app with their notes, inserts them, and deletes one by removing its old entry", async ({ page }) => {
  const app = await startLegacyApp();
  try {
    await openEverything(page, app);
    await openLibrary(page);
    await expect(presetItem(page, "Split into parts").getByTestId("preset-legacy")).toHaveText(
      "From the old app. Not kept: Its old results were not kept. The text step @planner lost its model. Run it with the composer.",
    );
    await expect(presetItem(page, "Hiker character").getByTestId("preset-legacy")).toHaveText("From the old app.");
    await expect(presetItem(page, "Fox on the cliff").getByTestId("preset-legacy")).toHaveCount(0);

    // Add: the group keeps its name, suffixed because the canvas has @character already, and its picture is copied in from this project.
    const before = new Set((await roomRecords(app.engine, "everything")).map((record) => record.id));
    await presetItem(page, "Hiker character").getByRole("button", { name: "Add" }).click();
    await expect(libraryDialog(page)).toHaveCount(0);
    const inserted = await waitForRoom(app.engine, "everything", (all) => {
      const added = all.filter((record) => !before.has(record.id));
      return added.filter((record) => record.typeName === "shape").length === 3 ? added : undefined;
    });
    const frame = inserted.find((record) => record.type === "frame")!;
    expect(frame.props.name).toBe("character-2");
    const prompt = inserted.find((record) => record.typeName === "shape" && record.type === "text")!;
    expect(plainText(prompt)).toBe("A hiker in a yellow jacket and brown boots, seen from slightly below");
    const image = inserted.find((record) => record.typeName === "shape" && record.type === "image")!;
    const asset = inserted.find((record) => record.id === image.props.assetId)!;
    expect(asset.props.src).toMatch(/^project-file:\d+-hiker\.png$/);
    await expect(shapeOnScreen(page, image.id).locator("img")).toBeVisible();

    // An inline picture is written into the project before it reaches the canvas.
    const next = new Set((await roomRecords(app.engine, "everything")).map((record) => record.id));
    await openLibrary(page);
    await presetItem(page, "Fox walk clip").getByRole("button", { name: "Add" }).click();
    const clip = await waitForRoom(app.engine, "everything", (all) => {
      const added = all.filter((record) => !next.has(record.id));
      return added.some((record) => record.type === "frame") && added.filter((record) => record.typeName === "asset").length === 2 ? added : undefined;
    });
    const sources = clip.filter((record) => record.typeName === "asset").map((record) => String(record.props.src));
    expect(sources.some((src) => /^project-file:\d+-upload\.png$/.test(src))).toBe(true);
    expect(sources).toContain("https://media.example.com/clips/fox-trot.mp4");
    expect(clip.find((record) => record.type === "frame")!.meta.unframed.recipe).toMatchObject({ medium: "video", model: "bytedance/seedance-2.0" });

    // Delete removes the old entry and nothing else.
    const presetsPath = join(app.outputDir, "presets.json");
    const raw = splitJsonArray(await readFile(presetsPath, "utf8"))!;
    await openLibrary(page);
    await presetItem(page, "Detail list").getByRole("button", { name: "Delete Detail list" }).click();
    await page.getByRole("button", { name: "Delete preset" }).click();
    await expect(presetItem(page, "Detail list")).toHaveCount(0);
    const after = splitJsonArray(await readFile(presetsPath, "utf8"))!;
    expect(after).toEqual(raw.filter((entry) => !entry.includes('"id": "user-mf1b5y2e"')));
    await expect(canvasOf(page, "everything")).toBeVisible();
  } finally {
    await app.dispose();
  }
});
