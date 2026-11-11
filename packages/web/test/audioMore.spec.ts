import type { Page } from "@playwright/test";
import { gate } from "../../engine/test/openRouterStub.ts";
import { outsideLink } from "../../engine/test/outsideCalls.ts";
import type { AgentEngine } from "../../engine/test/agent.ts";
import { openCanvas, roomRecords, shapeOnScreen } from "./canvas.ts";
import { audioShapes, chooseAudio, expect, filledAudio, pickVoice, startAudio, test, tray } from "./audio.ts";
import { clickShape, composer, openComposer, toolbar } from "./generation.ts";
import { pngBytes } from "./images.ts";
import { libraryDialog, openLibrary, presetItem, userPreset, writePresets } from "./library.ts";
import { filledMedia, promptRecord, putRecords } from "./media.ts";

const status = (page: Page) => composer(page).getByTestId("composer-status");
const chip = (page: Page, key: string) => tray(page).locator(`[data-prop="${key}"]`);
const label = (page: Page, id: string) => shapeOnScreen(page, id).locator("[data-shape-label]").first();

test("without an ElevenLabs key the audio medium says so, and with nothing to speak it says that", async ({ page }) => {
  const audio = await startAudio({ elevenLabs: false });
  try {
    await openCanvas(page, audio.engine);
    await clickShape(page, "shape:starter-subject");
    await openComposer(page);
    await chooseAudio(page);
    await expect(status(page)).toContainText("No ElevenLabs key yet. Add one in Settings, under ElevenLabs.");
    await expect(composer(page).getByRole("button", { name: /^Generate/ })).toBeDisabled();
  } finally {
    await audio.engine.dispose();
  }
});

test("an image alone gives the audio medium nothing to say", async ({ page, audio }) => {
  await openCanvas(page, audio.engine);
  await filledMedia(audio.engine, { id: "shape:photo", type: "image", ref: "300", at: { x: -260, y: 60 }, bytes: pngBytes(20, 20), name: "photo.png", mime: "image/png", natural: { w: 20, h: 20 }, width: 140 });
  await clickShape(page, "shape:photo");
  await openComposer(page);
  await chooseAudio(page);
  await pickVoice(page, "Olivia");
  await expect(status(page)).toContainText("Nothing to say. Select a prompt, or type an instruction.");
  await expect(status(page)).toContainText("An image is selected, but audio models only read text. It will not be sent.");
});

test("the placeholder shows Generating… until the line lands", async ({ page, audio }) => {
  const held = gate<void>();
  audio.script.speech = async () => {
    await held.promise;
    return { kind: "audio" };
  };
  await openCanvas(page, audio.engine);
  await clickShape(page, "shape:starter-subject");
  await openComposer(page);
  await chooseAudio(page);
  await pickVoice(page, "Olivia");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByTestId("audio-placeholder")).toHaveText(/Generating…/);
  await expect(page.getByTestId("audio-empty")).toHaveCount(0);
  held.release();
  await expect(page.getByTestId("audio-card")).toBeVisible();
  await expect(page.getByTestId("audio-placeholder")).toHaveCount(0);
});

test("a model change removes Speed on v4, unsets a language the model does not list, and keeps format and seed", async ({ page, audio }) => {
  await openCanvas(page, audio.engine);
  await clickShape(page, "shape:starter-subject");
  await openComposer(page);
  await chooseAudio(page);
  await pickVoice(page, "Olivia");
  await chip(page, "advanced").click();
  const advanced = page.getByRole("dialog", { name: "Advanced" });
  await advanced.getByRole("textbox", { name: "Seed" }).fill("7");
  await advanced.getByRole("textbox", { name: "Seed" }).press("Tab");
  await advanced.getByRole("combobox", { name: "Format" }).click();
  await page.getByRole("option", { name: "wav_44100" }).click();
  await advanced.getByRole("combobox", { name: "Language" }).click();
  await page.getByRole("option", { name: "Italian (it)" }).click();
  await expect(chip(page, "advanced")).toHaveText("Advanced · 3");
  await page.keyboard.press("Escape");

  await tray(page).getByTestId("model-chip").click();
  await page.getByRole("dialog").locator('[data-model="eleven_multilingual_v2"]').getByRole("button").click();
  await expect(chip(page, "speed")).toHaveText("Speed 1.00×");
  await expect(chip(page, "advanced")).toHaveText("Advanced · 2");

  await tray(page).getByTestId("model-chip").click();
  await page.getByRole("dialog").locator('[data-model="eleven_v4"]').getByRole("button").click();
  await expect(chip(page, "speed")).toHaveCount(0);
  await expect(chip(page, "style")).toHaveCount(0);
  await expect(chip(page, "advanced")).toHaveText("Advanced · 2");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect.poll(() => audio.speech.length).toBe(1);
  expect(audio.speech[0]!.query).toEqual({ output_format: "wav_44100" });
  expect(audio.speech[0]!.body).toEqual({ text: "lone red fox", model_id: "eleven_v4", voice_settings: { stability: 0.5 }, seed: 7 });
});

