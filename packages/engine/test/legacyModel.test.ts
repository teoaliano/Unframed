import { describe, expect, it } from "vitest";
import { startEngine } from "./harness.ts";

describe("legacy image model name", () => {
  it("reads OPENROUTER_MODEL as the image model when it is the only one set", async () => {
    const engine = await startEngine({ dotenv: "OPENROUTER_MODEL=google/gemini-3-pro-image\n" });
    expect((await (await engine.rpc()).call("server.health")).imageModel).toBe("google/gemini-3-pro-image");
    expect(engine.stdout()).toContain("  image:    google/gemini-3-pro-image\n");
  });

  it("prefers OPENROUTER_IMAGE_MODEL when both are present", async () => {
    const engine = await startEngine({
      dotenv: "OPENROUTER_MODEL=google/gemini-3-pro-image\nOPENROUTER_IMAGE_MODEL=openai/gpt-image-2\n",
    });
    expect((await (await engine.rpc()).call("server.health")).imageModel).toBe("openai/gpt-image-2");
  });
});
