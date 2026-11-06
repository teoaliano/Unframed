import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { TLRecord } from "@tldraw/tlschema";
import { NO_PRICE_REFUSAL, VERCEL_NO_KEY_MESSAGE } from "@unframed/domain";
import { describe, expect, it } from "vitest";
import { PROJECT } from "./agent.ts";
import { promptShape } from "./canvasRecords.ts";
import { startEngine } from "./harness.ts";
import { nodeShape, wireShape } from "./nodeRecords.ts";
import { outsideLink } from "./outsideCalls.ts";
import { vercelRoutes, VERCEL_KEY } from "./vercelStub.ts";

const start = async (dotenv = `AI_GATEWAY_API_KEY=${VERCEL_KEY}\n`) => {
  const vercel = vercelRoutes();
  const engine = await startEngine({ dotenv, env: { UNFRAMED_TEST_CANVAS: "1", UNFRAMED_TEST_VERCEL_LOOKUP_MS: "20" }, vercel: vercel.handler });
  const rpc = await engine.rpc();
  await rpc.call("projects.create", { name: PROJECT }).catch(() => undefined);
  const records = async (): Promise<any[]> => (await rpc.call("testCanvas.read", { project: PROJECT })).records as any[];
  const seed = (put: TLRecord[]) => rpc.call("testCanvas.apply", { project: PROJECT, change: { put, remove: [] }, origin: { kind: "system", id: "test-seed" } });
  const waitNode = async (id: string, check: (node: any) => boolean) => {
    const started = Date.now();
    for (;;) {
      const node = (await records()).find((record) => record.id === `shape:${id}`);
      if (node && check(node)) return node;
      if (Date.now() - started > 10_000) throw new Error(`Timed out waiting for node ${id}: ${JSON.stringify(node?.props)}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };
  const sidecarOf = async (file: string) => JSON.parse(await readFile(join(engine.dataDir, "output", PROJECT, file.replace(/\.[a-z]+$/, ".json")), "utf8"));
  return { engine, rpc, vercel, records, seed, waitNode, sidecarOf };
};

const landed = (node: any) => node.props.run === undefined && node.props.versions.length > 0 && node.props.versions.every((version: any) => version.status === "done");

describe("a node run through the Vercel AI Gateway", () => {
  it("runs an image node on Vercel's default model, and its version's sidecar and recipe carry the provider and the list price", async () => {
    const started = await start();
    try {
      await started.seed([promptShape("p", "101", "a lone red fox"), nodeShape("n", "102", { medium: "image", provider: "vercel" }), wireShape("w", "p", "n", "prompt")]);
      await started.rpc.call("node.run", { project: PROJECT, shapeId: "shape:n" });
      const node = await started.waitNode("n", (each) => landed(each) && each.props.versions[0].error === undefined);
      const version = node.props.versions[0];
      expect(version.file).toMatch(/\.png$/);
      const generation = started.vercel.calls.find((call) => call.path === "/v1/images/generations")!;
      expect(generation.body).toMatchObject({ model: "bfl/flux-kontext-pro", prompt: "a lone red fox" });
      expect(generation.headers.authorization).toBe(`Bearer ${VERCEL_KEY}`);
      const sidecar = await (async () => {
        for (;;) {
          const read = await started.sidecarOf(version.file);
          if (read.costBasis !== undefined) return read;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      })();
      expect(sidecar).toMatchObject({ provider: "vercel", cost: 0.04, costBasis: "list-price", node: { shapeId: "shape:n" }, recipe: { provider: "vercel", model: "bfl/flux-kontext-pro", node: { shapeId: "shape:n" } } });
    } finally {
      await started.engine.dispose();
    }
  });

  it("runs a text node through Vercel's chat completions", async () => {
    const started = await start();
    try {
      await started.seed([promptShape("p", "101", "name a fox"), nodeShape("n", "102", { medium: "text", provider: "vercel" }), wireShape("w", "p", "n", "prompt")]);
      await started.rpc.call("node.run", { project: PROJECT, shapeId: "shape:n" });
      const node = await started.waitNode("n", landed);
      expect(node.props.versions[0].text).toBe("A gateway answer.");
      expect(started.vercel.calls.find((call) => call.path === "/v1/chat/completions")!.body).toMatchObject({ model: "google/gemini-3.5-flash-lite" });
    } finally {
      await started.engine.dispose();
    }
  });

  it("is refused before any call when there is no Vercel key, and writes no version", async () => {
    const started = await start("OPENROUTER_API_KEY=sk-or-v1-test-key-0000abcd\n");
    try {
      await started.seed([promptShape("p", "101", "a lone red fox"), nodeShape("n", "102", { medium: "image", provider: "vercel" }), wireShape("w", "p", "n", "prompt")]);
      await expect(started.rpc.call("node.run", { project: PROJECT, shapeId: "shape:n" })).rejects.toMatchObject({ message: VERCEL_NO_KEY_MESSAGE });
      const node = (await started.records()).find((record) => record.id === "shape:n");
      expect(node.props.versions).toEqual([]);
      expect(started.vercel.calls.filter((call) => call.path !== "/v1/models")).toEqual([]);
    } finally {
      await started.engine.dispose();
    }
  });
});

describe("an agent's node_run through Vercel", () => {
  const ops = (medium: "image" | "text", model?: string) => [
    { type: "create", id: "new:fox", kind: "prompt", x: 0, y: 0, props: { text: "a red fox" } },
    { type: "create", id: "new:n", kind: "node", x: 400, y: 0, props: { medium, provider: "vercel", ...(model === undefined ? {} : { model }) } },
    { type: "create", id: "new:w", kind: "wire", x: 0, y: 0, props: { from: "new:fox", to: "new:n", role: "prompt" } },
  ];

  it("estimates an image step at the model's flat list price, and reports the node's provider", async () => {
    const started = await start();
    try {
      const link = await outsideLink({ ...started, requests: [], answer: () => undefined } as never, "Limited", { usd: 1, period: "month" });
      const session = await link.open();
      const made = await link.call(session, "canvas_write", { project: PROJECT, ops: ops("image", "bfl/flux-2-pro") });
      const node = made.value.ids["new:n"];
      const read = await link.call(session, "canvas_read", { project: PROJECT });
      expect(read.value.shapes.find((shape: any) => shape.id === node)).toMatchObject({ kind: "node", provider: "vercel", model: "bfl/flux-2-pro" });
      const dry = await link.call(session, "node_run", { project: PROJECT, ids: [node], dryRun: true });
      expect(dry.value).toMatchObject({ estimate: "est. ~$0.030", steps: [{ estimate: "est. ~$0.030" }] });
    } finally {
      await started.engine.dispose();
    }
  });

  it.each([
    ["a text step", "text", undefined],
    ["an image model with no flat price", "image", "openai/gpt-image-2"],
  ] as const)("refuses %s under a spend limit, since its cost has no exact estimate, and calls nothing", async (_case, medium, model) => {
    const started = await start();
    try {
      const link = await outsideLink({ ...started, requests: [], answer: () => undefined } as never, "Limited", { usd: 1, period: "month" });
      const session = await link.open();
      const made = await link.call(session, "canvas_write", { project: PROJECT, ops: ops(medium, model) });
      const answer = await link.call(session, "node_run", { project: PROJECT, ids: [made.value.ids["new:n"]] });
      expect(answer.isError).toBe(true);
      expect(answer.value.error).toContain(NO_PRICE_REFUSAL);
      expect(started.vercel.calls.filter((call) => call.path !== "/v1/models")).toEqual([]);
    } finally {
      await started.engine.dispose();
    }
  });
});
