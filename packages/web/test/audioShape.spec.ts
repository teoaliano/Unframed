import type { Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { centre, emptyCanvasPoint, openCanvas, roomRecords, shapeOnScreen, toast } from "./canvas.ts";
import { audioBytes, audioShapes, expect, filledAudio, test } from "./audio.ts";
import { clickShape, composer, openComposer, toolbar } from "./generation.ts";
import { pngBytes } from "./images.ts";
import { dropFiles, filledMedia } from "./media.ts";
import { platformOf } from "./platform.ts";

const card = (page: Page, id: string) => shapeOnScreen(page, id);
const label = (page: Page, id: string) => card(page, id).locator("[data-shape-label]").first();

test("the add menu's Audio makes an empty audio shape; Choose file fills it with a titled card that resizes in width only", async ({ page, audio }) => {
  const { engine } = audio;
  await openCanvas(page, engine);
  await page.getByRole("button", { name: "Add" }).click();
  await page.getByRole("menuitem", { name: "Audio" }).click();
  await expect.poll(async () => (await audioShapes(engine)).length).toBe(1);
  const [empty] = await audioShapes(engine);
  expect(empty).toMatchObject({ props: { w: 240, h: 64, file: "", fileName: "" } });
  await expect(card(page, empty!.id).getByTestId("audio-empty")).toBeVisible();
  await expect(label(page, empty!.id)).toHaveText("Audio");

  const chooser = page.waitForEvent("filechooser");
  await card(page, empty!.id).getByRole("button", { name: "Choose file" }).click();
  await (await chooser).setFiles({ name: "Line one.wav", mimeType: "audio/wav", buffer: audioBytes(3) });
  await expect(card(page, empty!.id).getByTestId("audio-card")).toBeVisible();
  await expect.poll(async () => (await audioShapes(engine))[0]?.props).toMatchObject({ fileName: "Line one.wav", w: 320, h: 64, file: expect.stringMatching(/^\d+-line-one\.wav$/) });
  await expect(card(page, empty!.id).getByTestId("audio-title")).toHaveText("Line one.wav");
  await expect(card(page, empty!.id).getByTestId("audio-time")).toHaveText("0:00 / 0:03");

  const box = (await card(page, empty!.id).getByTestId("audio-card").boundingBox())!;
  await page.mouse.click(box.x + box.width - 20, box.y + 12);
  await page.mouse.move(box.x + box.width, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width + 600, box.y + box.height / 2 + 200, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await audioShapes(engine))[0]?.props).toMatchObject({ w: 640, h: 64 });
});

test("the player plays and pauses, scrubs without dragging, drags from the card, plays one line at a time, and Remove keeps the file", async ({ page, audio }) => {
  const { engine } = audio;
  await openCanvas(page, engine);
  const file = await filledAudio(engine, "shape:first", "200", { x: 400, y: 200 }, "first.wav", 3);
  await filledAudio(engine, "shape:second", "201", { x: 400, y: 340 }, "second.wav", 3);
  const first = card(page, "shape:first");
  const second = card(page, "shape:second");
  await expect(first.getByTestId("audio-time")).toHaveText("0:00 / 0:03");

  await first.getByRole("button", { name: "Play" }).click();
  await expect(first.getByRole("button", { name: "Pause" })).toBeVisible();
  await second.getByRole("button", { name: "Play" }).click();
  await expect(second.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect(first.getByRole("button", { name: "Play" })).toBeVisible();
  await second.getByRole("button", { name: "Pause" }).click();
  await expect(second.getByRole("button", { name: "Play" })).toBeVisible();

  const before = (await roomRecords(engine, "default")).find((record) => record.id === "shape:first")!;
  const slider = first.getByRole("slider", { name: "Position" });
  const box = (await slider.boundingBox())!;
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(first.getByTestId("audio-time")).not.toHaveText("0:00 / 0:03");
  const afterScrub = (await roomRecords(engine, "default")).find((record) => record.id === "shape:first")!;
  expect({ x: afterScrub.x, y: afterScrub.y }).toEqual({ x: before.x, y: before.y });

  const title = (await first.getByTestId("audio-title").boundingBox())!;
  await page.mouse.move(title.x + title.width - 10, title.y + 4);
  await page.mouse.down();
  await page.mouse.move(title.x + title.width + 90, title.y + 54, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await roomRecords(engine, "default")).find((record) => record.id === "shape:first")!.x).toBeGreaterThan(before.x! + 50);

  await first.getByRole("button", { name: "Remove first.wav" }).click();
  await expect.poll(async () => (await audioShapes(engine)).find((shape) => shape.id === "shape:first")?.props).toMatchObject({ file: "", fileName: "" });
  expect(existsSync(join(engine.dataDir, "output", "default", file))).toBe(true);
});

