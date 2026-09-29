import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { openCanvas, roomRecords, shapeOnScreen } from "./canvas.ts";
import { clickShape, composer, openComposer } from "./generation.ts";
import { pngBytes } from "./images.ts";
import { filledMedia, promptRecord, putRecords, testIndex } from "./media.ts";
import { addProp, badge, chips, chooseVideo, expect, pickModel, setProp, statusLines, test, tray } from "./videoGeneration.ts";

const clipPath = fileURLToPath(new URL("./media/clip.webm", import.meta.url));
const DASH = "—";
const EDITING =
  'Describe the result you want, not a change to make. An instruction like "edit this video to..." switches the model into editing mode, which OpenRouter cannot currently express and which fails with a duration error.';
const UNUSED = "One or more selected inputs will not be sent";
const NOT_ACCEPTED = "A video is selected, but this model is not known to accept video input. It will be sent and probably ignored.";
const SHARE_ON =
  "While this generates, the clip is served from this machine through a temporary public link only the model provider receives. Nothing is uploaded to storage, and the link stops working when the job ends.";
const SHARE_OFF =
  "Video generation only accepts a reference video as a public https:// link, and this one is a local file. Generating will fail unless you tick this, or use the clip in a text run instead, which does take local files.";

const image = (engine: Parameters<typeof filledMedia>[0], id: string, ref: string, at: { x: number; y: number }, shade: number) =>
  filledMedia(engine, { id, type: "image", ref, at, bytes: pngBytes(40, 30, shade), name: `${ref}.png`, mime: "image/png", natural: { w: 40, h: 30 }, width: 160 });

const clip = async (engine: Parameters<typeof filledMedia>[0], id: string, ref: string, at: { x: number; y: number }) =>
  filledMedia(engine, { id, type: "video", ref, at, bytes: await readFile(clipPath), name: "clip.webm", mime: "video/webm", natural: { w: 320, h: 180 }, width: 160 });

const linked = (id: string, ref: string, at: { x: number; y: number }) => [
  {
    id: `asset:${id.slice("shape:".length)}`,
    typeName: "asset",
    type: "video",
    props: { w: 1280, h: 720, name: "hosted.mp4", isAnimated: true, mimeType: null, src: "https://cdn.example/hosted.mp4" },
    meta: {},
  },
  {
    id,
    typeName: "shape",
    type: "video",
    x: at.x,
    y: at.y,
    rotation: 0,
    index: testIndex(),
    parentId: "page:page",
    isLocked: false,
    opacity: 1,
    props: { w: 160, h: 90, time: 0, playing: false, autoplay: false, url: "", assetId: `asset:${id.slice("shape:".length)}`, altText: "" },
    meta: { ref },
  },
];

/** Selects every shape and opens the composer on the video medium. */
const openOnAll = async (page: Page) => {
  await page.keyboard.press("ControlOrMeta+a");
  await openComposer(page);
  await chooseVideo(page);
};

