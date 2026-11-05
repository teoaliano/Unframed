import { chmod, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AudioRunRequest } from "@unframed/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eventsOf, finished, until } from "./generation.ts";
import { startEngine } from "./harness.ts";
import { gate } from "./openRouterStub.ts";
import { audioBytes, audioFiles, boardFolder, ELEVENLABS_KEY, readJson, roomShapes, startSpeaking, type Speaking } from "./elevenLabsStub.ts";

const audioRequest = (overrides: Partial<AudioRunRequest> = {}): AudioRunRequest => ({
  project: "board",
  voice: { id: "olivia01", name: "Olivia" },
  params: {},
  selectionPrompt: "Hello there",
  instruction: "",
  prompt: "Hello there",
  sources: [],
  anchor: { x: 1000, y: 0, w: 100, h: 100 },
  ...overrides,
});

const forgetLog = (speaking: Speaking) => speaking.engine.stdout().length;

describe("run.audio", () => {
  let speaking: Speaking;
  beforeAll(async () => {
    speaking = await startSpeaking();
  });
  afterAll(() => speaking.engine.dispose());

  it.each([
    ["an empty prompt", { prompt: "   " }, "bad_request", "Prompt is empty. Select a prompt, or type an instruction."],
    ["a bad voice id", { voice: { id: "../models", name: "x" } }, "bad_request", "That is not an ElevenLabs voice id."],
    ["a bad model id", { model: "eleven v4/x" }, "bad_request", "That does not look like an ElevenLabs model id."],
    ["an unknown format", { params: { output_format: "pcm_16000" } }, "bad_request", "That audio format is not offered here."],
    ["stability out of range", { params: { stability: 1.5 } }, "bad_request", "Stability has to be between 0 and 1."],
    ["speed out of range", { params: { speed: 2 } }, "bad_request", "Speed has to be between 0.7 and 1.2."],
    ["a seed out of range", { params: { seed: -2 } }, "bad_request", "Seed has to be between 0 and 4294967295."],
  ] as const)("refuses %s and writes nothing", async (_case, overrides, code, message) => {
    const before = await roomShapes(speaking);
    const calls = speaking.speech.length;
    await expect(speaking.rpc.call("run.audio", audioRequest(overrides as Partial<AudioRunRequest>))).rejects.toMatchObject({ code, message });
    expect(await roomShapes(speaking)).toEqual(before);
    expect(speaking.speech).toHaveLength(calls);
  });

  it("puts a placeholder in the room, calls ElevenLabs, writes the file and its sidecar, and fills the placeholder", async () => {
    const held = gate<void>();
    speaking.script.speech = async () => {
      await held.promise;
      return { kind: "audio", bytes: audioBytes(2), headers: { "character-cost": "38", "request-id": "req-abc" } };
    };
    const started = await speaking.rpc.call(
      "run.audio",
      audioRequest({
        model: "eleven_multilingual_v2",
        params: { stability: 0.4, similarity_boost: 0.8, style: 0.2, use_speaker_boost: false, speed: 1.1, seed: 7, language_code: "en", output_format: "wav_44100" },
        selectionPrompt: "[whispers] Hello there",
        instruction: "slowly",
        prompt: "[whispers] Hello there\n\nslowly",
        sources: ["shape:starter-subject"],
        anchor: { x: 40, y: 60, w: 320, h: 300 },
      }),
    );
    expect(started.batchId).toMatch(/^b-\d+$/);
    const placeholder = (await roomShapes(speaking)).find((shape) => shape.id === started.placeholders[0]);
    expect(placeholder).toMatchObject({
      type: "audio",
      props: { w: 320, h: 64, file: "", fileName: "" },
      meta: {
        unframed: {
          run: { runId: started.runId, runIndex: 1 },
          result: { sidecar: null, medium: "audio", model: "eleven_multilingual_v2", runIndex: 1, runCount: 1, cost: null, credits: null, sources: ["shape:starter-subject"] },
        },
      },
    });
    expect(placeholder.x).toBeGreaterThanOrEqual(40 + 320);

    await until(() => (speaking.speech.length > 0 ? true : undefined), "the speech call");
    const call = speaking.speech.at(-1)!;
    expect(call.voiceId).toBe("olivia01");
    expect(call.query).toEqual({ output_format: "wav_44100" });
    expect(call.headers["xi-api-key"]).toBe(ELEVENLABS_KEY);
    expect(call.body).toEqual({
      text: "[whispers] Hello there\n\nslowly",
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.2, use_speaker_boost: false, speed: 1.1 },
      seed: 7,
      language_code: "en",
    });
    held.release();
    const done = await finished(speaking.events, started.runId);
    expect(done).toEqual({ type: "finished", runId: started.runId, succeeded: 1, failed: 0, errors: [], orphaned: 0 });

    const file = (await audioFiles(speaking)).find((name) => name.endsWith("-audio-whispers-hello-there-slowly.wav"))!;
    expect(file).toBeDefined();
    expect(await readFile(join(boardFolder(speaking), file))).toEqual(audioBytes(2));
    const sidecarName = file.replace(/\.wav$/, ".json");
    const sidecar = await readJson(speaking, sidecarName);
    expect(sidecar).toEqual({
      kind: "audio",
      prompt: "[whispers] Hello there\n\nslowly",
      model: "eleven_multilingual_v2",
      voice: { id: "olivia01", name: "Olivia" },
      voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.2, use_speaker_boost: false, speed: 1.1 },
      output_format: "wav_44100",
      seed: 7,
      language_code: "en",
      characters: 30,
      billing: "elevenlabs-credits",
      credits: 38,
      requestId: "req-abc",
      batchId: started.batchId,
      runIndex: 1,
      runCount: 1,
      createdAt: expect.any(String),
      file,
      recipe: {
        medium: "audio",
        model: "eleven_multilingual_v2",
        params: { voice_id: "olivia01", voice_name: "Olivia", stability: 0.4, similarity_boost: 0.8, style: 0.2, use_speaker_boost: false, speed: 1.1, seed: 7, language_code: "en", output_format: "wav_44100" },
        selectionPrompt: "[whispers] Hello there",
        instruction: "slowly",
        references: [],
        sources: ["shape:starter-subject"],
      },
    });
    expect("cost" in sidecar).toBe(false);

    const filled = (await roomShapes(speaking)).find((shape) => shape.id === started.placeholders[0]);
    expect(filled.props.file).toBe(file);
    expect(filled.meta.unframed.run).toBeUndefined();
    expect(filled.meta.unframed.result).toMatchObject({ sidecar: sidecarName, medium: "audio", cost: null, credits: 38 });
    expect(eventsOf(speaking.events, started.runId)).toEqual([
      { type: "started", runId: started.runId, batchId: started.batchId, count: 1 },
      { type: "output", runId: started.runId, runIndex: 1, ok: true, shapeId: started.placeholders[0], file, cost: null, credits: 38 },
      done,
    ]);
    expect(await speaking.rpc.call("recipe.read", { project: "board", shapeId: started.placeholders[0]! })).toEqual(sidecar.recipe);
  });

  it("sends no voice settings when none is set, mp3 by default, and logs unknown credits", async () => {
    speaking.script.speech = () => ({ kind: "audio", headers: { "character-cost": "" } });
    const from = forgetLog(speaking);
    const started = await speaking.rpc.call("run.audio", audioRequest({ prompt: "No settings at all" }));
    await finished(speaking.events, started.runId);
    expect(speaking.speech.at(-1)!.body).toEqual({ text: "No settings at all", model_id: "eleven_v4" });
    expect(speaking.speech.at(-1)!.query).toEqual({ output_format: "mp3_44100_128" });
    const file = (await audioFiles(speaking)).find((name) => name.endsWith("-audio-no-settings-at-all.mp3"))!;
    expect((await readJson(speaking, file.replace(/\.mp3$/, ".json"))).credits).toBeNull();
    expect(speaking.engine.stdout().slice(from)).toContain("  audio →  18 chars  eleven_v4  (credits unknown)\n");
  });

  it("logs the credits it used", async () => {
    speaking.script.speech = () => ({ kind: "audio" });
    const from = forgetLog(speaking);
    const started = await speaking.rpc.call("run.audio", audioRequest({ prompt: "Credits please" }));
    await finished(speaking.events, started.runId);
    expect(speaking.engine.stdout().slice(from)).toContain("  audio →  14 chars  eleven_v4  (42 credits)\n");
  });

  const heldRun = async (prompt: string, params: AudioRunRequest["params"] = {}) => {
    const held = gate<void>();
    speaking.script.speech = async () => {
      await held.promise;
      return { kind: "audio" };
    };
    const started = await speaking.rpc.call("run.audio", audioRequest({ prompt, params }));
    const shape = (await roomShapes(speaking)).find((each) => each.id === started.placeholders[0]);
    const stamp = new Date(shape.meta.unframed.run.startedAt).toISOString().replace(/[:.]/g, "-");
    return { started, stamp, release: held.release };
  };

  it.each([
    ["the spoken text's slug, mp3", "A Line, at Dawn!", {}, "a-line-at-dawn.mp3"],
    ["audio when the text has no slug", "¡¿!", {}, "audio.mp3"],
    ["wav for a wav format", "Wave", { output_format: "wav_16000" }, "wave.wav"],
  ] as const)("names the file <stamp>-audio-<slug> with %s", async (_case, prompt, params, rest) => {
    const { started, stamp, release } = await heldRun(prompt, params);
    release();
    await finished(speaking.events, started.runId);
    const shape = (await roomShapes(speaking)).find((each) => each.id === started.placeholders[0]);
    expect(shape.props.file).toBe(`${stamp}-audio-${rest}`);
  });

  it("never overwrites: a taken name retries as -2 up to -5, then fails", async () => {
    const taken = await heldRun("taken");
    const base = `${taken.stamp}-audio-taken`;
    for (const name of [`${base}.mp3`, `${base}-2.json`]) await writeFile(join(boardFolder(speaking), name), "x", { flag: "wx" });
    taken.release();
    await finished(speaking.events, taken.started.runId);
    expect((await roomShapes(speaking)).find((each) => each.id === taken.started.placeholders[0]).props.file).toBe(`${base}-3.mp3`);
    expect(await readFile(join(boardFolder(speaking), `${base}.mp3`), "utf8")).toBe("x");

    const crowded = await heldRun("crowded");
    const crowdedBase = `${crowded.stamp}-audio-crowded`;
    for (const suffix of ["", "-2", "-3", "-4", "-5"]) await writeFile(join(boardFolder(speaking), `${crowdedBase}${suffix}.mp3`), "x", { flag: "wx" });
    crowded.release();
    const done = await finished(speaking.events, crowded.started.runId);
    expect(done.errors[0]).toMatch(/^Generated the audio but failed to write it: /);
  });

  it.each([
    ["a 401", { kind: "status", status: 401, body: { detail: { status: "invalid_api_key", message: "Invalid API key" } } }, "ElevenLabs refused the key: Invalid API key. Check the key in Settings."],
    [
      "a 402",
      { kind: "status", status: 402, body: { detail: { message: "Not enough credits" } } },
      "ElevenLabs has no credits left for this: either the account's quota for this period is used up, or this key has hit its own credit limit. Check your plan and the key's limit at elevenlabs.io. (Not enough credits)",
    ],
    [
      "quota_exceeded on a 429",
      { kind: "status", status: 429, body: { detail: { code: "quota_exceeded", message: "Quota used" } } },
      "ElevenLabs has no credits left for this: either the account's quota for this period is used up, or this key has hit its own credit limit. Check your plan and the key's limit at elevenlabs.io. (Quota used)",
    ],
    [
      "insufficient_credits on a 400",
      { kind: "status", status: 400, body: { detail: { status: "insufficient_credits", message: "Short" } } },
      "ElevenLabs has no credits left for this: either the account's quota for this period is used up, or this key has hit its own credit limit. Check your plan and the key's limit at elevenlabs.io. (Short)",
    ],
    ["another status", { kind: "status", status: 422, body: { detail: "Voice not found" } }, "ElevenLabs (422): Voice not found"],
    ["an empty body", { kind: "empty" }, "ElevenLabs returned no audio."],
  ] as const)("reports %s and deletes the placeholder", async (_case, answer, message) => {
    speaking.script.speech = () => answer;
    const started = await speaking.rpc.call("run.audio", audioRequest({ prompt: "Failing line" }));
    const done = await finished(speaking.events, started.runId);
    expect(done).toEqual({ type: "finished", runId: started.runId, succeeded: 0, failed: 1, errors: [message], orphaned: 0 });
    expect((await roomShapes(speaking)).some((shape) => shape.id === started.placeholders[0])).toBe(false);
  });

  it("reports a body lost mid-read", async () => {
    speaking.script.speech = () => ({ kind: "drop" });
    const started = await speaking.rpc.call("run.audio", audioRequest({ prompt: "Dropped" }));
    const done = await finished(speaking.events, started.runId);
    expect(done.errors[0]).toMatch(/^Lost the connection while reading ElevenLabs' answer: .+\. The line may still have been made and charged\. Check your ElevenLabs usage\.$/);
    expect((await roomShapes(speaking)).some((shape) => shape.id === started.placeholders[0])).toBe(false);
  });

  it("reports a write failure", async () => {
    speaking.script.speech = () => ({ kind: "audio" });
    await chmod(boardFolder(speaking), 0o500);
    try {
      const started = await speaking.rpc.call("run.audio", audioRequest({ prompt: "Unwritable" }));
      const done = await finished(speaking.events, started.runId);
      expect(done.errors[0]).toMatch(/^Generated the audio but failed to write it: /);
    } finally {
      await chmod(boardFolder(speaking), 0o700);
    }
  });

  it("does not recreate a placeholder deleted mid-run, and counts it orphaned", async () => {
    const held = gate<void>();
    speaking.script.speech = async () => {
      await held.promise;
      return { kind: "audio" };
    };
    const started = await speaking.rpc.call("run.audio", audioRequest({ prompt: "Orphan" }));
    await speaking.rpc.call("testCanvas.apply", { project: "board", change: { put: [], remove: [started.placeholders[0]!] }, origin: { kind: "server", id: "test" } });
    held.release();
    const done = await finished(speaking.events, started.runId);
    expect(done.orphaned).toBe(1);
    expect((await roomShapes(speaking)).some((shape) => shape.id === started.placeholders[0])).toBe(false);
    expect((await audioFiles(speaking)).some((name) => name.endsWith("-audio-orphan.mp3"))).toBe(true);
  });

  it("fills a placeholder restored after the answer landed, as an undo would", async () => {
    const held = gate<void>();
    speaking.script.speech = async () => {
      await held.promise;
      return { kind: "audio" };
    };
    const started = await speaking.rpc.call("run.audio", audioRequest({ prompt: "Restore me" }));
    const placeholder = (await roomShapes(speaking)).find((shape) => shape.id === started.placeholders[0]);
    await speaking.rpc.call("testCanvas.apply", { project: "board", change: { put: [], remove: [placeholder.id] }, origin: { kind: "server", id: "test" } });
    held.release();
    await finished(speaking.events, started.runId);
    await speaking.rpc.call("testCanvas.apply", { project: "board", change: { put: [placeholder], remove: [] }, origin: { kind: "server", id: "test" } });
    let restored: any;
    for (let tries = 0; tries < 100; tries++) {
      restored = (await roomShapes(speaking)).find((each) => each.id === placeholder.id);
      if (restored && !restored.meta.unframed.run) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(restored.props.file).toMatch(/-audio-restore-me\.mp3$/);
    expect(restored.meta.unframed.result).toMatchObject({ credits: 42, cost: null });
  });

  it("answers the live-run conflict for a rename while it runs", async () => {
    const held = gate<void>();
    speaking.script.speech = async () => {
      await held.promise;
      return { kind: "audio" };
    };
    const started = await speaking.rpc.call("run.audio", audioRequest({ prompt: "Busy" }));
    await expect(speaking.rpc.call("projects.rename", { name: "board", to: "renamed" })).rejects.toMatchObject({ code: "conflict" });
    held.release();
    await finished(speaking.events, started.runId);
  });
});

