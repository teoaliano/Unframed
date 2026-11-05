import { describe, expect, it } from "vitest";
import {
  advancedCount,
  audioDefaults,
  audioExtension,
  audioKeep,
  audioLine,
  audioParams,
  audioRangeRefusal,
  audioRequest,
  audioReset,
  audioStatus,
  composeSelection,
  contextMenu,
  creditsFrom,
  dropKind,
  elevenLabsMessage,
  elevenLabsStatusCopy,
  envUpsert,
  extensionFor,
  mayBeGroupMember,
  normaliseSettingsPatch,
  pastedFileName,
  recipeChip,
  speechFailure,
  UNUSED_ROLE,
  type AudioCatalogueEntry,
} from "../src/index.ts";
import { image, prompt, video } from "./shapes.ts";

const traits = (overrides: Record<string, unknown> = {}) => ({ canUseStyle: false, canUseSpeakerBoost: false, languages: [], maxCharacters: null, ...overrides });
const entry = (id: string, overrides: Record<string, unknown> | null = {}): AudioCatalogueEntry => ({ id, params: overrides === null ? null : traits(overrides) });
const keys = (params: ReturnType<typeof audioParams>) => ({ delivery: params.delivery.map((prop) => prop.key), advanced: [...params.advanced] });

describe("audio params", () => {
  it.each([
    ["eleven_v4 with speaker boost", entry("eleven_v4", { canUseSpeakerBoost: true }), { delivery: ["stability"], advanced: ["similarity_boost", "use_speaker_boost", "output_format", "seed"] }],
    ["eleven_v4_turbo", entry("eleven_v4_turbo"), { delivery: ["stability"], advanced: ["similarity_boost", "output_format", "seed"] }],
    ["a model with style", entry("eleven_multilingual_v2", { canUseStyle: true }), { delivery: ["stability", "style", "speed"], advanced: ["similarity_boost", "output_format", "seed"] }],
    ["a model with languages", entry("eleven_v3", { languages: [{ id: "en", name: "English" }] }), { delivery: ["stability", "speed"], advanced: ["similarity_boost", "output_format", "seed", "language_code"] }],
    ["an unknown row", entry("eleven_v9", null), { delivery: ["stability", "speed"], advanced: ["similarity_boost", "output_format", "seed"] }],
    ["an unknown v4 row", entry("eleven_v4", null), { delivery: ["stability"], advanced: ["similarity_boost", "output_format", "seed"] }],
  ])("%s", (_name, model, expected) => {
    expect(keys(audioParams(model))).toEqual(expected);
  });

  it("defaults every delivery prop the model takes", () => {
    expect(audioDefaults(audioParams(entry("eleven_multilingual_v2", { canUseStyle: true })))).toEqual({ stability: 0.5, style: 0, speed: 1 });
    expect(audioDefaults(audioParams(entry("eleven_v4")))).toEqual({ stability: 0.5 });
  });

  it("keeps a stored Style and Speaker boost on an unknown row, and drops them on a known model that lacks them", () => {
    const stored = { stability: 0.4, style: 0.3, use_speaker_boost: false, voice_id: "v1", voice_name: "Olivia" };
    expect(audioKeep(stored, audioParams(entry("eleven_x", null)))).toEqual(stored);
    expect(audioKeep(stored, audioParams(entry("eleven_v3")))).toEqual({ stability: 0.4, voice_id: "v1", voice_name: "Olivia" });
  });

  it("drops a stored Speed on a v4 model and an unlisted language", () => {
    const params = audioParams(entry("eleven_v4", { languages: [{ id: "en", name: "English" }] }));
    expect(audioKeep({ speed: 1.1, language_code: "fr", output_format: "wav_44100", seed: 7 }, params)).toEqual({ output_format: "wav_44100", seed: 7 });
    expect(audioKeep({ language_code: "en", output_format: "opus_48000_32" }, params)).toEqual({ language_code: "en" });
  });
});