test("choosing video shows the default video model and only the props it declares, Seconds always, no Runs", async ({ page, videoEngine: video }) => {
  await openCanvas(page, video.engine);
  await clickShape(page, "shape:starter-subject");
  await openComposer(page);
  await expect(composer(page).getByRole("radio")).toHaveText(["image", "video", "text"]);
  await chooseVideo(page);
  await expect(chips(page)).toHaveText(["References", "5"]);
  await tray(page).getByRole("button", { name: "+ add prop" }).click();
  const add = page.getByRole("menu", { name: "Add prop" });
  await expect(add.getByRole("menuitem")).toHaveText([/Size\s*480p/, /Ratio\s*16:9/, /Audio\s*off/]);
  await expect(add.getByRole("menuitem", { name: /Runs/ })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Seconds lists exactly the model's durations and has no Remove.
  await tray(page).locator('[aria-label="Seconds 5"]').click();
  const seconds = page.getByRole("menu", { name: "Seconds" });
  await expect(seconds.getByRole("menuitemradio")).toHaveText(["5", "10"]);
  await expect(seconds.getByRole("menuitem", { name: "Remove" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Input offers the three modes.
  await tray(page).locator('[aria-label="Input reference"]').click();
  await expect(page.getByRole("menu", { name: "Input" }).getByRole("menuitemradio")).toHaveText(["References", "First frame", "First and last frame"]);
  await page.keyboard.press("Escape");

  // Audio is a checkbox, off until ticked.
  await addProp(page, "Audio off", "Audio");
  await expect(chips(page)).toHaveText(["References", "5", "no audio"]);
  await tray(page).locator('[aria-label="Audio false"]').click();
  await page.getByRole("menu", { name: "Audio" }).getByRole("menuitemcheckbox", { name: "Audio" }).click();
  await expect(chips(page)).toHaveText(["References", "5", "audio"]);

  // A model with exact sizes offers them, labelled with their ratio, and no tier or ratio.
  await pickModel(page, "veo-3.1");
  await tray(page).getByRole("button", { name: "+ add prop" }).click();
  await expect(page.getByRole("menu", { name: "Add prop" }).getByRole("menuitem")).toHaveText([/Size\s*1280x720 · 16:9/]);
  await page.keyboard.press("Escape");

  // A model without frame support has no Input prop.
  await pickModel(page, "kling-3");
  await expect(chips(page)).toHaveText(["5"]);
  await expect(page.getByRole("dialog", { name: "Video models" })).toHaveCount(0);
});

test("changing the model resets the props in the tray", async ({ page, videoEngine: video }) => {
  await openCanvas(page, video.engine);
  await clickShape(page, "shape:starter-subject");
  await openComposer(page);
  await chooseVideo(page);
  await setProp(page, "Input", "First and last frame");
  await setProp(page, "Seconds", "10");
  await addProp(page, "Ratio 16:9", "Ratio");
  await addProp(page, "Size 480p", "Size");
  await expect(chips(page)).toHaveText(["First and last frame", "10", "480p", "16:9"]);
  await pickModel(page, "veo-3.1");
  await expect(chips(page)).toHaveText(["References", "8"]);
  await pickModel(page, "seedance-2.0");
  await expect(chips(page)).toHaveText(["References", "5"]);
});

test("role badges show on selected media while the composer is open on video, and go when it closes", async ({ page, videoEngine: video }) => {
  const { engine } = video;
  await openCanvas(page, engine);
  await image(engine, "shape:top", "300", { x: 460, y: -80 }, 10);
  await clip(engine, "shape:clip", "301", { x: 460, y: 60 });
  await image(engine, "shape:low", "302", { x: 460, y: 200 }, 90);
  await expect(shapeOnScreen(page, "shape:low")).toBeVisible();
  await openOnAll(page);
  await expect(badge(page, "shape:top")).toHaveText("image 1");
  await expect(badge(page, "shape:clip")).toHaveText("video 1");
  await expect(badge(page, "shape:low")).toHaveText("image 2");

  await setProp(page, "Input", "First frame");
  await expect(badge(page, "shape:top")).toHaveText("first");
  await expect(badge(page, "shape:clip")).toHaveText(DASH);
  await expect(badge(page, "shape:low")).toHaveText(DASH);

  await page.keyboard.press("Escape");
  await expect(page.locator(".unframed-role-badge")).toHaveCount(0);
});

test("moving one selected image above another swaps first and last live", async ({ page, videoEngine: video }) => {
  const { engine } = video;
  await openCanvas(page, engine);
  await putRecords(engine, [promptRecord("shape:say", "310", "a slow pan", { x: 700, y: -200 })]);
  await image(engine, "shape:a", "311", { x: 460, y: -60 }, 10);
  await image(engine, "shape:b", "312", { x: 460, y: 140 }, 90);
  await expect(shapeOnScreen(page, "shape:b")).toBeVisible();
  await clickShape(page, "shape:a");
  await clickShape(page, "shape:b", ["Shift"]);
  await openComposer(page);
  await chooseVideo(page);
  await setProp(page, "Input", "First and last frame");
  await expect(badge(page, "shape:a")).toHaveText("first");
  await expect(badge(page, "shape:b")).toHaveText("last");

  // A drag of a selected shape moves the whole selection, so b moves on its own the way
  // spec 03's badge test moves a shape: through the room, as another tab would.
  const current = (await roomRecords(engine, "default")).find((record) => record.id === "shape:b")!;
  await putRecords(engine, [{ ...current, y: -200 }]);
  await expect(badge(page, "shape:b")).toHaveText("first");
  await expect(badge(page, "shape:a")).toHaveText("last");
  await putRecords(engine, [{ ...current, y: 300 }]);
  await expect(badge(page, "shape:a")).toHaveText("first");
  await expect(badge(page, "shape:b")).toHaveText("last");
});

test("the tray warns about unused inputs, about phrasing with a clip, and about a model known not to take video", async ({ page, videoEngine: video }) => {
  const { engine } = video;
  await openCanvas(page, engine);
  await image(engine, "shape:one", "320", { x: 460, y: -80 }, 10);
  await image(engine, "shape:two", "321", { x: 460, y: 60 }, 90);
  await expect(shapeOnScreen(page, "shape:two")).toBeVisible();
  await openOnAll(page);
  await expect(composer(page).getByTestId("composer-status")).toHaveCount(0);
  await setProp(page, "Input", "First frame");
  await expect(statusLines(page)).toHaveText([UNUSED]);
  await setProp(page, "Input", "References");
  await expect(composer(page).getByTestId("composer-status")).toHaveCount(0);
  await page.keyboard.press("Escape");

  // A hosted clip as a reference: the phrasing warning; with a model known not to take video, that warning too.
  await putRecords(engine, linked("shape:hosted", "322", { x: 460, y: 200 }));
  await expect(shapeOnScreen(page, "shape:hosted")).toBeVisible();
  await openOnAll(page);
  await expect(statusLines(page)).toHaveText([EDITING]);
  await pickModel(page, "kling-3");
  await expect(statusLines(page)).toHaveText([EDITING, NOT_ACCEPTED]);
  await expect(composer(page).getByTestId("share-block")).toHaveCount(0);
});

test("the share block shows only for a local clip that will be sent, on by default, with its note", async ({ page, videoEngine: video }) => {
  const { engine } = video;
  await openCanvas(page, engine);
  await image(engine, "shape:still", "330", { x: 460, y: -80 }, 10);
  await clip(engine, "shape:local", "331", { x: 460, y: 60 });
  await expect(shapeOnScreen(page, "shape:local")).toBeVisible();
  await openOnAll(page);
  const block = composer(page).getByTestId("share-block");
  await expect(block).toBeVisible();
  const consent = block.getByRole("checkbox", { name: "Share via temporary link while generating" });
  await expect(consent).toBeChecked();
  await expect(block.getByText(SHARE_ON)).toHaveCount(0);
  await block.getByRole("button", { name: "What sharing does" }).click();
  await expect(block.getByText(SHARE_ON)).toBeVisible();
  await consent.uncheck();
  await expect(block.getByText(SHARE_OFF)).toBeVisible();
  await expect(block.getByText(SHARE_ON)).toHaveCount(0);

  // In a frame mode the clip is not sent, so nothing asks about sharing.
  await setProp(page, "Input", "First frame");
  await expect(block).toHaveCount(0);
  await expect(statusLines(page)).toHaveText([UNUSED]);
});

test("the estimate reads est. ~$x.xx and follows Seconds and Size", async ({ page, videoEngine: video }) => {
  await openCanvas(page, video.engine);
  await clickShape(page, "shape:starter-subject");
  await openComposer(page);
  await chooseVideo(page);
  const estimate = composer(page).getByTestId("estimate");
  await expect(estimate).toHaveText("est. ~$0.50");
  await setProp(page, "Seconds", "10");
  await expect(estimate).toHaveText("est. ~$1.00");
  await addProp(page, "Size 480p", "Size");
  await expect(estimate).toHaveText("est. ~$1.00");
  await setProp(page, "Size", "720p");
  await expect(estimate).toHaveText("est. ~$2.00");
  await pickModel(page, "veo-3.1");
  await expect(estimate).toHaveText("est. ~$3.20");
  await pickModel(page, "kling-3");
  await expect(estimate).toHaveCount(0);
});
