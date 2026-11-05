import type { Locator, Page } from "@playwright/test";
import { audioBytes, ELEVENLABS_KEY, elevenLabsRoutes, elevenModel, elevenVoice, type ElevenLabsScript, type SpeechRequest } from "../../engine/test/elevenLabsStub.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { imageCatalogue, imageGeneration, routes, type ImageRequest } from "../../engine/test/openRouterStub.ts";
import { chatCompletions, type ChatRequest } from "../../engine/test/textStub.ts";
import { pngBytes } from "./images.ts";
import { roomShapes, type AnyRecord } from "./canvas.ts";
import { expect, startHostedEngine, test as base } from "./fixtures.ts";
import { CATALOGUE, composer, KEY } from "./generation.ts";
import { putRecords, testIndex, uploadToEngine } from "./media.ts";

export { audioBytes, ELEVENLABS_KEY, elevenModel, elevenVoice };

export const AUDIO_MODELS = [
  elevenModel("eleven_v4", { name: "Eleven v4", can_use_speaker_boost: true, languages: [{ language_id: "en", name: "English" }, { language_id: "it", name: "Italian" }], maximum_text_length_per_request: 60 }),
  elevenModel("eleven_multilingual_v2", { name: "Multilingual v2", can_use_style: true, can_use_speaker_boost: true, languages: [{ language_id: "en", name: "English" }] }),
  elevenModel("eleven_flash_v2_5", { name: "Flash v2.5" }),
];

export const VOICES = [
  elevenVoice("olivia01", "Olivia", { labels: { accent: "british", gender: "female", age: "young", use_case: "narration" }, preview_url: null }),
  elevenVoice("marcus02", "Marcus", { category: "cloned", labels: { accent: "american", gender: "male" }, preview_url: null }),
];

export interface AudioEngine {
  readonly engine: TestEngine;
  readonly speech: SpeechRequest[];
  readonly script: ElevenLabsScript;
  readonly images: ImageRequest[];
  readonly chat: ChatRequest[];
}

export const startAudio = async (options: { readonly openRouter?: boolean; readonly elevenLabs?: boolean; readonly script?: ElevenLabsScript; readonly dataDir?: string } = {}): Promise<AudioEngine> => {
  let origin = "";
  const script: ElevenLabsScript = {
    models: AUDIO_MODELS,
    voices: (query) => {
      const search = (query.get("search") ?? "").toLowerCase();
      if (query.get("next_page_token") === "page-2") return { status: 200, body: { voices: [elevenVoice("aria03", "Aria", { category: "professional", preview_url: null })], has_more: false, next_page_token: null } };
      const voices = VOICES.filter((voice) => search === "" || voice.name.toLowerCase().includes(search)).map((voice) =>
        voice.voice_id === "olivia01" ? { ...voice, preview_url: `${origin}/preview/olivia.wav` } : voice,
      );
      return { status: 200, body: { voices, has_more: search === "", next_page_token: search === "" ? "page-2" : null } };
    },
    speech: () => ({ kind: "audio", bytes: audioBytes(2), headers: { "character-cost": "124" } }),
    ...options.script,
  };
  const live = elevenLabsRoutes(script);
  const images = imageGeneration(() => ({ kind: "image", bytes: pngBytes(32, 32), cost: 0.01 }));
  const chat = chatCompletions(() => ({ kind: "text", text: "An answer.", cost: 0.001 }));
  const lines = [...(options.openRouter === false ? [] : [`OPENROUTER_API_KEY=${KEY}`]), ...(options.elevenLabs === false ? [] : [`ELEVENLABS_API_KEY=${ELEVENLABS_KEY}`])];
  const engine = await startHostedEngine({
    ...(options.dataDir === undefined ? {} : { dataDir: options.dataDir }),
    dotenv: lines.map((line) => `${line}\n`).join(""),
    stub: routes(imageCatalogue({ data: CATALOGUE }), images.handler, chat.handler),
    elevenLabs: live.handler,
  });
  origin = engine.elevenLabs!.origin;
  return { engine, speech: live.speech, script, images: images.requests, chat: chat.requests };
};

export const test = base.extend<{ audio: AudioEngine }>({
  audio: async ({}, use) => {
    const audio = await startAudio();
    await use(audio);
    await audio.engine.dispose();
  },
});

export { expect };

export const audioRecord = (id: string, ref: string, at: { x: number; y: number }, props: { file?: string; fileName?: string; w?: number } = {}, meta: Record<string, unknown> = {}) => ({
  id,
  typeName: "shape",
  type: "audio",
  x: at.x,
  y: at.y,
  rotation: 0,
  index: testIndex(),
  parentId: "page:page",
  isLocked: false,
  opacity: 1,
  props: { w: props.w ?? (props.file ? 320 : 240), h: 64, file: props.file ?? "", fileName: props.fileName ?? "" },
  meta: { ref, ...meta },
});

export const filledAudio = async (engine: TestEngine, id: string, ref: string, at: { x: number; y: number }, name = "line.wav", seconds = 2, project = "default") => {
  const file = await uploadToEngine(engine, name, audioBytes(seconds), "audio/wav", project);
  await putRecords(engine, [audioRecord(id, ref, at, { file, fileName: name })], project);
  return file;
};

export const audioShapes = async (engine: TestEngine, project = "default"): Promise<AnyRecord[]> => roomShapes(engine, project, "audio");

export const mediumOption = (page: Page, medium: "image" | "video" | "text" | "audio"): Locator =>
  composer(page).getByRole("radiogroup", { name: "Medium" }).getByRole("radio", { name: medium });

export const chooseAudio = async (page: Page): Promise<void> => {
  await mediumOption(page, "audio").click();
  await expect(mediumOption(page, "audio")).toHaveAttribute("aria-checked", "true");
  await expect(composer(page).getByTestId("model-chip")).toBeEnabled();
};

export const tray = (page: Page): Locator => composer(page).getByTestId("composer-tray");

export const pickVoice = async (page: Page, name: string): Promise<void> => {
  await tray(page).getByTestId("voice-chip").click();
  const dialog = page.getByTestId("voice-dialog");
  await dialog.getByRole("button", { name, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(tray(page).getByTestId("voice-chip")).toHaveText(name);
};
