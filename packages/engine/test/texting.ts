/** Engine-seam helpers for text calls: the generation engine of `generation.ts` with a scripted chat endpoint too. */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { startGenerating, type Generating } from "./generation.ts";
import type { EngineOptions, StubHandler } from "./harness.ts";
import { chatCompletions, type ChatAnswer, type ChatRequest } from "./textStub.ts";

export interface Texting extends Generating {
  /** Every request the chat endpoint received, in order. */
  readonly chat: ChatRequest[];
  /** Replaces how the chat endpoint answers. */
  answerText(script: (request: ChatRequest) => ChatAnswer | Promise<ChatAnswer>): void;
}

/** An engine with a key, a project named `board`, a live `run.subscribe`, and scripted image and chat endpoints. */
export const startTexting = async (options: EngineOptions & { extra?: StubHandler[] } = {}): Promise<Texting> => {
  let script: (request: ChatRequest) => ChatAnswer | Promise<ChatAnswer> = () => ({ kind: "text", text: "a fox on a cliff", cost: 0.0012 });
  const chat = chatCompletions((request) => script(request));
  const generating = await startGenerating({ ...options, extra: [chat.handler, ...(options.extra ?? [])] });
  return {
    ...generating,
    chat: chat.requests,
    answerText: (next) => {
      script = next;
    },
  };
};

export const folderOf = (generating: Generating) => join(generating.engine.dataDir, "output", "board");

/** The project's text sidecars, by name. */
export const textSidecars = async (generating: Generating): Promise<string[]> =>
  (await readdir(folderOf(generating))).filter((name) => /-text-.*\.json$/.test(name)).sort();

export const readSidecar = async (generating: Generating, name: string) => JSON.parse(await readFile(join(folderOf(generating), name), "utf8"));

export const upload = async (generating: Generating, name: string, bytes: Buffer, mime: string): Promise<string> =>
  (await generating.engine.request(`/api/projects/board/files?name=${encodeURIComponent(name)}`, { method: "POST", body: bytes, headers: { "content-type": mime } })).json()
    .file as string;

export const roomShapes = async (generating: Generating): Promise<any[]> =>
  ((await generating.rpc.call("testCanvas.read", { project: "board" })).records as any[]).filter((record) => record.typeName === "shape");
