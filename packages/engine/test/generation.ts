/** Engine-seam helpers for runs: an engine with a key and a scripted image endpoint, and a project to run in. */
import type { ImageRunRequest, RunEvent } from "@unframed/contracts";
import { pngBytes } from "../../web/test/images.ts";
import { startEngine, type EngineOptions, type StubHandler, type TestEngine } from "./harness.ts";
import { imageGeneration, routes, type ImageAnswer, type ImageRequest } from "./openRouterStub.ts";
import type { Subscription, TestRpcClient } from "./rpcClient.ts";

export { pngBytes };

export const KEY = "sk-or-v1-test-key-0000abcd";

export interface Generating {
  readonly engine: TestEngine;
  readonly rpc: TestRpcClient;
  /** Every request the image endpoint received, in order. */
  readonly requests: ImageRequest[];
  /** Replaces how the image endpoint answers. */
  answer(script: (request: ImageRequest) => ImageAnswer | Promise<ImageAnswer>): void;
  readonly events: Subscription<RunEvent>;
}

/** An engine with a key, the test canvas methods on, a project named `board` and a live `run.subscribe`. */
export const startGenerating = async (options: EngineOptions & { extra?: StubHandler[] } = {}): Promise<Generating> => {
  let script: (request: ImageRequest) => ImageAnswer | Promise<ImageAnswer> = () => ({ kind: "image", bytes: pngBytes(64, 32) });
  const images = imageGeneration((request) => script(request));
  const engine = await startEngine({
    dotenv: `OPENROUTER_API_KEY=${KEY}\n`,
    ...options,
    env: { UNFRAMED_TEST_CANVAS: "1", ...options.env },
    stub: routes(images.handler, ...(options.extra ?? [])),
  });
  const rpc = await engine.rpc();
  await rpc.call("projects.create", { name: "board" }).catch(() => undefined);
  const events = rpc.subscribe("run.subscribe", { project: "board" });
  return {
    engine,
    rpc,
    requests: images.requests,
    answer: (next) => {
      script = next;
    },
    events,
  };
};

/** A one-output run request with nothing selected but its prompt. */
export const runRequest = (overrides: Partial<ImageRunRequest> = {}): ImageRunRequest => ({
  project: "board",
  params: {},
  selectionPrompt: "a lone red fox",
  instruction: "",
  outputs: [{ prompt: "a lone red fox", references: [] }],
  sources: [],
  anchor: { x: 1000, y: 0, w: 100, h: 100 },
  ...overrides,
});

const until = async <T>(check: () => T | undefined, what: string, timeoutMs = 10_000): Promise<T> => {
  const started = Date.now();
  for (;;) {
    const value = check();
    if (value !== undefined) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

/** Waits for the `finished` event of `runId`. */
export const finished = (events: Subscription<RunEvent>, runId: string) =>
  until(() => events.values.find((event): event is Extract<RunEvent, { type: "finished" }> => event.type === "finished" && event.runId === runId), `run ${runId} to finish`);

export const eventsOf = (events: Subscription<RunEvent>, runId: string) => events.values.filter((event) => event.runId === runId);

export { until };
