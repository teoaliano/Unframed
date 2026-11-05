import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pngBytes } from "../../web/test/images.ts";
import { finished, runRequest, until } from "./generation.ts";
import { gatewayRoutes, VERCEL_KEY, type GatewayScript } from "./gatewayStub.ts";
import { startEngine } from "./harness.ts";
import { chatsIn, outsideLink } from "./outsideCalls.ts";
import { PROJECT } from "./agent.ts";

const OPENROUTER_KEY = "sk-or-v1-test-key-0000abcd";

const start = async (options: { script?: GatewayScript; dotenv?: string } = {}) => {
  const gateway = gatewayRoutes(options.script);
  const engine = await startEngine({
    dotenv: options.dotenv ?? `AI_GATEWAY_API_KEY=${VERCEL_KEY}\n`,
    env: { UNFRAMED_TEST_CANVAS: "1", UNFRAMED_TEST_GATEWAY_LOOKUP_MS: "20" },
    vercel: gateway.handler,
  });
  const rpc = await engine.rpc();
  await rpc.call("projects.create", { name: "board" }).catch(() => undefined);
  const events = rpc.subscribe("run.subscribe", { project: "board" });
  const folder = join(engine.dataDir, "output", "board");
  const sidecars = async () => {
    const names = (await readdir(folder)).filter((name) => name.endsWith(".json") && !name.startsWith("unframed")).sort();
    return Promise.all(names.map(async (name) => JSON.parse(await readFile(join(folder, name), "utf8"))));
  };
  const shapes = async () => ((await rpc.call("testCanvas.read", { project: "board" })).records as any[]).filter((record) => record.typeName === "shape" && record.meta?.unframed?.result !== undefined);
  return { engine, rpc, events, gateway, folder, sidecars, shapes };
};

const paths = (calls: ReadonlyArray<{ path: string }>) => calls.map((call) => call.path);

describe("the Vercel AI Gateway settings", () => {
  it("reads the key and the two models, shows only the hint, writes and refuses with their sentences", async () => {
    const { engine, rpc } = await start();
    try {
      const settings = await rpc.call("settings.get");
      expect(settings).toMatchObject({ hasKey: false, hasVercelKey: true, vercelKeyHint: "wxyz", gatewayImageModel: "openai/gpt-image-2", gatewayTextModel: "google/gemini-3.5-flash-lite" });
      expect(JSON.stringify(settings)).not.toContain(VERCEL_KEY);
      expect(JSON.stringify(await rpc.call("server.health"))).not.toContain(VERCEL_KEY);
      const next = await rpc.call("settings.update", { gatewayImageModel: "bfl/flux-2-pro", vercelKey: " vck_another0000key9876 " });
      expect(next).toMatchObject({ gatewayImageModel: "bfl/flux-2-pro", vercelKeyHint: "9876" });
      expect(await readFile(join(engine.dataDir, ".env"), "utf8")).toContain("AI_GATEWAY_API_KEY=vck_another0000key9876\n");
      await expect(rpc.call("settings.update", { vercelKey: "sk-or-v1-abcdefgh" })).rejects.toMatchObject({
        code: "bad_request",
        message: 'That does not look like a Vercel AI Gateway key. Keys start with "vck_".',
      });
    } finally {
      await engine.dispose();
    }
  });

  it("removes the key live and emits the change", async () => {
    const { engine, rpc } = await start({ dotenv: `OPENROUTER_API_KEY=${OPENROUTER_KEY}\nAI_GATEWAY_API_KEY=${VERCEL_KEY}\n` });
    try {
      const removed = await rpc.call("settings.removeVercelKey");
      expect(removed.settings).toMatchObject({ hasVercelKey: false, vercelKeyHint: "", hasKey: true });
      expect(await readFile(join(engine.dataDir, ".env"), "utf8")).not.toContain("AI_GATEWAY_API_KEY");
    } finally {
      await engine.dispose();
    }
  });

  it("ignores a test origin that is not loopback", async () => {
    const engine = await startEngine({ dotenv: "", env: { UNFRAMED_TEST_VERCEL_ORIGIN: "https://ai-gateway.example.com" } });
    try {
      await until(() => (engine.stdout().includes("test origin ignored: https://ai-gateway.example.com is not a loopback origin") ? true : undefined), "the warning");
    } finally {
      await engine.dispose();
    }
  });
});