describe("audio params on a model change", () => {
  const before = { voice_id: "v1", voice_name: "Olivia", stability: 0.9, style: 0.6, speed: 1.15, use_speaker_boost: true, language_code: "fr", output_format: "wav_44100", seed: 42, similarity_boost: 0.3 };

  it("removes what the new model does not declare and resets delivery", () => {
    expect(audioReset(before, audioParams(entry("eleven_v4")))).toEqual({ voice_id: "v1", voice_name: "Olivia", output_format: "wav_44100", seed: 42, similarity_boost: 0.3, stability: 0.5 });
  });

  it("brings Speed back and keeps what the new model declares", () => {
    const next = entry("eleven_multilingual_v2", { canUseStyle: true, canUseSpeakerBoost: true, languages: [{ id: "fr", name: "French" }] });
    expect(audioReset(before, audioParams(next))).toEqual({
      voice_id: "v1",
      voice_name: "Olivia",
      output_format: "wav_44100",
      seed: 42,
      similarity_boost: 0.3,
      use_speaker_boost: true,
      language_code: "fr",
      stability: 0.5,
      style: 0,
      speed: 1,
    });
  });

  it.each([
    [{ stability: 1.2 }, "Stability has to be between 0 and 1."],
    [{ similarity_boost: -0.1 }, "Similarity has to be between 0 and 1."],
    [{ style: 2 }, "Style has to be between 0 and 1."],
    [{ speed: 0.5 }, "Speed has to be between 0.7 and 1.2."],
    [{ speed: 1.3 }, "Speed has to be between 0.7 and 1.2."],
    [{ seed: -1 }, "Seed has to be between 0 and 4294967295."],
    [{ seed: 1.5 }, "Seed has to be between 0 and 4294967295."],
    [{ seed: 4294967296 }, "Seed has to be between 0 and 4294967295."],
    [{ stability: 0, similarity_boost: 1, style: 0, speed: 0.7, seed: 4294967295 }, undefined],
  ])("range %j", (params, expected) => {
    expect(audioRangeRefusal(params)).toBe(expected);
  });

  it("counts the advanced props that are set", () => {
    expect(advancedCount({ stability: 0.5 })).toBe(0);
    expect(advancedCount({ seed: 1, output_format: "wav_44100", stability: 0.5 })).toBe(2);
  });
});

describe("audio request", () => {
  const shapes = [prompt("p1", "[whispers] Hello there", { x: 0, y: 0 }), prompt("p2", "General Kenobi", { x: 0, y: 100 }), image("i1", "a.png", { x: 300 }), video("v1", { file: "b.mp4" }, { x: 600 })];
  const composition = composeSelection({ shapes, selected: ["p1", "p2", "i1", "v1"], instruction: "slowly", medium: "audio" });

  it("speaks the composition's prompt and sends exactly the set keys", () => {
    const request = audioRequest({ composition, props: { voice_id: "v1", voice_name: "Olivia", stability: 0.4, speed: 0.9, use_speaker_boost: false }, voice: { id: "v1" }, model: "eleven_v3" });
    expect(request.text).toBe("[whispers] Hello there\n\nGeneral Kenobi\n\nslowly");
    expect(request.voiceId).toBe("v1");
    expect(request.query).toEqual({ output_format: "mp3_44100_128" });
    expect(request.body).toEqual({ text: request.text, model_id: "eleven_v3", voice_settings: { stability: 0.4, use_speaker_boost: false, speed: 0.9 } });
    expect(request.roles).toEqual({ i1: UNUSED_ROLE, v1: UNUSED_ROLE });
  });

  it("leaves voice_settings out when none is set, and sends seed, language and format only when set", () => {
    expect(audioRequest({ composition, props: {}, voice: undefined, model: "eleven_v4" }).body).toEqual({ text: composition.prompt, model_id: "eleven_v4" });
    const set = audioRequest({ composition, props: { seed: 9, language_code: "it", output_format: "wav_24000" }, voice: { id: "v" }, model: "eleven_v4" });
    expect(set.query).toEqual({ output_format: "wav_24000" });
    expect(set.body).toEqual({ text: composition.prompt, model_id: "eleven_v4", seed: 9, language_code: "it" });
  });
});

