import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { openCanvas, plainText, roomRecords, shapeOnScreen, toast, waitForRoom, type AnyRecord } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { toolbar } from "./generation.ts";
import { pngBytes } from "./images.ts";
import { groupContent, libraryDialog, openLibrary, presetItem, userPreset, writePresets } from "./library.ts";
import { emptyMedia, groupRecord, inGroup, promptRecord, putRecords, uploadToEngine } from "./media.ts";

type Engine = Parameters<typeof roomRecords>[0];

const newShapes = (records: AnyRecord[], before: Set<string>) => records.filter((record) => record.typeName === "shape" && !before.has(record.id));
const shapeIds = async (engine: Engine) => new Set((await roomRecords(engine, "default")).map((record) => record.id));

test("Add puts the preset at the centre of the view with fresh @ids and its references following, selected, as one undo step", async ({ page, engine }) => {
  const content = groupContent("character", {
    members: [
      inGroup(promptRecord("shape:a", "120", "@121 wears a red scarf, like @character, not @100"), "shape:preset-group", { x: 28, y: 56 }),
      inGroup(promptRecord("shape:b", "121", "a fox called Rust"), "shape:preset-group", { x: 28, y: 140 }),
    ],
  });
  await writePresets(engine, [userPreset("user-a", "Character", { content })]);
  await openCanvas(page, engine);
  // The canvas already uses the preset's group name: the insert takes a suffix.
  await putRecords(engine, [groupRecord("shape:mine", "character", { x: 40, y: 400 }, { w: 200, h: 120 })]);
  await expect(shapeOnScreen(page, "shape:mine")).toBeVisible();
  const before = await shapeIds(engine);

  await openLibrary(page);
  await presetItem(page, "Character").getByRole("button", { name: "Add" }).click();
  await expect(libraryDialog(page)).toHaveCount(0);

  const records = await waitForRoom(engine, "default", (all) => (newShapes(all, before).length === 3 ? all : undefined));
  const inserted = newShapes(records, before);
  const group = inserted.find((record) => record.type === "frame")!;
  expect(group.props.name).toBe("character-2");
  const [first, second] = ["wears a red scarf", "a fox called Rust"].map((text) => inserted.find((record) => plainText(record).includes(text))!);
  expect(first!.parentId).toBe(group.id);
  expect(second!.parentId).toBe(group.id);
  expect(first!.meta.ref).not.toBe("120");
  expect(second!.meta.ref).not.toBe("121");
  // The preset's own references follow its shapes; anything else stays as typed.
  expect(plainText(first)).toBe(`@${second!.meta.ref} wears a red scarf, like @character-2, not @100`);
  // The original on the canvas keeps its name.
  expect(records.find((record) => record.id === "shape:mine")!.props.name).toBe("character");

  // Centred on the view, and selected.
  const box = (await shapeOnScreen(page, group.id).boundingBox())!;
  const canvas = (await page.locator(".tl-canvas").boundingBox())!;
  expect(box.x + box.width / 2).toBeCloseTo(canvas.x + canvas.width / 2, -1);
  expect(box.y + box.height / 2).toBeCloseTo(canvas.y + canvas.height / 2, -1);
  await expect(toolbar(page).getByTestId("selection-hint")).toHaveText("@character-2");

  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => newShapes(await roomRecords(engine, "default"), before)).toHaveLength(0);
});