describe("vercel.status", () => {
  it("makes no call without a key", async () => {
    const { engine, rpc, gateway } = await start({ dotenv: "" });
    try {
      expect(await rpc.call("vercel.status")).toEqual({ hasKey: false });
      expect(gateway.calls).toEqual([]);
    } finally {
      await engine.dispose();
    }
  });

  it.each([
    ["credits", { status: 200, body: { balance: "95.50", total_used: "4.50" } }, { hasKey: true, balance: 95.5, totalUsed: 4.5 }],
    ["revoked", { status: 401, body: { error: { message: "Invalid key" } } }, { hasKey: true, revoked: true }],
  ] as const)("%s", async (_case, answer, status) => {
    const { engine, rpc, gateway } = await start({ script: { credits: () => answer } });
    try {
      expect(await rpc.call("vercel.status")).toEqual(status);
      expect(gateway.calls[0]!.headers.authorization).toBe(`Bearer ${VERCEL_KEY}`);
    } finally {
      await engine.dispose();
    }
  });

  it("fails upstream on another status", async () => {
    const { engine, rpc } = await start({ script: { credits: () => ({ status: 500, body: {} }) } });
    try {
      await expect(rpc.call("vercel.status")).rejects.toMatchObject({ code: "upstream", message: "The Vercel AI Gateway answered 500." });
    } finally {
      await engine.dispose();
    }
  });
});

describe("the gateway catalogues", () => {
  it("lists image and text models, appends the default, and sends no key", async () => {
    const { engine, rpc, gateway } = await start();
    try {
      const images = await rpc.call("models.list", { medium: "image", provider: "vercel" });
      expect(images.default).toBe("openai/gpt-image-2");
      expect(images.models.map((model) => model.id)).toEqual(["bfl/flux-2-pro", "openai/gpt-image-2"]);
      expect(images.models[0]).toEqual({ id: "bfl/flux-2-pro", name: "FLUX.2 [pro]", created: 1764028800, params: null, pricing: { image: "0.03" } });
      const texts = await rpc.call("models.list", { medium: "text", provider: "vercel" });
      expect(texts.models.map((model) => model.id)).toEqual(["google/gemini-3.5-flash-lite"]);
      expect(gateway.calls[0]!.headers.authorization).toBeUndefined();
    } finally {
      await engine.dispose();
    }
  });

  it("answers only the default without a key, and refuses video and audio", async () => {
    const { engine, rpc, gateway } = await start({ dotenv: "" });
    try {
      expect(await rpc.call("models.list", { medium: "image", provider: "vercel" })).toEqual({ models: [{ id: "openai/gpt-image-2", name: "openai/gpt-image-2" }], default: "openai/gpt-image-2" });
      expect(gateway.calls).toEqual([]);
      for (const medium of ["video", "audio"] as const) {
        await expect(rpc.call("models.list", { medium, provider: "vercel" })).rejects.toMatchObject({
          code: "bad_request",
          message: "The Vercel AI Gateway serves image and text runs only. Video runs through OpenRouter.",
        });
      }
    } finally {
      await engine.dispose();
    }
  });
});

