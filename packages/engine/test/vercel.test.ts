import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pngBytes } from "../../web/test/images.ts";
import { NO_PRICE_REFUSAL } from "@unframed/domain";
import { gate } from "./openRouterStub.ts";
import { finished, runRequest, until } from "./generation.ts";
import { vercelRoutes, VERCEL_KEY, type VercelScript } from "./vercelStub.ts";
import { startEngine } from "./harness.ts";
import { chatsIn, outsideLink } from "./outsideCalls.ts";
import { PROJECT } from "./agent.ts";

const OPENROUTER_KEY = "sk-or-v1-test-key-0000abcd";

const start = async (options: { script?: VercelScript; dotenv?: string } = {}) => {
  const vercel = vercelRoutes(options.script);
  const engine = await startEngine({
    dotenv: options.dotenv ?? `AI_GATEWAY_API_KEY=${VERCEL_KEY}\n`,
    env: { UNFRAMED_TEST_CANVAS: "1", UNFRAMED_TEST_VERCEL_LOOKUP_MS: "20" },
    vercel: vercel.handler,
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
  return { engine, rpc, events, vercel, folder, sidecars, shapes };
};

const paths = (calls: ReadonlyArray<{ path: string }>) => calls.map((call) => call.path);

describe("the Vercel AI Gateway settings", () => {
  it("reads the key and the two models, shows only the hint, writes and refuses with their sentences", async () => {
    const { engine, rpc } = await start();
    try {
      const settings = await rpc.call("settings.get");
      expect(settings).toMatchObject({ hasKey: false, hasVercelKey: true, vercelKeyHint: "wxyz", vercelImageModel: "bfl/flux-kontext-pro", vercelTextModel: "google/gemini-3.5-flash-lite" });
      expect(JSON.stringify(settings)).not.toContain(VERCEL_KEY);
      expect(JSON.stringify(await rpc.call("server.health"))).not.toContain(VERCEL_KEY);
      const next = await rpc.call("settings.update", { vercelImageModel: "bfl/flux-2-pro", vercelKey: " vck_another0000key9876 " });
      expect(next).toMatchObject({ vercelImageModel: "bfl/flux-2-pro", vercelKeyHint: "9876" });
      expect(await readFile(join(engine.dataDir, ".env"), "utf8")).toContain("AI_GATEWAY_API_KEY=vck_another0000key9876\n");
      await expect(rpc.call("settings.update", { vercelKey: "not a key" })).rejects.toMatchObject({
        code: "bad_request",
        message: "That does not look like a Vercel AI Gateway key.",
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
    const { engine, rpc, vercel } = await start({ dotenv: "" });
    try {
      expect(await rpc.call("vercel.status")).toEqual({ hasKey: false });
      expect(vercel.calls).toEqual([]);
    } finally {
      await engine.dispose();
    }
  });

  it.each([
    ["credits", { status: 200, body: { balance: "95.50", total_used: "4.50" } }, { hasKey: true, balance: 95.5, totalUsed: 4.5 }],
    ["revoked", { status: 401, body: { error: { message: "Invalid key" } } }, { hasKey: true, revoked: true }],
  ] as const)("%s", async (_case, answer, status) => {
    const { engine, rpc, vercel } = await start({ script: { credits: () => answer } });
    try {
      expect(await rpc.call("vercel.status")).toEqual(status);
      expect(vercel.calls[0]!.headers.authorization).toBe(`Bearer ${VERCEL_KEY}`);
    } finally {
      await engine.dispose();
    }
  });

  it("fails upstream on a 2xx body without the two amounts", async () => {
    const { engine, rpc } = await start({ script: { credits: () => ({ status: 200, body: { balance: "plenty" } }) } });
    try {
      await expect(rpc.call("vercel.status")).rejects.toMatchObject({ code: "upstream", message: "The Vercel AI Gateway answered 200." });
    } finally {
      await engine.dispose();
    }
  });

  it("fails upstream with the network's words when the gateway cannot be reached", async () => {
    const engine = await startEngine({ dotenv: `AI_GATEWAY_API_KEY=${VERCEL_KEY}\n`, env: { UNFRAMED_TEST_VERCEL_ORIGIN: "http://127.0.0.1:9" } });
    try {
      const rpc = await engine.rpc();
      await expect(rpc.call("vercel.status")).rejects.toMatchObject({ code: "upstream", message: expect.stringMatching(/\S/) });
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

describe("Vercel catalogues", () => {
  it("lists image and text models, appends the default, and sends no key", async () => {
    const { engine, rpc, vercel } = await start();
    try {
      const images = await rpc.call("models.list", { medium: "image", provider: "vercel" });
      expect(images.default).toBe("bfl/flux-kontext-pro");
      expect(images.models.map((model) => model.id)).toEqual(["bfl/flux-2-pro", "bfl/flux-kontext-pro", "openai/gpt-image-2"]);
      expect(images.models[0]).toEqual({ id: "bfl/flux-2-pro", name: "FLUX.2 [pro]", created: 1764028800, params: null, pricing: { image: "0.03" } });
      const texts = await rpc.call("models.list", { medium: "text", provider: "vercel" });
      expect(texts.models.map((model) => model.id)).toEqual(["google/gemini-3.5-flash-lite"]);
      expect(vercel.calls[0]!.headers.authorization).toBeUndefined();
    } finally {
      await engine.dispose();
    }
  });

  it("answers only the default without a key, and refuses video and audio", async () => {
    const { engine, rpc, vercel } = await start({ dotenv: "" });
    try {
      expect(await rpc.call("models.list", { medium: "image", provider: "vercel" })).toEqual({ models: [{ id: "bfl/flux-kontext-pro", name: "bfl/flux-kontext-pro" }], default: "bfl/flux-kontext-pro" });
      expect(vercel.calls).toEqual([]);
      for (const [medium, other] of [
        ["video", "Video runs through OpenRouter."],
        ["audio", "Audio runs through ElevenLabs."],
      ] as const) {
        await expect(rpc.call("models.list", { medium, provider: "vercel" })).rejects.toMatchObject({
          code: "bad_request",
          message: `The Vercel AI Gateway serves image and text runs only. ${other}`,
        });
      }
    } finally {
      await engine.dispose();
    }
  });
});

describe("an image run through the vercel", () => {
  it("is refused without a vercel key, even with an OpenRouter key", async () => {
    const { engine, rpc, vercel } = await start({ dotenv: `OPENROUTER_API_KEY=${OPENROUTER_KEY}\n` });
    try {
      await expect(rpc.call("run.image", runRequest({ provider: "vercel" }))).rejects.toMatchObject({
        code: "unavailable",
        message: "No Vercel AI Gateway key yet. Add one in Settings, under Generation.",
      });
      expect(vercel.calls).toEqual([]);
    } finally {
      await engine.dispose();
    }
  });

  it("generates without references, records the provider and the list price", async () => {
    const { engine, rpc, events, vercel, sidecars, shapes } = await start();
    try {
      const started = await rpc.call("run.image", runRequest({ provider: "vercel", model: "bfl/flux-2-pro" }));
      expect((await finished(events, started.runId)).succeeded).toBe(1);
      const generation = vercel.calls.find((call) => call.path === "/v1/images/generations")!;
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
    const { engine, rpc, events, vercel, folder, sidecars } = await start();
    try {
      await writeFile(join(folder, "ref.png"), pngBytes(8, 8));
      const started = await rpc.call(
        "run.image",
        runRequest({ provider: "vercel", model: "openai/gpt-image-2", outputs: [{ prompt: "make it blue", references: [{ kind: "image", file: "ref.png" }] }] }),
      );
      await finished(events, started.runId);
      const edit = vercel.calls.find((call) => call.path === "/v1/images/edits")!;
      expect(edit.body.model).toBe("openai/gpt-image-2");
      expect(edit.body.images).toEqual([{ image_url: expect.stringMatching(/^data:image\/png;base64,/) }]);
      const [sidecar] = await sidecars();
      expect(sidecar.cost).toBeNull();
      expect(sidecar).not.toHaveProperty("costBasis");
    } finally {
      await engine.dispose();
    }
  });

  it("sends no https link: a video link is not an image the edits endpoint takes, so the run generates from the prompt", async () => {
    const { engine, rpc, events, vercel } = await start();
    try {
      const started = await rpc.call(
        "run.image",
        runRequest({ provider: "vercel", outputs: [{ prompt: "a fox", references: [{ kind: "video", url: "https://example.com/clip.mp4" }] }] }),
      );
      expect((await finished(events, started.runId)).succeeded).toBe(1);
      expect(paths(vercel.calls)).not.toContain("/v1/images/edits");
      const generation = vercel.calls.find((call) => call.path === "/v1/images/generations")!;
      expect(JSON.stringify(generation.body)).not.toContain("example.com");
    } finally {
      await engine.dispose();
    }
  });

  it("lands the image before its cost is known, then records the cost on the result and its sidecar", async () => {
    const held = gate<void>();
    const { engine, rpc, events, shapes, sidecars } = await start({
      script: {
        image: () => ({ status: 200, body: { id: "gen_img", data: [{ b64_json: pngBytes(40, 20).toString("base64") }] } }),
        generation: async (id) => {
          await held.promise;
          return { status: 200, body: { data: { id, total_cost: 0.0371 } } };
        },
      },
    });
    try {
      const started = await rpc.call("run.image", runRequest({ provider: "vercel" }));
      let landed: any;
      for (let tries = 0; landed === undefined && tries < 200; tries++) {
        landed = (await shapes()).find((shape) => shape.props.assetId && !shape.meta.unframed.run);
        if (landed === undefined) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(landed.meta.unframed.result.cost).toBeNull();
      expect((await sidecars())[0].cost).toBeNull();
      expect(events.values.some((event) => event.runId === started.runId && event.type === "finished")).toBe(false);
      held.release();
      await finished(events, started.runId);
      const [sidecar] = await sidecars();
      expect(sidecar).toMatchObject({ cost: 0.0371, costBasis: "measured", provider: "vercel" });
      const [shape] = await shapes();
      expect(shape.meta.unframed.result).toMatchObject({ cost: 0.0371 });
      expect(shape.meta.unframed.result.listPrice).toBeUndefined();
      expect(events.values.find((event) => event.type === "output")).toMatchObject({ ok: true, cost: 0.0371 });
    } finally {
      await engine.dispose();
    }
  });

  it.each([
    [{ status: 402, body: { error: { message: "Budget hit", type: "quota_for_entity_exceeded" } } }, "The Vercel AI Gateway refused this because a budget was reached (the team's, this key's or yours). Raise it in the Vercel dashboard under AI Gateway, Budgets. (Budget hit)"],
    [{ status: 401, body: { error: { message: "Invalid key" } } }, "The Vercel AI Gateway refused the key. It may have been revoked. Paste a new one in Settings, under Generation. (Invalid key)"],
    [{ status: 200, body: { data: [] } }, "The Vercel AI Gateway returned no image data."],
    [{ kind: "raw", status: 200, text: "<html>" }, "Unexpected response from the Vercel AI Gateway: <html>"],
  ] as const)("fails with the vercel's sentence (%#)", async (answer, sentence) => {
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

describe("a text call through the vercel", () => {
  it("costs what the generation lookup answers, and sends no usage flag", async () => {
    const { engine, rpc, events, vercel, sidecars, shapes } = await start();
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
      const chat = vercel.calls.find((call) => call.path === "/v1/chat/completions")!;
      expect(chat.body).toEqual({ model: "google/gemini-3.5-flash-lite", messages: [{ role: "user", content: [{ type: "text", text: "describe a fox" }] }] });
      const [sidecar] = await sidecars();
      expect(sidecar).toMatchObject({ kind: "text", cost: 0.00042, provider: "vercel", costBasis: "measured", recipe: { provider: "vercel" } });
      const [shape] = await shapes();
      expect(shape.meta.unframed.result).toMatchObject({ provider: "vercel", cost: 0.00042 });
      expect(shape.meta.unframed.result.listPrice).toBeUndefined();
    } finally {
      await engine.dispose();
    }
  });

  it("text.complete answers as soon as the text arrives, then records the list price after three lookups that find nothing", async () => {
    const held = gate<void>();
    const { engine, rpc, vercel, sidecars } = await start({
      script: {
        generation: async () => {
          await held.promise;
          return { status: 404, body: { error: { message: "Usage event not found" } } };
        },
      },
    });
    try {
      const answer = await rpc.call("text.complete", { project: "board", prompt: "hi", provider: "vercel" });
      expect(answer).toEqual({ text: "A gateway answer.", cost: null });
      const [pending] = await sidecars();
      expect(pending).toMatchObject({ provider: "vercel", cost: null });
      expect(pending).not.toHaveProperty("costBasis");
      held.release();
      let sidecar: any;
      for (let tries = 0; sidecar?.costBasis === undefined && tries < 200; tries++) {
        [sidecar] = await sidecars();
        if (sidecar?.costBasis === undefined) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(sidecar).toMatchObject({ provider: "vercel", costBasis: "list-price" });
      expect(sidecar.cost).toBeCloseTo(0.0003, 10);
      expect(paths(vercel.calls).filter((path) => path === "/v1/generation")).toHaveLength(3);
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

describe("spend limits with Vercel", () => {
  const prompt = (id: string, text: string) => ({ type: "create", id, kind: "prompt", x: 0, y: 0, props: { text } });

  it("refuses a Vercel run with no exact estimate when the connection has a limit, and spends nothing", async () => {
    const started = await start();
    try {
      const link = await outsideLink({ ...started, requests: [], answer: () => undefined } as never, "Limited", { usd: 1, period: "month" });
      const session = await link.open();
      const made = await link.call(session, "canvas_write", { project: PROJECT, ops: [prompt("new:fox", "a red fox")] });
      const fox = made.value.ids["new:fox"];
      for (const call of [
        { medium: "text" },
        { medium: "image", model: "openai/gpt-image-2" },
      ]) {
        const answer = await link.call(session, "generate", { project: PROJECT, sources: [fox], provider: "vercel", ...call });
        expect(answer.isError).toBe(true);
        expect(answer.value).toEqual({ error: NO_PRICE_REFUSAL });
      }
      expect(paths(started.vercel.calls).filter((path) => path !== "/v1/models")).toEqual([]);
    } finally {
      await started.engine.dispose();
    }
  });
});

describe("an agent's generate with a provider", () => {
  const prompt = (id: string, text: string) => ({ type: "create", id, kind: "prompt", x: 0, y: 0, props: { text } });

  it("goes through Vercel when it is the only key, and refuses video through it and a bad provider", async () => {
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

