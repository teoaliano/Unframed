import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { canvasSchema } from "@unframed/contracts";
import { splitJsonArray } from "@unframed/domain";
import { describe, expect, it } from "vitest";
import { startLegacyEngine } from "./legacy.ts";

const OLD_IDS = ["user-mf2k8a1c", "user-mf1x9k4b", "user-mf1b5y2e", "user-mf0a3z7d"];

describe("library.list over old presets", () => {
  it("appends every old entry converted, marked legacy with its notes, after the current ones", async () => {
    const { engine } = await startLegacyEngine();
    const { presets } = await (await engine.rpc()).call("library.list");
    expect(presets.map((preset) => preset.id)).toEqual(["user-mfe1q9w2", ...OLD_IDS]);
    expect(presets[0]).not.toHaveProperty("legacy");
    const byId = new Map(presets.map((preset) => [preset.id, preset]));
    expect(byId.get("user-mf2k8a1c")).toMatchObject({
      format: 2,
      source: "user",
      name: "Split into parts",
      kind: "recipe",
      medium: "image",
      legacy: true,
      notes: ["Its old results were not kept.", "The text step @planner lost its model. Run it with the composer."],
    });
    expect(byId.get("user-mf0a3z7d")).toMatchObject({ kind: "group", legacy: true, notes: [] });
    expect(byId.get("user-mf1b5y2e")).toMatchObject({ kind: "recipe", medium: "text", notes: [] });
    // The content carries the canvas schema it was written in, so tldraw's migrations apply on insert.
    expect(byId.get("user-mf0a3z7d")!.content.schema).toEqual(JSON.parse(JSON.stringify(canvasSchema().serialize())));
  });

  it("never writes the converted form: presets.json stays byte-identical over lists, saves and deletes", async () => {
    const { engine, outputDir } = await startLegacyEngine();
    const path = join(outputDir, "presets.json");
    const before = await readFile(path, "utf8");
    const rpc = await engine.rpc();
    await rpc.call("library.list");
    await rpc.call("library.list");
    expect(await readFile(path, "utf8")).toBe(before);

    const saved = await rpc.call("library.save", {
      name: "New one",
      summary: "",
      content: {
        schema: canvasSchema().serialize(),
        shapes: [{ id: "shape:g", typeName: "shape", type: "frame", parentId: "page:page", x: 0, y: 0, props: { w: 420, h: 280, name: "g", color: "black" }, meta: {} }],
        rootShapeIds: ["shape:g"],
        assets: [],
        bindings: [],
      },
    });
    // Every entry but the new first one is kept as written.
    expect(splitJsonArray(await readFile(path, "utf8"))!.slice(1)).toEqual(splitJsonArray(before));
    await rpc.call("library.delete", { id: saved.preset.id });
    expect(splitJsonArray(await readFile(path, "utf8"))).toEqual(splitJsonArray(before));
  });

  it("deletes a converted preset by removing its old entry, and keeps every other entry as it was", async () => {
    const { engine, outputDir } = await startLegacyEngine();
    const path = join(outputDir, "presets.json");
    const before = JSON.parse(await readFile(path, "utf8")) as Array<{ id: string }>;
    const rpc = await engine.rpc();
    expect(await rpc.call("library.delete", { id: "user-mf1x9k4b" })).toEqual({ ok: true });
    const after = JSON.parse(await readFile(path, "utf8")) as Array<{ id: string }>;
    expect(after).toEqual(before.filter((entry) => entry.id !== "user-mf1x9k4b"));
    expect((await rpc.call("library.list")).presets.map((preset) => preset.id)).toEqual(["user-mfe1q9w2", "user-mf2k8a1c", "user-mf1b5y2e", "user-mf0a3z7d"]);
    await expect(rpc.call("library.delete", { id: "user-mf1x9k4b" })).rejects.toMatchObject({ message: "That preset is not in your library." });
  });
});

describe("library.copyFiles for old presets", () => {
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  it("finds preset-file:/<file> in the project the preset goes into", async () => {
    const { engine, folder } = await startLegacyEngine();
    const rpc = await engine.rpc();
    const [copied, missing] = await rpc.call("library.copyFiles", {
      project: "everything",
      files: [
        { project: "", file: "1789030920022-hiker.png" },
        { project: "", file: "1789030920022-hiker.png-not-here" },
      ],
    });
    expect(copied).toEqual({ file: expect.stringMatching(/^\d+-hiker\.png$/) });
    expect(missing).toEqual({ missing: true });
    const file = (copied as { file: string }).file;
    expect(await readFile(join(folder("everything"), file))).toEqual(await readFile(join(folder("everything"), "1789030920022-hiker.png")));
  });

  it("writes a data URL's bytes into the project with a legacy-preset sidecar, and answers missing for one that is not base64", async () => {
    const { engine, folder } = await startLegacyEngine();
    const rpc = await engine.rpc();
    const answers = await rpc.call("library.copyFiles", {
      project: "legacy-snapshot",
      files: [{ dataUrl: PNG }, { dataUrl: "data:image/png,not-base64" }, { dataUrl: "not a data url" }],
    });
    expect(answers[1]).toEqual({ missing: true });
    expect(answers[2]).toEqual({ missing: true });
    const file = (answers[0] as { file: string }).file;
    expect(file).toMatch(/^\d+-upload\.png$/);
    const bytes = await readFile(join(folder("legacy-snapshot"), file));
    expect(bytes.subarray(1, 4).toString("latin1")).toBe("PNG");
    const sidecar = JSON.parse(await readFile(join(folder("legacy-snapshot"), file.replace(/\.png$/, ".json")), "utf8"));
    expect(sidecar).toEqual({ source: "legacy-preset", fileName: "", mime: "image/png", bytes: bytes.length, at: expect.any(String) });
  });
});
