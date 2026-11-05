import { chmod, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot, startEngine } from "./harness.ts";
import { ELEVENLABS_KEY, elevenLabsRoutes, elevenModel, elevenVoice, OPENROUTER_KEY } from "./elevenLabsStub.ts";

const envText = (dataDir: string) => readFile(join(dataDir, ".env"), "utf8");

describe("the ElevenLabs settings", () => {
  it("reads both variables from .env, reports only the key's last four characters, and defaults the model", async () => {
    const engine = await startEngine({ dotenv: `ELEVENLABS_API_KEY=${ELEVENLABS_KEY}\n` });
    const rpc = await engine.rpc();
    const settings = await rpc.call("settings.get");
    expect(settings).toMatchObject({ hasKey: false, hasElevenLabsKey: true, elevenLabsKeyHint: "cdef", audioModel: "eleven_v4" });
    expect(JSON.stringify(settings)).not.toContain(ELEVENLABS_KEY);
    expect(JSON.stringify(await rpc.call("server.health"))).not.toContain(ELEVENLABS_KEY);
    expect(engine.stdout()).not.toContain(ELEVENLABS_KEY);
  });

  it("writes the key and the audio model with settings.update, and refuses bad values with their messages", async () => {
    const engine = await startEngine({ dotenv: "" });
    const rpc = await engine.rpc();
    const answer = await rpc.call("settings.update", { elevenLabsKey: ` ${ELEVENLABS_KEY} `, audioModel: "eleven_multilingual_v2" });
    expect(answer).toMatchObject({ hasElevenLabsKey: true, elevenLabsKeyHint: "cdef", audioModel: "eleven_multilingual_v2" });
    expect(await envText(engine.dataDir)).toBe(`ELEVENLABS_API_KEY=${ELEVENLABS_KEY}\nELEVENLABS_AUDIO_MODEL=eleven_multilingual_v2\n`);
    await expect(rpc.call("settings.update", { elevenLabsKey: "short" })).rejects.toMatchObject({ code: "bad_request", message: "That does not look like an ElevenLabs key." });
    await expect(rpc.call("settings.update", { audioModel: "eleven v4" })).rejects.toMatchObject({
      code: "bad_request",
      message: 'That does not look like an ElevenLabs model id. Expected something like "eleven_v4".',
    });
  });

  it("clears the stored audio model when the default audio model changes", async () => {
    const engine = await startEngine({ dotenv: `ELEVENLABS_API_KEY=${ELEVENLABS_KEY}\n` });
    const rpc = await engine.rpc();
    await rpc.call("preferences.set", { key: "lastUsed.audio", value: { model: "eleven_v3", props: { stability: 0.3 }, voice: { id: "v1", name: "Olivia" } } });
    await rpc.call("settings.update", { audioModel: "eleven_multilingual_v2" });
    expect((await rpc.call("preferences.get", { keys: ["lastUsed.audio"] })).values["lastUsed.audio"]).toEqual({ props: { stability: 0.3 }, voice: { id: "v1", name: "Olivia" } });
  });

  it("leaves a pending OpenRouter connection waiting when only the ElevenLabs key is saved", async () => {
    const engine = await startEngine({ dotenv: "" });
    const rpc = await engine.rpc();
    await rpc.call("oauth.start");
    await rpc.call("settings.update", { elevenLabsKey: ELEVENLABS_KEY });
    expect((await rpc.call("oauth.pending")).state).toBe("waiting");
  });

  it("removes the key live, emits the change, and keeps it when .env cannot be written", async () => {
    const engine = await startEngine({ dotenv: `OPENROUTER_API_KEY=${OPENROUTER_KEY}\nELEVENLABS_API_KEY=${ELEVENLABS_KEY}\n` });
    const rpc = await engine.rpc();
    const updates = rpc.subscribe("settings.subscribe");
    await chmod(engine.dataDir, 0o500);
    try {
      await expect(rpc.call("settings.removeElevenLabsKey")).rejects.toMatchObject({ code: "internal", message: expect.stringMatching(/^Could not write \.env: /) });
    } finally {
      await chmod(engine.dataDir, 0o700);
    }
    expect((await rpc.call("settings.get")).hasElevenLabsKey).toBe(true);
    const removed = await rpc.call("settings.removeElevenLabsKey");
    expect(removed.settings).toMatchObject({ hasKey: true, hasElevenLabsKey: false, elevenLabsKeyHint: "" });
    expect(await envText(engine.dataDir)).toBe(`OPENROUTER_API_KEY=${OPENROUTER_KEY}\n`);
    await expect.poll(() => updates.values.some((value) => value.hasElevenLabsKey === false)).toBe(true);
  });

  it("ships the two lines in .env.example", async () => {
    const text = await readFile(join(repoRoot, ".env.example"), "utf8");
    expect(text).toContain("\nELEVENLABS_API_KEY=\nELEVENLABS_AUDIO_MODEL=eleven_v4\n");
  });
});