test("Regenerate's second take lands beside the result; Remove on a result keeps its recipe, as on an image", async ({ page, audio }) => {
  const { engine } = audio;
  await openCanvas(page, engine);
  await clickShape(page, "shape:starter-subject");
  await openComposer(page);
  await chooseAudio(page);
  await pickVoice(page, "Olivia");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect.poll(async () => (await audioShapes(engine)).filter((shape) => shape.props.file !== "").length).toBe(1);
  const [first] = await audioShapes(engine);
  const title = (await shapeOnScreen(page, first!.id).getByTestId("audio-title").boundingBox())!;
  await page.mouse.click(title.x + title.width - 4, title.y + 4);
  await toolbar(page).getByRole("button", { name: "Regenerate" }).click();
  await expect(tray(page).getByTestId("voice-chip")).toHaveText("Olivia");
  await expect(composer(page).getByRole("button", { name: /^Generate/ })).toBeEnabled();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect.poll(async () => (await audioShapes(engine)).filter((shape) => shape.props.file !== "").length).toBe(2);
  const second = (await audioShapes(engine)).find((shape) => shape.id !== first!.id)!;
  expect(second.x! >= first!.x! + first!.props.w || second.y! >= first!.y! + first!.props.h).toBe(true);

  await page.mouse.click(10, 400);
  await page.mouse.click(title.x + title.width - 4, title.y + 4);
  await shapeOnScreen(page, first!.id).getByRole("button", { name: /^Remove / }).click();
  await expect(shapeOnScreen(page, first!.id).getByTestId("audio-empty")).toBeVisible();
  await expect.poll(async () => (await roomRecords(engine, "default")).find((record) => record.id === first!.id)?.props?.file).toBe("");
  const emptied = (await roomRecords(engine, "default")).find((record) => record.id === first!.id)!;
  expect(emptied.meta.unframed.result).toMatchObject({ medium: "audio" });
  await expect(toolbar(page).getByRole("button", { name: "Regenerate" })).toBeVisible();
});

test("an audio shape is named by double-clicking its label or by canvas_write's rename, and a prompt's @name of it stays as typed in every medium", async ({ page, audio }) => {
  const { engine } = audio;
  await openCanvas(page, engine);
  await filledAudio(engine, "shape:line", "300", { x: 420, y: 420 }, "line.wav");
  await expect(label(page, "shape:line")).toHaveText("Audio");
  const tag = (await label(page, "shape:line").boundingBox())!;
  await page.mouse.dblclick(tag.x + 8, tag.y + tag.height / 2);
  const field = page.getByRole("textbox", { name: "Audio name" });
  await expect(field).toBeFocused();
  await page.keyboard.type("narration");
  await page.keyboard.press("Enter");
  await expect(label(page, "shape:line")).toHaveText("@narration");
  await expect.poll(async () => (await roomRecords(engine, "default")).find((record) => record.id === "shape:line")?.meta?.ref).toBe("narration");

  const rpc = await engine.rpc();
  const link = await outsideLink({ engine, rpc } as unknown as AgentEngine);
  const session = await link.open();
  const renamed = await link.call(session, "canvas_write", { project: "default", ops: [{ type: "rename", id: "line", name: "voiceover" }] });
  expect(renamed).toMatchObject({ isError: false });
  await expect(label(page, "shape:line")).toHaveText("@voiceover");

  await putRecords(engine, [promptRecord("shape:script", "301", "Read @voiceover aloud", { x: -260, y: 60 })]);
  await expect(shapeOnScreen(page, "shape:script")).toBeVisible();
  for (const medium of ["image", "text", "audio"] as const) {
    await page.mouse.click(10, 400);
    await clickShape(page, "shape:script");
    await openComposer(page);
    await composer(page).getByRole("radiogroup", { name: "Medium" }).getByRole("radio", { name: medium }).click();
    if (medium === "audio") await pickVoice(page, "Olivia");
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(composer(page)).toHaveCount(0);
  }
  await expect.poll(() => audio.images.length).toBe(1);
  expect(JSON.stringify(audio.images[0]!.body)).toContain("Read @voiceover aloud");
  await expect.poll(() => audio.chat.length).toBe(1);
  expect(audio.chat[0]!.body.messages[0].content[0].text).toBe("Read @voiceover aloud");
  await expect.poll(() => audio.speech.length).toBe(1);
  expect(audio.speech[0]!.body.text).toBe("Read @voiceover aloud");
});

test("the library shows an audio recipe with the Audio chip", async ({ page, audio }) => {
  await writePresets(audio.engine, [userPreset("user-audio", "Narrator", { recipe: { medium: "audio" } })]);
  await openCanvas(page, audio.engine);
  await openLibrary(page);
  await expect(presetItem(page, "Narrator").getByTestId("preset-chips").locator("[data-chip]")).toHaveText(["Recipe", "Audio", "Custom"]);
  await expect(libraryDialog(page)).toBeVisible();
});
