import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startEngine, type TestEngine } from "./harness.ts";
import type { TestRpcClient } from "./rpcClient.ts";

const ORIGINAL = "# keep\nOPENROUTER_API_KEY=sk-or-v1-original0000\nOPENROUTER_TEXT_MODEL=a/b\n";

describe("settings.update refusals", () => {
  let engine: TestEngine;
  let rpc: TestRpcClient;
  beforeAll(async () => {
    engine = await startEngine({ dotenv: ORIGINAL });
    rpc = await engine.rpc();
  });
  afterAll(() => engine.dispose());

  it.each([
    [{ key: "not-a-key" }, 'That does not look like an OpenRouter key. Keys start with "sk-or-".'],
    [{ outputDir: "bad#dir" }, "That folder path has characters that cannot be saved."],
    [{ claudePath: "claude; rm -rf ~" }, "That does not look like a command name or a path to one."],
    [{ codexPath: "$(whoami)" }, "That does not look like a command name or a path to one."],
    [{ claudeConfigDir: "relative/.claude" }, "The config folder has to be an absolute path."],
    [{ imageModel: "no-slash" }, 'That does not look like a model slug. Expected something like "openai/gpt-image-2".'],
    [{ textModel: "a b/c" }, 'That does not look like a model slug. Expected something like "openai/gpt-image-2".'],
    [{ videoModel: "" }, 'That does not look like a model slug. Expected something like "openai/gpt-image-2".'],
    [{}, "Nothing to save."],
    [{ key: "sk-or-v1-newkey1234567", imageModel: "bad" }, 'That does not look like a model slug. Expected something like "openai/gpt-image-2".'],
  ])("refuses %j with bad_request and leaves .env and the running settings unchanged", async (patch, message) => {
    const before = await rpc.call("settings.get");
    await expect(rpc.call("settings.update", patch)).rejects.toMatchObject({
      _tag: "UnframedError",
      code: "bad_request",
      message,
    });
    expect(await readFile(join(engine.dataDir, ".env"), "utf8")).toBe(ORIGINAL);
    expect(await rpc.call("settings.get")).toEqual(before);
  });
});
