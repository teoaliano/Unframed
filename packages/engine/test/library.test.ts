import { chmod, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startEngine, type TestEngine } from "./harness.ts";

const recipe = { medium: "image", model: "openai/gpt-image-2", params: { quality: "low" }, runs: 3 };

/** Preset content: one group holding one prompt, with a recipe when asked. */
const groupContent = (name: string, withRecipe = false) => ({
  schema: { schemaVersion: 2, sequences: {} },
  shapes: [
    { id: "shape:g", typeName: "shape", type: "frame", parentId: "page:page", x: 0, y: 0, props: { w: 420, h: 280, name, color: "black" }, meta: withRecipe ? { unframed: { recipe } } : {} },
    { id: "shape:p", typeName: "shape", type: "text", parentId: "shape:g", x: 28, y: 56, props: { richText: { type: "doc", content: [] } }, meta: { ref: "100" } },
  ],
  rootShapeIds: ["shape:g"],
  assets: [],
  bindings: [],
});

/** An entry the old app wrote: no `format: 2`, spelled the way it spelled it. */
const OLD_ENTRY = `{ "id":"p-1700000000000", "name":"Old flow",\n    "nodes": [ {"type":"output"} ] }`;

describe("the preset store", () => {
  let engine: TestEngine;
  const presetsFile = () => join(engine.dataDir, "output", "presets.json");
  const readPresets = async () => JSON.parse(await readFile(presetsFile(), "utf8")) as Array<Record<string, unknown>>;

  beforeAll(async () => {
    engine = await startEngine();
  });
  afterAll(() => engine.dispose());
  beforeEach(async () => {
    await mkdir(join(engine.dataDir, "output"), { recursive: true });
    await rm(presetsFile(), { force: true });
  });

  it("lists nothing, and writes nothing, when there is no presets.json", async () => {
    expect(await (await engine.rpc()).call("library.list")).toEqual({ presets: [] });
    await expect(readFile(presetsFile(), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails a list over a file that is not JSON", async () => {
    await writeFile(presetsFile(), "[{ not json");
    await expect((await engine.rpc()).call("library.list")).rejects.toMatchObject({ message: "presets.json is not valid JSON." });
  });

  it("fails a list over a file it cannot read with the read error's message", async () => {
    await writeFile(presetsFile(), "[]");
    await chmod(presetsFile(), 0o000);
    try {
      await expect((await engine.rpc()).call("library.list")).rejects.toMatchObject({ message: expect.stringContaining("EACCES") });
    } finally {
      await chmod(presetsFile(), 0o600);
    }
  });

  it("saves: mints the id and time, derives kind and medium, puts the new preset first and writes the whole array", async () => {
    const rpc = await engine.rpc();
    const before = Date.now();
    const first = await rpc.call("library.save", { name: "  Portrait retouch ", summary: " Soft light ", content: groupContent("portrait", true) });
    expect(first.preset).toMatchObject({ format: 2, source: "user", name: "Portrait retouch", summary: "Soft light", kind: "recipe", medium: "image" });
    const stamp = Number.parseInt(first.preset.id.slice("user-".length), 36);
    expect(first.preset.id).toMatch(/^user-[0-9a-z]+$/);
    expect(stamp).toBeGreaterThanOrEqual(before);
    expect(Date.parse(first.preset.savedAt!)).toBeGreaterThanOrEqual(before);

    const second = await rpc.call("library.save", { name: "Beach set", summary: "", needs: "Add a picture.", content: groupContent("beach") });
    expect(second.preset).toMatchObject({ kind: "group", needs: "Add a picture." });
    expect(second.preset).not.toHaveProperty("medium");
    expect((await readPresets()).map((entry) => entry.name)).toEqual(["Beach set", "Portrait retouch"]);
    expect((await rpc.call("library.list")).presets.map((preset) => preset.id)).toEqual([second.preset.id, first.preset.id]);
    expect((await readPresets())[1]).toEqual(first.preset);
    // Written through a temp file renamed over it: nothing is left beside it.
    expect((await readdir(join(engine.dataDir, "output"))).filter((name) => name.includes("presets.json."))).toEqual([]);
  });

  it("increments the millisecond until the minted id is free", async () => {
    const rpc = await engine.rpc();
    // Every millisecond from a little before now to five seconds ahead is taken, so the save's own clock lands on a taken id.
    const t0 = Date.now() - 100;
    const taken = Array.from({ length: 5100 }, (_, offset) => `{"id":"user-${(t0 + offset).toString(36)}"}`);
    await writeFile(presetsFile(), `[${taken.join(",")}]`);
    const { preset } = await rpc.call("library.save", { name: "New", summary: "", content: groupContent("new") });
    expect(preset.id).toBe(`user-${(t0 + 5100).toString(36)}`);
  });

  it("refuses an empty name and content that is not one group, writing nothing", async () => {
    const rpc = await engine.rpc();
    await expect(rpc.call("library.save", { name: "   ", summary: "", content: groupContent("x") })).rejects.toMatchObject({ code: "bad_request", message: "Give it a name." });
    const twoRoots = { ...groupContent("x"), rootShapeIds: ["shape:g", "shape:p"] };
    const notAGroup = { ...groupContent("x"), rootShapeIds: ["shape:p"] };
    for (const content of [twoRoots, notAGroup, { shapes: [] }, "nothing"]) {
      await expect(rpc.call("library.save", { name: "x", summary: "", content })).rejects.toMatchObject({ code: "bad_request", message: "A preset is one group." });
    }
    await expect(readFile(presetsFile(), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("re-reads the file before every save, so a preset written behind its back survives", async () => {
    const rpc = await engine.rpc();
    const first = await rpc.call("library.save", { name: "First", summary: "", content: groupContent("first") });
    const behind = { format: 2, id: "user-behind", source: "user", savedAt: "2026-01-01T00:00:00.000Z", name: "Behind", summary: "", kind: "group", content: groupContent("behind") };
    await writeFile(presetsFile(), JSON.stringify([behind, ...(await readPresets())], null, 2));
    await rpc.call("library.save", { name: "Second", summary: "", content: groupContent("second") });
    expect((await readPresets()).map((entry) => entry.name)).toEqual(["Second", "Behind", "First"]);
    expect((await rpc.call("library.list")).presets.map((preset) => preset.id)).toContain(first.preset.id);
  });

  it("fails a save over a damaged file and leaves it byte for byte", async () => {
    const damaged = '[{"format": 2, "id": "user-1", "name": "Kept"},, oops';
    await writeFile(presetsFile(), damaged);
    await expect((await engine.rpc()).call("library.save", { name: "New", summary: "", content: groupContent("new") })).rejects.toMatchObject({
      message: "presets.json is not valid JSON.",
    });
    await expect((await engine.rpc()).call("library.delete", { id: "user-1" })).rejects.toMatchObject({ message: "presets.json is not valid JSON." });
    expect(await readFile(presetsFile(), "utf8")).toBe(damaged);
  });

  it("keeps entries it does not understand, in place and byte for byte, on every save and delete, and never lists them", async () => {
    const rpc = await engine.rpc();
    const mine = `{"format":2,"id":"user-mine","source":"user","savedAt":"2026-02-02T00:00:00.000Z","name":"Mine","summary":"","kind":"group","content":${JSON.stringify(groupContent("mine"))}}`;
    const broken = `{"format":2,"id":"user-broken"}`;
    await writeFile(presetsFile(), `[\n  ${OLD_ENTRY},\n  ${mine},\n  ${broken}\n]`);
    expect((await rpc.call("library.list")).presets.map((preset) => preset.id)).toEqual(["user-mine"]);

    const saved = await rpc.call("library.save", { name: "New", summary: "", content: groupContent("new") });
    let text = await readFile(presetsFile(), "utf8");
    expect(text).toContain(OLD_ENTRY);
    expect(text).toContain(broken);
    expect((await readPresets()).map((entry) => entry.id)).toEqual([saved.preset.id, "p-1700000000000", "user-mine", "user-broken"]);

    expect(await rpc.call("library.delete", { id: "user-mine" })).toEqual({ ok: true });
    text = await readFile(presetsFile(), "utf8");
    expect(text).toContain(OLD_ENTRY);
    expect(text).toContain(broken);
    expect((await readPresets()).map((entry) => entry.id)).toEqual([saved.preset.id, "p-1700000000000", "user-broken"]);
    // An entry this version does not understand is not "in your library", even by its id.
    await expect(rpc.call("library.delete", { id: "p-1700000000000" })).rejects.toMatchObject({ code: "not_found", message: "That preset is not in your library." });
  });

  it("deletes by id, and refuses an id that is not in the file", async () => {
    const rpc = await engine.rpc();
    const keep = await rpc.call("library.save", { name: "Keep", summary: "", content: groupContent("keep") });
    const drop = await rpc.call("library.save", { name: "Drop", summary: "", content: groupContent("drop") });
    await rpc.call("library.delete", { id: drop.preset.id });
    expect((await rpc.call("library.list")).presets.map((preset) => preset.id)).toEqual([keep.preset.id]);
    await expect(rpc.call("library.delete", { id: drop.preset.id })).rejects.toMatchObject({ code: "not_found", message: "That preset is not in your library." });
    await expect(rpc.call("library.delete", { id: "user-never" })).rejects.toMatchObject({ message: "That preset is not in your library." });
  });

  it("lands two saves sent at once, each with its own id", async () => {
    const [one, two] = await Promise.all([engine.rpc(), engine.rpc()]);
    const saves = await Promise.all([
      one.call("library.save", { name: "One", summary: "", content: groupContent("one") }),
      two.call("library.save", { name: "Two", summary: "", content: groupContent("two") }),
      one.call("library.save", { name: "Three", summary: "", content: groupContent("three") }),
    ]);
    expect(new Set(saves.map((save) => save.preset.id)).size).toBe(3);
    expect((await readPresets()).map((entry) => entry.name).sort()).toEqual(["One", "Three", "Two"]);
  });
});