describe("an image run through the gateway", () => {
  it("is refused without a gateway key, even with an OpenRouter key", async () => {
    const { engine, rpc, gateway } = await start({ dotenv: `OPENROUTER_API_KEY=${OPENROUTER_KEY}\n` });
    try {
      await expect(rpc.call("run.image", runRequest({ provider: "vercel" }))).rejects.toMatchObject({
        code: "unavailable",
        message: "No Vercel AI Gateway key yet. Add one in Settings, under Generation.",
      });
      expect(gateway.calls).toEqual([]);
    } finally {
      await engine.dispose();
    }
  });

  it("generates without references, records the provider and the list price", async () => {
    const { engine, rpc, events, gateway, sidecars, shapes } = await start();
    try {
      const started = await rpc.call("run.image", runRequest({ provider: "vercel", model: "bfl/flux-2-pro" }));
      expect((await finished(events, started.runId)).succeeded).toBe(1);
      const generation = gateway.calls.find((call) => call.path === "/v1/images/generations")!;
      expect(generation.body).toEqual({ model: "bfl/flux-2-pro", prompt: "a lone red fox", n: 1, response_format: "b64_json" });
      expect(generation.headers.authorization).toBe(`Bearer ${VERCEL_KEY}`);
      const [sidecar] = await sidecars();
      expect(sidecar).toMatchObject({ model: "bfl/flux-2-pro", cost: 0.03, provider: "vercel", costBasis: "list-price", recipe: { provider: "vercel", model: "bfl/flux-2-pro" } });
      const [shape] = await shapes();
      expect(shape.meta.unframed.result).toMatchObject({ provider: "vercel", listPrice: true, cost: 0.03 });
      expect(events.values.find((event) => event.type === "output")).toMatchObject({ ok: true, cost: 0.03 });
    } finally {
      await engine.dispose();
    }
  });

  it("edits with its image references as data URLs, and has no cost when the model has no flat price", async () => {
    const { engine, rpc, events, gateway, folder, sidecars } = await start();
    try {
      await writeFile(join(folder, "ref.png"), pngBytes(8, 8));
      const started = await rpc.call(
        "run.image",
        runRequest({ provider: "vercel", outputs: [{ prompt: "make it blue", references: [{ kind: "image", file: "ref.png" }] }] }),
      );
      await finished(events, started.runId);
      const edit = gateway.calls.find((call) => call.path === "/v1/images/edits")!;
      expect(edit.body.model).toBe("openai/gpt-image-2");
      expect(edit.body.images).toEqual([{ image_url: expect.stringMatching(/^data:image\/png;base64,/) }]);
      const [sidecar] = await sidecars();
      expect(sidecar.cost).toBeNull();
      expect(sidecar).not.toHaveProperty("costBasis");
    } finally {
      await engine.dispose();
    }
  });

  it.each([
    [{ status: 402, body: { error: { message: "Budget hit", type: "quota_for_entity_exceeded" } } }, "The Vercel AI Gateway refused this because a budget was reached (the team's, this key's or yours). Raise it in the Vercel dashboard under AI Gateway, Budgets. (Budget hit)"],
    [{ status: 401, body: { error: { message: "Invalid key" } } }, "The Vercel AI Gateway refused the key. It may have been revoked. Paste a new one in Settings, under Generation. (Invalid key)"],
    [{ status: 200, body: { data: [] } }, "The Vercel AI Gateway returned no image data."],
    [{ kind: "raw", status: 200, text: "<html>" }, "Unexpected response from the Vercel AI Gateway: <html>"],
  ] as const)("fails with the gateway's sentence (%#)", async (answer, sentence) => {
    const { engine, rpc, events, shapes } = await start({ script: { image: () => answer } });
    try {
      const started = await rpc.call("run.image", runRequest({ provider: "vercel" }));
      expect((await finished(events, started.runId)).errors).toEqual([sentence]);
      expect(await shapes()).toEqual([]);
    } finally {
      await engine.dispose();
    }
  });
});