describe("audio status", () => {
  const base = { text: "Hello", media: [], voice: { id: "v1" }, model: "eleven_v4", params: audioParams(entry("eleven_v4", { maxCharacters: 10 })), hasKey: true };
  it.each([
    ["ready", {}, [], []],
    ["no key", { hasKey: false }, ["No ElevenLabs key yet. Add one in Settings, under ElevenLabs."], []],
    ["empty text", { text: "  " }, ["Nothing to say. Select a prompt, or type an instruction."], []],
    ["no voice", { voice: undefined }, ["Pick a voice for this line."], []],
    ["too long", { text: "Hello there, friend" }, ["This text is 19 characters, but eleven_v4 takes at most 10 in one request. Shorten it, or pick a model that takes more."], []],
    ["a cycle", { error: "Circular reference: a -> a" }, ["Circular reference: a -> a"], []],
    ["one image", { media: [{ kind: "image" }] }, [], ["An image is selected, but audio models only read text. It will not be sent."]],
    ["one clip", { media: [{ kind: "video" }] }, [], ["A clip is selected, but audio models only read text. It will not be sent."]],
    ["several", { media: [{ kind: "image" }, { kind: "video" }, { kind: "image" }] }, [], ["3 images and clips are selected, but audio models only read text. They will not be sent."]],
  ] as const)("%s", (_name, overrides, blockers, warnings) => {
    expect(audioStatus({ ...base, ...overrides } as Parameters<typeof audioStatus>[0])).toEqual({ blockers, warnings });
  });

  it("says nothing about length when the model gives no maximum", () => {
    expect(audioStatus({ ...base, text: "x".repeat(50_000), params: audioParams(entry("eleven_v4")) }).blockers).toEqual([]);
  });
});

describe("ElevenLabs answers", () => {
  it.each([
    ["124", 124],
    ["12.5", 12.5],
    [" 0 ", 0],
    ["", null],
    [null, null],
    [undefined, null],
    ["-3", null],
    ["lots", null],
  ])("creditsFrom(%j)", (header, expected) => {
    expect(creditsFrom(header)).toBe(expected);
  });

  it.each([
    [JSON.stringify({ detail: { status: "invalid_api_key", message: "Invalid API key" } }), "Invalid API key"],
    [JSON.stringify({ detail: "Voice not found" }), "Voice not found"],
    ["<html>Bad gateway</html>", "<html>Bad gateway</html>"],
    ["x".repeat(400), "x".repeat(300)],
  ])("elevenLabsMessage %#", (body, expected) => {
    expect(elevenLabsMessage(500, body)).toBe(expected);
  });

  it.each([
    [401, JSON.stringify({ detail: { message: "Invalid API key" } }), "ElevenLabs refused the key: Invalid API key. Check the key in Settings."],
    [402, JSON.stringify({ detail: { message: "Out of credits" } }), "ElevenLabs has no credits left for this: either the account's quota for this period is used up, or this key has hit its own credit limit. Check your plan and the key's limit at elevenlabs.io. (Out of credits)"],
    [429, JSON.stringify({ detail: { code: "quota_exceeded", message: "Quota" } }), "ElevenLabs has no credits left for this: either the account's quota for this period is used up, or this key has hit its own credit limit. Check your plan and the key's limit at elevenlabs.io. (Quota)"],
    [400, JSON.stringify({ detail: { status: "insufficient_credits", message: "Short" } }), "ElevenLabs has no credits left for this: either the account's quota for this period is used up, or this key has hit its own credit limit. Check your plan and the key's limit at elevenlabs.io. (Short)"],
    [422, JSON.stringify({ detail: "Unprocessable" }), "ElevenLabs (422): Unprocessable"],
  ])("speechFailure %i", (status, body, expected) => {
    expect(speechFailure(status, body)).toBe(expected);
  });

  it.each([
    ["mp3_44100_128", "mp3"],
    ["mp3_22050_32", "mp3"],
    ["wav_44100", "wav"],
    [undefined, "mp3"],
  ])("audioExtension(%s)", (format, ext) => {
    expect(audioExtension(format)).toBe(ext);
  });

  it.each([
    [{ model: "eleven_v4", durationMs: 6200, credits: 124 }, "eleven_v4 · 0:06 · 124 credits"],
    [{ model: "eleven_v4", durationMs: 75_000, credits: 1 }, "eleven_v4 · 1:15 · 1 credit"],
    [{ model: "eleven_v4", credits: 1250 }, "eleven_v4 · 1,250 credits"],
    [{ model: "eleven_v4", durationMs: 3000, credits: null }, "eleven_v4 · 0:03"],
    [{ model: "eleven_v4" }, "eleven_v4"],
  ])("audioLine %#", (input, expected) => {
    expect(audioLine(input)).toBe(expected);
  });
});

