/**
 * A scripted ElevenLabs for the engine seam (spec 15): the models list, the voices search,
 * text to speech and the subscription, each answering whatever a test scripts.
 */
import type http from "node:http";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RunEvent } from "@unframed/contracts";
import { startEngine, type EngineOptions, type StubHandler, type TestEngine } from "./harness.ts";
import { json } from "./openRouterStub.ts";
import type { Subscription, TestRpcClient } from "./rpcClient.ts";

export const ELEVENLABS_KEY = "sk_0123456789abcdef0123456789abcdef";
export const OPENROUTER_KEY = "sk-or-v1-test-key-0000abcd";

export type SpeechAnswer =
  | { readonly kind: "audio"; readonly bytes?: Buffer; readonly headers?: Record<string, string> }
  | { readonly kind: "status"; readonly status: number; readonly body: unknown }
  | { readonly kind: "empty" }
  | { readonly kind: "drop" }
  | { readonly kind: "hang" };

export interface SpeechRequest {
  readonly voiceId: string;
  readonly query: Record<string, string>;
  readonly body: any;
  readonly headers: http.IncomingHttpHeaders;
}

export const audioBytes = (seconds = 1): Buffer => {
  const rate = 8000;
  const samples = rate * seconds;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++) buffer.writeInt16LE(Math.round(Math.sin(index / 6) * 2000), 44 + index * 2);
  return buffer;
};

export const elevenModel = (id: string, extra: Record<string, unknown> = {}) => ({
  model_id: id,
  name: id,
  can_do_text_to_speech: true,
  can_use_style: false,
  can_use_speaker_boost: false,
  languages: [],
  ...extra,
});

export const elevenVoice = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  voice_id: id,
  name,
  category: "premade",
  labels: { accent: "british", gender: "female" },
  preview_url: null,
  ...extra,
});

export interface ElevenLabsScript {
  models?: unknown;
  modelsStatus?: number;
  voices?: (query: URLSearchParams) => { status: number; body: unknown };
  subscription?: { status: number; body?: unknown };
  speech?: (request: SpeechRequest) => SpeechAnswer | Promise<SpeechAnswer>;
}

/** The stub's handler and every speech request it received. */
export const elevenLabsRoutes = (script: ElevenLabsScript) => {
  const speech: SpeechRequest[] = [];
  const handler: StubHandler = (req, body, res) => {
    const url = new URL(req.url ?? "/", "http://stub");
    if (req.method === "GET" && url.pathname === "/v1/models") {
      json(res, script.modelsStatus ?? 200, script.models ?? [elevenModel("eleven_v4"), elevenModel("eleven_multilingual_v2", { can_use_style: true })]);
      return true;
    }
    if (req.method === "GET" && url.pathname === "/v2/voices") {
      const answer = script.voices?.(url.searchParams) ?? { status: 200, body: { voices: [elevenVoice("olivia01", "Olivia")], has_more: false, next_page_token: null } };
      json(res, answer.status, answer.body);
      return true;
    }
    if (req.method === "GET" && url.pathname === "/v1/user/subscription") {
      const answer = script.subscription ?? { status: 200, body: { tier: "creator", character_count: 100, character_limit: 1000, next_character_count_reset_unix: 1_800_000_000 } };
      json(res, answer.status, answer.body ?? {});
      return true;
    }
    const match = /^\/v1\/text-to-speech\/([^/]+)$/.exec(url.pathname);
    if (req.method === "POST" && match) {
      const request: SpeechRequest = {
        voiceId: decodeURIComponent(match[1]!),
        query: Object.fromEntries(url.searchParams),
        body: JSON.parse(body),
        headers: req.headers,
      };
      speech.push(request);
      void Promise.resolve<SpeechAnswer>(script.speech?.(request) ?? { kind: "audio" }).then((answer) => {
        switch (answer.kind) {
          case "audio":
            res.writeHead(200, { "content-type": "audio/mpeg", "character-cost": "42", "request-id": "req-1", ...answer.headers });
            res.end(answer.bytes ?? audioBytes());
            return;
          case "status":
            json(res, answer.status, answer.body);
            return;
          case "empty":
            res.writeHead(200, { "content-type": "audio/mpeg" });
            res.end();
            return;
          case "drop":
            res.writeHead(200, { "content-type": "audio/mpeg", "content-length": "100000" });
            res.write(Buffer.alloc(100));
            setTimeout(() => res.destroy(), 20);
            return;
          case "hang":
            return;
        }
      });
      return true;
    }
    return false;
  };
  return { handler, speech };
};

export interface Speaking {
  readonly engine: TestEngine;
  readonly rpc: TestRpcClient;
  readonly events: Subscription<RunEvent>;
  readonly speech: SpeechRequest[];
  readonly script: ElevenLabsScript;
}

/** An engine with both keys (unless `.env` is given), the test canvas, a project `board`, a live `run.subscribe` and a scripted ElevenLabs. */
export const startSpeaking = async (options: EngineOptions & { script?: ElevenLabsScript } = {}): Promise<Speaking> => {
  const script: ElevenLabsScript = options.script ?? {};
  const live = elevenLabsRoutes(script);
  const engine = await startEngine({
    dotenv: `OPENROUTER_API_KEY=${OPENROUTER_KEY}\nELEVENLABS_API_KEY=${ELEVENLABS_KEY}\n`,
    ...options,
    env: { UNFRAMED_TEST_CANVAS: "1", ...options.env },
    elevenLabs: live.handler,
  });
  const rpc = await engine.rpc();
  await rpc.call("projects.create", { name: "board" }).catch(() => undefined);
  const events = rpc.subscribe("run.subscribe", { project: "board" });
  return { engine, rpc, events, speech: live.speech, script };
};

export const boardFolder = (speaking: Speaking): string => join(speaking.engine.dataDir, "output", "board");

export const audioFiles = async (speaking: Speaking): Promise<string[]> => (await readdir(boardFolder(speaking))).filter((name) => /-audio-/.test(name)).sort();

export const readJson = async (speaking: Speaking, name: string) => JSON.parse(await readFile(join(boardFolder(speaking), name), "utf8"));

export const roomShapes = async (speaking: Speaking): Promise<any[]> =>
  ((await speaking.rpc.call("testCanvas.read", { project: "board" })).records as any[]).filter((record) => record.typeName === "shape");
