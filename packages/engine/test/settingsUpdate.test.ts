import { chmod, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir, startEngine } from "./harness.ts";

const mode = async (path: string) => (await stat(path)).mode & 0o777;

describe("settings.update", () => {
  it("saves a model change to .env and applies it without a restart", async () => {
    const engine = await startEngine();
    const rpc = await engine.rpc();
    const answer = await rpc.call("settings.update", { textModel: "anthropic/claude-sonnet-5" });
    expect(answer.textModel).toBe("anthropic/claude-sonnet-5");
    expect((await rpc.call("server.health")).textModel).toBe("anthropic/claude-sonnet-5");
    expect(await readFile(join(engine.dataDir, ".env"), "utf8")).toBe("OPENROUTER_TEXT_MODEL=anthropic/claude-sonnet-5\n");
  });

  it("leaves no temp file behind and writes the file readable only by its owner", async () => {
    const engine = await startEngine();
    const rpc = await engine.rpc();
    await rpc.call("settings.update", { key: "sk-or-v1-abcdefgh12345678" });
    await rpc.call("settings.update", { videoModel: "google/veo-4" });
    const entries = await readdir(engine.dataDir);
    expect(entries.filter((name) => name.endsWith(".tmp"))).toEqual([]);
    expect(await mode(join(engine.dataDir, ".env"))).toBe(0o600);
  });

  it("tightens an older 0644 file to 0600 on the next write, keeping its other lines", async () => {
    const dataDir = await makeTempDir();
    const envPath = join(dataDir, ".env");
    await writeFile(envPath, "# mine\nOPENROUTER_API_KEY=sk-or-v1-keepthiskey99\n");
    await chmod(envPath, 0o644);
    const engine = await startEngine({ dataDir });
    await (await engine.rpc()).call("settings.update", { imageModel: "openai/gpt-image-2" });
    expect(await mode(envPath)).toBe(0o600);
    expect(await readFile(envPath, "utf8")).toBe(
      "# mine\nOPENROUTER_API_KEY=sk-or-v1-keepthiskey99\nOPENROUTER_IMAGE_MODEL=openai/gpt-image-2\n",
    );
  });

  it("keeps a saved setting across a restart", async () => {
    const dataDir = await makeTempDir();
    const first = await startEngine({ dataDir });
    await (await first.rpc()).call("settings.update", { outputDir: "./kept" });
    await first.stop();
    const second = await startEngine({ dataDir });
    expect((await (await second.rpc()).call("server.health")).outputDir).toBe(join(dataDir, "kept"));
  });
});
