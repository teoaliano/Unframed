import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startEngine } from "./harness.ts";

describe("settings.update line rules", () => {
  it("writing the image model deletes the legacy OPENROUTER_MODEL line", async () => {
    const engine = await startEngine({ dotenv: "OPENROUTER_MODEL=google/gemini-3-pro-image\nOUTPUT_DIR=./out\n" });
    const rpc = await engine.rpc();
    expect((await rpc.call("settings.get")).imageModel).toBe("google/gemini-3-pro-image");
    await rpc.call("settings.update", { imageModel: "openai/gpt-image-2" });
    expect(await readFile(join(engine.dataDir, ".env"), "utf8")).toBe(
      "OUTPUT_DIR=./out\nOPENROUTER_IMAGE_MODEL=openai/gpt-image-2\n",
    );
    expect((await rpc.call("settings.get")).imageModel).toBe("openai/gpt-image-2");
  });

  it("leaves OPENROUTER_MODEL alone when another field is written", async () => {
    const engine = await startEngine({ dotenv: "OPENROUTER_MODEL=google/gemini-3-pro-image\n" });
    await (await engine.rpc()).call("settings.update", { textModel: "a/b" });
    expect(await readFile(join(engine.dataDir, ".env"), "utf8")).toBe(
      "OPENROUTER_MODEL=google/gemini-3-pro-image\nOPENROUTER_TEXT_MODEL=a/b\n",
    );
  });

  it.each([
    ["claudePath", "CLAUDE_PATH", "/opt/claude"],
    ["codexPath", "CODEX_PATH", "/opt/codex"],
    ["claudeConfigDir", "CLAUDE_CONFIG_DIR", "/Users/someone/.claude-alt"],
  ] as const)("clearing %s with '' deletes its line so the shell's value is found again", async (field, variable, value) => {
    const engine = await startEngine({
      dotenv: `${variable}=${value}\nOPENROUTER_TEXT_MODEL=a/b\n`,
      env: { [variable]: "/from/the/shell" },
    });
    const rpc = await engine.rpc();
    expect((await rpc.call("settings.get"))[field]).toBe(value);
    const answer = await rpc.call("settings.update", { [field]: "" });
    expect(await readFile(join(engine.dataDir, ".env"), "utf8")).toBe("OPENROUTER_TEXT_MODEL=a/b\n");
    expect(answer[field]).toBe("/from/the/shell");
  });

  it("clearing with no shell value leaves the field empty", async () => {
    const engine = await startEngine({ dotenv: "CLAUDE_PATH=/opt/claude\n" });
    const answer = await (await engine.rpc()).call("settings.update", { claudePath: "" });
    expect(answer.claudePath).toBe("");
    expect(await readFile(join(engine.dataDir, ".env"), "utf8")).toBe("");
  });
});
