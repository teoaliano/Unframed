import { describe, expect, it } from "vitest";
import { startEngine } from "./harness.ts";

describe("settings.subscribe", () => {
  it("emits the current settings first, then one value per change from any socket", async () => {
    const engine = await startEngine({ dotenv: "OPENROUTER_TEXT_MODEL=first/model\n" });
    const watcher = await engine.rpc();
    const editor = await engine.rpc();
    const stream = watcher.subscribe("settings.subscribe");
    const initial = await stream.next();
    expect(initial.textModel).toBe("first/model");
    expect(initial).toEqual(await watcher.call("settings.get"));

    await editor.call("settings.update", { textModel: "second/model" });
    expect((await stream.next()).textModel).toBe("second/model");

    await watcher.call("settings.update", { videoModel: "video/model" });
    const third = await stream.next();
    expect(third).toMatchObject({ textModel: "second/model", videoModel: "video/model" });

    // A refused update is not a change.
    await editor.call("settings.update", { key: "nope" }).catch(() => {});
    await editor.call("settings.update", { imageModel: "image/model" });
    expect((await stream.next()).imageModel).toBe("image/model");
    expect(stream.values).toHaveLength(4);
  });

  it("gives a late subscriber the current value, not the history", async () => {
    const engine = await startEngine();
    const rpc = await engine.rpc();
    await rpc.call("settings.update", { textModel: "a/one" });
    await rpc.call("settings.update", { textModel: "a/two" });
    const stream = rpc.subscribe("settings.subscribe");
    expect((await stream.next()).textModel).toBe("a/two");
    expect(stream.values).toHaveLength(1);
  });
});
