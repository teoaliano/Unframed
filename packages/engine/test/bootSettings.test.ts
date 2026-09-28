import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir, startEngine } from "./harness.ts";

describe("boot reads settings", () => {
  it("shows a pre-written .env in server.health", async () => {
    const engine = await startEngine({
      dotenv: [
        "# written by hand",
        "OPENROUTER_API_KEY=sk-or-v1-0123456789abcd",
        "OPENROUTER_IMAGE_MODEL=black-forest-labs/flux.2-pro",
        "OPENROUTER_TEXT_MODEL=anthropic/claude-sonnet-5",
        "OPENROUTER_VIDEO_MODEL=google/veo-4",
        "OUTPUT_DIR=./art",
        "CLAUDE_PATH=/opt/bin/claude",
        "CODEX_PATH=codex-nightly",
        "CLAUDE_CONFIG_DIR=/Users/someone/.claude-work",
        "",
      ].join("\n"),
    });
    const health = await (await engine.rpc()).call("server.health");
    expect(health).toMatchObject({
      hasKey: true,
      keyHint: "abcd",
      imageModel: "black-forest-labs/flux.2-pro",
      textModel: "anthropic/claude-sonnet-5",
      videoModel: "google/veo-4",
      outputDir: join(engine.dataDir, "art"),
      claudePath: "/opt/bin/claude",
      codexPath: "codex-nightly",
      claudeConfigDir: "/Users/someone/.claude-work",
    });
  });

  it("lets .env beat the process environment", async () => {
    const engine = await startEngine({
      dotenv: "OPENROUTER_TEXT_MODEL=from/dotenv\nOUTPUT_DIR=./from-dotenv\n",
      env: { OPENROUTER_TEXT_MODEL: "from/process", OUTPUT_DIR: "/tmp/from-process", OPENROUTER_VIDEO_MODEL: "process/only" },
    });
    const health = await (await engine.rpc()).call("server.health");
    expect(health.textModel).toBe("from/dotenv");
    expect(health.outputDir).toBe(join(engine.dataDir, "from-dotenv"));
    expect(health.videoModel).toBe("process/only");
  });

  it("applies the defaults when nothing is set", async () => {
    const engine = await startEngine();
    const health = await (await engine.rpc()).call("server.health");
    expect(health).toMatchObject({
      hasKey: false,
      keyHint: "",
      imageModel: "openai/gpt-image-2",
      textModel: "google/gemini-3.5-flash-lite",
      videoModel: "bytedance/seedance-2.0",
      outputDir: join(engine.dataDir, "output"),
      claudePath: "",
      codexPath: "",
      claudeConfigDir: "",
    });
  });

  it("counts an empty value as unset", async () => {
    const engine = await startEngine({
      dotenv: "OPENROUTER_API_KEY=\nOPENROUTER_IMAGE_MODEL=\nOUTPUT_DIR=\nOPENROUTER_TEXT_MODEL=\n",
      env: { OPENROUTER_TEXT_MODEL: "process/text" },
    });
    const health = await (await engine.rpc()).call("server.health");
    expect(health.hasKey).toBe(false);
    expect(health.imageModel).toBe("openai/gpt-image-2");
    expect(health.outputDir).toBe(join(engine.dataDir, "output"));
    expect(health.textModel).toBe("process/text");
    expect(engine.stdout()).toContain("  api key:  MISSING");
  });

  it("resolves OUTPUT_DIR against the data folder and passes an absolute one through", async () => {
    const elsewhere = await makeTempDir("unframed-out-");
    const relative = await startEngine({ dotenv: "OUTPUT_DIR=../sibling/out\n" });
    expect((await (await relative.rpc()).call("server.health")).outputDir).toBe(join(relative.dataDir, "../sibling/out"));
    const absolute = await startEngine({ dotenv: `OUTPUT_DIR=${elsewhere}\n` });
    expect((await (await absolute.rpc()).call("server.health")).outputDir).toBe(elsewhere);
    expect(absolute.stdout()).toContain(`  output:   ${elsewhere}\n`);
  });
});
