import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Kit } from "@unframed/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startEngine, type TestEngine } from "./harness.ts";

const DOCUMENT = "document:document";
const kit: Kit = {
  format: 1,
  name: "Brand",
  modes: ["light", "dark"],
  tokens: [{ path: "color/brand/primary", type: "color", values: { light: "#1a73e8", dark: "#8ab4f8" } }],
};
const documentWith = (value: Kit | null) => ({ id: DOCUMENT, typeName: "document", gridSize: 10, name: "", meta: value === null ? {} : { unframed: { kit: value } } });
const OLD_ENTRY = `{ "id":"p-1700000000000", "name":"Old flow",\n    "nodes": [ {"type":"output"} ] }`;
const NEWER = "The library kit changed since this project took it. Update from kit first, so you do not overwrite those changes.";

describe("the kit library store (spec 19, task 29)", () => {
  let engine: TestEngine;
  const presetsFile = () => join(engine.dataDir, "output", "presets.json");
  const readRaw = () => readFile(presetsFile(), "utf8");
  const readPresets = async () => JSON.parse(await readRaw()) as Array<Record<string, unknown>>;

  beforeAll(async () => {
    engine = await startEngine({ env: { UNFRAMED_TEST_CANVAS: "1" } });
    await (await engine.rpc()).call("projects.create", { name: "board" });
  });
  afterAll(() => engine.dispose());
  beforeEach(async () => {
    await mkdir(join(engine.dataDir, "output"), { recursive: true });
    await rm(presetsFile(), { force: true });
  });

  const setKit = async (value: Kit | null) =>
    (await engine.rpc()).call("testCanvas.apply", { project: "board", change: { put: [documentWith(value)], remove: [] }, origin: { kind: "server", id: "kit:test" } });

  it("saves the project's kit to the library as a kit entry with revision 1 and no content", async () => {
    await setKit(kit);
    const { preset } = (await (await engine.rpc()).call("kit.saveToLibrary", { project: "board", name: "Brand kit", summary: "Our colours" })) as { preset: Record<string, any> };
    expect(preset).toMatchObject({ format: 2, source: "user", kind: "kit", name: "Brand kit", summary: "Our colours", revision: 1, kit: { name: "Brand", modes: ["light", "dark"], tokens: kit.tokens } });
    expect(preset).not.toHaveProperty("content");
    expect(preset).not.toHaveProperty("medium");
    expect(preset.kit).not.toHaveProperty("from");
    const stored = await readPresets();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ id: preset.id, kind: "kit", revision: 1 });
  });

  it("lists kit entries with library.list and deletes them with library.delete", async () => {
    await setKit(kit);
    const rpc = await engine.rpc();
    const { preset } = (await rpc.call("kit.saveToLibrary", { project: "board", name: "Brand kit", summary: "" })) as { preset: Record<string, any> };
    expect((await rpc.call("library.list")).presets).toEqual([expect.objectContaining({ id: preset.id, kind: "kit", revision: 1 })]);
    await rpc.call("library.delete", { id: preset.id });
    expect(await rpc.call("library.list")).toEqual({ presets: [] });
  });

  it("refuses a save with no name, and a save from a project with no kit, writing nothing", async () => {
    const rpc = await engine.rpc();
    await setKit(kit);
    await expect(rpc.call("kit.saveToLibrary", { project: "board", name: "   ", summary: "" })).rejects.toMatchObject({ code: "bad_request", message: "Give it a name." });
    await setKit(null);
    await expect(rpc.call("kit.saveToLibrary", { project: "board", name: "Brand", summary: "" })).rejects.toMatchObject({ message: "This project has no kit yet." });
    await expect(readRaw()).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps entries it does not understand, byte for byte, when it writes", async () => {
    await writeFile(presetsFile(), `[\n  ${OLD_ENTRY}\n]`);
    await setKit(kit);
    await (await engine.rpc()).call("kit.saveToLibrary", { project: "board", name: "Brand kit", summary: "" });
    expect(await readRaw()).toContain(OLD_ENTRY);
  });

  it("updates a linked library kit in place: its tokens, a revision plus one, and a new saved time", async () => {
    const rpc = await engine.rpc();
    await setKit(kit);
    const { preset } = (await rpc.call("kit.saveToLibrary", { project: "board", name: "Brand kit", summary: "" })) as { preset: Record<string, any> };
    const from = { presetId: preset.id as string, revision: 1, base: { modes: kit.modes, tokens: kit.tokens } };
    const changed: Kit = { ...kit, tokens: [...kit.tokens, { path: "space/gap", type: "dimension", value: "8px" }], from };
    await setKit(changed);
    const updated = (await rpc.call("kit.updateInLibrary", { project: "board" })) as { preset: Record<string, any> };
    expect(updated.preset).toMatchObject({ id: preset.id, kind: "kit", revision: 2, kit: { tokens: changed.tokens, modes: kit.modes } });
    expect(updated.preset.kit).not.toHaveProperty("from");
    const stored = await readPresets();
    expect(stored[0]).toMatchObject({ id: preset.id, revision: 2 });
  });

  it("refuses an update of a kit that is not linked, and of a preset that is gone", async () => {
    const rpc = await engine.rpc();
    await setKit(kit);
    await expect(rpc.call("kit.updateInLibrary", { project: "board" })).rejects.toMatchObject({ message: "This kit is not linked to your library." });
    await setKit({ ...kit, from: { presetId: "user-gone", revision: 1, base: { modes: kit.modes, tokens: kit.tokens } } });
    await expect(rpc.call("kit.updateInLibrary", { project: "board" })).rejects.toMatchObject({ message: "That preset is not in your library." });
  });

  it("refuses an update when the library kit is newer than the revision the project took", async () => {
    const rpc = await engine.rpc();
    await setKit(kit);
    const { preset } = (await rpc.call("kit.saveToLibrary", { project: "board", name: "Brand kit", summary: "" })) as { preset: Record<string, any> };
    await setKit({ ...kit, from: { presetId: preset.id as string, revision: 1, base: { modes: kit.modes, tokens: kit.tokens } } });
    await rpc.call("kit.updateInLibrary", { project: "board" });
    // The project still says revision 1; the library is now at 2.
    await setKit({ ...kit, tokens: [], from: { presetId: preset.id as string, revision: 1, base: { modes: kit.modes, tokens: kit.tokens } } });
    await expect(rpc.call("kit.updateInLibrary", { project: "board" })).rejects.toMatchObject({ code: "conflict", message: NEWER });
    expect((await readPresets())[0]).toMatchObject({ revision: 2 });
  });
});
