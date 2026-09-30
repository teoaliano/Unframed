import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir, startEngine } from "./harness.ts";

describe("preferences store", () => {
  it("round-trips a value and deletes it with null", async () => {
    const engine = await startEngine();
    const rpc = await engine.rpc();
    const value = { items: [1, "two", { three: true }], nested: { deep: null } };
    expect(await rpc.call("preferences.set", { key: "lastUsed.image", value })).toEqual({});
    await rpc.call("preferences.set", { key: "library.view", value: "list" });
    expect(await rpc.call("preferences.get", {})).toEqual({ values: { "lastUsed.image": value, "library.view": "list" } });
    expect(await rpc.call("preferences.get", { keys: ["library.view", "missing"] })).toEqual({
      values: { "library.view": "list" },
    });

    await rpc.call("preferences.set", { key: "library.view", value: null });
    expect(await rpc.call("preferences.get", {})).toEqual({ values: { "lastUsed.image": value } });
    const file = await readFile(join(engine.dataDir, "preferences.json"), "utf8");
    expect(file).toBe(`${JSON.stringify({ "lastUsed.image": value }, null, 2)}\n`);
    expect((await readdir(engine.dataDir)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it.each(["", "Upper", "1starts-with-digit", "has space", "slash/key", `a${"b".repeat(121)}`, "quote\"key"])(
    "refuses the key %j",
    async (key) => {
      const engine = await startEngine();
      await expect((await engine.rpc()).call("preferences.set", { key, value: 1 })).rejects.toMatchObject({
        code: "bad_request",
        message: "That is not a preference name.",
      });
    },
  );

  it("accepts every key shape in use", async () => {
    const engine = await startEngine();
    const rpc = await engine.rpc();
    for (const key of ["project.active", "lastUsed.video", "agent.stash.my-board", "agent.diffLayout", `a${"b".repeat(120)}`, "x:y_z-1"]) {
      await rpc.call("preferences.set", { key, value: key });
    }
    expect(Object.keys((await rpc.call("preferences.get", {})).values)).toHaveLength(6);
  });

  it("refuses a value over 4 MB and keeps the old one", async () => {
    const engine = await startEngine();
    const rpc = await engine.rpc();
    await rpc.call("preferences.set", { key: "agent.stash.p", value: "small" });
    await expect(
      rpc.call("preferences.set", { key: "agent.stash.p", value: "x".repeat(4 * 1024 * 1024) }),
    ).rejects.toMatchObject({ code: "bad_request", message: "That preference is too large to save." });
    expect((await rpc.call("preferences.get", { keys: ["agent.stash.p"] })).values).toEqual({ "agent.stash.p": "small" });
    await rpc.call("preferences.set", { key: "agent.stash.p", value: "x".repeat(4 * 1024 * 1024 - 2) });
  });

  it("streams the current value first, then every change from any socket", async () => {
    const engine = await startEngine();
    const watcher = await engine.rpc();
    const editor = await engine.rpc();
    await editor.call("preferences.set", { key: "project.active", value: "board" });

    const one = watcher.subscribe("preferences.subscribe", { keys: ["project.active", "library.view"] });
    expect(await one.next()).toEqual({ key: "project.active", value: "board" });
    expect(await one.next()).toEqual({ key: "library.view", value: null });
    const all = watcher.subscribe("preferences.subscribe", {});
    expect(await all.next()).toEqual({ key: "project.active", value: "board" });

    await editor.call("preferences.set", { key: "agent.followUp", value: "steer" });
    await editor.call("preferences.set", { key: "library.view", value: "card" });
    expect(await one.next()).toEqual({ key: "library.view", value: "card" });
    expect(await all.next()).toEqual({ key: "agent.followUp", value: "steer" });
    expect(await all.next()).toEqual({ key: "library.view", value: "card" });

    await editor.call("preferences.set", { key: "project.active", value: null });
    expect(await one.next()).toEqual({ key: "project.active", value: null });
    expect(one.values).toHaveLength(4);
  });

  it("reads an unparsable preferences.json as empty and replaces it on the next set", async () => {
    const dataDir = await makeTempDir();
    await writeFile(join(dataDir, "preferences.json"), "{ this is not json");
    const engine = await startEngine({ dataDir });
    const rpc = await engine.rpc();
    expect(await rpc.call("preferences.get", {})).toEqual({ values: {} });
    await rpc.call("preferences.set", { key: "library.view", value: "list" });
    expect(JSON.parse(await readFile(join(dataDir, "preferences.json"), "utf8"))).toEqual({ "library.view": "list" });
  });

  it("keeps a value across a restart on a new port", async () => {
    const dataDir = await makeTempDir();
    const first = await startEngine({ dataDir });
    await (await first.rpc()).call("preferences.set", { key: "project.active", value: "moodboard" });
    await first.stop();
    const second = await startEngine({ dataDir });
    expect(second.port).not.toBe(first.port);
    expect(await (await second.rpc()).call("preferences.get", { keys: ["project.active"] })).toEqual({
      values: { "project.active": "moodboard" },
    });
  });

  it("answers internal when the file cannot be written", async () => {
    const dataDir = await makeTempDir();
    const engine = await startEngine({ dataDir });
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(dataDir, "preferences.json"));
    const failure = await (await engine.rpc())
      .call("preferences.set", { key: "library.view", value: "list" })
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "internal" });
    expect((failure as Error).message).toMatch(/^Could not save the preference: .+/);
    expect(await (await engine.rpc()).call("preferences.get", {})).toEqual({ values: {} });
  });
});