describe("a text call through the gateway", () => {
  it("costs what the generation lookup answers, and sends no usage flag", async () => {
    const { engine, rpc, events, gateway, sidecars, shapes } = await start();
    try {
      const started = await rpc.call("run.text", {
        project: "board",
        provider: "vercel",
        selectionPrompt: "a fox",
        instruction: "",
        prompt: "describe a fox",
        references: [],
        sources: [],
        anchor: { x: 0, y: 0, w: 10, h: 10 },
      });
      await finished(events, started.runId);
      const chat = gateway.calls.find((call) => call.path === "/v1/chat/completions")!;
      expect(chat.body).toEqual({ model: "google/gemini-3.5-flash-lite", messages: [{ role: "user", content: [{ type: "text", text: "describe a fox" }] }] });
      const [sidecar] = await sidecars();
      expect(sidecar).toMatchObject({ kind: "text", cost: 0.00042, provider: "vercel", costBasis: "gateway", recipe: { provider: "vercel" } });
      const [shape] = await shapes();
      expect(shape.meta.unframed.result).toMatchObject({ provider: "vercel", cost: 0.00042 });
      expect(shape.meta.unframed.result.listPrice).toBeUndefined();
    } finally {
      await engine.dispose();
    }
  });

  it("falls back to the list price after three lookups that find nothing", async () => {
    const { engine, rpc, gateway, sidecars } = await start({ script: { generation: () => ({ status: 404, body: { error: { message: "Usage event not found" } } }) } });
    try {
      const answer = await rpc.call("text.complete", { project: "board", prompt: "hi", provider: "vercel" });
      expect(answer.text).toBe("A gateway answer.");
      expect(answer.cost).toBeCloseTo(0.0003, 10);
      expect(paths(gateway.calls).filter((path) => path === "/v1/generation")).toHaveLength(3);
      const [sidecar] = await sidecars();
      expect(sidecar).toMatchObject({ provider: "vercel", costBasis: "list-price" });
    } finally {
      await engine.dispose();
    }
  });

  it("fails text.complete upstream with the rate-limit sentence", async () => {
    const { engine, rpc } = await start({ script: { chat: () => ({ status: 429, body: { error: { message: "Rate limit exceeded", type: "rate_limit_exceeded" } } }) } });
    try {
      await expect(rpc.call("text.complete", { project: "board", prompt: "hi", provider: "vercel" })).rejects.toMatchObject({
        code: "upstream",
        message: "The Vercel AI Gateway is rate limiting this model. Try again in a moment. (Rate limit exceeded)",
      });
    } finally {
      await engine.dispose();
    }
  });
});

describe("an agent's generate with a provider", () => {
  const prompt = (id: string, text: string) => ({ type: "create", id, kind: "prompt", x: 0, y: 0, props: { text } });

  it("goes through the gateway when it is the only key, and refuses video through it and a bad provider", async () => {
    const started = await start();
    try {
      const generating = { ...started, requests: [], answer: () => undefined };
      const link = await outsideLink(generating as never);
      const session = await link.open();
      const made = await link.call(session, "canvas_write", { project: PROJECT, ops: [prompt("new:fox", "a red fox")] });
      const fox = made.value.ids["new:fox"];
      const dry = await link.call(session, "generate", { project: PROJECT, medium: "image", sources: [fox], model: "bfl/flux-2-pro", dryRun: true });
      expect(dry.value).toMatchObject({ dryRun: true, provider: "vercel", estimate: "est. ~$0.030 each" });
      const video = await link.call(session, "generate", { project: PROJECT, medium: "video", sources: [fox], provider: "vercel" });
      expect(video.value).toEqual({ error: "The Vercel AI Gateway serves image and text runs only. Video runs through OpenRouter." });
      const bad = await link.call(session, "generate", { project: PROJECT, medium: "image", sources: [fox], provider: "elsewhere" });
      expect(bad.value).toEqual({ error: 'provider has to be "openrouter" or "vercel".' });
      const run = await link.call(session, "generate", { project: PROJECT, medium: "image", sources: [fox], model: "bfl/flux-2-pro" });
      await finished(started.events, run.value.runId);
      const [chat] = await chatsIn(generating as never);
      const sidecars = await until(async () => {
        const found = await started.sidecars();
        return found.length === 1 ? found : undefined;
      }, "the sidecar");
      expect(sidecars![0]).toMatchObject({ provider: "vercel", cost: 0.03, chat: { id: chat!.id, turn: 1 } });
    } finally {
      await started.engine.dispose();
    }
  });
});