describe("UNFRAMED_TEST_ELEVENLABS_ORIGIN", () => {
  it.each(["https://api.elevenlabs.evil.example", "http://10.0.0.2:9000"])("ignores %s with the documented log line", async (value) => {
    const engine = await startEngine({ env: { UNFRAMED_TEST_ELEVENLABS_ORIGIN: value } });
    expect(engine.stdout()).toContain(`  test origin ignored: ${value} is not a loopback origin\n`);
  });

  it("redirects every ElevenLabs call to a loopback stub, and a .env line for it does nothing", async () => {
    const routes = elevenLabsRoutes({});
    const engine = await startEngine({ dotenv: `ELEVENLABS_API_KEY=${ELEVENLABS_KEY}\nUNFRAMED_TEST_ELEVENLABS_ORIGIN=http://127.0.0.1:1\n`, elevenLabs: routes.handler });
    const rpc = await engine.rpc();
    await rpc.call("models.list", { medium: "audio" });
    await rpc.call("voices.list", {});
    await rpc.call("elevenlabs.status");
    expect(engine.elevenLabs!.requests.map((request) => new URL(request.url, "http://stub").pathname)).toEqual(["/v1/models", "/v2/voices", "/v1/user/subscription"]);
    expect(engine.stdout()).not.toContain("test origin ignored");
  });
});

describe("the audio catalogue", () => {
  it("lists text-to-speech models in ElevenLabs' order with the key sent, and appends the default", async () => {
    const routes = elevenLabsRoutes({
      models: [
        elevenModel("eleven_multilingual_v2", { name: "Multilingual v2", can_use_style: true, can_use_speaker_boost: true, languages: [{ language_id: "en", name: "English" }], maximum_text_length_per_request: 10000 }),
        elevenModel("eleven_english_sts_v2", { can_do_text_to_speech: false }),
        { model_id: "eleven_flash_v2_5", can_do_text_to_speech: true },
      ],
    });
    const engine = await startEngine({ dotenv: `ELEVENLABS_API_KEY=${ELEVENLABS_KEY}\n`, elevenLabs: routes.handler });
    const answer = await (await engine.rpc()).call("models.list", { medium: "audio" });
    expect(answer).toEqual({
      default: "eleven_v4",
      models: [
        { id: "eleven_multilingual_v2", name: "Multilingual v2", created: null, params: { canUseStyle: true, canUseSpeakerBoost: true, languages: [{ id: "en", name: "English" }], maxCharacters: 10000 } },
        { id: "eleven_flash_v2_5", name: "eleven_flash_v2_5", created: null, params: { canUseStyle: false, canUseSpeakerBoost: false, languages: [], maxCharacters: null } },
        { id: "eleven_v4", name: "eleven_v4", created: null, params: null },
      ],
    });
    expect(engine.elevenLabs!.requests[0]!.headers["xi-api-key"]).toBe(ELEVENLABS_KEY);
  });

  it("answers only the default row without a key, and on a failure", async () => {
    const routes = elevenLabsRoutes({ modelsStatus: 500 });
    const keyless = await startEngine({ dotenv: "", elevenLabs: routes.handler });
    expect(await (await keyless.rpc()).call("models.list", { medium: "audio" })).toEqual({ default: "eleven_v4", models: [{ id: "eleven_v4", name: "eleven_v4", created: null, params: null }] });
    expect(keyless.elevenLabs!.requests).toHaveLength(0);
    const failing = await startEngine({ dotenv: `ELEVENLABS_API_KEY=${ELEVENLABS_KEY}\nELEVENLABS_AUDIO_MODEL=eleven_v3\n`, elevenLabs: routes.handler });
    expect(await (await failing.rpc()).call("models.list", { medium: "audio" })).toEqual({ default: "eleven_v3", models: [{ id: "eleven_v3", name: "eleven_v3", created: null, params: null }] });
  });
});