describe("ElevenLabs settings", () => {
  it.each([
    [{ elevenLabsKey: " sk_0123456789abcdef0123 " }, { ok: true, changes: { ELEVENLABS_API_KEY: "sk_0123456789abcdef0123" } }],
    [{ elevenLabsKey: "sk_short" }, { ok: false, message: "That does not look like an ElevenLabs key." }],
    [{ elevenLabsKey: "sk_0123456789abcdef0123\nX=1" }, { ok: false, message: "That does not look like an ElevenLabs key." }],
    [{ elevenLabsKey: "" }, { ok: false, message: "That does not look like an ElevenLabs key." }],
    [{ audioModel: "eleven_multilingual_v2" }, { ok: true, changes: { ELEVENLABS_AUDIO_MODEL: "eleven_multilingual_v2" } }],
    [{ audioModel: "eleven v4" }, { ok: false, message: 'That does not look like an ElevenLabs model id. Expected something like "eleven_v4".' }],
    [{ audioModel: "" }, { ok: false, message: 'That does not look like an ElevenLabs model id. Expected something like "eleven_v4".' }],
  ])("normalises %j", (patch, expected) => {
    expect(normaliseSettingsPatch(patch)).toEqual(expected);
  });

  it("upserts the two variables in .env", () => {
    const text = "OPENROUTER_API_KEY=sk-or-x\nELEVENLABS_API_KEY=old\n";
    expect(envUpsert(text, { ELEVENLABS_API_KEY: "sk_new", ELEVENLABS_AUDIO_MODEL: "eleven_v3" })).toBe("OPENROUTER_API_KEY=sk-or-x\nELEVENLABS_API_KEY=sk_new\nELEVENLABS_AUDIO_MODEL=eleven_v3\n");
    expect(envUpsert(text, { ELEVENLABS_API_KEY: null })).toBe("OPENROUTER_API_KEY=sk-or-x\n");
  });
});

describe("ElevenLabs status copy", () => {
  const copy = (status: Parameters<typeof elevenLabsStatusCopy>[0]["status"], hasKey = true, keyHint = "wxyz") => elevenLabsStatusCopy({ hasKey, keyHint, status, locale: "en-US" });
  it.each([
    ["no key", copy(undefined, false, ""), "Make a key at elevenlabs.io (Developers, API keys) and paste it here. Audio generation is billed to that account in credits."],
    ["not fetched", copy(undefined), "A key is already saved (…wxyz). Entering a new one replaces it."],
    ["not fetched, no hint", copy(undefined, true, ""), "A key is already saved. Entering a new one replaces it."],
    ["revoked", copy({ hasKey: true, revoked: true }), "This key no longer works at ElevenLabs. It may have been deleted or disabled there."],
    ["usage hidden", copy({ hasKey: true, usageHidden: true }), "This key cannot read the account's usage, so it is not shown here. Generating works if the key may use text to speech."],
    [
      "usage with a limit and a reset",
      copy({ hasKey: true, tier: "creator", creditsUsed: 12840, creditLimit: 100000, resetsAt: "2026-12-06T05:46:40.000Z" }),
      "12,840 of 100,000 credits used on this ElevenLabs account this period. Resets on Dec 6, 2026.",
    ],
    ["usage without a limit or reset", copy({ hasKey: true, tier: null, creditsUsed: 5, creditLimit: null, resetsAt: null }), "5 credits used on this ElevenLabs account this period."],
  ])("%s", (_name, actual, expected) => {
    expect(actual).toBe(expected);
  });
});

