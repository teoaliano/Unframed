import type { Page } from "@playwright/test";
import { openCanvas, roomRecords, shapeOnScreen, toast } from "./canvas.ts";
import { audioShapes, chooseAudio, expect, pickVoice, startAudio, test, tray } from "./audio.ts";
import { clickShape, composer, instructionBox, openComposer, selectGroup, sendButton, toolbar } from "./generation.ts";
import { pngBytes } from "./images.ts";
import { filledMedia, groupRecord, inGroup, promptRecord, putRecords } from "./media.ts";

const status = (page: Page) => composer(page).getByTestId("composer-status");
const chip = (page: Page, key: string) => tray(page).locator(`[data-prop="${key}"]`);
const landedAudio = async (engine: Parameters<typeof audioShapes>[0], before: ReadonlySet<string>) =>
  (await audioShapes(engine)).filter((shape) => !before.has(shape.id) && shape.props.file !== "" && !shape.meta.unframed?.run);

test("the audio medium: voice chip, model chip on the default, the chips the model declares, Advanced, the hint, no price, and the status lines", async ({ page, audio }) => {
  const { engine } = audio;
  await openCanvas(page, engine);
  await filledMedia(engine, { id: "shape:photo", type: "image", ref: "300", at: { x: -260, y: 60 }, bytes: pngBytes(20, 20), name: "photo.png", mime: "image/png", natural: { w: 20, h: 20 }, width: 140 });
  await clickShape(page, "shape:starter-subject");
  await openComposer(page);
  await chooseAudio(page);

  await expect(tray(page).getByTestId("voice-chip")).toHaveText("Pick a voice");
  await expect(tray(page).getByTestId("model-chip")).toHaveText("eleven_v4");
  await expect(chip(page, "stability")).toHaveText("Stability 0.50");
  await expect(chip(page, "style")).toHaveCount(0);
  await expect(chip(page, "speed")).toHaveCount(0);
  await expect(chip(page, "advanced")).toHaveText("Advanced");
  await expect(composer(page).getByTestId("medium-hint")).toHaveText("Bracketed directions like [whispers] or [excited] shape the delivery on Eleven v3 and v4.");
  await expect(composer(page).getByTestId("estimate")).toHaveCount(0);
  await expect(status(page)).toHaveText("Pick a voice for this line.");
  await expect(sendButton(page)).toBeDisabled();

  await pickVoice(page, "Olivia");
  await expect(status(page)).toHaveCount(0);
  await expect(sendButton(page)).toBeEnabled();

  await instructionBox(page).click();
  await page.keyboard.type("and then a very long tail of words that pushes it over");
  await expect(status(page)).toContainText("characters, but eleven_v4 takes at most 60 in one request. Shorten it, or pick a model that takes more.");
  await expect(sendButton(page)).toBeDisabled();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");

  await clickShape(page, "shape:photo", ["Shift"]);
  await expect(status(page)).toHaveText("An image is selected, but audio models only read text. It will not be sent.");
  await expect(page.locator('[data-role-for="shape:photo"]')).toHaveText("—");
  await expect(sendButton(page)).toBeEnabled();

  await tray(page).getByTestId("model-chip").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Audio models" })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Browse on ElevenLabs" })).toHaveAttribute("href", "https://elevenlabs.io/docs/overview/models");
  await expect(dialog.getByRole("columnheader")).toHaveText(["Model", "Languages"]);
  await expect(dialog.locator("tbody tr td:first-child")).toHaveText(["eleven_v4", "eleven_multilingual_v2", "eleven_flash_v2_5"]);
  await expect(dialog.locator("tbody tr td:nth-child(2)")).toHaveText(["2", "1", ""]);
  await dialog.locator('[data-model="eleven_multilingual_v2"]').getByRole("button").click();
  await expect(dialog).toHaveCount(0);
  await expect(chip(page, "style")).toHaveText("Style 0.00");
  await expect(chip(page, "speed")).toHaveText("Speed 1.00×");
  await expect(tray(page).getByTestId("voice-chip")).toHaveText("Olivia");
});