describe("voices.list", () => {
  it("asks with page_size, search and the page token, maps each voice, and answers a token only while there are more", async () => {
    const queries: URLSearchParams[] = [];
    const routes = elevenLabsRoutes({
      voices: (query) => {
        queries.push(query);
        return {
          status: 200,
          body: {
            voices: [elevenVoice("aria03", "Aria", { category: "professional", labels: { accent: "italian", age: 30, use_case: "characters" }, preview_url: "http://127.0.0.1:1/aria.mp3" }), { name: "no id" }],
            has_more: query.get("next_page_token") === null,
            next_page_token: "page-2",
          },
        };
      },
    });
    const engine = await startEngine({ dotenv: `ELEVENLABS_API_KEY=${ELEVENLABS_KEY}\n`, elevenLabs: routes.handler });
    const rpc = await engine.rpc();
    const first = await rpc.call("voices.list", { search: " aria " });
    expect(first).toEqual({
      voices: [{ id: "aria03", name: "Aria", category: "professional", labels: { accent: "italian", use_case: "characters" }, previewUrl: "http://127.0.0.1:1/aria.mp3" }],
      nextPageToken: "page-2",
    });
    const second = await rpc.call("voices.list", { search: "aria", pageToken: "page-2" });
    expect(second.nextPageToken).toBeNull();
    expect(queries.map((query) => Object.fromEntries(query))).toEqual([
      { page_size: "100", search: "aria" },
      { page_size: "100", search: "aria", next_page_token: "page-2" },
    ]);
  });

  it("refuses without a key, and answers ElevenLabs' message on a failure", async () => {
    const keyless = await startEngine({ dotenv: "" });
    await expect((await keyless.rpc()).call("voices.list", {})).rejects.toMatchObject({ code: "unavailable", message: "No ElevenLabs key yet. Add one in Settings, under ElevenLabs." });
    const routes = elevenLabsRoutes({ voices: () => ({ status: 500, body: { detail: { message: "Voices are down" } } }) });
    const engine = await startEngine({ dotenv: `ELEVENLABS_API_KEY=${ELEVENLABS_KEY}\n`, elevenLabs: routes.handler });
    await expect((await engine.rpc()).call("voices.list", {})).rejects.toMatchObject({ code: "upstream", message: "ElevenLabs (500): Voices are down" });
  });
});

describe("elevenlabs.status", () => {
  it("makes no call without a key", async () => {
    const engine = await startEngine({ dotenv: "", elevenLabs: true });
    expect(await (await engine.rpc()).call("elevenlabs.status")).toEqual({ hasKey: false });
    expect(engine.elevenLabs!.requests).toHaveLength(0);
  });

  it.each([
    [{ status: 401, body: {} }, { hasKey: true, revoked: true }],
    [{ status: 403, body: {} }, { hasKey: true, usageHidden: true }],
    [
      { status: 200, body: { tier: "creator", character_count: 12840, character_limit: 100000, next_character_count_reset_unix: 1_800_000_000 } },
      { hasKey: true, tier: "creator", creditsUsed: 12840, creditLimit: 100000, resetsAt: "2027-01-15T08:00:00.000Z" },
    ],
    [{ status: 200, body: { tier: 3, character_count: "lots" } }, { hasKey: true, tier: null, creditsUsed: 0, creditLimit: null, resetsAt: null }],
  ])("answers %j", async (subscription, expected) => {
    const routes = elevenLabsRoutes({ subscription });
    const engine = await startEngine({ dotenv: `ELEVENLABS_API_KEY=${ELEVENLABS_KEY}\n`, elevenLabs: routes.handler });
    expect(await (await engine.rpc()).call("elevenlabs.status")).toEqual(expected);
  });

  it("fails upstream on any other status", async () => {
    const routes = elevenLabsRoutes({ subscription: { status: 500 } });
    const engine = await startEngine({ dotenv: `ELEVENLABS_API_KEY=${ELEVENLABS_KEY}\n`, elevenLabs: routes.handler });
    await expect((await engine.rpc()).call("elevenlabs.status")).rejects.toMatchObject({ code: "upstream", message: "ElevenLabs answered 500." });
  });
});

