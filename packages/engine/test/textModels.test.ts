import { describe, expect, it } from "vitest";
import { startEngine } from "./harness.ts";
import { listedModel, textCatalogue } from "./textStub.ts";

const DEFAULT = "google/gemini-3.5-flash-lite";

describe("models.list for text", () => {
  it("keeps only models that read images and write text, mapped without params, sorted, the default appended", async () => {
    const engine = await startEngine({
      dotenv: "OPENROUTER_TEXT_MODEL=zeta/default-text\n",
      stub: textCatalogue({
        data: [
          listedModel("openai/gpt-5", ["text", "image", "file"], ["text"], { name: "OpenAI: GPT-5", created: 1_760_000_000, supported_parameters: ["tools"] }),
          listedModel("meta/llama-text", ["text"], ["text"], { name: "Llama" }),
          listedModel("google/image-maker", ["text", "image"], ["image"], { name: "Image maker" }),
          listedModel("anthropic/claude-vision", ["image", "text"], ["text", "image"]),
          { id: "broken/no-architecture", name: "Broken" },
        ],
      }),
    });
    const rpc = await engine.rpc();
    expect(await rpc.call("models.list", { medium: "text" })).toEqual({
      models: [
        { id: "anthropic/claude-vision", name: "anthropic/claude-vision", created: null },
        { id: "openai/gpt-5", name: "OpenAI: GPT-5", created: 1_760_000_000 },
        { id: "zeta/default-text", name: "zeta/default-text" },
      ],
      default: "zeta/default-text",
    });
    expect(engine.stub!.requests.map((request) => `${request.method} ${request.url}`)).toEqual(["GET /api/v1/models"]);
  });

  it("keeps the default model when the listing has it", async () => {
    const engine = await startEngine({ stub: textCatalogue({ data: [listedModel(DEFAULT, ["image"], ["text"], { name: "Gemini", created: 7 })] }) });
    expect(await (await engine.rpc()).call("models.list", { medium: "text" })).toEqual({ models: [{ id: DEFAULT, name: "Gemini", created: 7 }], default: DEFAULT });
  });

  it.each([
    ["an error status", textCatalogue({ status: 500 })],
    ["no route at all", undefined],
  ])("answers only the default model on %s, never an error", async (_case, stub) => {
    const engine = await startEngine(stub === undefined ? {} : { stub });
    expect(await (await engine.rpc()).call("models.list", { medium: "text" })).toEqual({ models: [{ id: DEFAULT, name: DEFAULT }], default: DEFAULT });
  });
});
