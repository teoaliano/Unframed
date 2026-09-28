import { describe, expect, it } from "vitest";
import { startEngine } from "./harness.ts";
import { imageCatalogue, imagePricing, routes } from "./openRouterStub.ts";

const DEFAULT = "openai/gpt-image-2";

describe("models.list for image", () => {
  it("maps each upstream entry, sorts by id, and appends the default model when it is missing", async () => {
    const engine = await startEngine({
      dotenv: "OPENROUTER_IMAGE_MODEL=zeta/default-model\n",
      stub: imageCatalogue({
        data: [
          { id: "recraft/v4", name: "Recraft: V4", created: 1_750_000_000, supported_parameters: { quality: { type: "enum", values: ["low"] } } },
          { id: "~google/nano", created: 1_760_000_000 },
          { id: "black-forest-labs/flux", name: "FLUX", supported_parameters: null, extra: "ignored" },
        ],
      }),
    });
    const rpc = await engine.rpc();
    expect(await rpc.call("models.list", { medium: "image" })).toEqual({
      models: [
        { id: "black-forest-labs/flux", name: "FLUX", created: null, params: null },
        { id: "recraft/v4", name: "Recraft: V4", created: 1_750_000_000, params: { quality: { type: "enum", values: ["low"] } } },
        { id: "zeta/default-model", name: "zeta/default-model" },
        { id: "~google/nano", name: "~google/nano", created: 1_760_000_000, params: null },
      ],
      default: "zeta/default-model",
    });
    expect(engine.stub!.requests.map((request) => `${request.method} ${request.url}`)).toEqual(["GET /api/v1/images/models"]);
  });

  it("keeps the default model when the catalogue lists it", async () => {
    const engine = await startEngine({ stub: imageCatalogue({ data: [{ id: DEFAULT, name: "OpenAI: GPT Image 2", created: 5 }] }) });
    const answer = await (await engine.rpc()).call("models.list", { medium: "image" });
    expect(answer).toEqual({ models: [{ id: DEFAULT, name: "OpenAI: GPT Image 2", created: 5, params: null }], default: DEFAULT });
  });

  it.each([
    ["an error status", imageCatalogue({ status: 500 })],
    ["no route at all", undefined],
  ])("answers only the default model on %s, never an error", async (_case, stub) => {
    const engine = await startEngine(stub === undefined ? {} : { stub });
    expect(await (await engine.rpc()).call("models.list", { medium: "image" })).toEqual({ models: [{ id: DEFAULT, name: DEFAULT }], default: DEFAULT });
  });

  it("answers only the default model when OpenRouter cannot be reached", async () => {
    const engine = await startEngine({ env: { UNFRAMED_TEST_OPENROUTER_ORIGIN: "http://127.0.0.1:9" } });
    expect(await (await engine.rpc()).call("models.list", { medium: "image" })).toEqual({ models: [{ id: DEFAULT, name: DEFAULT }], default: DEFAULT });
  });
});

describe("models.imagePricing", () => {
  const sku = { unit: "image", billable: "output_image", variant: "high", cost_usd: 0.17 };
  const pricing = imagePricing({
    "openai/gpt-image-2": { data: { endpoints: [{ provider: "OpenAI", pricing: [sku, { unit: "image", billable: "input_image", cost_usd: "0.01" }] }, { provider: "Azure" }] } },
    "~vendor/model.v2": { data: { endpoints: [{ pricing: [{ unit: "token", billable: "output_image", cost_usd: 0.00001 }] }] } },
    "down/model": 503,
  });

  it("answers one SKU list per endpoint, an endpoint without pricing as an empty list", async () => {
    const engine = await startEngine({ stub: routes(pricing) });
    const rpc = await engine.rpc();
    expect(await rpc.call("models.imagePricing", { id: "openai/gpt-image-2" })).toEqual({
      endpoints: [[sku, { unit: "image", billable: "input_image", cost_usd: 0.01 }], []],
    });
    expect(await rpc.call("models.imagePricing", { id: "~vendor/model.v2" })).toEqual({
      endpoints: [[{ unit: "token", billable: "output_image", cost_usd: 0.00001 }]],
    });
    expect(engine.stub!.requests.map((request) => request.url)).toEqual([
      "/api/v1/images/models/openai/gpt-image-2/endpoints",
      "/api/v1/images/models/~vendor/model.v2/endpoints",
    ]);
  });

  it("answers no endpoints on any upstream failure", async () => {
    const engine = await startEngine({ stub: routes(pricing) });
    const rpc = await engine.rpc();
    expect(await rpc.call("models.imagePricing", { id: "down/model" })).toEqual({ endpoints: [] });
    expect(await rpc.call("models.imagePricing", { id: "missing/model" })).toEqual({ endpoints: [] });
  });

  it.each(["../../api/v1/keys", "openai/../x", "openai", "a/b/c", "a b/c", "openai/gpt?x=1", "..a/b"])("refuses %s as not a model slug and calls nothing", async (id) => {
    const engine = await startEngine({ stub: routes(pricing) });
    await expect((await engine.rpc()).call("models.imagePricing", { id })).rejects.toMatchObject({ code: "bad_request", message: "Not a model slug." });
    expect(engine.stub!.requests).toEqual([]);
  });
});
