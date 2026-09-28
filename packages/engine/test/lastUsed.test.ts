import { describe, expect, it } from "vitest";
import { startEngine } from "./harness.ts";

const stored = { model: "google/gemini-3-pro-image", props: { quality: "high", aspect_ratio: "2:3" } };

describe("last-used values", () => {
  it("are kept as the lastUsed.<medium> preferences and survive a restart", async () => {
    const engine = await startEngine();
    const rpc = await engine.rpc();
    await rpc.call("preferences.set", { key: "lastUsed.image", value: stored });
    await engine.stop();
    const again = await startEngine({ dataDir: engine.dataDir });
    expect(await (await again.rpc()).call("preferences.get", { keys: ["lastUsed.image"] })).toEqual({ values: { "lastUsed.image": stored } });
  });

  it("lose their stored model when that medium's default model changes, and keep their props", async () => {
    const engine = await startEngine();
    const rpc = await engine.rpc();
    await rpc.call("preferences.set", { key: "lastUsed.image", value: stored });
    await rpc.call("preferences.set", { key: "lastUsed.text", value: { model: "x/text", props: {} } });
    await rpc.call("settings.update", { imageModel: "black-forest-labs/flux-2" });
    expect(await rpc.call("preferences.get", { keys: ["lastUsed.image", "lastUsed.text"] })).toEqual({
      values: { "lastUsed.image": { props: stored.props }, "lastUsed.text": { model: "x/text", props: {} } },
    });
    await rpc.call("settings.update", { textModel: "google/gemini-3.5-flash" });
    expect((await rpc.call("preferences.get", { keys: ["lastUsed.text"] })).values).toEqual({ "lastUsed.text": { props: {} } });
  });

  it("are left alone by a settings change that is not a default model, or one that is refused", async () => {
    const engine = await startEngine();
    const rpc = await engine.rpc();
    await rpc.call("preferences.set", { key: "lastUsed.image", value: stored });
    await rpc.call("settings.update", { claudePath: "claude" });
    await expect(rpc.call("settings.update", { imageModel: "not a slug" })).rejects.toMatchObject({ code: "bad_request" });
    expect((await rpc.call("preferences.get", { keys: ["lastUsed.image"] })).values).toEqual({ "lastUsed.image": stored });
  });
});