describe("run.audio without a key", () => {
  it("refuses and writes nothing", async () => {
    const engine = await startEngine({ dotenv: "", env: { UNFRAMED_TEST_CANVAS: "1" }, elevenLabs: true });
    const rpc = await engine.rpc();
    await rpc.call("projects.create", { name: "board" });
    await expect(rpc.call("run.audio", audioRequest())).rejects.toMatchObject({ code: "unavailable", message: "No ElevenLabs key yet. Add one in Settings, under ElevenLabs." });
    expect(engine.elevenLabs!.requests).toHaveLength(0);
  });
});

describe("audio runs with no tab and after a restart", () => {
  it("lands with no client connected", async () => {
    const speaking = await startSpeaking();
    const held = gate<void>();
    speaking.script.speech = async () => {
      await held.promise;
      return { kind: "audio" };
    };
    const tab = await speaking.engine.rpc();
    const started = await tab.call("run.audio", audioRequest({ prompt: "Alone" }));
    await tab.close();
    held.release();
    await finished(speaking.events, started.runId);
    const filled = (await roomShapes(speaking)).find((shape) => shape.id === started.placeholders[0]);
    expect(filled.props.file).toMatch(/-audio-alone\.mp3$/);
  });

  it("clears a stale audio marker when the room opens after a restart", async () => {
    const first = await startSpeaking();
    const dataDir = first.engine.dataDir;
    await first.rpc.call("testCanvas.apply", {
      project: "board",
      change: {
        put: [
          {
            id: "shape:stale-audio",
            typeName: "shape",
            type: "audio",
            x: 0,
            y: 0,
            rotation: 0,
            index: "a5",
            parentId: "page:page",
            isLocked: false,
            opacity: 1,
            props: { w: 320, h: 64, file: "", fileName: "" },
            meta: { ref: "777", unframed: { run: { runId: "run-old", runIndex: 1, startedAt: 1 } } },
          },
        ],
        remove: [],
      },
      origin: { kind: "server", id: "run:run-old" },
    });
    await first.engine.stop("SIGKILL");
    const second = await startEngine({ dataDir, dotenv: `ELEVENLABS_API_KEY=${ELEVENLABS_KEY}\n`, env: { UNFRAMED_TEST_CANVAS: "1" } });
    const records = (await (await second.rpc()).call("testCanvas.read", { project: "board" })).records as any[];
    expect(records.some((record) => record.id === "shape:stale-audio")).toBe(false);
    await second.dispose();
    await rm(dataDir, { recursive: true, force: true });
  });
});

describe("audio recipes across projects", () => {
  it("copies an audio result's sidecar beside the copied file", async () => {
    const speaking = await startSpeaking();
    speaking.script.speech = () => ({ kind: "audio" });
    await speaking.rpc.call("projects.create", { name: "other" });
    const started = await speaking.rpc.call("run.audio", audioRequest({ prompt: "Copy this" }));
    await finished(speaking.events, started.runId);
    const result = (await roomShapes(speaking)).find((shape) => shape.id === started.placeholders[0]);
    const copiedFile = (await speaking.rpc.call("files.copy", { project: "other", file: result.props.file, from: "board" })).file;
    const { sidecar } = await speaking.rpc.call("recipe.copy", { project: "other", from: "board", sidecar: result.meta.unframed.result.sidecar, file: copiedFile });
    expect(sidecar).toBe(copiedFile.replace(/\.mp3$/, ".json"));
    const copied = JSON.parse(await readFile(join(speaking.engine.dataDir, "output", "other", sidecar), "utf8"));
    expect(copied).toMatchObject({ kind: "audio", file: copiedFile, billing: "elevenlabs-credits", recipe: { medium: "audio", params: { voice_id: "olivia01" } } });
  });
});

