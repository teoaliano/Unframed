import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Locator } from "@playwright/test";
import { openCanvas, toast } from "./canvas.ts";
import { audioShapes, chooseAudio, ELEVENLABS_KEY, expect, mediumOption, pickVoice, startAudio } from "./audio.ts";
import { test } from "./fixtures.ts";
import { clickShape, composer, instructionBox, toolbar } from "./generation.ts";
import { openSettings, settingsButton, settingsDialog } from "./settings.ts";

const block = (dialog: Locator) => dialog.locator("section[aria-label='ElevenLabs']");

test("with an OpenRouter key: paste an ElevenLabs key, a bad one's error, the usage line, revoked and hidden lines, the two-step remove, and Audio among the default models", async ({ page }) => {
  const audio = await startAudio({ elevenLabs: false });
  try {
    await openCanvas(page, audio.engine);
    let dialog = await openSettings(page);
    await expect(block(dialog).getByRole("heading", { name: "ElevenLabs" })).toBeVisible();
    await expect(block(dialog).getByTestId("elevenlabs-status")).toHaveText(
      "Make a key at elevenlabs.io (Developers, API keys) and paste it here. Audio generation is billed to that account in credits.",
    );
    await expect(block(dialog).getByRole("button", { name: "Remove key" })).toHaveCount(0);
    await expect(dialog.locator("[data-model-select='Audio']")).toHaveCount(0);

    await dialog.getByLabel("ElevenLabs API key").fill("short");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByText("That does not look like an ElevenLabs key.")).toBeVisible();

    audio.script.subscription = { status: 200, body: { tier: "creator", character_count: 12840, character_limit: 100000, next_character_count_reset_unix: 1_800_000_000 } };
    await dialog.getByLabel("ElevenLabs API key").fill(ELEVENLABS_KEY);
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(block(dialog).getByTestId("elevenlabs-status")).toContainText("12,840 of 100,000 credits used on this ElevenLabs account this period. Resets on");
    await expect(dialog.getByLabel("ElevenLabs API key")).toHaveValue("");
    expect(await readFile(join(audio.engine.dataDir, ".env"), "utf8")).toContain(`ELEVENLABS_API_KEY=${ELEVENLABS_KEY}\n`);
    await expect(dialog.locator("[data-model-select='Audio']")).toBeVisible();

    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    audio.script.subscription = { status: 401 };
    dialog = await openSettings(page);
    await expect(block(dialog).getByTestId("elevenlabs-status")).toHaveText("This key no longer works at ElevenLabs. It may have been deleted or disabled there.");
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    audio.script.subscription = { status: 403 };
    dialog = await openSettings(page);
    await expect(block(dialog).getByTestId("elevenlabs-status")).toHaveText(
      "This key cannot read the account's usage, so it is not shown here. Generating works if the key may use text to speech.",
    );

    await block(dialog).getByRole("button", { name: "Remove key" }).click();
    await expect(block(dialog).getByTestId("elevenlabs-warning")).toHaveText("This deletes the ElevenLabs key from .env. Audio generation is disabled until you add one.");
    await block(dialog).getByRole("button", { name: "Yes, remove it" }).click();
    await expect(block(dialog).getByTestId("elevenlabs-warning")).toHaveText("ElevenLabs key removed.");
    await expect(block(dialog).getByRole("button", { name: "Remove key" })).toHaveCount(0);
    expect(await readFile(join(audio.engine.dataDir, ".env"), "utf8")).not.toContain("ELEVENLABS_API_KEY");
  } finally {
    await audio.engine.dispose();
  }
});

test("with only an ElevenLabs key to come: the block sits under the OpenRouter intro, saving it alone closes with its toast, and Generation then shows Default models with Audio only", async ({ page }) => {
  const audio = await startAudio({ openRouter: false, elevenLabs: false });
  try {
    await openCanvas(page, audio.engine);
    let dialog = await openSettings(page);
    await expect(dialog.getByRole("button", { name: "Connect OpenRouter" })).toBeVisible();
    await expect(block(dialog).getByTestId("elevenlabs-only-audio")).toHaveText("Only want audio? Paste an ElevenLabs key here. Images, video and text still need OpenRouter.");
    await expect(dialog.getByRole("button", { name: "Save" })).toHaveCount(0);
    await dialog.getByLabel("ElevenLabs API key").fill(ELEVENLABS_KEY);
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(settingsDialog(page)).toHaveCount(0);
    await expect(toast(page, "ElevenLabs key saved. Audio is ready to generate.")).toBeVisible();

    await page.reload();
    await expect(page.locator(".tl-canvas")).toBeVisible();
    await settingsButton(page).hover();
    await expect(page.locator("[data-slot=tooltip-popup]")).toHaveText("Settings: ElevenLabs key …cdef, default models, output folder");
    dialog = await openSettings(page);
    await expect(dialog.getByRole("button", { name: "Connect OpenRouter" })).toBeVisible();
    await expect(block(dialog)).toBeVisible();
    await expect(dialog.locator("[data-model-select='Audio']")).toBeVisible();
    await expect(dialog.locator("[data-model-select='Image']")).toHaveCount(0);
  } finally {
    await audio.engine.dispose();
  }
});

test("with only an ElevenLabs key the composer opens on audio, an audio run lands, and image, video and text ask for OpenRouter", async ({ page }) => {
  const audio = await startAudio({ openRouter: false });
  try {
    await openCanvas(page, audio.engine);
    await clickShape(page, "shape:starter-subject");
    await toolbar(page).getByRole("button", { name: "Generate" }).click();
    await expect(mediumOption(page, "audio")).toHaveAttribute("aria-checked", "true");
    await expect(composer(page).getByTestId("model-chip")).toBeEnabled();
    for (const medium of ["image", "video", "text"] as const) {
      await mediumOption(page, medium).click();
      await expect(composer(page).getByTestId("no-key-blocker")).toBeVisible();
    }
    await chooseAudio(page);
    await pickVoice(page, "Olivia");
    await instructionBox(page).click();
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(composer(page)).toHaveCount(0);
    await expect.poll(async () => (await audioShapes(audio.engine)).filter((shape) => shape.props.file !== "").length).toBe(1);
  } finally {
    await audio.engine.dispose();
  }
});

test("when ElevenLabs refuses the models list, Settings says why under the Audio select", async ({ page }) => {
  const audio = await startAudio({ script: { modelsStatus: 401 } });
  try {
    await openCanvas(page, audio.engine);
    const dialog = await openSettings(page);
    await expect(dialog.getByTestId("audio-models-problem")).toHaveText("ElevenLabs refused the key, so only the default audio model is listed.");
  } finally {
    await audio.engine.dispose();
  }
});
