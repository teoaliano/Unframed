import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startEngine } from "./harness.ts";

describe("RPC socket", () => {
  it("answers server.health at /ws with ok and the settings snapshot", async () => {
    const engine = await startEngine();
    const rpc = await engine.rpc();
    const health = await rpc.call("server.health");
    expect(health).toEqual({
      ok: true,
      hasKey: false,
      keyHint: "",
      imageModel: "openai/gpt-image-2",
      textModel: "google/gemini-3.5-flash-lite",
      videoModel: "bytedance/seedance-2.0",
      outputDir: join(engine.dataDir, "output"),
      claudePath: "",
      codexPath: "",
      claudeConfigDir: "",
      previewPort: engine.previewPort,
    });
    expect(await rpc.call("settings.get")).toEqual({ ...health, ok: undefined });
  });

  it("serves several sockets at once", async () => {
    const engine = await startEngine();
    const [a, b] = await Promise.all([engine.rpc(), engine.rpc()]);
    const [ha, hb] = await Promise.all([a.call("server.health"), b.call("server.health")]);
    expect(ha.ok).toBe(true);
    expect(hb).toEqual(ha);
  });
});