describe("audio on the canvas", () => {
  it.each([
    ["audio/mpeg", "mp3"],
    ["audio/mp3", "mp3"],
    ["audio/wav", "wav"],
    ["audio/x-wav", "wav"],
    ["audio/wave", "wav"],
    ["audio/mp4", "m4a"],
    ["audio/x-m4a", "m4a"],
  ])("names %s uploads .%s", (mime, ext) => {
    expect(extensionFor(mime, "clip.bin")).toBe(ext);
  });

  it.each([
    [{ type: "audio/mpeg", name: "" }, "audio"],
    [{ type: "audio/ogg", name: "x.ogg" }, "audio"],
    [{ type: "", name: "Take 1.MP3" }, "audio"],
    [{ type: "application/octet-stream", name: "line.wav" }, "audio"],
    [{ type: "", name: "voice.m4a" }, "audio"],
    [{ type: "image/png", name: "a.mp3" }, "image"],
    [{ type: "", name: "notes.txt" }, undefined],
  ])("drop kind of %j", (file, kind) => {
    expect(dropKind(file)).toBe(kind);
  });

  it("names a nameless pasted sound file by its type, mp3 when unknown", () => {
    expect(pastedFileName("audio", "audio/wav")).toBe("pasted-audio.wav");
    expect(pastedFileName("audio", "audio/ogg")).toBe("pasted-audio.mp3");
  });

  it("refuses audio as a group member", () => {
    expect(mayBeGroupMember("audio")).toBe(false);
    expect(mayBeGroupMember("image")).toBe(true);
  });

  it("offers Reveal and Copy path on a filled audio shape, and nothing on an empty one", () => {
    const filled = { id: "a1", type: "audio", ref: "line", file: "1-line.mp3" };
    const menu = contextMenu({ target: { kind: "shape", shape: filled }, selection: [filled], clipboard: false, libraryRegistered: false, platform: "darwin" });
    expect(menu[0]).toEqual({
      section: "image",
      heading: "Audio",
      items: [
        { action: "reveal", label: "Reveal in Finder", files: ["1-line.mp3"] },
        { action: "copy-path", label: "Copy path", file: "1-line.mp3" },
      ],
    });
    const empty = { id: "a2", type: "audio", ref: "102" };
    expect(contextMenu({ target: { kind: "shape", shape: empty }, selection: [empty], clipboard: false, libraryRegistered: false, platform: "darwin" }).map((section) => section.section)).not.toContain("image");
  });

  it("adds Audio to the add menu's inputs, after Video", () => {
    const inputs = contextMenu({ target: { kind: "canvas" }, selection: [], clipboard: false, libraryRegistered: false, platform: "darwin" }).find((section) => section.section === "inputs");
    expect(inputs?.items.map((item) => item.label)).toEqual(["Prompt", "Image", "Video", "Audio", "Group"]);
  });

  it("chips an audio recipe as the model then the voice name", () => {
    expect(recipeChip({ medium: "audio", model: "eleven_v4", params: { voice_id: "v1", voice_name: "Rachel", stability: 0.5 }, runs: 1 })).toBe("eleven_v4 · Rachel");
  });
});
