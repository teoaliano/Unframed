import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir, repoRoot, startEngine } from "./harness.ts";

describe("hosting and test variables come from the process environment only", () => {
  it("ignores UNFRAMED_DATA_DIR, UNFRAMED_CLIENT_DIST and UNFRAMED_TEST_OPENROUTER_ORIGIN lines in .env", async () => {
    const elsewhere = await makeTempDir("unframed-elsewhere-");
    const clientDist = await makeTempDir("unframed-client-");
    await mkdir(join(clientDist, "assets"), { recursive: true });
    await writeFile(join(clientDist, "index.html"), "<!doctype html><title>Unframed</title>");
    const engine = await startEngine({
      dotenv: [
        `UNFRAMED_DATA_DIR=${elsewhere}`,
        `UNFRAMED_CLIENT_DIST=${clientDist}`,
        "UNFRAMED_TEST_OPENROUTER_ORIGIN=https://openrouter.evil.example",
        "",
      ].join("\n"),
    });
    const health = await (await engine.rpc()).call("server.health");
    expect(health.outputDir).toBe(join(engine.dataDir, "output"));
    expect((await engine.request("/")).status).toBe(404);
    expect(engine.stdout()).not.toContain("test origin ignored");

    await (await engine.rpc()).call("settings.update", { textModel: "a/b" });
    expect(await readFile(join(engine.dataDir, ".env"), "utf8")).toContain(`UNFRAMED_DATA_DIR=${elsewhere}\n`);
    await expect(readFile(join(elsewhere, ".env"), "utf8")).rejects.toThrow();
  });

  it("ships a .env.example with exactly the documented lines under a one-line comment", async () => {
    const text = await readFile(join(repoRoot, ".env.example"), "utf8");
    const lines = text.split("\n").filter((line) => line !== "");
    expect(lines[0]).toMatch(/^# .+/);
    expect(lines.slice(1)).toEqual([
      "OPENROUTER_API_KEY=",
      "OPENROUTER_IMAGE_MODEL=openai/gpt-image-2",
      "OPENROUTER_TEXT_MODEL=google/gemini-3.5-flash-lite",
      "OPENROUTER_VIDEO_MODEL=bytedance/seedance-2.0",
      "OUTPUT_DIR=./output",
      "PORT=8787",
    ]);
    expect(text).not.toMatch(/UNFRAMED_/);
  });
});
