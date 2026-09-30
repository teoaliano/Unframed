import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot, startEngine } from "./harness.ts";

describe("UNFRAMED_DATA_DIR", () => {
  it("puts .env, preferences and the default output folder under it, and writes nothing to the install root", async () => {
    const rootBefore = (await readdir(repoRoot)).sort();
    const engine = await startEngine();
    const rpc = await engine.rpc();
    const health = await rpc.call("server.health");
    expect(health.outputDir).toBe(join(engine.dataDir, "output"));

    await rpc.call("settings.update", { textModel: "a/b" });
    await rpc.call("projects.list").catch(() => {});
    await rpc.call("preferences.set", { key: "probe", value: 1 }).catch(() => {});

    expect(await readFile(join(engine.dataDir, ".env"), "utf8")).toBe("OPENROUTER_TEXT_MODEL=a/b\n");
    expect((await readdir(repoRoot)).sort()).toEqual(rootBefore);
    await expect(stat(join(repoRoot, ".env"))).rejects.toThrow();
    await expect(stat(join(repoRoot, "output"))).rejects.toThrow();
    await expect(stat(join(repoRoot, "preferences.json"))).rejects.toThrow();
  });
});