test("sound files dropped by type or by name become audio shapes with the multi-drop offset, and a drop onto one replaces its file", async ({ page, audio }) => {
  const { engine } = audio;
  await openCanvas(page, engine);
  const point = await emptyCanvasPoint(page);
  await dropFiles(page, point, [
    { name: "a.mp3", mime: "audio/mpeg", bytes: audioBytes(1) },
    { name: "b.WAV", mime: "", bytes: audioBytes(1) },
  ]);
  await expect.poll(async () => (await audioShapes(engine)).length).toBe(2);
  const dropped = (await audioShapes(engine)).sort((a, b) => a.x! - b.x!);
  expect(dropped.map((shape) => shape.props.fileName)).toEqual(["a.mp3", "b.WAV"]);
  expect(Math.round(dropped[1]!.x! - dropped[0]!.x!)).toBe(24);
  expect(Math.round(dropped[1]!.y! - dropped[0]!.y!)).toBe(24);

  const target = dropped[1]!;
  const bounds = (await card(page, target.id).getByTestId("audio-card").boundingBox())!;
  await dropFiles(page, { x: bounds.x + bounds.width - 8, y: bounds.y + bounds.height - 8 }, [{ name: "replacement.m4a", mime: "audio/mp4", bytes: audioBytes(1) }]);
  await expect.poll(async () => (await audioShapes(engine)).find((shape) => shape.id === target.id)?.props.fileName).toBe("replacement.m4a");
  expect((await audioShapes(engine)).length).toBe(2);

});

test("an audio shape offers Reveal and Copy path, Copy @ref and Rename; F2 and the label name it", async ({ page, audio }) => {
  const { engine } = audio;
  await openCanvas(page, engine);
  await filledAudio(engine, "shape:line", "300", { x: 420, y: 260 }, "line.wav");
  const platform = await platformOf(page);
  await expect(label(page, "shape:line")).toHaveText("Audio");

  const at = await centre(card(page, "shape:line").getByTestId("audio-title"));
  await page.mouse.move(at.x, at.y);
  await page.mouse.click(at.x, at.y, { button: "right" });
  const menu = page.getByTestId("context-menu");
  await expect(menu.getByRole("menuitem", { name: platform.reveal() })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Copy path" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Copy @300" })).toBeVisible();
  await menu.getByRole("menuitem", { name: /^Rename/ }).click();
  const field = page.getByRole("textbox", { name: "Audio name" });
  await expect(field).toBeFocused();
  await page.keyboard.type("narration");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await audioShapes(engine))[0]?.meta.ref).toBe("narration");
  await expect(label(page, "shape:line")).toHaveText("@narration");

  await clickShape(page, "shape:line");
  await page.keyboard.press("F2");
  await expect(page.getByRole("textbox", { name: "Audio name" })).toBeFocused();
  await page.keyboard.press("Escape");
});

test("audio in other media: the unused mark in every tray, nothing sent, Agent only for audio alone, and Cmd-G leaves it out", async ({ page, audio }) => {
  const { engine } = audio;
  await openCanvas(page, engine);
  await filledAudio(engine, "shape:line", "300", { x: 420, y: 420 }, "line.wav");
  await filledMedia(engine, { id: "shape:photo", type: "image", ref: "301", at: { x: 120, y: 420 }, bytes: pngBytes(20, 20), name: "photo.png", mime: "image/png", natural: { w: 20, h: 20 }, width: 140 });

  await clickShape(page, "shape:line");
  await expect(toolbar(page).getByRole("button", { name: "Generate" })).toHaveCount(0);

  await clickShape(page, "shape:starter-subject", ["Shift"]);
  await openComposer(page);
  for (const medium of ["image", "video", "text"] as const) {
    await composer(page).getByRole("radiogroup", { name: "Medium" }).getByRole("radio", { name: medium }).click();
    await expect(page.locator('[data-role-for="shape:line"]')).toHaveText("—");
  }
  await page.keyboard.press("Escape");
  await expect(composer(page)).toHaveCount(0);

  await clickShape(page, "shape:photo", ["Shift"]);
  await page.keyboard.press("ControlOrMeta+g");
  await expect.poll(async () => (await roomRecords(engine, "default")).filter((record) => record.type === "frame").length).toBe(1);
  const records = await roomRecords(engine, "default");
  expect(records.find((record) => record.id === "shape:line")!.parentId).toBe("page:page");
  expect(records.find((record) => record.id === "shape:photo")!.parentId).not.toBe("page:page");
});

test("sound the board cannot play, and sound over 25 MB, are refused with a toast and leave nothing", async ({ page, audio }) => {
  const { engine } = audio;
  await openCanvas(page, engine);
  const point = await emptyCanvasPoint(page);
  await dropFiles(page, point, [{ name: "song.ogg", mime: "audio/ogg", bytes: audioBytes(1) }]);
  await expect(toast(page, "song.ogg is not a sound file the board can play. Use MP3, WAV or M4A.")).toBeVisible();
  await dropFiles(page, point, [{ name: "take.flac", mime: "", bytes: audioBytes(1) }]);
  await expect(toast(page, "take.flac is not a sound file the board can play. Use MP3, WAV or M4A.")).toBeVisible();
  await dropFiles(page, point, [{ name: "long.wav", mime: "audio/wav", size: 26_214_401 }]);
  await expect(toast(page, "Sound file is too large. Keep it under 25MB.")).toBeVisible();
  expect(await audioShapes(engine)).toHaveLength(0);

  await page.getByRole("button", { name: "Add" }).click();
  await page.getByRole("menuitem", { name: "Audio" }).click();
  await expect.poll(async () => (await audioShapes(engine)).length).toBe(1);
  const [empty] = await audioShapes(engine);
  const chooser = page.waitForEvent("filechooser");
  await card(page, empty!.id).getByRole("button", { name: "Choose file" }).click();
  await (await chooser).setFiles({ name: "song.ogg", mimeType: "audio/ogg", buffer: audioBytes(1) });
  await expect(toast(page, "song.ogg is not a sound file the board can play. Use MP3, WAV or M4A.")).toHaveCount(2);
  expect((await audioShapes(engine))[0]!.props.file).toBe("");
});
