import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { describe, expect, it } from "vitest";
import { makeTempDir, startEngine } from "./harness.ts";

describe("settings.update under load and failure", () => {
  it("lands two concurrent updates for different fields, from two sockets", async () => {
    const engine = await startEngine();
    const [a, b] = await Promise.all([engine.rpc(), engine.rpc()]);
    const rounds = Array.from({ length: 5 }, (_, i) => i);
    await Promise.all(
      rounds.flatMap((i) => [
        a.call("settings.update", { textModel: `text/model-${i}` }),
        b.call("settings.update", { videoModel: `video/model-${i}` }),
      ]),
    );
    const onDisk = parseEnv(await readFile(join(engine.dataDir, ".env"), "utf8"));
    expect(onDisk).toEqual({ OPENROUTER_TEXT_MODEL: "text/model-4", OPENROUTER_VIDEO_MODEL: "video/model-4" });
    const live = await a.call("settings.get");
    expect(live.textModel).toBe("text/model-4");
    expect(live.videoModel).toBe("video/model-4");
  });

  it("stops the save when .env cannot be read, changes nothing, and keeps answering", async () => {
    const engine = await startEngine();
    const rpc = await engine.rpc();
    const before = await rpc.call("settings.get");
    await mkdir(join(engine.dataDir, ".env"));
    const failure = await rpc.call("settings.update", { textModel: "a/b" }).catch((error: unknown) => error);
    expect(failure).toMatchObject({ _tag: "UnframedError", code: "internal" });
    expect((failure as Error).message).toMatch(/^Could not write \.env: .+/);
    expect((await stat(join(engine.dataDir, ".env"))).isDirectory()).toBe(true);
    expect(await rpc.call("settings.get")).toEqual(before);
    expect((await rpc.call("server.health")).ok).toBe(true);
  });

  it("refuses an output folder that cannot be created and writes nothing", async () => {
    const engine = await startEngine({ dotenv: "OPENROUTER_TEXT_MODEL=a/b\n" });
    const rpc = await engine.rpc();
    await writeFile(join(engine.dataDir, "a-file"), "not a folder");
    const failure = await rpc
      .call("settings.update", { outputDir: "./a-file/inside", textModel: "c/d" })
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ _tag: "UnframedError", code: "bad_request" });
    expect((failure as Error).message).toMatch(/^Cannot use that folder: .+/);
    expect(await readFile(join(engine.dataDir, ".env"), "utf8")).toBe("OPENROUTER_TEXT_MODEL=a/b\n");
    expect((await rpc.call("settings.get")).textModel).toBe("a/b");
  });

  it("creates a new output folder, recursively, before saving it", async () => {
    const engine = await startEngine();
    const target = join(await makeTempDir("unframed-out-"), "deep", "er", "output");
    const answer = await (await engine.rpc()).call("settings.update", { outputDir: target });
    expect(answer.outputDir).toBe(target);
    expect((await stat(target)).isDirectory()).toBe(true);
    expect(await readFile(join(engine.dataDir, ".env"), "utf8")).toBe(`OUTPUT_DIR=${target}\n`);
  });
});