test("the voice dialog lists, searches, marks the current voice, and Escape closes only it; a failed load says why", async ({ page, audio }) => {
  const { engine } = audio;
  await openCanvas(page, engine);
  await clickShape(page, "shape:starter-subject");
  await openComposer(page);
  await chooseAudio(page);
  await pickVoice(page, "Marcus");
  await tray(page).getByTestId("voice-chip").click();
  const dialog = page.getByTestId("voice-dialog");
  await expect(dialog.getByRole("heading", { name: "Voices" })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Browse voices on ElevenLabs" })).toHaveAttribute("href", "https://elevenlabs.io/app/voice-library");
  await expect(dialog.locator("tbody tr")).toHaveCount(2);
  await dialog.getByRole("button", { name: "Load more" }).click();
  await expect(dialog.locator("tbody tr")).toHaveCount(3);
  await expect(dialog.getByRole("button", { name: "Load more" })).toHaveCount(0);
  await expect(dialog.locator('[data-voice="marcus02"]').getByRole("button", { name: /^Preview/ })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Preview Olivia" }).click();
  await expect(dialog.getByRole("button", { name: "Stop Olivia" })).toBeVisible();
  await dialog.getByRole("button", { name: "Stop Olivia" }).click();
  await expect(dialog.getByRole("button", { name: "Preview Olivia" })).toBeVisible();
  await expect(dialog.locator('[data-voice="olivia01"]')).toContainText("british · female · young · narration");
  await expect(dialog.locator('[data-voice="marcus02"]')).toContainText("cloned");
  await expect(dialog.locator('[data-voice="marcus02"]').getByLabel("Current voice")).toBeVisible();
  await dialog.getByRole("textbox", { name: "Search voices" }).fill("oli");
  await expect(dialog.locator("tbody tr")).toHaveCount(1);
  await dialog.getByRole("textbox", { name: "Search voices" }).fill("nobody");
  await expect(dialog.getByText("No voice matches. Clear the search.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(composer(page)).toBeVisible();

  audio.script.voices = () => ({ status: 500, body: { detail: { message: "Voices are down" } } });
  await tray(page).getByTestId("voice-chip").click();
  await expect(page.getByTestId("voice-dialog").getByText("ElevenLabs (500): Voices are down")).toBeVisible();
});

test("delivery and Advanced popovers: values, Reset, Remove and re-add, the Advanced count, and the stub receives exactly what is set", async ({ page, audio }) => {
  const { engine } = audio;
  await openCanvas(page, engine);
  await clickShape(page, "shape:starter-subject");
  await openComposer(page);
  await chooseAudio(page);
  await pickVoice(page, "Olivia");

  await chip(page, "stability").click();
  const popup = page.getByRole("dialog", { name: "Stability" });
  const slider = popup.getByRole("slider", { name: "Stability" });
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(popup.getByTestId("stability-value")).toHaveText("0.60");
  await expect(chip(page, "stability")).toHaveText("Stability 0.60");
  await popup.getByRole("button", { name: "Reset" }).click();
  await expect(chip(page, "stability")).toHaveText("Stability 0.50");
  await popup.getByRole("button", { name: "Remove" }).click();
  await expect(chip(page, "stability")).toHaveCount(0);
  await tray(page).getByRole("button", { name: "+ add prop" }).click();
  await page.getByRole("menuitem", { name: /^Stability/ }).click();
  await expect(chip(page, "stability")).toHaveText("Stability 0.50");
  await page.keyboard.press("Escape");

  await chip(page, "advanced").click();
  const advanced = page.getByRole("dialog", { name: "Advanced" });
  await advanced.getByRole("textbox", { name: "Seed" }).fill("42");
  await advanced.getByRole("textbox", { name: "Seed" }).press("Tab");
  await expect(chip(page, "advanced")).toHaveText("Advanced · 1");
  await advanced.getByRole("combobox", { name: "Format" }).click();
  await page.getByRole("option", { name: "wav_44100" }).click();
  await expect(chip(page, "advanced")).toHaveText("Advanced · 2");
  await advanced.getByRole("switch", { name: "Speaker boost" }).click();
  await expect(chip(page, "advanced")).toHaveText("Advanced · 3");
  await advanced.getByRole("button", { name: "Reset Speaker boost" }).click();
  await expect(chip(page, "advanced")).toHaveText("Advanced · 2");
  await page.keyboard.press("Escape");
  await expect(advanced).toHaveCount(0);

  await instructionBox(page).click();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(composer(page)).toHaveCount(0);
  await expect.poll(() => audio.speech.length).toBe(1);
  expect(audio.speech[0]!.query).toEqual({ output_format: "wav_44100" });
  expect(audio.speech[0]!.body).toEqual({ text: "lone red fox", model_id: "eleven_v4", voice_settings: { stability: 0.5 }, seed: 42 });
});

test("a run lands as an audio result beside the selection with its line; its bar is Regenerate and Agent; Regenerate reopens the recipe and a second take lands", async ({ page, audio }) => {
  const { engine } = audio;
  await openCanvas(page, engine);
  await clickShape(page, "shape:starter-subject");
  await openComposer(page);
  await chooseAudio(page);
  await pickVoice(page, "Olivia");
  await instructionBox(page).click();
  await page.keyboard.type("[whispers] slowly");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(composer(page)).toHaveCount(0);
  await expect.poll(async () => (await landedAudio(engine, new Set())).length).toBe(1);
  const [result] = await landedAudio(engine, new Set());
  expect(audio.speech[0]!.body.text).toBe("lone red fox\n\n[whispers] slowly");
  const subject = (await roomRecords(engine, "default")).find((record) => record.id === "shape:starter-subject")!;
  expect(result!.x).toBeGreaterThan(subject.x!);

  const card = shapeOnScreen(page, result!.id);
  await expect(card.getByTestId("audio-title")).toHaveText("lone red fox [whispers] slowly");
  const title = (await card.getByTestId("audio-title").boundingBox())!;
  await page.mouse.click(title.x + title.width - 4, title.y + 4);
  await expect(toolbar(page).getByTestId("result-line")).toHaveText("eleven_v4 · 0:02 · 124 credits");
  await expect(toolbar(page).getByRole("button")).toHaveText([/Regenerate/, /Agent/]);
  await expect(toolbar(page).getByRole("button", { name: "Generate", exact: true })).toHaveCount(0);

  await toolbar(page).getByRole("button", { name: "Regenerate" }).click();
  await expect(composer(page)).toBeVisible();
  await expect(composer(page).getByTestId("source-count")).toHaveText("recipe · 1 source");
  await expect(tray(page).getByTestId("voice-chip")).toHaveText("Olivia");
  await expect(instructionBox(page)).toHaveText("[whispers] slowly");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(composer(page)).toHaveCount(0);
  await expect.poll(async () => (await landedAudio(engine, new Set([result!.id]))).length).toBe(1);
  expect(audio.speech[1]!.body.text).toBe("lone red fox\n\n[whispers] slowly");
});

test("a failed run reports in a toast and its placeholder goes", async ({ page, audio }) => {
  const { engine } = audio;
  audio.script.speech = () => ({ kind: "status", status: 401, body: { detail: { message: "Invalid API key" } } });
  await openCanvas(page, engine);
  await clickShape(page, "shape:starter-subject");
  await openComposer(page);
  await chooseAudio(page);
  await pickVoice(page, "Olivia");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(toast(page, "0 of 1 succeeded. ElevenLabs refused the key: Invalid API key. Check the key in Settings.")).toBeVisible();
  await expect.poll(async () => (await audioShapes(engine)).length).toBe(0);
});

test("the voice, model and props come back on the next open and after a restart", async ({ page }) => {
  const first = await startAudio();
  try {
    await openCanvas(page, first.engine);
    await clickShape(page, "shape:starter-subject");
    await openComposer(page);
    await chooseAudio(page);
    await pickVoice(page, "Marcus");
    await tray(page).getByTestId("model-chip").click();
    await page.getByRole("dialog").locator('[data-model="eleven_multilingual_v2"]').getByRole("button").click();
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(composer(page)).toHaveCount(0);
    await expect.poll(async () => (await audioShapes(first.engine)).filter((shape) => shape.props.file !== "").length).toBe(1);
    await page.mouse.click(10, 400);
    await clickShape(page, "shape:starter-subject");
    await openComposer(page);
    await chooseAudio(page);
    await expect(tray(page).getByTestId("voice-chip")).toHaveText("Marcus");
    await expect(tray(page).getByTestId("model-chip")).toHaveText("eleven_multilingual_v2");
    await expect(chip(page, "style")).toHaveText("Style 0.00");
  } finally {
    await first.engine.stop();
  }
  const second = await startAudio({ dataDir: first.engine.dataDir });
  try {
    await openCanvas(page, second.engine);
    await clickShape(page, "shape:starter-subject");
    await openComposer(page);
    await chooseAudio(page);
    await expect(tray(page).getByTestId("voice-chip")).toHaveText("Marcus");
    await expect(tray(page).getByTestId("model-chip")).toHaveText("eleven_multilingual_v2");
  } finally {
    await second.engine.dispose();
    await first.engine.dispose();
  }
});

test("a recipe group with audio: Save as recipe, its chip, and its Generate runs run.audio", async ({ page, audio }) => {
  const { engine } = audio;
  await openCanvas(page, engine);
  await putRecords(engine, [groupRecord("shape:lines", "lines", { x: 420, y: 40 }), inGroup(promptRecord("shape:lines-a", "310", "Welcome back."), "shape:lines", { x: 28, y: 56 })]);
  await expect(shapeOnScreen(page, "shape:lines-a")).toBeVisible();
  await selectGroup(page, "shape:lines");
  await openComposer(page);
  await chooseAudio(page);
  await pickVoice(page, "Olivia");
  await composer(page).getByTestId("recipe-line").getByRole("button", { name: "Save as recipe" }).click();
  await expect(shapeOnScreen(page, "shape:lines").getByTestId("recipe-chip")).toHaveText("eleven_v4 · Olivia");
  await page.keyboard.press("Escape");
  await expect(composer(page)).toHaveCount(0);
  await toolbar(page).getByRole("button", { name: "Generate", exact: true }).click();
  await expect.poll(() => audio.speech.length).toBe(1);
  expect(audio.speech[0]!.body).toMatchObject({ text: "Welcome back.", model_id: "eleven_v4" });
});