test("Add copies a preset's pictures into this project, and a picture that is gone arrives empty with one toast", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const rpc = await engine.rpc();
  await rpc.call("projects.create", { name: "shoots" });
  const kept = await uploadToEngine(engine, "fox.png", pngBytes(64, 40), "image/png", "shoots");
  const image = (id: string, ref: string, assetId: string, y: number) => ({ ...inGroup(emptyMedia(id, "image", ref, { x: 0, y: 0 }), "shape:preset-group", { x: 28, y }), props: { ...emptyMedia(id, "image", ref, { x: 0, y: 0 }).props, assetId } });
  const asset = (id: string, src: string) => ({ id, typeName: "asset", type: "image", props: { w: 64, h: 40, name: "fox.png", isAnimated: false, mimeType: "image/png", src }, meta: {} });
  const content = groupContent("pictures", {
    members: [image("shape:kept", "130", "asset:kept", 56), image("shape:gone", "131", "asset:gone", 220)],
    assets: [asset("asset:kept", `preset-file:shoots/${kept}`), asset("asset:gone", "preset-file:shoots/1700000000000-deleted.png")],
  });
  await writePresets(engine, [userPreset("user-p", "Pictures", { content })]);
  const before = await shapeIds(engine);
  await openLibrary(page);
  await presetItem(page, "Pictures").getByRole("button", { name: "Add" }).click();

  await expect(toast(page, "1 file(s) in “Pictures” are no longer on disk, so their shapes arrived empty.")).toBeVisible();
  const records = await waitForRoom(engine, "default", (all) => (newShapes(all, before).length === 3 ? all : undefined));
  const images = newShapes(records, before).filter((record) => record.type === "image");
  const filled = images.find((record) => record.props.assetId !== null)!;
  const empty = images.find((record) => record.props.assetId === null);
  expect(empty).toBeDefined();
  const copiedAsset = records.find((record) => record.id === filled.props.assetId)!;
  const src: string = copiedAsset.props.src;
  expect(src).toMatch(/^project-file:\d+-fox\.png$/);
  // The copy is this project's own file, with a sidecar naming where it came from.
  const file = src.slice("project-file:".length);
  const folder = join(engine.dataDir, "output", "default");
  expect(await readFile(join(folder, file))).toEqual(await readFile(join(engine.dataDir, "output", "shoots", kept)));
  expect(JSON.parse(await readFile(join(folder, file.replace(/\.png$/, ".json")), "utf8"))).toMatchObject({ source: "copy", of: kept, ofProject: "shoots" });
  expect(JSON.stringify(records)).not.toContain("preset-file:");
  await expect(shapeOnScreen(page, filled.id).locator("img")).toBeVisible();
});

test("the system presets insert as text recipe groups with the asset text and the current default text model", async ({ page, engine }) => {
  const { textModel } = await (await engine.rpc()).call("settings.get");
  const plan = (await readFile(new URL("../../../assets/prompts/preset-layerize-plan.md", import.meta.url), "utf8")).match(/```text\n([\s\S]*?)\n```/)![1]!;
  await openCanvas(page, engine);
  const before = await shapeIds(engine);
  await openLibrary(page);
  await presetItem(page, "Layerize").getByRole("button", { name: "Add" }).click();

  const records = await waitForRoom(engine, "default", (all) => (newShapes(all, before).length === 3 ? all : undefined));
  const inserted = newShapes(records, before);
  const group = inserted.find((record) => record.type === "frame")!;
  expect(group.props).toMatchObject({ name: "layerize", w: 420 });
  expect(group.meta.unframed.recipe).toEqual({ medium: "text", model: textModel, params: {}, runs: 1 });
  const prompt = inserted.find((record) => record.type === "text")!;
  const picture = inserted.find((record) => record.type === "image")!;
  expect(plainText(prompt)).toBe(plan);
  expect(picture.props.assetId).toBeNull();
  expect(prompt.y!).toBeLessThan(picture.y!);
  await expect(shapeOnScreen(page, group.id).getByTestId("recipe-chip")).toBeVisible();

  // Every member sits inside the box, the prompt clear of the picture.
  const box = (await shapeOnScreen(page, group.id).boundingBox())!;
  const text = (await shapeOnScreen(page, prompt.id).boundingBox())!;
  const image = (await shapeOnScreen(page, picture.id).boundingBox())!;
  expect(text.y + text.height).toBeLessThanOrEqual(image.y);
  expect(image.y + image.height).toBeLessThanOrEqual(box.y + box.height);
  expect(text.x + text.width).toBeLessThanOrEqual(box.x + box.width);

  await page.keyboard.press("Escape");
  await page.mouse.click(10, 400);
  const beforeJson = await shapeIds(engine);
  await openLibrary(page);
  await presetItem(page, "Prose to JSON").getByRole("button", { name: "Add" }).click();
  const more = await waitForRoom(engine, "default", (all) => (newShapes(all, beforeJson).length === 2 ? all : undefined));
  const toJson = newShapes(more, beforeJson).find((record) => record.type === "frame")!;
  expect(toJson.props.name).toBe("to-json");
  expect(toJson.meta.unframed.recipe.model).toBe(textModel);
  const member = newShapes(more, beforeJson).find((record) => record.type === "text")!;
  const convert = (await shapeOnScreen(page, member.id).boundingBox())!;
  const frame = (await shapeOnScreen(page, toJson.id).boundingBox())!;
  expect(convert.y + convert.height).toBeLessThanOrEqual(frame.y + frame.height);
});
