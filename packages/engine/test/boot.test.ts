import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startEngine } from "./harness.ts";

describe("engine boot", () => {
  it("prints the banner with where it listens, the models, the key, the preview and the output folder", async () => {
    const engine = await startEngine();
    const lines = engine.stdout().split("\n");
    const start = lines.findIndex((line) => line.startsWith("  Unframed server  →  http://localhost:"));
    expect(start).toBeGreaterThan(0);
    expect(lines[start - 1]).toBe("");
    expect(lines.slice(start, start + 8)).toEqual([
      `  Unframed server  →  http://localhost:${engine.port}`,
      "  image:    openai/gpt-image-2",
      "  text:     google/gemini-3.5-flash-lite",
      "  video:    bytedance/seedance-2.0",
      "  api key:  MISSING: add one in the app (settings icon, top right)",
      `  preview:  http://127.0.0.1:${engine.previewPort}`,
      `  output:   ${join(engine.dataDir, "output")}`,
      "",
    ]);
  });

  it("says the key is loaded when one is set", async () => {
    const engine = await startEngine({ dotenv: "OPENROUTER_API_KEY=sk-or-v1-abcdefgh1234\n" });
    expect(engine.stdout()).toContain("\n  api key:  loaded\n");
    expect(engine.stdout()).not.toContain("abcdefgh1234");
  });
});
